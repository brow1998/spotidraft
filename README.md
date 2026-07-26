# Spotidraft

YouTube (vídeo / playlist / canal) → **drafts** no [Spotify for Creators](https://creators.spotify.com/).

CLI + UI web local. Default: sempre draft (nunca publica sozinho).

## O que faz

- **Home** — canais memorizados, recentes (infinite scroll), playlists, fila → Spotify
- **Importar** — cola qualquer URL solta do YouTube
- **Progresso** — barras ao vivo (download e envio), passo atual e log técnico
- **Spotify** — drafts no Creators (cache + atualizar)
- **Sessão** — cola o curl de login do Creators

Download e envio rodam **sobrepostos**: o vídeo 1 sobe enquanto o 2 baixa. Cada
etapa tem faixas paralelas configuráveis, e o arquivo local é apagado assim que
o rascunho existe no Spotify.

## Requisitos

- Node.js **≥ 22**
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) no `PATH` (ou `YT_DLP=…`)
- Chromium do Playwright (`npx playwright install chromium`)
- **ffmpeg** no `PATH` — necessário para juntar áudio+vídeo. Sem ele, só o modo
  "só áudio" funciona.

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

### Desenvolver contra a sessão do app desktop

Se você já usa o app Electron, `npm run dev:server` aponta o servidor para os
**mesmos** dados e cookies dele — nada de colar cURL de novo. Também resolve o
`yt-dlp` do `vendor/` (ou do app instalado), o que evita o `spawn yt-dlp ENOENT`
quando ele não está no `PATH`.

```bash
npm run build:web && npm run dev:server
# http://127.0.0.1:8787
```

> Não rode o app Electron e o `dev:server` enviando episódios ao mesmo tempo: o
> Chromium tranca o diretório de perfil, e o segundo fica na fila até liberar.

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

Cobertura: lógica pura e o acesso ao SQLite — parsing de progresso do yt-dlp,
cálculo de progresso do job, serialização SSE, classificação de erro do
Creators, política de requeue, limpeza de disco e as faixas de concorrência.
Os fluxos que dirigem o browser continuam sendo verificados manualmente.

## Config / dados locais (não vão pro git)

| Caminho | Conteúdo |
|---------|----------|
| `data/` | config, fila SQLite, downloads, cache Creators (modo CLI/server) |
| `profiles/` | browser profile / cookies (modo CLI/server) |
| `vendor/` | yt-dlp + Chromium empacotados (gerados no prepare) |

### Variáveis de ambiente

| Variável | Padrão | Para quê |
|----------|--------|----------|
| `PORT` | `8787` | Porta da API/UI |
| `YT_LANG` | `pt` | Idioma dos títulos. O yt-dlp usa `pt`, não `pt-BR` |
| `YT_DLP` | auto | Caminho do binário do yt-dlp |
| `SPOTIDRAFT_DOWNLOAD_LANES` | `2` | Downloads simultâneos (teto 4) |
| `SPOTIDRAFT_UPLOAD_LANES` | `2` | Envios simultâneos ao Creators (teto 5) |
| `SPOTIDRAFT_DATA` | `data/` | Config, fila SQLite, downloads, caches |
| `SPOTIDRAFT_PROFILE` | `profiles/creators` | Perfil do browser e `cookies.json` |

As faixas são conservadoras de propósito. Medições e o porquê dos tetos estão em
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Deploy / 4K longo

Ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Resumo: vídeos de horas em 4K **não cabem** em free tier de cloud; use o **app Electron local**.

## Avisos

- Automação de UI no Creators; cookies são segredo local.
- Respeite ToS do YouTube / Spotify e direitos do conteúdo.
- **ffmpeg** no PATH ajuda o yt-dlp a juntar áudio+vídeo; em máquinas sem ffmpeg, prefira “só áudio” ou instale ffmpeg.
