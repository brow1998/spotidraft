# web/: the Spotidraft UI

A React 19 + Vite SPA. It talks to the API in the parent project's `src/server/` and doesn't run on
its own (the dev server proxies `/api` to `127.0.0.1:8787`).

```bash
npm run dev      # Vite on :5173, proxies /api to :8787
npm run build    # builds dist/, which the Node server serves in production
npm run lint     # oxlint
```

Start the API first: `npm run server` (or `npm run dev:server`) from the repository root.

## Finding your way around

| Path | What it is |
|------|------------|
| `src/Layout.jsx` | Shell: collapsible sidebar, session status, Spotify FAB |
| `src/pages/` | One per route: Home, Import, Progress, Spotify, Session |
| `src/components/` | Shared pieces (ProgressBar, LogPanel, Modal, Thumb…) |
| `src/hooks/useEventStream.js` | SSE with a watchdog and a polling fallback |
| `src/toast/` | Provider mounted above the router, so toasts survive navigation |
| `src/index.css` | One stylesheet, OKLCH tokens on `:root` (see `DESIGN.md` at the root) |

## Conventions worth knowing

- **No state framework.** `useState` per page; anything that crosses routes goes through the
  Layout's `useOutletContext` or `localStorage` (`channels.js`, `homePrefs.js`, `sidebarPrefs.js`).
- **Progress arrives as events, not polling.** `useEventStream` subscribes to `/api/events`; each
  event patches one row instead of refetching the queue. Polling only kicks in when SSE can't get
  through.
- **Errors become toasts**, not a banner at the top of the page, and the provider sits outside
  `<Outlet/>` precisely so the message survives `navigate`.
- **No TypeScript and no test runner.** The UI is verified with `npm run lint` plus running the
  app; the testable logic lives in the backend.
