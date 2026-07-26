import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const ToastContext = createContext(null);

const AUTO_DISMISS_MS = 6000;

/**
 * Toasts live in the Layout, outside the routed <Outlet/>, so a message pushed
 * right before navigating survives the route change. Setting a banner in page
 * state and navigating in the same tick used to unmount it before it rendered.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type, text, { timeout } = {}) => {
      const id = ++seq.current;
      setToasts((list) => [...list, { id, type, text }]);
      // Errors stay until dismissed — they usually need an action.
      const ms = timeout ?? (type === "error" ? 0 : AUTO_DISMISS_MS);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      ok: (text, o) => push("ok", text, o),
      info: (text, o) => push("info", text, o),
      error: (text, o) => push("error", text, o),
    }),
    [push, dismiss]
  );

  const polite = toasts.filter((t) => t.type !== "error");
  const assertive = toasts.filter((t) => t.type === "error");

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Two regions: a single container can't switch politeness in a way
          screen readers reliably honor. */}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
        {polite.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
      <div className="toast-region" role="alert" aria-live="assertive" aria-atomic="false">
        {assertive.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }) {
  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-text">{toast.text}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="Dispensar"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
