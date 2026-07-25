import { useOutletContext } from "react-router-dom";
import { useState } from "react";
import { api } from "../api";

export default function SessionPage() {
  const { session, refreshSession } = useOutletContext();
  const [curl, setCurl] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.saveCurl(curl);
      setMsg({
        type: "ok",
        text: `Cookies salvos (${r.cookieCount}). Sessão ${r.session?.ok ? "ok" : "incompleta"}.`,
      });
      setCurl("");
      refreshSession?.();
    } catch (e) {
      setMsg({ type: "error", text: e.message });
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
      <div className={`chip ${session?.ok ? "ok" : "bad"}`} style={{ marginBottom: "1rem" }}>
        {session?.ok
          ? `Sessão ok · ${session.cookieCount} cookies`
          : "Sem sessão válida — cole o curl abaixo"}
      </div>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
      <div className="field">
        <label htmlFor="curl">Curl / cookies</label>
        <textarea
          id="curl"
          value={curl}
          onChange={(e) => setCurl(e.target.value)}
          placeholder="curl 'https://creators.spotify.com/...' -b 'sp_dc=...; ...'"
        />
      </div>
      <button type="button" className="btn btn-primary" disabled={busy || !curl.trim()} onClick={save}>
        Salvar sessão
      </button>
    </div>
  );
}
