/**
 * Chromium takes an exclusive SingletonLock on a persistent profile directory,
 * so two `launchPersistentContext(PROFILE_DIR)` calls cannot overlap. Every
 * caller in this process must go through here.
 *
 * This matters more now than it used to: a context used to live for one
 * episode, but the uploader holds one for a whole batch. Without the lease,
 * browsing the Spotify catalog during a batch would fail or hang.
 */

let tail = Promise.resolve();
let holders = 0;

export class ProfileBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProfileBusyError";
    this.code = "PROFILE_BUSY";
  }
}

export function isProfileBusy() {
  return holders > 0;
}

/**
 * Run `fn` with exclusive access to the browser profile.
 *
 * @param {() => Promise<T>} fn
 * @param {{ timeoutMs?: number, label?: string }} [opts] timeoutMs bounds how
 *   long we wait to *acquire* the lease, not how long `fn` may run. A batch can
 *   legitimately hold it for an hour; a page request should give up and say so
 *   rather than hanging until the browser is free.
 * @returns {Promise<T>}
 * @template T
 */
export function withProfileLease(fn, { timeoutMs = 90_000, label = "" } = {}) {
  const prev = tail;

  let release;
  const mine = new Promise((resolve) => {
    release = resolve;
  });
  // Chain unconditionally so the queue never breaks, even if we time out below.
  tail = prev.then(() => mine);

  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            reject(
              new ProfileBusyError(
                "Navegador ocupado enviando episódios — tente de novo após o lote."
              )
            );
          }, timeoutMs)
        : null;
    timer?.unref?.();

    prev.then(async () => {
      clearTimeout(timer);
      // Acquire timed out and the caller already got an error — don't run fn,
      // just hand the lease straight to whoever is next in line.
      if (timedOut) return release();
      holders += 1;
      if (label) console.error(`[profile-lease] ${label}`);
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        holders -= 1;
        release();
      }
    });
  });
}
