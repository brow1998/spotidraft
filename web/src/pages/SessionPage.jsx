import { useOutletContext } from "react-router-dom";
import { useState } from "react";
import { api } from "../api";
import { useToast } from "../toast/ToastProvider.jsx";

/** Rough shape check so an accidental paste fails here, not on the server. */
function looksLikeCurl(text) {
  const s = String(text);
  return /\bcurl\b/i.test(s) || /(^|\s)-b\s/.test(s) || /cookie:/i.test(s);
}

export default function SessionPage() {
  const { session, refreshSession } = useOutletContext();
  const toast = useToast();
  const [curl, setCurl] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState(null);

  const save = async () => {
    if (!looksLikeCurl(curl)) {
      setFieldError(
        "Isso não parece um comando cURL. Use Network → Copy → Copy as cURL."
      );
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      const r = await api.saveCurl(curl);
      if (r.session?.ok) {
        toast.ok(
          `Sessão renovada — ${r.cookieCount} cookies.${
            r.resumed ? " Envios pendentes retomados." : ""
          }`
        );
      } else {
        toast.error(
          `Salvei ${r.cookieCount} cookie(s), mas falta o sp_dc — a sessão não vai funcionar.`
        );
      }
      setCurl("");
      refreshSession?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Sessão</h1>
      <p>
        Quando o login do Creators expirar, cole aqui o curl de uma página já autenticada
        (Network → Copy as cURL) e salve.
      </p>
      <div
        className={`chip ${session == null ? "" : session.ok ? "ok" : "bad"}`}
        style={{ marginBottom: "1rem" }}
      >
        {session == null
          ? "Verificando…"
          : session.ok
            ? `Sessão ok · ${session.cookieCount} cookies`
            : "Sem sessão válida — cole o curl abaixo"}
      </div>
      <div className="field">
        <label htmlFor="curl">Curl / cookies</label>
        <textarea
          id="curl"
          value={curl}
          onChange={(e) => {
            setCurl(e.target.value);
            if (fieldError) setFieldError(null);
          }}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? "curl-error" : undefined}
          placeholder="curl 'https://creators.spotify.com/...' -b 'sp_dc=...; ...'"
        />
        {/* Field-level, next to the input that caused it — not a page-top banner. */}
        {fieldError && (
          <p id="curl-error" className="field-error" role="alert">
            {fieldError}
          </p>
        )}
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !curl.trim()}
        onClick={save}
      >
        {busy ? "Salvando…" : "Salvar sessão"}
      </button>
    </div>
  );
}
