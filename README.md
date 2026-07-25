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
node bin/spotidraft.js import-curl ./curl.txt
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

## App desktop (Electron)

Para o time usar **sem instalar Node** — um instalador por OS:

| OS | Artefato | Como gerar |
|----|----------|------------|
| Linux | `.AppImage` | `npm run electron:dist:linux` (daqui no WSL funciona) |
| Windows | `.exe` (NSIS) | `npm run electron:dist:win` **no Windows** (ou CI) |
| macOS | `.dmg` | `npm run electron:dist:mac` **no Mac** (ou CI) |

**Melhor caminho pros 3 de uma vez:** GitHub Actions  
Actions → **Desktop builds** → *Run workflow* (ou tag `v0.1.0`).  
Sobe artefatos `spotidraft-linux` / `spotidraft-win` / `spotidraft-mac`.

```bash
npm install
npm run electron:dist:linux   # local neste WSL
```

Dev com janela Electron:

```bash
npm run electron:dev
```

Dados da sessão ficam em:
- Linux: `~/.config/Spotidraft/`
- macOS: `~/Library/Application Support/Spotidraft/`
- Windows: `%APPDATA%\\Spotidraft\\`

> Cross-compile: no Linux **não** dá pra fazer DMG Mac de verdade; Windows às vezes com Wine, mas é frágil. Use CI ou a máquina do OS alvo.
>
> Mac sem notarização da Apple: o Gatekeeper avisa na 1ª abertura (botão direito → Abrir).

## CLI

```bash
node bin/spotidraft.js ingest "URL"
node bin/spotidraft.js status
```

## Testes

```bash
npm test
```

Cobertura atual: helpers puros (`normalizeChannelInput`, idioma yt-dlp, nomes de pasta). Fluxos Playwright / Creators ainda são manuais.

## Config / dados locais (não vão pro git)

| Caminho | Conteúdo |
|---------|----------|
| `data/` | config, fila SQLite, downloads, cache Creators (modo CLI/server) |
| `profiles/` | browser profile / cookies (modo CLI/server) |
| `vendor/` | yt-dlp + Chromium empacotados (gerados no prepare) |

Idioma dos títulos do YouTube: `YT_LANG=pt` (padrão). O yt-dlp usa o código `pt` (não `pt-BR`).

## Deploy / 4K longo

Ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Resumo: vídeos de horas em 4K **não cabem** em free tier de cloud; use o **app Electron local**.

## Avisos

- Automação de UI no Creators; cookies são segredo local.
- Respeite ToS do YouTube / Spotify e direitos do conteúdo.
- **ffmpeg** no PATH ajuda o yt-dlp a juntar áudio+vídeo; em máquinas sem ffmpeg, prefira “só áudio” ou instale ffmpeg.
