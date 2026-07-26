import { useEffect, useId, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A real dialog: focus moves in, stays in, and comes back out where it started.
 * Escape and backdrop click both close.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {() => void} props.onClose
 */
export function Modal({ title, onClose, children, labelledBy }) {
  const cardRef = useRef(null);
  const restoreRef = useRef(null);
  const autoId = useId();
  const titleId = labelledBy || `modal-title-${autoId}`;

  useEffect(() => {
    restoreRef.current = document.activeElement;

    const card = cardRef.current;
    const focusables = card?.querySelectorAll(FOCUSABLE);
    (focusables?.[0] || card)?.focus();

    // Hide the rest of the app from AT and pointer while the dialog is up.
    const shell = document.querySelector(".app-shell");
    if (shell) shell.inert = true;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        return onClose();
      }
      if (e.key !== "Tab") return;

      const items = [...(cardRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (shell) shell.inert = false;
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={cardRef}
        tabIndex={-1}
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export default Modal;
