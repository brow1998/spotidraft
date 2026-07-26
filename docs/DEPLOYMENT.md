# Deploy e limites (Spotidraft)

## Realidade: 3h em 4K

Um vídeo ~3h em 4K pode passar de **tens de GB** (bitrate / codec). O Spotidraft:

1. baixa com yt-dlp  
2. empacota  
3. sobe via browser (Playwright) pro Creators  

Isso precisa de **disco grande**, **CPU/rede estáveis** e **sessão longa** — o oposto do free tier típico.

| Opção | Free tier? | Serve 3h 4K? | Notas |
|-------|------------|--------------|--------|
| **Local (recomendado)** | — | Sim | Seu disco/GPU/rede; cookies no `profiles/` |
| Binário desktop (Electron/Tauri) | — | Sim | Empacota UI+API; ainda roda na máquina |
| Railway / Render / Fly free | Frágil | Não | Disco efêmero, timeout, RAM baixa |
| Cloudflare Workers / Vercel | Sim | Não | Sem download longo nem Playwright pesado |
| VPS barato (Hetzner etc.) | Pago | Talvez | Disco + tempo de upload; cookies sensíveis |
| GPU cloud free credits | Limitado | Arriscado | Custo sobe rápido com 4K |

**Conclusão:** free tier na nuvem **não** é caminho sério para 3h 4K. Local sim. Cloud só com disco/VM pagos e aceitando risco de sessão/cookies.

## Uso de disco na prática

O padrão de qualidade é **1080p**, não "melhor disponível". Medido num vídeo de
44 min do mesmo canal:

| Qualidade | Tamanho |
|-----------|---------|
| Melhor (4K) | 2166 MB |
| 1080p (padrão) | 401 MB |
| 720p | 244 MB |

São 5,4× menos bytes para baixar, guardar e subir — e o Creators recodifica de
qualquer forma. "Melhor disponível" continua no seletor de opções para quem
precisar.

O arquivo de vídeo é **apagado assim que o rascunho existe no Spotify**
(`src/cleanup.js`). Os sidecars ficam: o `.info.json` alimenta duração e
descrição na fila e a thumbnail tem dezenas de KB. Uploads que falham mantêm o
arquivo, para reenviar sem baixar de novo.

## Downloads simultâneos

Cada invocação do yt-dlp baixa um vídeo e tem o próprio arquivo de archive, o
que permite rodar downloads em paralelo. O padrão é **2 faixas**
(`SPOTIDRAFT_DOWNLOAD_LANES`, teto de 4).

Medido com dois vídeos do mesmo canal, a 720p, ordem invertida para não
favorecer nenhum cenário:

| Cenário | Total | Por vídeo |
|---------|-------|-----------|
| Paralelo (2 faixas) | 46 s | 45 s, 46 s |
| Sequencial | 70 s | 34 s, 36 s |

**1,52×** — não 2×, porque a banda é compartilhada: cada download fica ~30 %
mais lento. O ganho vem de sobrepor os 10–15 s de extração de metadados e de
aproveitar banda ociosa.

Sobre o `HTTP 403` que o extractor devolve: em teste controlado ele **não** foi
causado por concorrência, e sim por *repetição* — rebaixar os mesmos vídeos
poucos segundos depois. Rodar as duas faixas primeiro, em vídeos novos,
funcionou (2/2). Ainda assim o teto de 4 faixas existe porque cada faixa traz um
ffmpeg disputando CPU no merge.

Ressalva de fim a fim: os uploads ao Creators são estritamente seriais (um
browser, uma sessão) e costumam ser a etapa mais lenta. Num lote grande o tempo
total tende a ser limitado pelo upload, então boa parte do ganho de download é
absorvida pela fila de envio. Ele aparece de verdade em vídeos grandes, em
`audioOnly`, ou quando o YouTube está lento.

## Caminhos seguintes

### A) Executável local (Electron) — preferido

| Comando | Saída |
|---------|--------|
| `npm run electron:dist:linux` | `release/*.AppImage` |
| `npm run electron:dist:win` | `release/*Setup*.exe` (rode no Windows) |
| `npm run electron:dist:mac` | `release/*.dmg` (rode no Mac) |

Ou **GitHub Actions** → workflow *Desktop builds* (matrix ubuntu/windows/macos).

O app sobe a API embutida, abre a UI e guarda sessão em `userData` do SO.  
Empacota **yt-dlp** + **Chromium (Playwright)** — instalador grande (~200–400 MB), mas o time não precisa de Node.

Dependência externa útil: **ffmpeg** no PATH (merge de formatos). Sem ffmpeg, use “só áudio” ou instale ffmpeg no PC.

### B) Hospedagem “leve” (só meta / fila)

Possível no free tier: listar canal, montar fila, **não** baixar 4K no servidor — o download/upload roda no desktop do usuário (agente local). Arquitetura híbrida; mais trabalho.

### C) VPS pago mínimo

Se precisar remoto: 1 VPS com ≥100–200 GB SSD, processar um episódio por vez, limpar `data/downloads` depois do draft. Ainda não é “free”.

## Segurança

Nunca commitir `profiles/`, `data/`, curl de sessão. Em cloud, cookies de Creators são alto risco (conta do show).
