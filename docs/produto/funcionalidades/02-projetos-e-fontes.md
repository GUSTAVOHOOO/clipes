# Projetos, Fontes e Importação

## A jornada

Antes de transcrever uma live, selecionar momentos ou editar um **Corte**, o usuário cria ou abre um **Projeto** — normalmente um por canal. Dentro do Projeto ficam organizadas todas as **Fontes** (arquivos de vídeo locais ou gravações de lives já encerradas, chamadas de **VOD**), suas **Permissões** de uso, o idioma falado, o **Perfil de canal** e as preferências de privacidade (**Somente local**).

Para adicionar material ao Projeto, o usuário pode escolher um arquivo já salvo no disco ou colar uma URL para baixar com o `yt-dlp`. A Fonte fica apenas referenciada (sem duplicar dezenas de gigabytes por padrão); se o arquivo for movido ou editado fora do app, ela aparece como offline ou alterada e pode ser verificada ou relocalizada sem perder o trabalho já feito. Quando há várias Fontes para processar de uma vez (por exemplo, durante a noite), o usuário cria um **Lote de Fontes** para rodar a **Transcrição** e a seleção de Cortes em sequência, com teto de custo opcional. Por fim, ao abrir qualquer trecho para pré-visualizar ou editar, o núcleo gera um **proxy** de vídeo leve e busca automaticamente o replay do chat da live (quando veio por URL) para enriquecer a seleção.

---

## Conceitos e arquitetura do domínio

### 1. O arquivo de Projeto portátil com SQLite (ADR-0005)

- **Pasta `.clipes`:** cada Projeto é uma pasta cujo nome termina em `.clipes`, contendo o banco `project.sqlite` como única fonte da verdade. Por padrão existe um Projeto por canal, e ele pode ser copiado ou levado para outro computador.
- **Motor e gravação:** o núcleo Rust acessa o banco via `rusqlite` compilado junto com o app (`bundled`), em modo `WAL` (Write-Ahead Logging, que permite leituras simultâneas à escrita) e com suporte a busca textual `FTS5`. O núcleo Rust é o único escritor; o worker Python e a UI React nunca abrem o arquivo SQLite diretamente.
- **Mídia e subpastas dentro do `.clipes`:**
  - `project.sqlite` — tabelas relacionais (Fontes, Transcrições, palavras, Frases, Notas, custos, fila de **jobs** — tarefas assíncronas persistidas — e configurações do Projeto) e documentos JSON com `schemaVersion` e `revision`.
  - `project.pre-migration.sqlite` — backup criado antes de aplicar novas migrações de schema (`schema_migrations`). Não há downgrade: Projetos de uma versão mais nova do Clipes são recusados com `newer_project`.
  - `backups/` — cópias rotativas automáticas (`backup-*.sqlite` e `before-restore-*.sqlite`) feitas pela Online Backup API do SQLite e validadas com `PRAGMA integrity_check` e `PRAGMA foreign_key_check`.
  - `media/` — criada somente quando o usuário importa uma Fonte com `copy: true`.
- **Índice reconstruível:** a lista de Projetos recentes (`projects.json`, no diretório de dados do app) é apenas um atalho visual. Se esse arquivo se perder, basta apontar a pasta `.clipes` em `projects.open` para reabrir tudo.

### 2. Modo "Somente local" do Projeto (ADR-0010)

- **O que é:** uma trava de segurança gravada dentro de `project.sqlite` (tabela `project_privacy`), que viaja junto com a pasta portátil e entra nos backups.
- **Regra de funcionamento:** quando ligada (`enabled: true`), proíbe qualquer envio de texto ou áudio do Projeto para fora da máquina — valendo para todas as **Tarefas de IA**, inclusive para "refazer com outro perfil" e para o **Motor de transcrição** remoto (Groq). O veto **só proíbe**, nunca escolhe um **Provedor** sozinho, e soma-se por `OU` lógico ao "Somente local" configurado por tarefa no app.
- **O que conta como local:** apenas endereços de **loopback** (`localhost`, `127.0.0.1` ou `[::1]`), verificados literalmente na URL do endpoint sem consulta DNS. Servidores na rede local (LAN) e ferramentas de linha de comando (CLIs) são tratados como externos. Quando vetada, a chamada falha na hora com `local_only_violation`, sem abrir conexão de rede e sem expor o nome do Projeto em logs ou diagnósticos.

### 3. Importação por URL (`yt-dlp`, cookies e download por trecho)

- **Como funciona hoje (`core/src/url_import.rs`):** usa o Componente executável `yt-dlp` (sem shell, com hash SHA-256 ou assinatura OpenPGP verificada) para baixar VODs por HTTP/HTTPS para a pasta configurada em `url-import.json`. Exige aceite prévio único do aviso de Termos do YouTube (`terms_accepted: true`). Quando o Componente `deno` está instalado, passa `--js-runtimes deno:<caminho>` para resolver desafios JavaScript do YouTube; quando o FFmpeg está configurado, passa `--ffmpeg-location`.
- **Filtros e detecção prévia:** o download bloqueia lives em andamento ou futuras (`live_status !=? is_live & live_status !=? is_upcoming & live_status !=? post_live`) e executa uma sonda prévia (`precheck_age`) para identificar restrição de idade sem vazar dados privados do `stderr` (apenas identificadores fixos de erro vão para diagnóstico).
- **Cookies e login:** **não implementados** na v1. O `yt-dlp` nunca recebe `--cookies` nem `--cookies-from-browser`, e o Clipes não guarda sessão do YouTube (`docs/research/2026-11-16-youtube-restricao-idade.md`). Vídeos `+18` ou que exigem login retornam erros tipados (`age_restricted` ou `login_required`) orientando o usuário a baixar por conta própria e importar o arquivo local.
- **Download por trecho / modo "só áudio primeiro":** **não implementado e fora da v1** (`#152` fechado como `wontfix`; histórias `US-123` e `US-124` na issue `#26`). O spike técnico (`docs/research/2026-11-16-download-por-trecho.md`) mediu 50% de falha por HTTP 403 e travamentos com `yt-dlp --download-sections` no YouTube; por isso a v1 baixa o VOD completo.

### 4. Permissão da Fonte

- Toda Fonte importada registra obrigatoriamente sua **Permissão** (`sources.import`), que pode ser atualizada depois via `sources.permission.set`.
- Aceita dois formatos normalizados:
  - `{"status": "none"}` — sem permissão registrada;
  - `{"status": "granted", "who": "...", "where": "...", "scope": "..."}` — com os três campos preenchidos (quem autorizou, onde foi concedida e qual o escopo, incluindo se cobre tradução).
- Esse registro alimenta automaticamente os créditos na descrição do **Empacotamento**, os avisos dos guarda-corpos e a verificação de escopo antes da tradução de legendas.

### 5. Lotes de Fontes (`core/src/source_batches.rs`)

- Um **Lote de Fontes** processa de 1 a 500 Fontes do Projeto em sequência (apenas uma Fonte ativa por vez), automatizando duas etapas: **Transcrição** (`local` ou `groq`) e **Seleção de Cortes** (`direct` ou `transformed`).
- **Avanço baseado no banco (`tick`):** a cada volta da thread da fila, a função `tick()` recalcula o estado real de cada item (`pending` → `transcribing` → `selecting` → `completed` / `paused` / `cancelled`) cruzando `source_batch_items`, `jobs`, `transcripts` e `selection_runs`. Antes de iniciar a seleção de uma Fonte já transcrita, o lote também aguarda jobs locais pendentes (`energy` e `chat`) saírem da fila para que seus sinais entrem na seleção.
- **Resiliência e teto de custo:** um erro de Provedor não transitório (ou falha na Transcrição) pausa **apenas aquela Fonte** (`paused` com `error_code` fixo), cancela as Janelas ainda enfileiradas dela (`stop_queued_windows`) e deixa as outras Fontes do lote continuarem. Chamadas pagas cujo resultado ficou incerto (`uncertain`) nunca são repetidas sozinhas; exigem confirmação na lista de tarefas (`jobs.retry` / `jobs.discard`). Um teto de custo opcional (`maxCostMicroUsd`) é registrado no escopo `batch` (`sources-<id>`) e pausa o lote inteiro (`budget_paused`) antes de qualquer chamada que ultrapasse o limite.

