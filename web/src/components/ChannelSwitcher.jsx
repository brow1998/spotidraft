import { useEffect, useRef, useState } from "react";
import { Thumb } from "./Thumb.jsx";
import { IconSearch, IconStar } from "../icons.jsx";

/**
 * Remembered channels as a dropdown next to the current channel's name.
 *
 * @param {object} props
 * @param {Array} props.channels remembered, newest-used first
 * @param {object} props.current
 * @param {(c: object) => void} props.onPick
 * @param {(c: object) => void} props.onForget
 * @param {() => void} props.onSearchNew
 */
export function ChannelSwitcher({ channels, current, onPick, onForget, onSearchNew }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const others = channels.filter((c) => c.url !== current?.url);

  return (
    <div className="channel-switcher" ref={rootRef}>
      <button
        type="button"
        className="channel-switcher-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        title="Trocar de canal"
      >
        <span className="channel-switcher-label">
          {channels.length > 1 ? `${channels.length} canais` : "Canais"}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m6 9 6 6 6-6"
          />
        </svg>
      </button>

      {open && (
        <div className="channel-menu" role="menu">
          {others.length === 0 && (
            <p className="channel-menu-empty">
              Nenhum outro canal salvo ainda. Os que você abrir ficam aqui.
            </p>
          )}
          {others.map((c) => (
            <div className="channel-menu-row" key={c.url}>
              <button
                type="button"
                role="menuitem"
                className="channel-menu-item"
                onClick={() => {
                  setOpen(false);
                  onPick(c);
                }}
              >
                <span className="channel-menu-avatar">
                  <Thumb src={c.thumb} fallbackText={(c.title || "?").slice(0, 1)} />
                </span>
                <span className="channel-menu-meta">
                  <span className="channel-menu-title">{c.title}</span>
                  {c.handle && <span className="channel-menu-handle">{c.handle}</span>}
                </span>
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                title={`Esquecer ${c.title}`}
                aria-label={`Esquecer ${c.title}`}
                onClick={() => onForget(c)}
              >
                <IconStar filled />
              </button>
            </div>
          ))}

          <button
            type="button"
            role="menuitem"
            className="channel-menu-new"
            onClick={() => {
              setOpen(false);
              onSearchNew();
            }}
          >
            <IconSearch size={15} />
            Buscar outro canal
          </button>
        </div>
      )}
    </div>
  );
}

export default ChannelSwitcher;
