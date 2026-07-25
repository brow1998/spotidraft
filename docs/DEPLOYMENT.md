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

## Caminhos seguintes

### A) Executável local (preferido)

1. Manter Node + scripts (`npm run server` / `dev:web`) — já funciona  
2. Empacotar com **Tauri** ou **Electron**: sobe API embutida + UI, ícone no SO  
3. Dependências nativas: yt-dlp + Chromium/Playwright (ou Chrome do sistema)

### B) Hospedagem “leve” (só meta / fila)

Possível no free tier: listar canal, montar fila, **não** baixar 4K no servidor — o download/upload roda no desktop do usuário (agente local). Arquitetura híbrida; mais trabalho.

### C) VPS pago mínimo

Se precisar remoto: 1 VPS com ≥100–200 GB SSD, processar um episódio por vez, limpar `data/downloads` depois do draft. Ainda não é “free”.

## Segurança

Nunca commitir `profiles/`, `data/`, curl de sessão. Em cloud, cookies de Creators são alto risco (conta do show).