### 6. Chat da live (`core/src/chat.rs`)

- **Quando roda:** toda Fonte importada com `origin_url` ganha automaticamente um job `chat` (local) na fila do Projeto; também pode ser disparado depois com `chat.fetch` ("buscar o chat depois"). Na v1 suporta apenas replay do YouTube (`--skip-download --write-subs --sub-langs live_chat` via `yt-dlp`).
- **Armazenamento e privacidade:** o arquivo bruto fica ao lado da mídia (`<mídia>.live_chat.json`), nunca dentro do `project.sqlite`. Durante a agregação, o texto das mensagens e os IDs de autores ficam **somente em memória** para contar pessoas distintas por intervalo de 10 s, descartar comandos `!` (exceto Super Chats), filtrar spam repetido em 60 s e classificar reações (`laugh`, `surprise`, `clip`). Apenas os contadores agregados vão para o banco (`chat_replays` e `chat_series`), e o Provedor recebe apenas marcas numéricas deslocadas 10 s para trás pelo atraso de reação (ex.: `[chat 3,1× · risadas]`). Se o vídeo não tiver replay, o estado vira `absent` sem erro.

### 7. Proxy de mídia e reprodução na UI (`core/src/proxy.rs`, `core/src/media.rs`, ADR-0004)

- **Por que existe:** no protótipo (#15), buscar diretamente numa Fonte longa (ex.: 2 horas) levava ~277 ms; com o proxy de **GOP** curto (intervalo curto entre quadros-chave), cai para ~33 ms (~16 ms no loopback Linux).
- **O que é:** um arquivo MP4 leve (`proxy.mp4`) gerado pelo FFmpeg (`libx264`, `veryfast`, `yuv420p`, sem quadros B `-bf 0`, keyframe a cada `0,5 s`, altura máx. `540 px`, vídeo ~2500 kbps, áudio AAC 128 kbps estéreo, `+faststart`) cobrindo apenas a janela do **Corte ±2 min** (`MARGIN_US = 120_000_000`, para Cortes de até 10 min).
- **Cache externo LRU:** fica fora do Projeto e dos backups, em `<cache_dir>/proxies/<sha256>/proxy.mp4`, junto com miniaturas e onda da timeline. A limpeza **LRU** (remove os menos usados recentemente) mantém o total abaixo do menor valor entre `cache_limit_bytes` (configuração de Componentes, padrão 10 GB) e `CACHE_MAX_BYTES` (2 GiB).
- **Como a UI toca o vídeo (`media.rs` e `src-tauri`):** a UI nunca recebe caminhos reais de arquivo; ela monta URLs com identificadores opacos (`proxy/<64 hex>`, `thumbs/<64 hex>`, `source/<id>`, `narration/<id>`, `audio/<id>`) via `mediaUrl()` em `src/lib/media.ts`:
  - No **Windows** (WebView2) e **macOS** (WKWebView), usa o protocolo customizado `clipes-media` (`convertFileSrc`), traduzido por `src-tauri/src/main.rs` para `clipes_core::media::serve` com suporte a `Range` (HTTP `206 Partial Content`, limitado a 8 MiB por resposta).
  - No **Linux** (WebKitGTK), devido à incompatibilidade do GStreamer com esquemas customizados (`FormatError`, emenda de 17/11/2026 do ADR-0004), `src-tauri/src/media_server.rs` sobe um servidor HTTP loopback (`127.0.0.1:<porta aleatória>`) autenticado com token criptográfico de sessão na URL e CORS restrito ao app, servindo os mesmos recursos de `clipes_core::media`.

---

## Fluxo típico

1. **Abrir ou criar o Projeto:**
   - A UI lista os Projetos conhecidos com `projects.recent` e verifica se há sessão ativa com `projects.current`.
   - O usuário cria um novo Projeto (`projects.create`) ou abre uma pasta `.clipes` existente (`projects.open`).
   - Opcionalmente, ajusta o veto de privacidade com `projects.local_only.get` e `projects.local_only.set`.
2. **Importar uma Fonte (caminho local ou URL):**
   - **Arquivo local:** usuário escolhe o vídeo → UI chama `sources.inspect` (via `ffprobe`) para mostrar duração, resolução e faixas de áudio (ex.: faixa do microfone no OBS).
   - **Por URL:** UI lê `sources.url.settings.get`. Se `terms_accepted` for `false`, exibe o aviso único dos Termos e grava com `sources.url.settings.set`. Em seguida chama `sources.url.download` (acompanhando eventos `core-progress` no estágio `download` até receber `{ path, url }`) e chama `sources.inspect` no arquivo baixado.
   - Usuário define faixa de áudio, idioma falado, Permissão e se deseja copiar para o Projeto → UI chama `sources.import` (que grava no SQLite e enfileira o job `preview` e, se houver `origin_url`, o job `chat`).
   - A UI atualiza a lista com `sources.list` e, na prática atual, dispara `sources.hash` em seguida para calcular e guardar o SHA-256 completo.
3. **Gerenciar Fontes, Permissões e chat:**
   - Usuário pode atualizar o idioma antes de transcrever (`sources.language.set`) ou editar a Permissão a qualquer momento (`sources.permission.set`).
   - Se uma Fonte importada por URL ainda não teve chat buscado, a UI verifica com `chat.status` e pode disparar `chat.fetch`.
4. **Processar em Lote de Fontes (opcional):**
   - Usuário seleciona múltiplas Fontes e chama `batches.create` (se houver serviço pago, trata `confirmation_required` e reenvia com `confirmed: true`).
   - Acompanha o progresso com `batches.list` / `batches.get` reagindo a `core-progress` (ou polling). Pode pausar/retomar/cancelar com `batches.pause`, `batches.resume` e `batches.cancel`, ou destravar uma Fonte individual com `batches.item.resume`.
5. **Preparar preview de um Corte:**
   - Ao abrir um Corte ou candidato, a UI chama `proxy.request` (`source_id`, `start_us`, `end_us`).
   - Se `state` vier como `queued` ou `running`, acompanha `core-progress` e consulta `proxy.status` até `state === "ready"`.
   - Monta a URL do `<video>` com `proxy/<key>` (e pode converter tempos entre Fonte e proxy usando `proxy.map_time` ou o cálculo equivalente `windowStartUs`).

### Caminhos alternativos e erros comuns

- **Cancelar download ou hash:** durante `sources.url.download`, chama `sources.url.cancel { job }`; durante `sources.hash` ou `sources.relocate`, chama `sources.cancel { job }`. Durante geração do proxy (`proxy.request`), cancela via `jobs.cancel { id: job }`.
- **Fonte offline ou alterada:** se `sources.list` mostrar `status: "offline"`, o usuário escolhe o novo caminho e chama `sources.relocate` (podendo exigir `confirmed: true` se não houver hash completo prévio). Se mostrar `status: "changed"`, chama `sources.hash` para revalidar a identidade (também podendo pedir `confirmed: true`).
- **Erro de restrição de idade ou falta de JS runtime na URL:** `sources.url.download` retorna `age_restricted` (orientar importação local manual) ou `js_runtime_missing` (orientar instalação do Componente `deno`).
- **Fonte pausada no lote por chamada incerta:** `batches.item.resume` devolve `uncertain_job`; o usuário precisa decidir na lista de tarefas (`jobs.retry` / `jobs.discard`).

---

## Comandos

### `projects.create`
- **O que faz:** Cria uma nova pasta `<nome>.clipes` com banco `project.sqlite` inicializado e migrado, e já a abre como Projeto ativo.
- **Entrada:**
  - `name: string` (obrigatório) — nome do Projeto (não pode ser vazio após `trim()`, `.` ou `..`, nem conter `/`, `\` ou `:`).
  - `parent: string` (obrigatório) — caminho da pasta onde `<name>.clipes` será criada.
- **Saída:** `{ name: string, path: string, id: string }` (mesmo retorno de `projects.open`).
- **Erros:** `invalid_project` (nome ou pasta pai ausente/inválido), `project_create` (falha ao criar pasta, abrir ou inserir no SQLite), `migration` / `newer_project` / `project_open` / `project_busy` / `project_read` / `project_write` / `library` (propagados por `projects.open` e registro em `projects.json`), além de erros de `editor.flush` se houver Projeto anterior com falha ao salvar.
- **Eventos e jobs:** nenhum evento `core-progress`; internamente para o worker do Projeto anterior, reconcilia a fila e inicia a thread da fila de jobs do novo Projeto.
- **Pré-condições:** não haver job ativo bloqueando a troca de Projeto (`project_busy`).
- **Tela hoje:** [Projects.tsx](../../../src/features/projects/Projects.tsx#L36).
- **Mock TS:** não (ausente em [core.ts](../../../src/lib/core.ts)).
- **US (#26):** US-34, US-39.
- **Código:** `core/src/projects.rs:209`

### `projects.open`
- **O que faz:** Abre uma pasta `.clipes` existente, roda migrações pendentes (com backup prévio), reconcilia jobs interrompidos, inicia o worker da fila e grava nos recentes.
- **Entrada:**
  - `path: string` (obrigatório) — caminho de uma pasta com extensão `.clipes`.
- **Saída:** `{ name: string, path: string, id: string }`.
- **Erros:** `invalid_project` (caminho ausente, sem extensão `.clipes` ou registro `project` ausente no SQLite), `project_open` (falha ao canonicalizar caminho ou abrir `project.sqlite`), `migration` (erro ao migrar schema), `newer_project` (Projeto criado por versão mais nova do Clipes), `backup` (falha no backup pré-migração), `project_busy` (há tarefa ativa impedindo fechar o Projeto anterior), `project_read`, `project_write`, `library` (falha ao ler/gravar `projects.json`), além de erros de `editor.flush` do Projeto anterior.
- **Eventos e jobs:** nenhum evento `core-progress`; inicia o thread de backup automático (se dirty e vencido) e o worker da fila de jobs do Projeto aberto.
- **Pré-condições:** pasta `.clipes` válida com `project.sqlite`; nenhum job ativo no Projeto anterior.
- **Tela hoje:** [Projects.tsx](../../../src/features/projects/Projects.tsx#L37-L49).
- **Mock TS:** não (ausente em [core.ts](../../../src/lib/core.ts)).
- **US (#26):** US-34, US-35, US-39.
- **Código:** `core/src/projects.rs:210`

### `projects.recent`
- **O que faz:** Lista os Projetos abertos recentemente a partir do índice `projects.json`, indicando se cada pasta ainda possui `project.sqlite` no disco.
- **Entrada:** nenhuma (`{}`).
- **Saída:** array de `{ available: boolean, name: string, path: string }`.
- **Erros:** `library` (diretório de dados indisponível ou `projects.json` corrompido/ilegível).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** [Projects.tsx](../../../src/features/projects/Projects.tsx#L24).
- **Mock TS:** sim, `src/lib/core.ts` (sempre retorna `[]`).
- **US (#26):** US-35.
- **Código:** `core/src/projects.rs:211`

### `projects.current`
- **O que faz:** Retorna os dados do Projeto atualmente aberto na sessão (incluindo eventual aviso de falha no backup automático), ou `null` se nenhum estiver aberto.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ name: string, path: string, warning: CoreError | null, id: string | null } | null`.
- **Erros:** `project_busy` (falha ao obter lock da sessão).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** [Projects.tsx](../../../src/features/projects/Projects.tsx#L25-L47).
- **Mock TS:** sim, `src/lib/core.ts` (retorna projeto fixo apenas com `?source-test=1`; caso contrário `null`).
- **US (#26):** US-34.
- **Código:** `core/src/projects/backups.rs:437`

### `projects.close`
- **O que faz:** Descarrega edições pendentes no editor (`editor.flush`), para o worker da fila de jobs e fecha o Projeto atualmente aberto.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `null`.
- **Erros:** `project_busy` (há tarefa ativa no Projeto ou lock ocupado — nesse caso reinicia o worker da fila), além de eventuais erros propagados por `editor.flush`.
- **Eventos e jobs:** nenhum evento `core-progress`; encerra a thread da fila de jobs e a thread de backup automático da sessão.
- **Pré-condições:** nenhuma (se não houver Projeto aberto, encerra normalmente retornando `null`).
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** nenhuma encontrada.
- **Código:** `core/src/projects/backups.rs:438`

### `projects.local_only.get`
- **O que faz:** Consulta se o veto "Somente local" está ativado para o Projeto aberto (e informa se há um Projeto aberto).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ open: boolean, enabled: boolean }`. (Quando não há Projeto aberto, devolve `{ open: false, enabled: false }`).
- **Erros:** `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** [ProjectPrivacy.tsx](../../../src/features/projects/ProjectPrivacy.tsx#L30).
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-121, US-122.
- **Código:** `core/src/projects/privacy.rs:53`

### `projects.local_only.set`
- **O que faz:** Ativa ou desativa o veto "Somente local" no banco `project.sqlite` do Projeto aberto.
- **Entrada:**
  - `enabled: boolean` (obrigatório).
- **Saída:** `{ open: true, enabled: boolean }`.
- **Erros:** `invalid_request` (`enabled` ausente ou não booleano), `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [ProjectPrivacy.tsx](../../../src/features/projects/ProjectPrivacy.tsx#L34).
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-121, US-122.
- **Código:** `core/src/projects/privacy.rs:54`

### `sources.inspect`
- **O que faz:** Executa `ffprobe` em um arquivo de vídeo local e devolve seus metadados brutos (duração, formato e streams de vídeo/áudio) sem alterar o Projeto.
- **Entrada:**
  - `path: string` (obrigatório) — caminho do arquivo de vídeo a inspecionar.
- **Saída:** JSON bruto do `ffprobe` contendo obrigatoriamente `format.duration` e `streams[]` (com `index`, `codec_type`, `codec_name`, `tags`, `width`, `height`, `avg_frame_rate`, etc.).
- **Erros:** `invalid_source` (`path` ausente), `source_unavailable` (arquivo inexistente ou inacessível), `ffprobe_missing` (`ffprobe` não encontrado ou FFmpeg gerenciado incompleto), `probe_failed` (falha na execução, JSON inválido ou metadados sem duração/`streams`).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Componente FFmpeg/`ffprobe` disponível (ou `CLIPES_FFPROBE` definido no ambiente).
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L41-L43).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1`).
- **US (#26):** US-44, US-50.
- **Código:** `core/src/sources.rs:613`

### `sources.import`
- **O que faz:** Registra uma Fonte (arquivo local ou já baixado por URL) no Projeto aberto com faixa de áudio, idioma, Permissão e cópia opcional para `<projeto>/media/`, enfileirando a geração de prévia local (e busca de chat se houver URL).
- **Entrada:**
  - `project: string` (obrigatório) — caminho do Projeto aberto.
  - `path: string` (obrigatório) — caminho do arquivo de vídeo.
  - `audio_track: number` (obrigatório) — índice de uma stream com `codec_type == "audio"` presente no `ffprobe`.
  - `permission: object` (obrigatório) — `{ status: "none" }` ou `{ status: "granted", who: string, where: string, scope: string }` (campos não vazios).
  - `language?: string | null` (opcional) — código ISO-639-1 ou nome em inglês suportado (padrão: idioma do Perfil de canal).
  - `copy?: boolean` (opcional) — se `true`, copia o arquivo para `<projeto>/media/<nome>` e calcula o SHA-256 completo validando a cópia.
  - `origin_url?: string | null` (opcional) — URL HTTP/HTTPS de origem (usada quando veio de `sources.url.download`).
- **Saída:** `{ id: number, status: "available" | "offline" | "changed", available: boolean, path: string, metadata: object, permission: object, audio_track: number, verified: boolean, origin_url: string | null, language: string }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_project`, `invalid_permission`, `invalid_language`, `invalid_url`, `invalid_source`, `source_unavailable`, `ffprobe_missing`, `probe_failed`, `invalid_track`, `source_read`, `copy_failed`, `copy_exists`, `job_running`, `cancelled`, `hash_mismatch`, `project_write`, `project_read`, `source_missing`.
- **Eventos e jobs:**
  - Quando `copy: true`: emite `core-progress` síncrono (durante o comando) para `job: "source-copy-original"` e depois `job: "source-copy-check"` (`stage: "hash"`, `percentage: 0..100`, `message: "Verificando Fonte"`, `project: null`), canceláveis via `sources.cancel`.
  - Sempre enfileira na fila `jobs` do Projeto um job `preview` (local, que emite `waveform` 1–49%, `thumbnails` 50% e `complete`/`failed`) e, quando `origin_url` é informado, um job `chat` (local).
- **Pré-condições:** Projeto aberto; `ffprobe` disponível; se `copy: true`, espaço em disco e nome não repetido em `media/`.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L50).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1`).
- **US (#26):** US-36, US-44, US-45, US-47, US-50.
- **Código:** `core/src/sources.rs:612`

### `sources.list`
- **O que faz:** Lista todas as Fontes do Projeto aberto em ordem crescente de ID, recalculando na hora se cada arquivo está disponível, offline ou alterado.
- **Entrada:**
  - `project: string` (obrigatório) — caminho do Projeto aberto.
- **Saída:** array de objetos `{ id, status: "available" | "offline" | "changed", available: boolean, path, metadata, permission, audio_track, verified: boolean, origin_url, language }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_project`, `project_read`, `source_missing`, `source_unavailable`, `source_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L38), [SourceBatches.tsx](../../../src/features/projects/SourceBatches.tsx#L87).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1`).
- **US (#26):** US-36, US-37.
- **Código:** `core/src/sources.rs:614`

### `sources.hash`
- **O que faz:** Calcula o hash SHA-256 completo do arquivo da Fonte para verificar e gravar sua identidade; pede confirmação se o arquivo mudou e não há hash anterior (ou se divergir).
- **Entrada:**
  - `project: string` (obrigatório) — caminho do Projeto aberto.
  - `id: number` (obrigatório) — ID da Fonte.
  - `job?: string` (opcional) — identificador da operação para progresso/cancelamento (padrão `"source-hash"`).
  - `confirmed?: boolean` (opcional) — `true` para confirmar quando a impressão digital parcial/mtime mudou sem hash completo prévio ou quando o hash completo não bate com o anterior.
- **Saída:** `{ verified: true }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_project`, `source_missing`, `source_unavailable`, `source_read`, `confirmation_required`, `job_running`, `cancelled`, `ffprobe_missing`, `probe_failed`, `source_changed`, `project_read`, `project_write`.
- **Eventos e jobs:** execução síncrona (não entra na fila `jobs` do SQLite); emite `core-progress` durante a leitura com `job: <job>`, `project: null`, `stage: "hash"`, `percentage: 0..100`, `message: "Verificando Fonte"`. Cancelável por `sources.cancel { job }`.
- **Pré-condições:** Projeto aberto; Fonte existente e arquivo presente no disco; se houve mudança parcial, `ffprobe` disponível para re-inspecionar metadados.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L48-L50).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1`).
- **US (#26):** US-38.
- **Código:** `core/src/sources.rs:615`

### `sources.relocate`
- **O que faz:** Aponta um novo arquivo no disco para uma Fonte offline (ou movida), validando tamanho, hash parcial, duração e SHA-256 completo antes de atualizar o caminho no Projeto.
- **Entrada:**
  - `project: string` (obrigatório) — caminho do Projeto aberto.
  - `id: number` (obrigatório) — ID da Fonte.
  - `path: string` (obrigatório) — caminho do novo arquivo candidato.
  - `job?: string` (opcional) — identificador da operação (padrão `"source-relocate"`).
  - `confirmed?: boolean` (opcional) — `true` para aceitar a relocalização quando a Fonte não possuía hash completo prévio.
- **Saída:** objeto atualizado da Fonte (mesmo formato de `sources.list`).
- **Erros:** `project_not_open`, `project_busy`, `invalid_project`, `source_missing`, `invalid_source`, `source_unavailable`, `source_read`, `ffprobe_missing`, `probe_failed`, `source_mismatch` (tamanho, amostra parcial, duração ou hash completo não correspondem à Fonte original), `confirmation_required`, `job_running`, `cancelled`, `source_changed`, `project_read`, `project_write`.
- **Eventos e jobs:** execução síncrona (não entra na fila `jobs`); emite `core-progress` com `job: <job>`, `project: null`, `stage: "hash"`, `percentage: 0..100`, `message: "Verificando Fonte"`. Cancelável por `sources.cancel { job }`.
- **Pré-condições:** Projeto aberto; Fonte existente; `ffprobe` disponível; arquivo candidato compatível.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L49-L53).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1`).
- **US (#26):** US-37, US-38.
- **Código:** `core/src/sources.rs:616`

### `sources.cancel`
- **O que faz:** Sinaliza o cancelamento de uma verificação de hash (`sources.hash`, `sources.relocate` ou cópia em `sources.import`) em andamento.
- **Entrada:**
  - `job: string` (opcional/esperado) — identificador da tarefa passado em `sources.hash` / `sources.relocate` (ou `"source-copy-original"` / `"source-copy-check"`).
- **Saída:** `{}`.
- **Erros:** nenhum (é no-op se `job` estiver ausente ou já tiver terminado).
- **Eventos e jobs:** altera o `AtomicBool` em memória da tarefa, fazendo-a encerrar com erro `cancelled`.
- **Pré-condições:** nenhuma.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L60).
- **Mock TS:** não (ausente em [core.ts](../../../src/lib/core.ts)).
- **US (#26):** US-51.
- **Código:** `core/src/sources.rs:617`

### `sources.language.set`
- **O que faz:** Atualiza o idioma falado da Fonte antes que a Transcrição tenha sido iniciada ou concluída.
- **Entrada:**
  - `project: string` (obrigatório) — caminho do Projeto aberto.
  - `id: number` (obrigatório) — ID da Fonte.
  - `language: string` (obrigatório) — código ISO-639-1 (ex.: `"pt"`, `"en"`) ou nome em inglês suportado em `SUPPORTED_LANGUAGES`.
- **Saída:** objeto atualizado da Fonte (mesmo formato de `sources.list`).
- **Erros:** `project_not_open`, `project_busy`, `invalid_project`, `source_missing`, `invalid_language`, `transcription_busy` (há job de transcrição na fila, rodando ou incerto), `transcript_complete` (Transcrição já concluída), `transcript_partial` (Transcrição já avançou além de `resume_us = 0`), `project_read`, `project_write`, `source_unavailable`, `source_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Fonte existente; Transcrição da faixa ainda não iniciada (`resume_us == 0` e sem job ativo).
- **Tela hoje:** [EngineChoice.tsx](../../../src/features/projects/EngineChoice.tsx#L70).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1`).
- **US (#26):** US-53.
- **Código:** `core/src/sources.rs:618`

### `sources.permission.set`
- **O que faz:** Atualiza o registro de Permissão de uma Fonte já importada (definindo ou removendo quem autorizou, onde e qual o escopo).
- **Entrada:**
  - `project: string` (obrigatório) — caminho do Projeto aberto.
  - `id: number` (obrigatório) — ID da Fonte.
  - `permission: object` (obrigatório) — `{ status: "none" }` ou `{ status: "granted", who: string, where: string, scope: string }`.
- **Saída:** objeto atualizado da Fonte (mesmo formato de `sources.list`).
- **Erros:** `project_not_open`, `project_busy`, `invalid_project`, `source_missing`, `invalid_permission`, `project_write`, `project_read`, `source_unavailable`, `source_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Fonte existente.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L52).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1`).
- **US (#26):** US-47, US-48.
- **Código:** `core/src/sources.rs:619`

### `sources.url.settings.get`
- **O que faz:** Lê as configurações globais da importação por URL: se o aviso dos Termos já foi aceito e qual a pasta padrão de downloads.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ terms_accepted: boolean, download_dir: string }` (quando `url-import.json` não existe ainda, usa `terms_accepted: false` e `<vídeos|downloads|home/Downloads>/Clipes`).
- **Erros:** `settings` (diretório de configuração/downloads indisponível ou `url-import.json` inválido).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L39).
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-45, US-46.
- **Código:** `core/src/url_import.rs:58`

### `sources.url.settings.set`
- **O que faz:** Salva a pasta padrão de downloads por URL e o aceite do aviso dos Termos em `url-import.json` (uma vez aceito, `terms_accepted` permanece `true`).
- **Entrada:**
  - `terms_accepted: boolean` (obrigatório).
  - `download_dir: string` (obrigatório, deve ser um caminho absoluto).
- **Saída:** `{ terms_accepted: boolean, download_dir: string }`.
- **Erros:** `settings` (JSON inválido, `download_dir` não absoluto, ou erro ao ler/gravar `url-import.json`).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L42-L47).
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-45, US-46.
- **Código:** `core/src/url_import.rs:59`

### `sources.url.download`
- **O que faz:** Baixa um VOD a partir de uma URL usando `yt-dlp` para a pasta de downloads configurada e retorna o caminho local do arquivo baixado (ainda sem importá-lo para o SQLite).
- **Entrada:**
  - `project: string` (obrigatório) — caminho do Projeto aberto.
  - `url: string` (obrigatório) — URL `http` ou `https` com host válido.
  - `job: string` (obrigatório) — identificador não vazio da tarefa para progresso e cancelamento.
- **Saída:** `{ path: string, url: string }`.
- **Erros:** `invalid_url`, `project_not_open`, `project_busy`, `invalid_project`, `terms_required` (Termos ainda não aceitos), `invalid_job`, `job_running` (já há download com o mesmo `job`), `component_missing` (`yt-dlp` não instalado), `component_integrity` (hash/assinatura do `yt-dlp` inválida), `settings`, `cancelled`, `download_directory`, `age_restricted`, `login_required`, `js_runtime_missing` (falta `deno`), `sabr_unavailable`, `download_failed`.
- **Eventos e jobs:** execução síncrona (não entra na fila `jobs` do SQLite); emite `core-progress` lendo o `--progress-template` do `yt-dlp` com `job: <job>`, `project: null`, `stage: "download"`, `percentage: 0..100`, `message: "Baixando Fonte"`. Cancelável por `sources.url.cancel { job }`.
- **Pré-condições:** Projeto aberto; `terms_accepted == true`; Componente `yt-dlp` instalado e íntegro (e `deno` recomendado para desafios JS do YouTube).
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L43).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1`).
- **US (#26):** US-45, US-46, US-51.
- **Código:** `core/src/url_import.rs:584`

### `sources.url.cancel`
- **O que faz:** Solicita o cancelamento de um download por URL em andamento, encerrando o processo do `yt-dlp` e sua árvore de processos.
- **Entrada:**
  - `job: string` (opcional/esperado) — identificador passado em `sources.url.download`.
- **Saída:** `{}`.
- **Erros:** nenhum (no-op se `job` não existir).
- **Eventos e jobs:** aciona o `AtomicBool` da tarefa em memória, encerrando `sources.url.download` com erro `cancelled` e removendo temporários.
- **Pré-condições:** nenhuma.
- **Tela hoje:** [Sources.tsx](../../../src/features/projects/Sources.tsx#L60).
- **Mock TS:** não (ausente em [core.ts](../../../src/lib/core.ts)).
- **US (#26):** US-51.
- **Código:** `core/src/url_import.rs:585`

### `batches.create`
- **O que faz:** Cria um Lote de Fontes para transcrever e selecionar Cortes de 1 a 500 Fontes do Projeto em sequência, com teto de custo opcional.
- **Entrada:**
  - `sourceIds: number[]` (obrigatório) — lista de 1 a 500 IDs de Fontes (duplicatas são removidas).
  - `engine?: "local" | "groq"` (opcional, padrão `"local"`).
  - `videoKind?: "direct" | "transformed"` (opcional, padrão do Perfil de canal).
  - `minUs?: number` (opcional, > 0, padrão do Perfil de canal).
  - `maxUs?: number` (opcional, > `minUs`, padrão do Perfil de canal).
  - `maxCostMicroUsd?: number | null` (opcional, ≥ 0) — teto de custo em micro-dólares (`1e-6` US$).
  - `confirmed?: boolean` (opcional; obrigatório `true` quando a rota de seleção for paga ou `engine == "groq"`).
- **Saída:** objeto completo do lote (mesmo formato de `batches.get`).
- **Erros:** `project_not_open`, `project_busy`, `invalid_batch` (`sourceIds` vazio/> 500 ou faixa `minUs`/`maxUs` inválida), `invalid_engine`, `source_missing`, `invalid_budget`, `invalid_video_kind`, `local_only_violation` (rota da seleção ou `engine == "groq"` violando "Somente local"), erros de rota de Provedor (ex.: perfil não configurado/ausente), `confirmation_required` (com `usage: { selectionPaid, transcriptionPaid, audioEstimateMicroUsd, profile, maxCostMicroUsd, sources }`), `project_read`, `project_write`, mais eventuais erros de `transcription.groq.estimate` se `engine == "groq"`.
- **Eventos e jobs:** emite em background `core-progress` com `job: "batch-<id>"`, `project: <id>`, `stage: "batch:created"`, `percentage: 0`, `message: "Lote de Fontes criado"`. A partir daí, a thread da fila (`source_batches::tick`) dispara sequencialmente jobs `transcription` e execuções de seleção (`selection.start` → jobs `ai:selection` / `ai:selection_transformed`), emitindo `batch:item`, `batch:item-paused` e `batch:completed`. Cancelável via `batches.cancel`.
- **Pré-condições:** Projeto aberto; Fontes já importadas; rota da Tarefa de seleção configurada e compatível com "Somente local".
- **Tela hoje:** [SourceBatches.tsx](../../../src/features/projects/SourceBatches.tsx#L110).
- **Mock TS:** sim, `src/lib/batchMock.ts` (ativo apenas com `?source-test=1&batch-test=1`).
- **US (#26):** US-28, US-29, US-31, US-32, US-49.
- **Código:** `core/src/source_batches.rs:966`

### `batches.get`
- **O que faz:** Consulta o estado consolidado de um Lote de Fontes, incluindo contagem de itens, orçamento, motivo de pausa e progresso de cada Fonte.
- **Entrada:**
  - `id: number` (obrigatório) — ID do lote.
- **Saída:** `{ id, key: "sources-<id>", state: "running" | "paused" | "completed" | "cancelled", status: "running" | "paused" | "budget_paused" | "attention" | "completed" | "cancelled", engine, minUs, maxUs, videoKind, pause: string | null, budget: object | null, counts: { total, completed, paused, active, pending, cancelled }, items: [{ position, sourceId, name, state, error, resetAtMs, transcriptionJob, selectionRun, progress, engine }] }`.
- **Erros:** `project_not_open`, `project_busy`, `batch_not_found`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; lote existente.
- **Tela hoje:** nenhuma diretamente (a UI usa `batches.list`; nota: `src/features/export/mock.ts` cita `batches.get` apenas em código morto/mock antigo de exportação — o comando real de exportação em lote é `export.batch.status`).
- **Mock TS:** sim, `src/lib/batchMock.ts` (ativo apenas com `?source-test=1&batch-test=1`).
- **US (#26):** US-49, US-51.
- **Código:** `core/src/source_batches.rs:967`

### `batches.list`
- **O que faz:** Lista todos os Lotes de Fontes do Projeto aberto, do mais recente para o mais antigo, com o mesmo formato detalhado de `batches.get`.
- **Entrada:** nenhuma (`{}`).
- **Saída:** array de objetos no formato de `batches.get`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [SourceBatches.tsx](../../../src/features/projects/SourceBatches.tsx#L82).
- **Mock TS:** sim, `src/lib/batchMock.ts` (ativo apenas com `?source-test=1&batch-test=1`).
- **US (#26):** US-49, US-51.
- **Código:** `core/src/source_batches.rs:968`

### `batches.pause`
- **O que faz:** Pausa um Lote de Fontes para que nenhuma nova Fonte ou job da fila do lote seja iniciado (jobs já em execução terminam sem cortar chamadas pagas em voo).
- **Entrada:**
  - `id: number` (obrigatório) — ID do lote.
- **Saída:** objeto atualizado do lote (mesmo formato de `batches.get`).
- **Erros:** `project_not_open`, `project_busy`, `batch_not_found`, `invalid_batch_state` (lote já cancelado), `project_read`, `project_write`.
- **Eventos e jobs:** emite em background `core-progress` com `job: "batch-<id>"`, `stage: "batch:paused"`, `percentage: 0`, `message: "Lote pausado"`. Grava pausa `user` em `ai_pauses` para o escopo `batch`.
- **Pré-condições:** Projeto aberto; lote existente e não cancelado.
- **Tela hoje:** [SourceBatches.tsx](../../../src/features/projects/SourceBatches.tsx#L163).
- **Mock TS:** sim, `src/lib/batchMock.ts` (ativo apenas com `?source-test=1&batch-test=1`).
- **US (#26):** US-49.
- **Código:** `core/src/source_batches.rs:969`

### `batches.resume`
- **O que faz:** Retoma um Lote de Fontes pausado pelo usuário (pausas por teto de custo ou custo desconhecido devem usar `jobs.budget.continue`).
- **Entrada:**
  - `id: number` (obrigatório) — ID do lote.
- **Saída:** objeto atualizado do lote (mesmo formato de `batches.get`).
- **Erros:** `project_not_open`, `project_busy`, `batch_not_found`, `invalid_batch_state` (lote já cancelado), `project_read`, `project_write`.
- **Eventos e jobs:** emite em background `core-progress` com `job: "batch-<id>"`, `stage: "batch:resumed"`, `percentage: 0`, `message: "Lote retomado"`. Remove apenas a pausa `reason='user'` de `ai_pauses`.
- **Pré-condições:** Projeto aberto; lote existente e não cancelado.
- **Tela hoje:** [SourceBatches.tsx](../../../src/features/projects/SourceBatches.tsx#L164).
- **Mock TS:** sim, `src/lib/batchMock.ts` (ativo apenas com `?source-test=1&batch-test=1`).
- **US (#26):** US-49.
- **Código:** `core/src/source_batches.rs:970`

### `batches.cancel`
- **O que faz:** Cancela um Lote de Fontes, marcando os itens não concluídos como `cancelled` e solicitando o cancelamento de jobs de transcrição e execuções de seleção em aberto (resultados já gravados são mantidos).
- **Entrada:**
  - `id: number` (obrigatório) — ID do lote.
- **Saída:** objeto atualizado do lote (mesmo formato de `batches.get`).
- **Erros:** `project_not_open`, `project_busy`, `batch_not_found`, `project_read`, `project_write`.
- **Eventos e jobs:** emite em background `core-progress` com `job: "batch-<id>"`, `stage: "batch:cancelled"`, `percentage: 0`, `message: "Lote cancelado"`. Cancela jobs `queued`/`running` dos itens e chama `selection.cancel` para cada execução em andamento.
- **Pré-condições:** Projeto aberto; lote existente.
- **Tela hoje:** [SourceBatches.tsx](../../../src/features/projects/SourceBatches.tsx#L165).
- **Mock TS:** sim, `src/lib/batchMock.ts` (ativo apenas com `?source-test=1&batch-test=1`).
- **US (#26):** US-49, US-51.
- **Código:** `core/src/source_batches.rs:971`

### `batches.item.resume`
- **O que faz:** Retoma uma Fonte específica que ficou `paused` no lote (por exemplo, após o usuário trocar de Perfil de Provedor ou corrigir um componente), pedindo confirmação se houver novo custo ou recusando se houver chamada paga incerta.
- **Entrada:**
  - `id: number` (obrigatório) — ID do lote.
  - `sourceId: number` (obrigatório) — ID da Fonte dentro do lote.
  - `confirmed?: boolean` (opcional) — `true` para confirmar cobrança ao retomar Janelas ou Transcrição paga.
- **Saída:** objeto atualizado do lote (mesmo formato de `batches.get`).
- **Erros:** `project_not_open`, `project_busy`, `batch_not_found`, `invalid_batch_state` (lote cancelado), `source_missing` (Fonte não encontrada no lote), `invalid_item_state` (item não está `paused`), `uncertain_job` (job de transcrição em estado `uncertain` — deve ser resolvido na fila de tarefas), `confirmation_required` / `transcription_retry_confirmation` (com `usage.estimate`), `selection_failed`, além de erros propagados por `selection.resume` (ex.: `window_uncertain`, `local_only_violation`, `nothing_to_redo`) ou `transcription.start` (ex.: `groq_key_missing`, `component_missing`, `source_changed`, `local_only_violation`).
- **Eventos e jobs:** reativa o job de seleção (`selection.resume`) ou inicia/retoma a Transcrição (`transcription.start`); o andamento segue pela fila `jobs`. Se falhar por erro diferente de pedido de confirmação, atualiza `error_code` do item e mantém em `paused`.
- **Pré-condições:** Projeto aberto; lote não cancelado; item no estado `paused` (sem job `uncertain` pendente).
- **Tela hoje:** [SourceBatches.tsx](../../../src/features/projects/SourceBatches.tsx#L116).
- **Mock TS:** sim, `src/lib/batchMock.ts` (ativo apenas com `?source-test=1&batch-test=1`).
- **US (#26):** US-31, US-32, US-33, US-49.
- **Código:** `core/src/source_batches.rs:972`

### `proxy.request`
- **O que faz:** Calcula a chave e a janela (±2 min) do proxy de preview de um Corte; se o arquivo ainda não estiver em cache, enfileira sua geração em segundo plano via FFmpeg.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `start_us: number` (obrigatório) — início do Corte em microssegundos (`≥ 0`).
  - `end_us: number` (obrigatório) — fim do Corte em microssegundos (`> start_us`, duração ≤ 10 min / `600_000_000` µs).
- **Saída:** `{ state: "ready" | "queued" | "running", key: string, job: number | null, progress: number, error: string | null, windowStartUs: number, windowEndUs: number }`.
- **Erros:** `invalid_source`, `invalid_range`, `clip_too_long` (> 10 min), `invalid_project`, `project_not_open`, `project_busy`, `source_not_found`, `source_offline`, `source_changed`, `proxy_failed`, `settings`, `project_read`, `project_write`.
- **Eventos e jobs:** se não existir em cache (`missing`, `failed` ou `cancelled`), insere um job `proxy` (local) na tabela `jobs` (cancelável via `jobs.cancel { id: job }`). Quando executado, emite `core-progress` com `job: "<job_id>"`, `project: <id>`, `stage: "proxy"`, `percentage: 1..98`, `message: "Gerando o preview do Corte"`, e ao encerrar na fila `stage: "complete"` (100%, `"Prévia pronta"`) ou `"failed"` (0%, `"Prévia interrompida"`).
- **Pré-condições:** Projeto aberto; Fonte existente, online e com identidade parcial inalterada; Componente FFmpeg instalado para a execução do job.
- **Tela hoje:** [CutPreview.tsx](../../../src/features/projects/CutPreview.tsx#L144).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1&transcript-test=1`).
- **US (#26):** US-70.
- **Código:** `core/src/proxy.rs:312`

### `proxy.status`
- **O que faz:** Consulta o estado atual e o progresso de um proxy de preview pela sua chave SHA-256 (sem expor caminhos de disco).
- **Entrada:**
  - `key: string` (obrigatório) — hash hexadecimal minúsculo de 64 caracteres retornado por `proxy.request`.
- **Saída:** `{ state: "ready" | "queued" | "running" | "cancelled" | "failed" | "missing", key: string, job: number | null, progress: number, error: string | null }`. (Se o job tinha concluído mas o arquivo foi removido pelo LRU, devolve `"missing"`).
- **Erros:** `invalid_key`, `settings`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (apenas consulta; se o arquivo estiver pronto, atualiza seu timestamp `mtime` para o LRU).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [CutPreview.tsx](../../../src/features/projects/CutPreview.tsx#L178).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1&transcript-test=1`).
- **US (#26):** US-70.
- **Código:** `core/src/proxy.rs:320`

### `proxy.map_time`
- **O que faz:** Converte um timestamp em microssegundos entre a linha do tempo da Fonte original (`source_us`) e a do proxy (`proxy_us`), retornando `null` se cair fora da janela.
- **Entrada:**
  - `window_start_us: number` (obrigatório).
  - `window_end_us: number` (obrigatório).
  - `source_us?: number` OU `proxy_us?: number` (obrigatório informar um dos dois; se ambos vierem, prioriza `source_us`).
- **Saída:** `{ proxyUs: number | null }` (quando recebe `source_us`) ou `{ sourceUs: number | null }` (quando recebe `proxy_us`).
- **Erros:** `invalid_range` (campos ausentes ou não inteiros).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** nenhuma (sem uso na UI — [CutPreview.tsx](../../../src/features/projects/CutPreview.tsx#L62) calcula essa conversão localmente em TypeScript).
- **Mock TS:** não.
- **US (#26):** US-55, US-70.
- **Código:** `core/src/proxy.rs:335`

### `chat.fetch`
- **O que faz:** Enfileira a busca e agregação do replay de chat de uma Fonte importada por URL ("buscar o chat depois"), de forma idempotente enquanto houver job ativo.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** `{ state: "queued", job: number }`.
- **Erros:** `project_not_open`, `project_busy`, `source_missing`, `chat_needs_url` (Fonte importada por arquivo local sem `origin_url`), `project_read`, `project_write`.
- **Eventos e jobs:** enfileira job `chat` (local) na tabela `jobs`, cancelável via `jobs.cancel { id: job }`. Durante a execução em background, emite `core-progress` com `job: "<job_id>"`, `project: <id>`, `stage: "chat"`, `percentage: 0` (`"Buscando o chat da live"`) e `50` (`"Agregando o chat da live"`), encerrando na fila com `stage: "complete"` (100%, `"Chat da live pronto"`) ou `"failed"` (0%, `"Busca do chat interrompida"`).
- **Pré-condições:** Projeto aberto; Fonte importada com `origin_url`; Componente `yt-dlp` instalado (a menos que `<mídia>.live_chat.json` já exista ao lado do vídeo).
- **Tela hoje:** [Selection.tsx](../../../src/features/projects/Selection.tsx#L131).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1&transcript-test=1`).
- **US (#26):** US-125.
- **Código:** `core/src/chat.rs:838`

### `chat.status`
- **O que faz:** Consulta se a Fonte possui replay de chat agregado, se pode ser buscado por URL, quantos intervalos/mensagens/picos foram extraídos e o estado do último job `chat`.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** `{ state: "none" | "available" | "absent", canFetch: boolean, intervals: number, messages: number, peaks: number, job: { id: number, state: string, progress: number } | null }`.
- **Erros:** `project_not_open`, `project_busy`, `source_missing`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Fonte existente.
- **Tela hoje:** [Selection.tsx](../../../src/features/projects/Selection.tsx#L90).
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?source-test=1&transcript-test=1`; não inclui `intervals` e `messages`).
- **US (#26):** US-125, US-126.
- **Código:** `core/src/chat.rs:839`

---

## Estados e eventos do domínio

### Eventos `core-progress` emitidos neste domínio

| `job` | `stage` | Quando acontece | `percentage` | `error` |
| --- | --- | --- | --- | --- |
| `<job>` (string passada em `sources.url.download`) | `download` | Durante o download de VOD via `yt-dlp` (`sources.url.download`) | `0..100` | `null` (falhas retornam direto como `CoreError` do comando) |
| `<job>` (ou `"source-hash"`, `"source-relocate"`, `"source-copy-original"`, `"source-copy-check"`) | `hash` | Cálculo síncrono de SHA-256 em `sources.hash`, `sources.relocate` e `sources.import` (`copy: true`) | `0..100` | `null` (falhas retornam direto do comando) |
| `"<job_id>"` (job `preview` enfileirado por `sources.import`) | `waveform` | Extração de onda de áudio da Fonte pela fila | `1..49` | `null` |
| `"<job_id>"` (job `preview`) | `thumbnails` | Extração de miniaturas da Fonte pela fila | `50` | `null` |
| `"<job_id>"` (job `proxy` enfileirado por `proxy.request`) | `proxy` | Transcodificação FFmpeg do proxy do Corte (±2 min) | `1..98` | `null` |
| `"<job_id>"` (job `chat` enfileirado por `sources.import` ou `chat.fetch`) | `chat` | Busca do `live_chat.json` via `yt-dlp` (`0%`) e agregação (`50%`) | `0`, `50` | `null` |
| `"<job_id>"` (jobs `preview`, `proxy`, `chat` na fila) | `complete` / `failed` | Conclusão ou falha/cancelamento do job na fila (`run_queue`) | `100` (`complete`) / `0` (`failed`) | `null` ou `CoreError` |
| `"batch-<id>"` (`source_batches.rs`) | `batch:created` | Criação de um Lote de Fontes (`batches.create`) | `0` | `null` |
| `"batch-<id>"` | `batch:item` | Mudança de estado de um item detectada em `tick()` | `0` | `null` |
| `"batch-<id>"` | `batch:item-paused` | Falha ao iniciar Transcrição/Seleção de uma Fonte em `tick()` | `0` | `CoreError` da falha |
| `"batch-<id>"` | `batch:paused` | Lote pausado pelo usuário (`batches.pause`) | `0` | `null` |
| `"batch-<id>"` | `batch:resumed` | Lote retomado pelo usuário (`batches.resume`) | `0` | `null` |
| `"batch-<id>"` | `batch:cancelled` | Lote cancelado pelo usuário (`batches.cancel`) | `0` | `null` |
| `"batch-<id>"` | `batch:completed` | Todas as Fontes do lote em `completed` ou `cancelled` | `0` | `null` |

### Estados dos objetos do domínio

- **Fonte (`sources.list` / `sources.import`):**
  - `available`: arquivo presente no disco, tamanho, amostra parcial SHA-256 e data de modificação (`mtime`) idênticos ao registrado.
  - `offline`: arquivo não existe no caminho salvo. Transcrição e edição continuam acessíveis; preview e exportação bloqueados até `sources.relocate`.
  - `changed`: arquivo existe no caminho, mas tamanho, hash parcial ou `mtime` mudaram; exige `sources.hash` antes de preview/export.
- **Permissão da Fonte:**
  - `none` (sem permissão registrada) | `granted` (com `who`, `where`, `scope`).
- **Lote de Fontes (`batches.get` → `state` vs. `status` derivado):**
  - `state` persistido: `running` | `paused` | `completed` | `cancelled`.
  - `status` derivado para UI: `running` | `paused` (pausa do usuário) | `budget_paused` (pausa por teto ou custo desconhecido em `ai_pauses`) | `attention` (nenhum item ativo/pendente, mas há itens pausados) | `completed` | `cancelled`.
- **Item do Lote (`source_batch_items.state`):**
  - `pending` → `transcribing` → `selecting` → `completed` (ou `paused` com `error_code`, ou `cancelled`).
- **Proxy do Corte (`proxy.request` / `proxy.status`):**
  - `missing` (não existe ou limpo pelo LRU) | `queued` | `running` | `ready` | `cancelled` | `failed`.
- **Replay de Chat (`chat.status`):**
  - `none` (nunca buscado ou falhou antes de gravar) | `available` (série agregada pronta no SQLite) | `absent` (vídeo sem `live_chat` ou sem mensagens válidas).

---

## Configurações deste domínio

| Preferência / Dado | Onde vive | Comandos que leem | Comandos que gravam |
| --- | --- | --- | --- |
| Lista de Projetos recentes (`projects.json`) | Diretório de dados do app (`AppDirs.data_dir`, em `core/src/paths.rs`) | `projects.recent` | `projects.open`, `projects.create` |
| Nome e migrações do Projeto (`project`, `schema_migrations`) | `project.sqlite` (pasta `.clipes`) | `projects.open`, `projects.current` | `projects.create`, `projects.open` |
| Veto "Somente local" do Projeto (`project_privacy.local_only`) | `project.sqlite` (pasta `.clipes`) | `projects.local_only.get`, `batches.create` (e Tarefas de IA) | `projects.local_only.set` |
| Aceite dos Termos do YouTube e pasta padrão de download (`terms_accepted`, `download_dir`) | `url-import.json` no diretório de configuração do app (`AppDirs.config_dir`) | `sources.url.settings.get`, `sources.url.download` | `sources.url.settings.set` |
| Diretório e limite de cache de proxies (`cache_dir`, `cache_limit_bytes`) e caminho do FFmpeg | `settings.json` (ou `component-settings.json` quando `CLIPES_DATA_DIR` está definido, via `core/src/paths.rs`) | `proxy.request`, `proxy.status`, `sources.inspect`, `sources.import`, `sources.hash`, `sources.relocate`, `sources.url.download` | Domínio de Componentes (`components.settings.set`) |
| Idioma e Permissão padrão/por Fonte (`sources.language`, `sources.permission`) | `project.sqlite` (tabela `sources`) | `sources.list`, `sources.import` (lê idioma padrão de `channel_profile`) | `sources.import`, `sources.language.set`, `sources.permission.set` |
| Teto de custo do lote (`ai_budgets` / `ai_pauses` com `scope='batch'`, `key='sources-<id>'`) | `project.sqlite` | `batches.get`, `batches.list`, `batches.create` | `batches.create`, `batches.pause`, `batches.resume`, `batches.cancel` (e `jobs.budget.*`) |

---

## Observações para o front novo

1. **Comandos do núcleo sem uso na UI hoje (`projects.close`, `proxy.map_time`):**
   - `projects.close` (`core/src/projects/backups.rs:438`) existe para salvar edições pendentes (`editor.flush`), parar a fila e fechar o Projeto ativo, mas nenhuma tela em `src/features/**` o chama (a UI só troca de Projeto abrindo outro).
   - `proxy.map_time` (`core/src/proxy.rs:335`) converte tempos entre Fonte e proxy, mas `src/features/projects/CutPreview.tsx:62` duplicou a lógica em TypeScript (`toProxySeconds`) e nunca chama o comando.
2. **Lacunas graves no Mock TS (`src/lib/core.ts` e `src/lib/batchMock.ts`):**
   - `projects.create`, `projects.open`, `projects.close`, `sources.cancel`, `sources.url.cancel` e `proxy.map_time` **não têm mock** em `src/lib/core.ts` (caem em `Unknown core command` ao rodar com `VITE_CORE_MOCK=1`).
   - Quase todos os mocks de `sources.*`, `proxy.*` e `chat.*` em `src/lib/core.ts` exigem query params especiais (`?source-test=1`, `?transcript-test=1`), e `batches.*` exige `?source-test=1&batch-test=1` em `src/lib/batchMock.ts`.
   - `chat.status` no mock (`src/lib/core.ts:267`) omite os campos `intervals` e `messages` retornados pelo núcleo Rust; `sources.import` no mock ignora `copy` e `audio_track` e fixa `id: 4`.
   - `src/features/export/mock.ts:99-109` referencia `batches.get` dentro do mock de exportação legado.
3. **Inconsistência de nomenclatura (`snake_case` vs. `camelCase`) e campo `project` redundante:**
   - `projects.*` e `sources.*` usam `snake_case` (`audio_track`, `origin_url`, `terms_accepted`, `download_dir`); `chat.*` recebe `source_id` (`snake_case`) mas retorna `canFetch` (`camelCase`); `proxy.request` recebe `source_id`, `start_us`, `end_us` (`snake_case`) mas retorna `windowStartUs`, `windowEndUs` (`camelCase`), e `proxy.map_time` recebe `window_start_us`/`source_us` e retorna `proxyUs`/`sourceUs`; `batches.*` usa `camelCase` em tudo (`sourceIds`, `videoKind`, `maxCostMicroUsd`, `sourceId`).
   - `sources.*` (exceto `sources.inspect`, `sources.cancel`, `sources.url.settings.*` e `sources.url.cancel`) e `sources.url.download` exigem `project: string` na entrada apenas para validar se bate com o Projeto aberto, enquanto `projects.local_only.*`, `batches.*`, `proxy.*` e `chat.*` leem o Projeto aberto direto da sessão.
4. **Dois modelos diferentes de cancelamento e execução assíncrona:**
   - `sources.url.download`, `sources.hash`, `sources.relocate` (e `copy` em `sources.import`) rodam de forma **síncrona/bloqueante** na thread de despacho usando `job: string` e mapas em memória (`sources.url.cancel` / `sources.cancel`). Em `sources.import` com `copy: true`, os IDs emitidos (`"source-copy-original"` e `"source-copy-check"`) são fixos e a UI atual não oferece cancelamento durante a cópia.
   - `proxy.request`, `chat.fetch`, `batches.create` e o job `preview` gerado por `sources.import` usam a **fila persistente `jobs`** no SQLite (IDs numéricos, cancelamento via `jobs.cancel` ou `batches.cancel`).
5. **Funcionalidades ausentes no núcleo e tratamentos faltantes na UI atual:**
   - Não existe comando para **remover/excluir uma Fonte** do Projeto (`sources.delete` não existe).
   - **Cookies/login no `yt-dlp`** e **download por trecho / "só áudio primeiro"** (`US-123`, `US-124`) ficaram fora da v1 no núcleo.
   - Em `ProjectPrivacy.tsx:30-35`, qualquer erro de `projects.local_only.*` exibe uma mensagem genérica fixa; em `Sources.tsx`, erros como `terms_required`, `job_running`, `invalid_url`, `download_directory`, `source_mismatch`, `copy_exists`, `hash_mismatch`, `transcription_busy`, `transcript_complete` e `transcript_partial` não têm tratamento dedicado além do alerta genérico; e em `SourceBatches.tsx:124`, `uncertain_job` exibe apenas um texto estático sem levar o usuário para a fila de tarefas (`jobs.retry` / `jobs.discard`).
