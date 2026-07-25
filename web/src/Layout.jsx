import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./api";

const SPOTIFY_FALLBACK = "https://creators.spotify.com/";

function isValidShowName(name) {
  if (!name || typeof name !== "string") return false;
  const t = name.trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/^new episode$|^novo episódio$/i.test(t)) return false;
  if (t === "{}" || t === "[]") return false;
  if (
    /store and access|cookie|privacy|consent|allow all|accept all|preference|onetrust|informação|dispositivo/i.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

function IconHome() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
      />
    </svg>
  );
}

function IconImport() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5M5 14.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5"
      />
    </svg>
  );
}

function IconProgress() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 19h16M7 16V9m5 7V5m5 11v-4"
      />
    </svg>
  );
}

function IconSpotify() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        d="M8.2 10.2c2.6-1 5.6-.8 8.2.6M7.6 13c2.3-.8 4.9-.6 7.1.7M7.8 15.7c1.7-.5 3.6-.4 5.2.5"
      />
    </svg>
  );
}

function IconSession() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.5 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.5 19.2c.9-2.6 3.3-4.2 6.5-4.2s5.6 1.6 6.5 4.2"
      />
    </svg>
  );
}

const LINKS = [
  { to: "/", label: "Home", Icon: IconHome, end: true },
  { to: "/import", label: "Importar", Icon: IconImport },
  { to: "/progress", label: "Progresso", Icon: IconProgress },
  { to: "/spotify", label: "Spotify", Icon: IconSpotify },
  { to: "/session", label: "Sessão", Icon: IconSession },
];

export default function Layout() {
  const [session, setSession] = useState(null);
  const [show, setShow] = useState(null);

  const refresh = () => {
    api
      .show()
      .then((d) => {
        setSession(d.session);
        const s = d.show || null;
        if (s && !isValidShowName(s.name)) {
          setShow({ ...s, name: null });
        } else {
          setShow(s);
        }
      })
      .catch(() => setSession({ ok: false }));
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, []);

  const spotifyHref = show?.episodesUrl || SPOTIFY_FALLBACK;
  const creatorsHome = show?.homeUrl || show?.episodesUrl || SPOTIFY_FALLBACK;
  const programName = isValidShowName(show?.name) ? show.name : null;
  const programImage =
    typeof show?.imageUrl === "string" && show.imageUrl.startsWith("http")
      ? show.imageUrl
      : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <NavLink to="/" className="brand" title="Início">
            Spotidraft
          </NavLink>
          {programName ? (
            <a
              className="brand-show-link"
              href={creatorsHome}
              target="_blank"
              rel="noreferrer"
              title="Abrir no Spotify for Creators"
            >
              <span className="brand-show-avatar" aria-hidden="true">
                {programImage ? (
                  <img src={programImage} alt="" />
                ) : (
                  <span className="brand-show-fallback">
                    {programName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="brand-show-meta">
                <span className="brand-show">{programName}</span>
                <span className="brand-show-hint">Creators ↗</span>
              </span>
            </a>
          ) : null}
        </div>
        <nav className="nav" aria-label="Principal">
          {LINKS.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={Boolean(end)}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className={`chip ${session?.ok ? "ok" : "bad"}`}>
            {session?.ok ? "Sessão ok" : "Sessão ausente"}
          </span>
          <a
            className="btn btn-accent"
            href={spotifyHref}
            target="_blank"
            rel="noreferrer"
            title="Abrir no Spotify for Creators"
          >
            Abrir no Spotify
          </a>
        </header>
        <main className="content">
          <Outlet context={{ session, show, refreshSession: refresh }} />
        </main>
      </div>
    </div>
  );
}
