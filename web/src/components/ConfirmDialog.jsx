import { Modal } from "./Modal.jsx";

/**
 * Confirmation for destructive actions. Replaces window.confirm(), which blocks
 * the whole Electron window and can't be styled or made accessible.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal title={title} onClose={busy ? () => {} : onCancel}>
      <p>{message}</p>
      <div className="row modal-actions">
        {/* Cancel first in DOM order so it takes initial focus — the safe
            default for something irreversible. */}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? "btn btn-danger" : "btn btn-primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Aguarde…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
