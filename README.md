# Spotidraft

YouTube (vídeo / playlist / canal) → **drafts** no [Spotify for Creators](https://creators.spotify.com/).

CLI + UI web local. Default: sempre draft (nunca publica sozinho).

## O que faz

- **Home** — canal favorito, recentes (infinite scroll), playlists, fila → Spotify
- **Importar** — cola qualquer URL solta do YouTube
- **Progresso** — jobs / episódios na fila
- **Spotify** — drafts no Creators (cache + atualizar)
- **Sessão** — cola o curl de login do Creators

## Requisitos

- Node.js **≥ 22**
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) no `PATH` (ou `YT_DLP=…`)
- Chromium do Playwright (`npx playwright install chromium`)

## Setup

```bash
git clone https://github.com/brow1998/spotidraft.git
cd spotidraft
npm install
npx playwright install chromium
npm --prefix web install
```

Sessão Creators (curl do DevTools ou pela UI **Sessão**):

```bash
node bin/podcast-publisher.js import-curl ./curl.txt
```

## UI web

```bash
# terminal 1 — API
npm run server

# terminal 2 — Vite (proxy /api → :8787)
npm run dev:web
```

Abra http://127.0.0.1:5173

Produção local (API serve o build):

```bash
npm run build:web && npm run server
# http://127.0.0.1:8787
```

## CLI

```bash
node bin/podcast-publisher.js ingest "URL"
node bin/podcast-publisher.js status
```

## Testes

```bash
npm test
```

Cobertura atual: helpers puros (`normalizeChannelInput`, idioma yt-dlp, nomes de pasta). Fluxos Playwright / Creators ainda são manuais.

## Config / dados locais (não vão pro git)

| Caminho | Conteúdo |
|---------|----------|
| `data/` | config, fila SQLite, downloads, cache Creators |
| `profiles/` | browser profile / cookies do Creators |

Idioma dos títulos do YouTube: `YT_LANG=pt` (padrão). O yt-dlp usa o código `pt` (não `pt-BR`).

## Deploy / 4K longo

Ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Resumo: vídeos de horas em 4K **não cabem** em free tier de cloud; o caminho realista é **app local** (e eventualmente binário empacotado).

## Avisos

- Automação de UI no Creators; cookies são segredo local.
- Respeite ToS do YouTube / Spotify e direitos do conteúdo.
