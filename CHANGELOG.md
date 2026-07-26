# Changelog

## 0.2.0

Rodada focada em desempenho do processo e em tornar visível o que antes era uma
espera cega. Números vêm de medições no próprio app, não de estimativa.

### Desempenho

- **Download e envio agora se sobrepõem.** O vídeo 1 sobe enquanto o 2 baixa.
  Antes o lote inteiro baixava para só então começar a enviar.
- **Um navegador por lote, não por episódio.** O login no Creators (até 60 s)
  era pago a cada episódio; agora é pago uma vez e ainda acontece em paralelo
  com o primeiro download.
- **Downloads paralelos** — 2 faixas por padrão (`SPOTIDRAFT_DOWNLOAD_LANES`,
  teto 4). Medido: 46 s contra 70 s seriais (**1,52×**). Cada invocação do
  yt-dlp passou a ter seu próprio arquivo de archive, que era a contenção real.
- **Envios paralelos** — 2 faixas por padrão (`SPOTIDRAFT_UPLOAD_LANES`, teto 5).
  Medido com 3 faixas contra o Creators real: 26 s contra ~76 s seriais
  (**2,9×**), com tempos por faixa de 24/26/26 s. Cada faixa tem seu próprio
  perfil do Chromium e compartilha os cookies injetados.
- **Qualidade padrão passou a 1080p.** "Melhor disponível" baixava 4K: 2166 MB
  contra 401 MB no mesmo vídeo — 5,4× menos bytes para baixar, guardar e subir,
  para algo que o Spotify recodifica de qualquer forma.
- **O vídeo é apagado quando o rascunho existe.** Um catálogo de teste ocupava
  5,0 GB; passou a 1,3 MB. Falha de envio preserva o arquivo para reenviar sem
  baixar de novo.
- **Canais resolvidos ficam em cache** com revalidação em segundo plano. Reabrir
  um canal foi de ~34 s para ~0,01 s.
- **Polling substituído por SSE.** A fila era rebuscada a cada 2 s, com leitura
  de disco por episódio; agora cada evento remenda uma linha.

### Visibilidade

- Barras de progresso reais para download e envio, com velocidade, ETA e o item
  em andamento.
- O envio informa o passo atual — enviando arquivo, Spotify processando (com
  tempo decorrido), preenchendo título, adicionando descrição, enviando
  thumbnail, salvando rascunho.
- Painel de log com a saída do yt-dlp e da automação, antes só visível no stderr
  do servidor.
- A etapa de merge do ffmpeg aparece como indeterminada em vez de parecer travada.

### Correções

- **Reenfileirar um download que falhou não funcionava.** O episódio ia para
  "pronto para enviar" sem ter arquivo, e falhava na hora com `video_path
  missing`. Agora volta para a fila de download quando não há arquivo.
- **Jobs simultâneos.** O segundo import se marcava como concluído sem ter
  enviado nada.
- **Cancelar não matava o yt-dlp.** O processo seguia baixando por minutos; e o
  ffmpeg do merge ficava órfão quando só o pai era sinalizado.
- **Trabalho interrompido ficava preso.** Downloads voltam para a fila no boot;
  envios interrompidos viram falha explícita, sem reenvio automático, porque o
  rascunho pode já existir no Spotify.
- **Listar e excluir episódios do Spotify nunca funcionou** — `ensureEpisodesPage`
  era chamada mas nunca existiu.
- **O nome do programa vinha como lixo** ("checkbox label"). O nav do Creators
  está em shadow DOM, que `querySelectorAll` não atravessa.
- **Timeout de envio era fixo em 6 min** e, ao estourar, seguia adiante — o erro
  aparecia depois como "Campo Description não encontrado". Agora escala com o
  tamanho do arquivo e falha dizendo o que houve.
- **`@handle` voltou a ser aceito** no campo de canal, além de nome solto e URL.
- Ações de cancelar e reenfileirar não tinham tratamento de erro: falhavam em
  silêncio.

### Interface

- Logo própria, aplicada na sidebar, no favicon e no ícone do app.
- Vários canais memorizados, com troca rápida — antes era um favorito só, e uma
  caixa de diálogo perguntava a cada abertura.
- Sidebar colapsável com o status da sessão sempre visível; a barra superior deu
  lugar a um botão flutuante.
- Ações de enviar/enfileirar aparecem sobre a thumbnail no hover; clicar na área
  livre abre os detalhes.
- Tela do Spotify com a capa do programa; o Show ID saiu de vista.
- Toasts que sobrevivem à navegação, diálogo de confirmação no lugar de
  `window.confirm`, foco preso em modais, skeletons e correção do conteúdo que
  ficava colado à esquerda.

### Interno

- Pipeline extraído de `src/server/index.js` para `src/server/pipeline.js`.
- Automação do Creators separada em `creators-dom` (DOM), `creators-session`
  (sessão reutilizável) e `profile-lease` (trava do perfil).
- 82 testes, ante 5.

## 0.1.0

Primeira versão: YouTube → drafts no Spotify for Creators, CLI, UI web e app
Electron.
