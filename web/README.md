# web/ — UI do Spotidraft

SPA em React 19 + Vite. Consome a API em `src/server/` do projeto pai; não roda
sozinha (o dev server faz proxy de `/api` para `127.0.0.1:8787`).

```bash
npm run dev      # Vite em :5173, proxy /api → :8787
npm run build    # gera dist/, que o servidor Node serve em produção
npm run lint     # oxlint
```

Suba a API antes: `npm run server` (ou `npm run dev:server`) na raiz.

## Como se orienta aqui

| Caminho | O que é |
|---------|---------|
| `src/Layout.jsx` | Shell: sidebar colapsável, status de sessão, FAB do Spotify |
| `src/pages/` | Uma por rota — Home, Import, Progress, Spotify, Session |
| `src/components/` | Peças compartilhadas (ProgressBar, LogPanel, Modal, Thumb…) |
| `src/hooks/useEventStream.js` | SSE com watchdog e fallback para polling |
| `src/toast/` | Provider montado acima do router, para toasts sobreviverem à navegação |
| `src/index.css` | Folha única, tokens OKLCH em `:root` (ver `DESIGN.md` na raiz) |

## Convenções que valem conhecer

- **Sem framework de estado.** `useState` por página; o que cruza rotas vai pelo
  `useOutletContext` do Layout ou por `localStorage` (`channels.js`,
  `homePrefs.js`, `sidebarPrefs.js`).
- **Progresso vem por evento, não por polling.** `useEventStream` assina
  `/api/events`; cada evento remenda uma linha em vez de rebuscar a fila.
  O polling só entra como fallback quando o SSE não passa.
- **Erros viram toast**, não banner no topo da página — e o provider fica fora
  do `<Outlet/>` justamente para a mensagem sobreviver ao `navigate`.
- **Sem TypeScript e sem test runner.** A verificação da UI é `npm run lint` mais
  rodar o app; a lógica testável mora no backend.
