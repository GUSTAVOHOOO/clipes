# Instalação de componentes, sistema e backups

## A jornada

Antes de importar uma Fonte, rodar a Transcrição local, gerar Narração por TTS ou exportar um Corte, o usuário precisa preparar as ferramentas externas que o Clipes não embute no instalador. Nesta etapa, ele consulta o manifesto embutido (tamanhos, licenças e código-fonte), escolhe onde guardar Componentes e cache, opcionalmente aponta um FFmpeg já instalado no sistema, e confirma cada download — sempre verificado por hash SHA-256 e com suporte a retomada. Quando tem placa NVIDIA, o worker Python recebe bibliotecas CUDA; sem ela, instala apenas a variante CPU.

Depois dos downloads iniciais, este domínio também cuida da manutenção contínua sem exigir atualização completa do app: atualização independente do `yt-dlp` (com assinatura PGP), verificação do catálogo remoto assinado de modelos (assinatura Ed25519 e proteção contra rollback), atualização de modelos de Transcrição, detecção facial (YuNet) e Narração (Pocket TTS), além de exibir a versão do aplicativo na tela "Sobre".

Quando algo falha ou quando o usuário quer proteger seu trabalho, entram as duas pontas de confiabilidade do sistema: os backups automáticos e manuais do banco SQLite de cada Projeto portátil (`*.clipes`) e a geração/exportação de diagnóstico sanitizado por lista permitida (allowlist), sem telemetria automática, para abrir relatos públicos no GitHub após revisão humana.

## Fluxo típico

### 1. Primeira execução e instalação de Componentes
1. A UI consulta `components.settings.get` para exibir e permitir alterar a pasta de dados, a pasta de cache e o limite de cache (`components.settings.set`).
2. Para cada grupo de ferramentas, a UI consulta manifestos e estados atuais:
   - `components.manifest` + `components.ffmpeg.status` + `components.ytdlp.status` + `components.deno.status` + `components.pocket_tts.status`
   - `components.catalog.status` (versão e origem do catálogo de modelos)
   - `components.worker.status` (estado do ambiente Python isolado e presença de GPU NVIDIA)
   - `components.models.manifest` (modelos de Transcrição e YuNet)
   - `tts.catalog` (motores, modelos e vozes TTS)
3. O usuário confirma explicitamente cada instalação:
   - Executáveis individuais (`ffmpeg`, `yt-dlp`, `uv`, `deno`, `pocket-tts`): `components.download` (ou aponta um FFmpeg existente com `components.ffmpeg.system`).
   - Worker Python de ML: `components.worker.install` (baixa o `uv` se faltar, instala Python 3.12 gerenciado e dependências travadas).
   - Modelos do worker (`whisper-turbo`, `whisper-small`, `yunet`): exige worker instalado e chama `components.models.download`.
   - Modelos TTS (`portuguese_24l`, `portuguese`, `english`): exige aceitação do termo de uso proibido e chama `tts.models.download`; opcionalmente troca o modelo ativo por idioma com `tts.models.choose`.
4. Durante downloads e instalações, o núcleo emite eventos `core-progress` (progresso percentual).
   - **Cancelar:** `components.cancel` cancela downloads de Componentes, modelos do worker e instalação do worker; `tts.models.cancel` cancela downloads de modelos TTS.
   - **Erro:** falhas de rede, hash ou permissão retornam `CoreError`; arquivos `.part` parciais são mantidos (quando a falha não é de hash) para retomada na próxima tentativa.

### 2. Atualização de catálogo, modelos e `yt-dlp`
1. `components.catalog.check` consulta releases `catalog-N` no GitHub, valida a assinatura Ed25519 e recusa versões menores que a atual. Se houver novidade, a UI recarrega `components.models.manifest` e `tts.catalog`.
2. `components.ytdlp.update` baixa a release nightly mais recente do `yt-dlp`, confere a assinatura PGP de `SHA2-256SUMS` e o hash do executável, testa `--version` e mantém backup para restaurar em caso de falha.

### 3. Backups do Projeto e relato de problemas
1. Com um Projeto aberto, `backups.list` e `backups.settings.get` mostram as cópias existentes e o intervalo/retenção configurados; `backups.settings.set` altera as regras, `backups.create` cria uma cópia imediata (após `editor.flush`) e `backups.restore` valida o arquivo e preserva o estado atual em `before-restore-*` antes de restaurar.
2. Na tela de relato, `diagnostic.get` monta o texto de diagnóstico a partir da allowlist; `diagnostic.export` salva esse texto revisado em um arquivo `.txt`.
3. Na tela "Sobre", `app.version` informa a versão do pacote compilado.

---

## Onde vive cada configuração do app (visão geral)

Esta seção é a referência global para todos os domínios do Clipes. A resolução central fica em [core/src/paths.rs](../../../core/src/paths.rs) e separa estritamente o **Projeto portátil** (pasta `.clipes`) dos **dados e configurações globais do aplicativo**.

### Diretórios base (`AppDirs` e `CLIPES_DATA_DIR`)

O núcleo resolve três diretórios base fora dos Projetos (`paths::app_dirs`, usando o identificador `io.github.gustavohooo.clipes`, separado da pasta de instalação do NSIS `%LOCALAPPDATA%\Clipes`):

| Variável / Ambiente | `data_dir` (dados globais) | `config_dir` (configurações globais) | `cache_dir` (cache descartável) |
| :--- | :--- | :--- | :--- |
| **`CLIPES_DATA_DIR` definida** (`isolated = true`) | `<CLIPES_DATA_DIR>` | `<CLIPES_DATA_DIR>` (igual ao `data_dir`) | `<CLIPES_DATA_DIR>/cache` |
| **Windows padrão** | `%LOCALAPPDATA%\io.github.gustavohooo.clipes` | Igual ao `data_dir` | `<data_dir>\cache` |
| **Linux / macOS padrão** | `$XDG_DATA_HOME/io.github.gustavohooo.clipes` (ex.: `~/.local/share/...`) | `$XDG_CONFIG_HOME/io.github.gustavohooo.clipes` (ex.: `~/.config/...`) | `$XDG_CACHE_HOME/io.github.gustavohooo.clipes` (ex.: `~/.cache/...`) |

> **Atenção sobre `settings.data_dir` e `settings.cache_dir`:** o usuário pode escolher outro disco em `components.settings.set`, gravando `data_dir` e `cache_dir` customizados no arquivo de configurações de Componentes. Esse redirecionamento move `components/`, `worker/`, `models/`, `tts-models/`, `tts-settings.json`, `catalog/`, `transcription-hardware.json` e o cache de proxies/mídias (`cache_dir`), **mas não move** os arquivos lidos diretamente via `paths::config_file` ou `paths::data_file` (como o próprio `settings.json`, `projects.json`, `provider.json`, `diagnostic.log` e `export-encoder.json`).

### Migração única de dados legados (`paths::ensure_migrated`)

Na inicialização do Tauri (`src-tauri/src/main.rs:117`), o núcleo chama `paths::ensure_migrated()` (protegido por `OnceLock`, roda uma vez por processo).
- **Quando não roda:** se `CLIPES_DATA_DIR` estiver definida (`isolated = true`), a migração é ignorada para nunca tocar nos dados reais do usuário (obrigatório em testes).
- **Marcador:** quando termina sem erros, grava `<data_dir>/.migrated-v1.json` com o resumo por categoria (sem caminhos pessoais). Se o marcador já existir, não faz nada.
- **O que migra:** move (ou copia e remove entre volumes diferentes, sem sobrescrever arquivos já existentes no destino) itens das pastas legadas `Clipes/` e `directories::ProjectDirs("io", "github.gustavohooo", "clipes")`:
  - Pastas de dados: `components/`, `models/`, `worker/` (ajustando `venv/pyvenv.cfg` e symlinks Unix em `venv/bin/` para o novo caminho) e `cache/` → `cache_dir`.
  - Arquivos de dados: `projects.json`, `transcription-hardware.json`, `diagnostic.log`, `ytdlp-diagnostic.json`, `export-encoder.json`.
  - Arquivos movidos para `config_dir`: `export-settings.json`, `url-import.json`, `settings.json` (atualizando `data_dir`, `cache_dir` e `ffmpeg_path` se apontavam para a pasta legada), `transcription-consent.json`, `assistant.json`, `provider.json`, `provider-cli.json`, `provider-prices.json`, `token-calibration.json`, `provider-context.json`.

### Mapa completo de armazenamento do Clipes

#### 1. Arquivos de configuração global (`config_dir` via `paths::config_file`)
| Arquivo | O que guarda | Domínio / Módulo |
| :--- | :--- | :--- |
| `settings.json` (ou `component-settings.json` na raiz de `CLIPES_DATA_DIR` quando isolado) | `data_dir`, `cache_dir`, `cache_limit_bytes`, `ffmpeg_path` | Componentes (`core/src/components.rs`) |
| `assistant.json` | Estado do assistente de Provedor, escolha padrão, roteamento por Tarefa de IA e flags `Somente local` por tarefa | Provedor / Assistente (`core/src/assistant.rs`) |
| `provider.json` | Perfis de Provedor, endpoint/modelo legado, limites, endpoints remotos confirmados | Provedor (`core/src/provider.rs`) |
| `provider-cli.json` | CLI selecionado (`codex`, `claude`, `opencode`) e confirmações de consentimento | Provedor CLI (`core/src/provider_cli.rs`) |
| `provider-prices.json` | Sobrescritas manuais da tabela de preços de modelos | Custos de IA (`core/src/provider/cost.rs`) |
| `token-calibration.json` | Fator local de calibração de estimativa de tokens (gravado ao lado de `provider.json`) | Provedor (`core/src/provider.rs`) |
| `provider-context.json` | Cache de limites de contexto medidos/descobertos por perfil (gravado ao lado de `provider.json`) | Provedor (`core/src/provider/context.rs`) |
| `export-settings.json` | Preferências globais de exportação | Exportação (`core/src/export.rs`) |
| `url-import.json` | Aceitação dos termos de importação por URL e pasta de download de VOD | Fontes (`core/src/url_import.rs`) |
| `transcription-consent.json` | Consentimento para envio de áudio ao Motor remoto Groq | Transcrição (`core/src/transcription/remote.rs`) |

#### 2. Dados globais, binários e modelos (`data_dir` e `settings.data_dir`)
| Caminho | Origem do caminho base | O que guarda |
| :--- | :--- | :--- |
| `projects.json` | `paths::data_file` | Índice reconstruível de Projetos recentes (`projects.recent`) |
| `export-encoder.json` | `paths::data_file` | Cache do encoder de vídeo detectado/escolhido (`NVENC`, `QSV`, `AMF`, `VideoToolbox`, `x264`) |
| `diagnostic.log` | `paths::data_file` | Log append-only apenas com códigos fixos (`component_failure`, `gpu_probe_fallback`, etc.) |
| `ytdlp-diagnostic.json` | `paths::data_file` | Último código e padrões fechados de falha do `yt-dlp` |
| `.migrated-v1.json` | `paths::data_dir` | Marcador idempotente da migração de dados legados |
| `components/` | `settings.data_dir` | Executáveis baixados (`ffmpeg`, `ffprobe`, `yt-dlp` + `yt-dlp.state.json`, `uv`, `deno`, `pocket-tts`) |
| `catalog/` | `settings.data_dir` | Catálogo remoto assinado em cache (`catalog.json` e `catalog.json.sig`) |
| `worker/` | `settings.data_dir` | Worker Python de ML (`project/`, `python/`, `venv/`, `uv-cache/`, `worker.state.json`) |
| `models/<id>/` | `settings.data_dir` | Pesos dos modelos do worker (`whisper-turbo`, `whisper-small`, `yunet`) + `model.state.json` |
| `tts-models/<engine_id>/<model_id>/` | `settings.data_dir` | Pesos TTS, embeddings em `voices/*.safetensors`, `config.yaml` gerado e `model.state.json` |
| `tts-settings.json` | `settings.data_dir` | Modelo TTS ativo escolhido por idioma (`active_models`: `pt`, `en`) |
| `transcription-hardware.json` | `settings.data_dir` | Resultado da sonda de GPU/VRAM, escolha manual de modelo/precisão e agrupamento |

#### 3. Cache descartável (`settings.cache_dir`, padrão em `AppDirs::cache_dir`)
- `proxies/<hash64>/`: proxies de preview (`proxy.mp4`), tiras de miniaturas (`thumbs.jpg`) e dados de onda (`wave.bin`), gerenciados com limpeza LRU respeitando o menor valor entre `cache_limit_bytes` e o limite interno de 2 GiB (`proxy::CACHE_MAX_BYTES`).
- Pastas temporárias de processamento de áudio de Narração: `narration-align/`, `narration-cleanup/`, `narration-record/`.

#### 4. Cofre do sistema (Keyring / Credential Manager)
As chaves de API nunca são gravadas em arquivos JSON, SQLite nem enviadas para a UI:
- Serviço `io.github.gustavohooo.clipes.provider`: chaves dos Perfis de Provedor e da configuração legada.
- Serviço `io.github.gustavohooo.clipes.transcription`, conta `groq`: chave da API do Groq para Transcrição remota.

#### 5. Pasta portátil do Projeto (`<Nome>.clipes/`)
Conforme o ADR-0005, toda a produção do canal vive dentro da pasta `<Nome>.clipes/`:
- `project.sqlite` (SQLite com `rusqlite` bundled, modo `WAL`, `FTS5` e migrações por `inventory::submit! { Migration }`): Fontes referenciadas e Permissões, Lotes de Fontes, Transcrições (`transcripts`, `transcript_words`, `sentences`, `sentence_search`), análises de energia e chat, execuções e revisão de seleção de Cortes, edições/snapshots de Cortes, estilo e overrides de legenda, Roteiros/ângulos, Narrações/alinhamento/limpeza/trilhas, Empacotamento, exportações e lotes, fila persistente de `jobs`, custos/auditoria/orçamento de IA, `channel_profile`, `backup_settings` e `project_privacy` (veto `Somente local` do Projeto).
- `project.pre-migration.sqlite`: backup verificado criado automaticamente antes de aplicar migrações pendentes no banco.
- `backups/`: cópias rotativas `backup-<39 dígitos>.sqlite` e cópias de segurança pré-restauração `before-restore-<39 dígitos>.sqlite`.

---

### O worker Python de ML (o que é, como é instalado e para que serve)

Conforme o ADR-0004 e sua emenda de 16/11/2026:
- **O que é:** um único processo Python gerenciado (`clipes_worker`), cujo código-fonte e travas (`pyproject.toml`, `uv.lock` e módulos em `worker/src/clipes_worker/`) vão embutidos no binário Rust (`core/src/components/worker.rs`). Ele **nunca** usa o Python instalado no sistema do usuário e **nunca** abre o banco `project.sqlite`.
- **Para que serve:** executa exclusivamente tarefas de ML que dependem de bibliotecas Python:
  1. Sonda de hardware e Transcrição local (`faster-whisper` / CTranslate2 e VAD Silero);
  2. Detecção de rostos/área para reenquadramento 9:16 (`onnxruntime` com modelo YuNet);
  3. Apoio de VAD/alinhamento ligado ao fluxo do worker (a síntese de voz TTS foi movida para o executável Rust `pocket-tts`, sem PyTorch no worker).
- **Como é instalado (`components.worker.install`):**
  1. Se o `uv` da versão fixada ainda não estiver em `<data_dir>/components/`, o núcleo baixa e verifica o `uv` primeiro.
  2. Detecta se há GPU NVIDIA executando `nvidia-smi -L`.
  3. Grava os arquivos embutidos em `<data_dir>/worker/project/` e executa o `uv` sem shell, com variáveis `UV_PYTHON_PREFERENCE=only-managed`, `UV_NO_CONFIG=1` e remoção de `VIRTUAL_ENV`/`CONDA_PREFIX`/`PYTHONPATH`/`PYTHONHOME`:
     - `uv python install 3.12 --python-preference only-managed ...` (instala Python standalone em `<data_dir>/worker/python/`);
     - `uv sync --frozen --no-dev --extra cuda` (ou `--extra cpu` sem GPU NVIDIA; quando `cuda`, passa `--no-install-package onnxruntime` para evitar conflito com o wheel GPU).
  4. Grava `<data_dir>/worker/worker.state.json` (com versão do `uv`, flag `cuda`, `lock_sha256` e `files_sha256`) e inicia o processo uma vez para confirmar o handshake.
- **Como funciona em execução:** o núcleo Rust sobe o processo via `WorkerClient::start`, troca mensagens **JSON lines** (protocolo versão `1`) pelo `stdin`/`stdout`, carrega um modelo por vez para caber em 4 GB de VRAM, recebe eventos de progresso e erros tipados (descartando texto bruto que possa conter caminhos pessoais) e envia os resultados para o núcleo persistir. Ao iniciar, `start_worker()` ressincroniza arquivos de `worker/project/` automaticamente se o app tiver sido atualizado.

### O catálogo remoto assinado de modelos

Conforme `core/src/components/catalog.rs`:
- **Fallback offline garantido:** o app embute `catalog/models.json` na compilação (versão inicial `1`).
- **Atualização remota segura:** `components.catalog.check` consulta `https://api.github.com/repos/GUSTAVOHOOO/clipes/releases?per_page=100` (apenas HTTPS e domínios GitHub permitidos, limite de 1 MiB), procura releases não rascunho com tag `catalog-<N>`, baixa `catalog.json` e a assinatura destacada `catalog.json.sig` (128 caracteres hex = 64 bytes).
- **Verificação criptográfica e anti-rollback:** verifica a assinatura Ed25519 contra a chave pública embutida `CATALOG_PUBLIC_KEY_HEX`, rejeita versões menores que a conhecida (ou versão `0`), valida licenças comerciais permitidas (ADR-0003), revisões Git de 40 hexadecimais, URLs apenas de domínios permitidos (`huggingface.co`, `hf.co`, `github.com`, `githubusercontent.com`), tamanhos positivos e hashes SHA-256 válidos.
- **Persistência:** grava atomicamente em `<settings.data_dir>/catalog/catalog.json` e `catalog.json.sig`. Se os arquivos em cache forem adulterados ou corrompidos, `load_active_catalog` volta automaticamente para o catálogo embutido e expõe um aviso (`warning` / `warningCode`).

### O relato de problemas sem telemetria (ADR-0006)

- **Zero telemetria:** nenhum comando envia dados automaticamente. O registro local (`<paths::data_dir>/diagnostic.log` e `ytdlp-diagnostic.json`) aceita exclusivamente códigos fechados de evento (`DiagnosticEvent`) e códigos/padrões fechados do `yt-dlp`, nunca mensagens arbitrárias de erro, nomes de Fontes ou caminhos pessoais.
- **Allowlist rigorosa (`diagnostic.get`):** constrói um resumo textual apenas com versão do app, SO, etapa de falha (se houver log), últimas 200 linhas reconstruídas a partir dos códigos do log, último diagnóstico estruturado do `yt-dlp` (se existir) e os 10 campos registrados via `DiagnosticField` (Componentes, GPU/VRAM, Encoder, Motor de transcrição, Provedor, Calibração de tokens, Versão da Tarefa de IA, Hash do prompt SHA-256, Contexto efetivo em tokens e Origem do contexto efetivo). Mesmo que `diagnostic.log` seja editado no disco, linhas desconhecidas são ignoradas na leitura.
- **Revisão humana obrigatória:** a UI (`src/features/report/Report.tsx`) exibe o diagnóstico em um campo editável (ligado por padrão em relato de bug e desligado em sugestão de ideia), alerta se o usuário digitar "token", "chave" ou "key", oferece exportação local (`diagnostic.export`) e abre uma URL `issues/new` do GitHub no navegador (copiando o diagnóstico para a área de transferência se a URL passar de ~8 KB).

---

## Comandos

### `components.manifest`
- **O que faz:** retorna a lista de Componentes executáveis embutida para o sistema operacional e arquitetura atuais, com versão, tamanho, licença e URLs de código-fonte.
- **Entrada:** nenhuma (`{}`).
- **Saída:** array JSON de objetos `{ id: string, version: string, url: string, sha256: string, size: number, license: string, source_url: string, build_source_url: string | null }`. No Windows x64 e Linux x64 inclui `ffmpeg`, `yt-dlp`, `uv`, `deno` e `pocket-tts`; no macOS (`aarch64` / `x86_64`) inclui apenas `deno` e `pocket-tts`.
- **Erros:** nenhum.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L36) (repassa itens para `DenoCard` e `PocketTtsCard`) e [src/features/projects/Sources.tsx](../../../src/features/projects/Sources.tsx#L44).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L810-L816).
- **US (#26):** US-3, US-45.
- **Código:** [core/src/components.rs:882](../../../core/src/components.rs#L882).

### `components.download`
- **O que faz:** baixa (com retomada HTTP `Range` e verificação SHA-256) e extrai/instala um Componente executável do manifesto na pasta `<data_dir>/components/`.
- **Entrada:** `id: string` obrigatório (`"ffmpeg"`, `"yt-dlp"`, `"uv"`, `"deno"` ou `"pocket-tts"`, conforme manifesto da plataforma); `confirmed: boolean` obrigatório (precisa ser `true`).
- **Saída:** `{ path: string }` com o caminho do executável instalado. Quando `id == "ffmpeg"`, também atualiza `ffmpeg_path` nas configurações salvas.
- **Erros:**
  - `confirmation_required` — `confirmed` não é `true`;
  - `unknown_component` — `id` ausente ou indisponível no manifesto desta plataforma;
  - `already_downloading` — já existe um download/operação em andamento com esse `id`;
  - `settings` — erro ao ler ou gravar as configurações de Componentes;
  - `download` — falha de rede, resposta HTTP inválida, erro de `Content-Range` na retomada ou erro de arquivo `.part`;
  - `cancelled` — download cancelado via `components.cancel`;
  - `hash_mismatch` — tamanho final ou SHA-256 diferente do manifesto (o `.part` é descartado);
  - `install` — falha ao extrair `.zip`/`.tar.xz`/`.tar.gz`, executável ausente no pacote ou erro ao mover para o destino final.
- **Eventos e jobs:** síncrono na chamada (bloqueia a thread de despacho Tauri até terminar/falhar), não entra na fila SQLite do Projeto (`core/src/jobs*`). Emite `core-progress` com `job: "<id>"` (sem `project`): `stage: "download"` (`0..99`, `"Baixando componente"`) e `stage: "complete"` (`100`, `"Componente instalado"`). Cancelável por `components.cancel` com `{ id }`.
- **Pré-condições:** confirmação explícita do usuário (`confirmed: true`); `settings.data_dir` gravável.
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L45), [src/features/components/DenoCard.tsx](../../../src/features/components/DenoCard.tsx#L33), [src/features/components/PocketTtsCard.tsx](../../../src/features/components/PocketTtsCard.tsx#L90) e [src/features/projects/Sources.tsx](../../../src/features/projects/Sources.tsx#L45).
- **Mock TS:** sim, parcialmente (apenas `id === 'deno'` e `id === 'pocket-tts'`), em [src/lib/core.ts](../../../src/lib/core.ts#L483-L485).
- **US (#26):** US-3, US-4, US-5, US-6.
- **Código:** [core/src/components.rs:883](../../../core/src/components.rs#L883).

### `components.cancel`
- **O que faz:** sinaliza o cancelamento de um download ou operação em memória registrada no mapa global de jobs de Componentes (`components::jobs()`).
- **Entrada:** `id: string` obrigatório (identificador da operação: ID do componente como `"ffmpeg"`, `"yt-dlp"`, `"deno"`, `"pocket-tts"`, `"uv"`; ID de modelo como `"whisper-turbo"`, `"whisper-small"`, `"yunet"`; `"worker"`; `"hardware-probe"`; ou `"transcription-estimate"`).
- **Saída:** `{}` (objeto vazio; não falha se o `id` não estiver rodando).
- **Erros:** nenhum.
- **Eventos e jobs:** nenhum evento próprio (a operação cancelada é quem interrompe e retorna erro `cancelled`). Não entra na fila SQLite do Projeto.
- **Pré-condições:** operação correspondente em execução em `components::jobs()`.
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L52), [DenoCard.tsx](../../../src/features/components/DenoCard.tsx#L47), [PocketTtsCard.tsx](../../../src/features/components/PocketTtsCard.tsx#L127), [WorkerCard.tsx](../../../src/features/components/WorkerCard.tsx#L53), [ModelsCard.tsx](../../../src/features/components/ModelsCard.tsx#L59), [HardwareCard.tsx](../../../src/features/components/HardwareCard.tsx#L100) e [LocalEstimate.tsx](../../../src/features/projects/LocalEstimate.tsx#L61).
- **Mock TS:** não (não implementado em `src/lib/core.ts`).
- **US (#26):** US-51.
- **Código:** [core/src/components.rs:884](../../../core/src/components.rs#L884).

### `components.settings.get`
- **O que faz:** lê as configurações globais de armazenamento de Componentes e cache (ou devolve os padrões derivados de `paths::app_dirs()` se o arquivo ainda não existir).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ data_dir: string, cache_dir: string, cache_limit_bytes: number, ffmpeg_path: string | null }` (padrão de `cache_limit_bytes`: `10_000_000_000`, equivalente a 10 GB decimais).
- **Erros:**
  - `settings` — diretório de configurações indisponível ou arquivo de configurações corrompido/ilegível.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L39) e `useSystem` (linha 48).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L880).
- **US (#26):** US-8, US-9.
- **Código:** [core/src/components.rs:885](../../../core/src/components.rs#L885).

### `components.settings.set`
- **O que faz:** valida e salva a pasta de dados dos Componentes/modelos, a pasta de cache, o limite de cache e o caminho do FFmpeg; se `data_dir` mudar e `ffmpeg_path` apontava para o FFmpeg gerenciado anterior, revalida se já existe um `ffmpeg` gerenciado no novo `data_dir`.
- **Entrada:** `{ data_dir: string, cache_dir: string, cache_limit_bytes: number, ffmpeg_path: string | null }` (todos os campos da struct `Settings` são obrigatórios; `ffmpeg_path` pode ser `null`). `data_dir` e `cache_dir` devem ser caminhos absolutos e `cache_limit_bytes > 0`.
- **Saída:** o objeto `Settings` salvo (com `ffmpeg_path` eventualmente ajustado na troca de `data_dir`).
- **Erros:**
  - `invalid_settings` — JSON incompatível com `Settings`, caminho relativo em `data_dir`/`cache_dir` ou `cache_limit_bytes == 0`;
  - `settings` — erro ao gravar o arquivo de configurações.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** `data_dir` e `cache_dir` absolutos e `cache_limit_bytes > 0`.
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L47).
- **Mock TS:** não (não implementado em `src/lib/core.ts`).
- **US (#26):** US-8, US-9.
- **Código:** [core/src/components.rs:886](../../../core/src/components.rs#L886).

### `components.ffmpeg.status`
- **O que faz:** verifica se o FFmpeg configurado está instalado e completo (no caso do FFmpeg gerenciado em `<data_dir>/components/`, exige que `ffmpeg` e `ffprobe` existam no disco).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ incomplete: boolean, installed: boolean }`.
- **Erros:**
  - `settings` — falha ao ler o arquivo de configurações de Componentes.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L34), [src/features/projects/EngineChoice.tsx](../../../src/features/projects/EngineChoice.tsx#L43) e [src/features/projects/Sources.tsx](../../../src/features/projects/Sources.tsx#L39).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L714).
- **US (#26):** US-3, US-7.
- **Código:** [core/src/components.rs:881](../../../core/src/components.rs#L881).

### `components.ffmpeg.system`
- **O que faz:** valida um executável FFmpeg do sistema (e o `ffprobe` correspondente) rodando `-version` sem shell e, se ambos funcionarem, registra o caminho em `settings.ffmpeg_path`.
- **Entrada:** `path: string` opcional (padrão `"ffmpeg"` se omitido ou nulo).
- **Saída:** `{ version: string, path: string }` (`version` é a primeira linha de `ffmpeg -version`).
- **Erros:**
  - `invalid_ffmpeg` — falha ao executar o binário, código de saída diferente de zero ou saída não começa com `"ffmpeg version "`;
  - `ffprobe_missing` — `ffprobe` irmão ou no `PATH` não encontrado ou inválido;
  - `settings` — falha ao ler ou salvar o arquivo de configurações.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** `ffmpeg` e `ffprobe` acessíveis no caminho informado ou no `PATH`.
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L48).
- **Mock TS:** não (não implementado em `src/lib/core.ts`).
- **US (#26):** US-7.
- **Código:** [core/src/components.rs:887](../../../core/src/components.rs#L887).

### `components.deno.status`
- **O que faz:** verifica se o runtime `deno` (usado pelo `yt-dlp` para extrair streams do YouTube) está instalado na pasta de componentes, qual versão reporta e se difere da versão fixada no manifesto.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ installed: boolean, version: string | null, pinned: string | null, outdated: boolean }`.
- **Erros:**
  - `settings` — falha ao ler as configurações de Componentes.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/DenoCard.tsx](../../../src/features/components/DenoCard.tsx#L23).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L482).
- **US (#26):** US-3, US-45.
- **Código:** [core/src/components.rs:879](../../../core/src/components.rs#L879).

### `components.pocket_tts.status`
- **O que faz:** verifica se o executável `pocket-tts` (motor local de Narração por TTS) está instalado na pasta de componentes, qual versão reporta e se está desatualizado em relação ao manifesto.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ installed: boolean, version: string | null, pinned: string | null, outdated: boolean }`.
- **Erros:**
  - `settings` — falha ao ler as configurações de Componentes.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/PocketTtsCard.tsx](../../../src/features/components/PocketTtsCard.tsx#L71).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L484).
- **US (#26):** US-3, US-91.
- **Código:** [core/src/components.rs:880](../../../core/src/components.rs#L880).

### `components.ytdlp.status`
- **O que faz:** verifica se o `yt-dlp` está instalado em `<data_dir>/components/` e confere sua integridade (hash do manifesto ou `yt-dlp.state.json` assinado após atualização).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ installed: false }` quando ausente; `{ installed: true, version: string }` quando instalado e íntegro.
- **Erros:**
  - `settings` — falha ao ler configurações;
  - `component_missing` — `yt-dlp` indisponível no manifesto desta plataforma ou erro ao abrir o arquivo;
  - `component_integrity` — hash do executável não bate com o manifesto nem com um `yt-dlp.state.json` válido de versão igual ou superior.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L33).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L710).
- **US (#26):** US-17, US-45.
- **Código:** [core/src/components/update.rs:359](../../../core/src/components/update.rs#L359).

### `components.ytdlp.update`
- **O que faz:** verifica a release mais recente de `yt-dlp/yt-dlp-nightly-builds`, valida a assinatura PGP de `SHA2-256SUMS` com a chave pública fixada, baixa o novo binário, confere o SHA-256, executa `--version` e substitui o anterior (com backup e restauração automática se falhar).
- **Entrada:** `confirmed: boolean` obrigatório (`true`).
- **Saída:** `{ version: string, up_to_date: true }` se já estiver na versão mais recente ou mais nova; `{ version: string }` após atualizar.
- **Erros:**
  - `confirmation_required` — `confirmed` não é `true`;
  - `already_downloading` — operação do `"yt-dlp"` já em andamento;
  - `settings`, `component_missing`, `component_integrity` — falha ao validar o `yt-dlp` já instalado;
  - `update_key` — chave PGP embutida inválida ou fingerprint divergente;
  - `update_network` — erro ao consultar API do GitHub ou baixar `SHA2-256SUMS`, `.sig` ou o binário;
  - `update_signature` — assinatura PGP de `SHA2-256SUMS` inválida;
  - `update_checksum` — formato inválido ou asset ausente/duplicado em `SHA2-256SUMS`;
  - `hash_mismatch` — SHA-256 do binário baixado não confere;
  - `cancelled` — cancelado via `components.cancel` com `{ id: "yt-dlp" }`;
  - `update_io` — falha de leitura/escrita ao preparar arquivos temporários ou backup;
  - `update_failed` — falha ao substituir executável, rodar `--version` ou gravar `yt-dlp.state.json`;
  - `update_restore` — falha na atualização após remover o executável anterior e falha ao restaurar o backup.
- **Eventos e jobs:** síncrono na chamada, fora da fila SQLite do Projeto. Quando há nova versão, emite `core-progress` com `job: "yt-dlp"` (sem `project`): `stage: "update"` (`0..99`, `"Atualizando yt-dlp"`) e `stage: "complete"` (`100`, `"yt-dlp atualizado"`). Cancelável por `components.cancel` com `{ id: "yt-dlp" }`.
- **Pré-condições:** `yt-dlp` já instalado e íntegro; `confirmed: true`; acesso à internet (`api.github.com` / `github.com`).
- **Tela hoje:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx#L46).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L711).
- **US (#26):** US-4, US-6, US-17.
- **Código:** [core/src/components/update.rs:360](../../../core/src/components/update.rs#L360).

### `components.worker.status`
- **O que faz:** verifica se o worker Python de ML está instalado, detecta presença de GPU NVIDIA (`nvidia-smi -L`), confere se o código/lock embutido mudou (`outdated`) e, se instalado, inicia o worker para obter o handshake com as versões de Python e bibliotecas.
- **Entrada:** nenhuma (`{}`).
- **Saída:**
  - Não instalado: `{ installed: false, gpu: boolean }`.
  - Instalado com handshake OK: `{ installed: true, outdated: boolean, cuda: boolean, gpu: boolean, uv: string | null, handshake: { protocol: number, worker: string, python: string, libs: Record<string, string | null> } }`.
  - Instalado mas falhou ao iniciar: mesmos campos sem `handshake`, trazendo `error: { code: string, message: string }`.
- **Erros:**
  - `settings` — erro ao ler configurações de Componentes. (Falhas ao iniciar o worker entram no campo `error` da resposta, não como `CoreError`.)
- **Eventos e jobs:** nenhum (síncrono; inicia e encerra o processo do worker rapidamente).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/WorkerCard.tsx](../../../src/features/components/WorkerCard.tsx#L23).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L712).
- **US (#26):** US-3, US-14.
- **Código:** [core/src/components/worker.rs:594](../../../core/src/components/worker.rs#L594).

### `components.worker.install`
- **O que faz:** instala (ou reinstala) o worker Python de ML em `<data_dir>/worker/`: baixa o `uv` se necessário, grava `pyproject.toml`/`uv.lock`/código Python embutidos, instala Python 3.12 gerenciado, sincroniza dependências (`cuda` se houver GPU NVIDIA ou `cpu` caso contrário), grava `worker.state.json` e verifica o handshake.
- **Entrada:** `confirmed: boolean` obrigatório (`true`).
- **Saída:** `{ handshake: { protocol: number, worker: string, python: string, libs: Record<string, string | null> }, cuda: boolean }`.
- **Erros:**
  - `confirmation_required` — `confirmed` não é `true`;
  - `already_downloading` — instalação `"worker"` já está em andamento;
  - `settings` — falha ao ler configurações;
  - `unknown_component` — `uv` não consta no manifesto desta plataforma (ex.: macOS);
  - `download`, `hash_mismatch`, `install` — erro ao baixar/instalar o `uv`;
  - `worker_install` — falha ao gravar arquivos ou executar `uv python install` / `uv sync`;
  - `cancelled` — cancelado via `components.cancel` com `{ id: "worker" }` (remove o ambiente parcial);
  - `worker_verify` — instalado, mas falhou ao iniciar ou responder ao handshake.
- **Eventos e jobs:** síncrono na chamada, fora da fila SQLite do Projeto. Emite `core-progress` com `job: "worker"` (sem `project`):
  - `stage: "download"` (`0..24`, `"Baixando componente"`, se precisar baixar o `uv`);
  - `stage: "worker"` (`25`, `"Instalando o Python gerenciado"`; `45`, `"Instalando as dependências do worker (CUDA)"` ou `"(CPU)"`; `95`, `"Verificando o worker"`);
  - `stage: "complete"` (`100`, `"Worker instalado"`).
  Cancelável por `components.cancel` com `{ id: "worker" }`.
- **Pré-condições:** `confirmed: true`; `uv` disponível no manifesto da plataforma; conexão com a internet para baixar `uv` (se ausente), Python standalone e pacotes.
- **Tela hoje:** [src/features/components/WorkerCard.tsx](../../../src/features/components/WorkerCard.tsx#L33).
- **Mock TS:** sim (simplificado, retorna `{ handshake: null }`), em [src/lib/core.ts](../../../src/lib/core.ts#L713).
- **US (#26):** US-3, US-4, US-14.
- **Código:** [core/src/components/worker.rs:593](../../../core/src/components/worker.rs#L593).

### `components.catalog.status`
- **O que faz:** informa a versão e a origem do catálogo de modelos ativo (`embedded` ou `remote` em cache verificado por Ed25519), além de eventual aviso caso o cache local tenha sido descartado por falha de validação.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ version: number, embeddedVersion: number, source: "embedded" | "remote", warning: string | null, warningCode: string | null }`.
- **Erros:**
  - `settings` — erro ao ler configurações de Componentes.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/CatalogCard.tsx](../../../src/features/components/CatalogCard.tsx#L65).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L817).
- **US (#26):** US-17.
- **Código:** [core/src/components/catalog.rs:923](../../../core/src/components/catalog.rs#L923).

### `components.catalog.check`
- **O que faz:** consulta as releases `catalog-N` no GitHub, verifica assinatura Ed25519 (`catalog.json.sig`), aplica regra anti-rollback, valida esquema e licenças permitidas e salva o novo catálogo em `<data_dir>/catalog/`.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ version: number, previousVersion: number, embeddedVersion: number, source: "embedded" | "remote", updated: boolean, upToDate: boolean, warning: string | null, warningCode: string | null }`.
- **Erros:**
  - `settings` — falha ao ler configurações;
  - `catalog_key_invalid` — chave pública Ed25519 inválida;
  - `catalog_network` — erro de rede ou HTTP ao consultar releases/assets;
  - `catalog_invalid` — URL fora da allowlist, resposta > 1 MiB, JSON inválido, `catalog.json` ausente ou esquema/licença/hash inválido;
  - `catalog_signature_invalid` — `catalog.json.sig` ausente, malformada ou assinatura Ed25519 inválida;
  - `catalog_rollback` — versão remota menor que a versão conhecida;
  - `catalog_io` — falha ao gravar `catalog.json` / `catalog.json.sig` em disco.
- **Eventos e jobs:** síncrono na chamada (serializado por mutex interno, não entra na fila SQLite). Emite `core-progress` com `job: "catalog"`, `stage: "complete"`, `percentage: 100`, `message: "Catálogo de modelos verificado"`. Não cancelável.
- **Pré-condições:** acesso à internet (`api.github.com` / `github.com` / `githubusercontent.com`).
- **Tela hoje:** [src/features/components/CatalogCard.tsx](../../../src/features/components/CatalogCard.tsx#L77).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L818-L833).
- **US (#26):** US-6, US-17.
- **Código:** [core/src/components/catalog.rs:924](../../../core/src/components/catalog.rs#L924).

### `components.models.manifest`
- **O que faz:** lista os modelos de Transcrição e detecção facial do catálogo ativo (`whisper-turbo`, `whisper-small`, `yunet`, etc.), com tamanho, licença, fonte, estado de instalação, atualização disponível e qual é o recomendado para o hardware atual.
- **Entrada:** nenhuma (`{}`).
- **Saída:** array JSON de objetos `{ id, label, repo, former_repo, revision, license, source_url, size, device, files: [{ name, size, sha256 }], installed, installed_revision, update_available, worker_installed, recommended, catalog_version, catalog_source }`.
- **Erros:**
  - `settings` — falha ao ler configurações de Componentes.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/ModelsCard.tsx](../../../src/features/components/ModelsCard.tsx#L26).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L834-L844).
- **US (#26):** US-3, US-17.
- **Código:** [core/src/components/models.rs:478](../../../core/src/components/models.rs#L478).

### `components.models.download`
- **O que faz:** baixa todos os arquivos de um modelo do worker (do Hugging Face ou GitHub, com redirecionamentos restritos a esses domínios), com retomada e conferência SHA-256 por arquivo, e grava `model.state.json` em `<data_dir>/models/<id>/`.
- **Entrada:** `id: string` obrigatório (ex.: `"whisper-turbo"`, `"whisper-small"`, `"yunet"`); `confirmed: boolean` obrigatório (`true`).
- **Saída:** `{ id: string }`.
- **Erros:**
  - `confirmation_required` — `confirmed` não é `true`;
  - `settings` — erro ao ler configurações;
  - `unknown_component` — `id` não existe no catálogo ativo;
  - `worker_missing` — worker Python de ML ainda não instalado;
  - `already_downloading` — download desse modelo já está em andamento;
  - `download` — erro de rede, HTTP, pasta de staging ou disco;
  - `cancelled` — cancelado via `components.cancel` com `{ id }`;
  - `hash_mismatch` — tamanho ou SHA-256 de algum arquivo do modelo não confere;
  - `install` — falha ao mover diretório para o destino final ou gravar `model.state.json` (preserva a versão anterior se existir).
- **Eventos e jobs:** síncrono na chamada, fora da fila SQLite do Projeto. Emite `core-progress` com `job: "<id>"` (sem `project`): `stage: "download"` (`0..99`, `"Baixando modelo"`) e `stage: "complete"` (`100`, `"Modelo instalado"`). Cancelável por `components.cancel` com `{ id }`.
- **Pré-condições:** `confirmed: true`; worker Python instalado (`components.worker.install`).
- **Tela hoje:** [src/features/components/ModelsCard.tsx](../../../src/features/components/ModelsCard.tsx#L42).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L846-L853).
- **US (#26):** US-4, US-5, US-6, US-17.
- **Código:** [core/src/components/models.rs:479](../../../core/src/components/models.rs#L479).

### `tts.catalog`
- **O que faz:** retorna o catálogo completo de TTS do catálogo ativo (motores, termo de uso proibido, modelos por idioma, vozes e embeddings compatíveis), além do estado do executável `pocket-tts`, dos modelos instalados/desatualizados e dos modelos ativos por idioma (`pt`, `en`).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ catalogVersion, catalogSource, catalogWarning, catalogWarningCode, componentInstalled, activeModels: { pt, en }, engines: [...], models: [...], voices: [...] }` (cada motor inclui `prohibitedUse: { textEn, summaryPt, version }`; cada modelo inclui `weightsSize`, `voicesSize`, `size`, `files`, `installed`, `updateAvailable`, `termsAccepted`, `active`, `license`, `sourceUrl`; cada voz inclui `attribution`, `license`, `models`, `installedModels`).
- **Erros:**
  - `settings` — erro ao ler configurações de Componentes.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/components/TtsCatalogCard.tsx](../../../src/features/components/TtsCatalogCard.tsx#L152), [src/features/projects/ChannelProfile.tsx](../../../src/features/projects/ChannelProfile.tsx#L183) e [src/features/projects/Narration.tsx](../../../src/features/projects/Narration.tsx#L319).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L486-L509).
- **US (#26):** US-3, US-17, US-91.
- **Código:** [core/src/tts/catalog.rs:1152](../../../core/src/tts/catalog.rs#L1152).

### `tts.models.choose`
- **O que faz:** define qual modelo TTS será usado por padrão para um idioma (`"pt"` ou `"en"`) em `<data_dir>/tts-settings.json` e retorna o catálogo TTS atualizado.
- **Entrada:** `modelId: string` obrigatório (aceita `id` como alias); `language: string` opcional (se omitido, usa o idioma do próprio modelo; valores normalizados para `"pt"` ou `"en"`).
- **Saída:** o mesmo objeto completo retornado por `tts.catalog`.
- **Erros:**
  - `tts_model_unknown` — `modelId` ausente ou não encontrado no catálogo;
  - `tts_model_language_mismatch` — o idioma informado não coincide com o idioma do modelo;
  - `settings` — erro ao ler configurações de Componentes ou ao gravar `tts-settings.json`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** modelo existente no catálogo (não exige que o modelo já esteja baixado para registrar a escolha).
- **Tela hoje:** [src/features/components/TtsCatalogCard.tsx](../../../src/features/components/TtsCatalogCard.tsx#L190).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L486-L509).
- **US (#26):** US-91.
- **Código:** [core/src/tts/catalog.rs:1153](../../../core/src/tts/catalog.rs#L1153).

### `tts.models.download`
- **O que faz:** baixa os pesos do modelo TTS e todos os embeddings de vozes associados em `<data_dir>/tts-models/<engine_id>/<id>/`, valida SHA-256 de cada arquivo, gera o `config.yaml` local e grava `model.state.json` com a versão do termo de uso aceito.
- **Entrada:** `id: string` obrigatório (ex.: `"portuguese_24l"`, `"portuguese"`, `"english"`); `confirmed: boolean` obrigatório (`true`); `termsAccepted: boolean` obrigatório (`true`).
- **Saída:** `{ id: string }`.
- **Erros:**
  - `confirmation_required` — `confirmed` não é `true`;
  - `terms_acceptance_required` — `termsAccepted` não é `true`;
  - `settings` — erro ao ler configurações;
  - `unknown_component` — modelo `id` não encontrado no catálogo TTS;
  - `already_downloading` — download `tts:<id>` já está em andamento;
  - `download` — erro de rede/HTTP ou preparação da pasta temporária (erros brutos de rede são sanitizados para esta mensagem fixa);
  - `cancelled` — cancelado via `tts.models.cancel`;
  - `hash_mismatch` — tamanho ou SHA-256 de pesos ou voz não confere;
  - `install` — erro ao mover pasta final ou gravar `config.yaml` / `model.state.json`.
- **Eventos e jobs:** síncrono na chamada, fora da fila SQLite do Projeto. Emite `core-progress` com `job: "tts:<id>"` (sem `project`):
  - `stage: "download"` (`0..99`, `"Baixando modelo TTS"` nos pesos e `"Baixando voz TTS"` nos embeddings);
  - `stage: "complete"` (`100`, `"Modelo TTS instalado"`).
  Cancelável por `tts.models.cancel` com `{ id }` (não por `components.cancel`).
- **Pré-condições:** `confirmed: true` e `termsAccepted: true`. (Não exige `pocket-tts` instalado previamente para baixar os pesos, embora a Narração exija ambos.)
- **Tela hoje:** [src/features/components/TtsCatalogCard.tsx](../../../src/features/components/TtsCatalogCard.tsx#L177).
- **Mock TS:** sim, em [src/lib/core.ts](../../../src/lib/core.ts#L510-L517).
- **US (#26):** US-4, US-5, US-6, US-17, US-91.
- **Código:** [core/src/tts/catalog.rs:1154](../../../core/src/tts/catalog.rs#L1154).

### `tts.models.cancel`
- **O que faz:** sinaliza o cancelamento do download de um modelo TTS em andamento (`tts:<id>`).
- **Entrada:** `id: string` obrigatório (ID do modelo TTS, sem o prefixo `tts:`).
- **Saída:** `{}`.
- **Erros:** nenhum.
- **Eventos e jobs:** nenhum evento próprio (o `tts.models.download` em execução interrompe e devolve `cancelled`).
- **Pré-condições:** download do modelo `id` em andamento.
- **Tela hoje:** [src/features/components/TtsCatalogCard.tsx](../../../src/features/components/TtsCatalogCard.tsx#L255).
- **Mock TS:** sim (no-op `{}`), em [src/lib/core.ts](../../../src/lib/core.ts#L518).
- **US (#26):** US-51.
- **Código:** [core/src/tts/catalog.rs:1155](../../../core/src/tts/catalog.rs#L1155).

### `diagnostic.get`
- **O que faz:** monta o texto de diagnóstico exclusivamente com os campos da allowlist (versão do Clipes, SO, etapa e até 200 linhas reconstruídas de `diagnostic.log`, último código estruturado do `yt-dlp` se houver, e os 10 campos registrados via `DiagnosticField`).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ text: string }`.
- **Erros:** nenhum (campos indisponíveis saem como `"indisponível"`).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/report/Report.tsx](../../../src/features/report/Report.tsx#L24).
- **Mock TS:** sim (texto mínimo estático), em [src/lib/core.ts](../../../src/lib/core.ts#L319).
- **US (#26):** US-111, US-112, US-113, US-122.
- **Código:** [core/src/diagnostic.rs:262](../../../core/src/diagnostic.rs#L262).

### `diagnostic.export`
- **O que faz:** grava em um arquivo `.txt` o texto de diagnóstico (já revisado/editado pelo usuário na UI).
- **Entrada:** `path: string` obrigatório (caminho absoluto terminando em `.txt` e que não seja um diretório); `text: string` obrigatório (conteúdo textual a salvar).
- **Saída:** `{}`.
- **Erros:**
  - `invalid_path` — `path` ausente, relativo, sem extensão `.txt` ou apontando para um diretório;
  - `invalid_text` — `text` ausente ou não textual;
  - `export_failed` — erro de escrita no arquivo.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** caminho `.txt` absoluto escolhido (normalmente via diálogo salvar).
- **Tela hoje:** [src/features/report/Report.tsx](../../../src/features/report/Report.tsx#L32).
- **Mock TS:** não (em navegador, `Report.tsx` usa `Blob` + download sem chamar o núcleo).
- **US (#26):** US-117.
- **Código:** [core/src/diagnostic.rs:263](../../../core/src/diagnostic.rs#L263).

### `app.version`
- **O que faz:** retorna a versão do pacote compilado do núcleo (`CARGO_PKG_VERSION`).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ version: string }`.
- **Erros:** nenhum.
- **Eventos e jobs:** síncrono (não entra na fila). Emite um evento `core-progress` com `job: "app.version"`, `stage: "complete"`, `percentage: 100`, `message: "Version loaded"`.
- **Pré-condições:** nenhuma.
- **Tela hoje:** [src/features/about/About.tsx](../../../src/features/about/About.tsx#L11).
- **Mock TS:** sim (lê `version` de `package.json`), em [src/lib/core.ts](../../../src/lib/core.ts#L481).
- **US (#26):** US-19.
- **Código:** [core/src/version.rs:16](../../../core/src/version.rs#L16).

### `backups.settings.get`
- **O que faz:** lê a configuração de backup automático rotativo do Projeto aberto (`interval_seconds` e `copies`), os valores padrão de fábrica (`1800` s e `10` cópias) e eventual aviso de falha do último backup automático em segundo plano.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ interval_seconds: number, copies: number, default_interval_seconds: number, default_copies: number, warning: { code: string, message: string } | null }`.
- **Erros:**
  - `project_busy` — falha ao adquirir lock da sessão do Projeto;
  - `project_not_open` — nenhum Projeto aberto;
  - `backup_failed` — erro ao consultar `backup_settings` no banco.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [src/features/projects/Backups.tsx](../../../src/features/projects/Backups.tsx#L16).
- **Mock TS:** sim, apenas quando `?source-test` está na URL (retorna `{ interval_seconds: 1800, copies: 10 }` sem `default_*` nem `warning`), em [src/lib/core.ts](../../../src/lib/core.ts#L452).
- **US (#26):** US-39.
- **Código:** [core/src/projects/backups.rs:439](../../../core/src/projects/backups.rs#L439).

### `backups.settings.set`
- **O que faz:** salva no banco SQLite do Projeto aberto o intervalo (em segundos) e a quantidade de cópias mantidas na rotação dos backups automáticos.
- **Entrada:** `interval_seconds: number` obrigatório (inteiro `> 0` e `<= i64::MAX`); `copies: number` obrigatório (inteiro `> 0` e `<= i64::MAX`).
- **Saída:** `null`.
- **Erros:**
  - `backup_settings` — `interval_seconds` ou `copies` inválido (não inteiro, `<= 0` ou acima de `i64::MAX`);
  - `project_busy` — falha ao adquirir lock da sessão;
  - `project_not_open` — nenhum Projeto aberto;
  - `project_write` — erro ao gravar `backup_settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [src/features/projects/Backups.tsx](../../../src/features/projects/Backups.tsx#L24).
- **Mock TS:** não (não implementado em `src/lib/core.ts`).
- **US (#26):** US-39.
- **Código:** [core/src/projects/backups.rs:440](../../../core/src/projects/backups.rs#L440).

### `backups.create`
- **O que faz:** força o salvamento de edições pendentes do editor (`editor.flush`), gera um backup via Online Backup API do SQLite em `<Projeto>.clipes/backups/backup-<timestamp>.sqlite`, verifica integridade (`PRAGMA integrity_check` e `PRAGMA foreign_key_check`) e remove cópias antigas além do limite `copies`.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `null`.
- **Erros:**
  - erros propagados de `editor.flush` (ex.: `project_not_open`, `project_write`, `project_busy`);
  - `project_busy` — falha ao adquirir lock da sessão;
  - `project_not_open` — nenhum Projeto aberto;
  - `backup_failed` — erro ao criar pasta, copiar banco, validar integridade/chaves estrangeiras ou podar backups antigos.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [src/features/projects/Backups.tsx](../../../src/features/projects/Backups.tsx#L24).
- **Mock TS:** não (não implementado em `src/lib/core.ts`).
- **US (#26):** US-39.
- **Código:** [core/src/projects/backups.rs:441](../../../core/src/projects/backups.rs#L441).

### `backups.list`
- **O que faz:** lista os backups existentes na pasta `<Projeto>.clipes/backups/` (`backup-*.sqlite` e `before-restore-*.sqlite`), ordenados do mais recente para o mais antigo pela data de modificação do arquivo.
- **Entrada:** nenhuma (`{}`).
- **Saída:** array JSON de `{ id: string, created_at: number, before_restore: boolean }` (`created_at` em segundos Unix).
- **Erros:**
  - `project_busy` — falha ao adquirir lock da sessão;
  - `project_not_open` — nenhum Projeto aberto;
  - `backup_failed` — erro ao ler a pasta `backups/`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [src/features/projects/Backups.tsx](../../../src/features/projects/Backups.tsx#L16).
- **Mock TS:** sim, apenas quando `?source-test` está na URL (retorna `[]`), em [src/lib/core.ts](../../../src/lib/core.ts#L451).
- **US (#26):** US-39.
- **Código:** [core/src/projects/backups.rs:442](../../../core/src/projects/backups.rs#L442).

### `backups.restore`
- **O que faz:** interrompe temporariamente o worker de fila do Projeto, descarta estado pendente de edição em memória (`project_change`), valida a integridade e compatibilidade de migrações do backup escolhido, salva o estado atual em um backup `before-restore-*.sqlite`, substitui `project.sqlite`, reconcilia jobs interrompidos e reinicia a fila.
- **Entrada:** `id: string` obrigatório (nome do arquivo de backup: `backup-<39 dígitos>.sqlite` ou `before-restore-<39 dígitos>.sqlite`).
- **Saída:** `null`.
- **Erros:**
  - `backup_invalid` — formato de `id` inválido, arquivo inexistente/symlink, falha em `integrity_check` / `foreign_key_check`, tabela `project` inválida ou `schema_migrations` contendo migração desconhecida (de versão mais nova do app);
  - `project_busy` — há job ativo no Projeto (`jobs > 0`) ou falha de lock;
  - `project_not_open` — nenhum Projeto aberto;
  - `backup_failed` — falha ao criar a cópia preservada `before-restore-*`;
  - `restore_failed` — falha ao trocar `project.sqlite` ou reabrir o banco restaurado.
- **Eventos e jobs:** nenhum (síncrono, mas para e reinicia a thread da fila de jobs do Projeto).
- **Pré-condições:** Projeto aberto e sem jobs em andamento (`jobs == 0`).
- **Tela hoje:** [src/features/projects/Backups.tsx](../../../src/features/projects/Backups.tsx#L25).
- **Mock TS:** não (não implementado em `src/lib/core.ts`).
- **US (#26):** US-39.
- **Código:** [core/src/projects/backups.rs:443](../../../core/src/projects/backups.rs#L443).

### `documents.validate`
- **O que faz:** recebe um documento JSON versionado (`clip`, `style`, `script` ou `packaging`), aplica migrações sequenciais de `schemaVersion` se houver (hoje todos estão na versão `1`, sem downgrade), valida a estrutura e devolve o documento normalizado.
- **Entrada:** `type: string` obrigatório (`"clip"`, `"style"`, `"script"` ou `"packaging"`); `document: object` obrigatório (deve conter `schemaVersion: number` e `revision: number`, além dos campos específicos de `style` quando `type == "style"`).
- **Saída:** o próprio `document` JSON após eventual migração e validação.
- **Erros:**
  - `invalid_document` — `type` desconhecido, `schemaVersion` ausente/não inteiro positivo, `revision` ausente/não inteiro, migração indisponível ou inválida;
  - `newer_document` — `schemaVersion` maior que a versão atual suportada pelo núcleo;
  - `caption_style_invalid` — quando `type == "style"` e o estilo de legenda falha nas regras de `Style::validate()` (ex.: fonte diferente de `Noto Sans`/`Noto Serif`, tamanho fora de `24..=96`, cores inválidas, posição fora da faixa).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** nenhuma encontrada (infraestrutura interna de schema de documentos do Projeto — ADR-0005).
- **Código:** [core/src/projects.rs:280](../../../core/src/projects.rs#L280).

---

## Estados e eventos do domínio

Nenhum comando deste domínio entra na fila persistente de jobs do Projeto (`core/src/jobs*`, tabela `jobs` do SQLite). Os downloads e instalações rodam de forma síncrona dentro de `core_dispatch` (em `spawn_blocking` do Tauri) e emitem eventos `core-progress` com `project: null`.

### Eventos `core-progress` emitidos

| `job` | `stage` | Quando acontece | `percentage` | `error` |
| :--- | :--- | :--- | :--- | :--- |
| `<component_id>` (`ffmpeg`, `yt-dlp`, `uv`, `deno`, `pocket-tts`) | `download` | Durante cada bloco de 64 KB baixado em `components.download` | `0`–`99` | `null` |
| `<component_id>` | `complete` | Após extrair, verificar SHA-256 e instalar em `components/` | `100` | `null` |
| `yt-dlp` | `update` | Durante cada bloco de 64 KB baixado em `components.ytdlp.update` (quando há versão mais nova) | `0`–`99` | `null` |
| `yt-dlp` | `complete` | Após validar PGP, SHA-256, testar `--version` e substituir executável | `100` | `null` |
| `worker` | `download` | Em `components.worker.install`, se precisar baixar o `uv` antes | `0`–`24` | `null` |
| `worker` | `worker` | Em `components.worker.install`: preparando Python (`25`), `uv sync` CUDA/CPU (`45`), verificando handshake (`95`) | `25`, `45`, `95` | `null` |
| `worker` | `complete` | Após gravar `worker.state.json` e concluir handshake inicial | `100` | `null` |
| `catalog` | `complete` | Ao final de `components.catalog.check` sem erro | `100` | `null` |
| `<model_id>` (`whisper-turbo`, `whisper-small`, `yunet`, etc.) | `download` | Durante o download dos arquivos do modelo em `components.models.download` | `0`–`99` | `null` |
| `<model_id>` | `complete` | Após conferir SHA-256 de todos os arquivos e gravar `model.state.json` | `100` | `null` |
| `tts:<model_id>` | `download` | Durante o download de pesos (`"Baixando modelo TTS"`) e embeddings (`"Baixando voz TTS"`) em `tts.models.download` | `0`–`99` | `null` |
| `tts:<model_id>` | `complete` | Após gravar `config.yaml` e `model.state.json` em `tts.models.download` | `100` | `null` |
| `app.version` | `complete` | Ao responder `app.version` | `100` | `null` |

> **Nota:** erros nunca chegam via `ProgressEvent.error` neste domínio; em caso de falha ou cancelamento, o próprio comando retorna `Err(CoreError)`.

### Estados dos objetos do domínio

- **FFmpeg (`components.ffmpeg.status`):**
  - Não configurado / ausente (`installed: false, incomplete: false`)
  - Incompleto (`installed: false, incomplete: true` — `ffmpeg_path` aponta para o gerenciado, mas `ffmpeg` ou `ffprobe` sumiu)
  - Instalado (`installed: true, incomplete: false` — gerenciado completo ou FFmpeg do sistema)
- **Deno e Pocket TTS (`components.deno.status`, `components.pocket_tts.status`):**
  - Não instalado (`installed: false, version: null, outdated: false`)
  - Instalado atualizado (`installed: true, version == pinned, outdated: false`)
  - Instalado desatualizado (`installed: true, version != pinned, outdated: true`)
- **yt-dlp (`components.ytdlp.status`):**
  - Ausente (`installed: false`)
  - Instalado e íntegro (`installed: true, version`)
  - Adulterado / sem estado válido (erro `component_integrity`)
- **Worker Python (`components.worker.status`):**
  - Não instalado (`installed: false`)
  - Instalado e saudável (`installed: true, outdated: false/true, handshake: {...}`)
  - Instalado com falha ao iniciar (`installed: true, error: { code, message }`)
- **Catálogo de modelos (`components.catalog.status`):**
  - Embutido (`source: "embedded"`, sem cache remoto válido)
  - Remoto assinado (`source: "remote"`, cache em `<data_dir>/catalog/` mais novo que o embutido e verificado)
  - Fallback com aviso (`source: "embedded"` com `warning` / `warningCode` quando o cache em disco falhou na assinatura ou esquema)
- **Modelos de ML e TTS (`components.models.manifest`, `tts.catalog`):**
  - Não instalado (`installed: false`)
  - Instalado e atualizado (`installed: true, update_available / updateAvailable: false`)
  - Instalado com atualização disponível (`installed: true, update_available / updateAvailable: true` — revisão ou `files_digest` diferente do catálogo ativo; no TTS também exige `terms_version` igual ao termo atual)
- **Backups do Projeto (`backups.list`):**
  - Backup rotativo (`before_restore: false`, prefixo `backup-`)
  - Backup preservado antes de restauração (`before_restore: true`, prefixo `before-restore-`)

---

## Configurações deste domínio

| Configuração / Chave | Onde vive | Quem lê | Quem grava |
| :--- | :--- | :--- | :--- |
| `data_dir` (pasta de Componentes, worker, modelos e catálogo) | `settings.json` em `config_dir` (ou `component-settings.json` na raiz de `CLIPES_DATA_DIR` quando isolado) | `components.settings.get`, todos os comandos de instalação/status de Componentes, worker e modelos | `components.settings.set` |
| `cache_dir` e `cache_limit_bytes` (pasta e limite do cache de proxies/ondas/miniaturas) | Mesmo arquivo acima (`settings.json` / `component-settings.json`) | `components.settings.get`, sistema de proxy/timeline/narração | `components.settings.set` |
| `ffmpeg_path` (caminho do executável FFmpeg) | Mesmo arquivo acima (`settings.json` / `component-settings.json`) | `components.settings.get`, `components.ffmpeg.status`, exportação/proxy/transcrição | `components.settings.set`, `components.download` (quando `id == "ffmpeg"`), `components.ffmpeg.system` |
| `active_models` (modelo TTS escolhido para `"pt"` e `"en"`) | `<settings.data_dir>/tts-settings.json` | `tts.catalog` e geração de Narração | `tts.models.choose` |
| `catalog.json` + `catalog.json.sig` (catálogo remoto assinado em cache) | `<settings.data_dir>/catalog/` | `components.catalog.status`, `components.models.manifest`, `tts.catalog`, downloads de modelos | `components.catalog.check` |
| `interval_seconds` e `copies` (frequência em segundos e número de cópias do backup automático) | Tabela `backup_settings` em `<Projeto>.clipes/project.sqlite` | `backups.settings.get`, rotina automática de backup da sessão | `backups.settings.set` |
| `CLIPES_DATA_DIR` (isolamento total de dados/config/cache fora do usuário) | Variável de ambiente do SO | `core/src/paths.rs` | Definida pelo ambiente antes de iniciar o processo |

---

## Observações para o front novo

1. **Comandos sem uso na UI e lacunas no Mock TS (`src/lib/core.ts`):**
   - `documents.validate` não é chamado em nenhuma tela hoje e não existe no mock TS.
   - Os comandos `components.cancel`, `components.settings.set`, `components.ffmpeg.system`, `diagnostic.export`, `backups.settings.set`, `backups.create` e `backups.restore` **são chamados pela UI atual, mas não têm mock em `src/lib/core.ts`** (no modo navegador `VITE_CORE_MOCK=1`, clicar nesses botões lança `Unknown core command`). Além disso, `backups.list` e `backups.settings.get` só estão mockados quando `?source-test` está na URL, e o mock de `backups.settings.get` omite `default_interval_seconds`, `default_copies` e `warning`.
   - `components.download` no mock TS só responde para `deno` e `pocket-tts`; tentar baixar `ffmpeg`, `yt-dlp` ou `uv` no mock lança erro.

2. **Dois comandos distintos de cancelamento (`components.cancel` vs `tts.models.cancel`):**
   - `components.cancel` aceita `{ id }` para `components.download`, `components.ytdlp.update`, `components.worker.install`, `components.models.download`, `transcription.hardware.probe` (`"hardware-probe"`) e `transcription.estimate` (`"transcription-estimate"`).
   - Já os modelos TTS usam a chave interna `tts:<id>` e só respondem a `tts.models.cancel` com `{ id }`. O front novo não deve misturar os dois.

3. **Mudar `data_dir` em `components.settings.set` não migra arquivos existentes nem redireciona todo o `data_dir` global:**
   - Na UI atual ([Components.tsx:62](../../../src/features/components/Components.tsx#L62)), há um aviso de que os caminhos valem para downloads futuros, mas é importante saber que:
     1) componentes/modelos já baixados não são movidos automaticamente;
     2) arquivos ligados diretamente a `paths::data_file` (`projects.json`, `export-encoder.json`, `diagnostic.log`, `ytdlp-diagnostic.json`) permanecem no `AppDirs::data_dir` original mesmo depois de alterar `settings.data_dir`.

4. **Plataforma macOS incompleta no manifesto de Componentes:**
   - Em `core/src/components.rs:50-59`, o manifesto no macOS (`aarch64` e `x86_64`) inclui apenas `deno` e `pocket-tts`. Não há entradas para `ffmpeg`, `yt-dlp` nem `uv`, o que faz `components.worker.install` retornar `unknown_component` no macOS até que essas entradas sejam adicionadas no núcleo.

5. **Peculiaridades de eventos e estado na UI atual:**
   - Em [Components.tsx:42](../../../src/features/components/Components.tsx#L42) e [ModelsCard.tsx:36](../../../src/features/components/ModelsCard.tsx#L36), o listener de `core-progress` não filtra por `e.payload.job` (diferente de `DenoCard`, `PocketTtsCard`, `WorkerCard` e `TtsCatalogCard`). No front novo, filtrar sempre por `job` para evitar mistura de barras caso algo rode em paralelo.
   - `backups.list` e `backups.settings.get` não têm evento de push quando o backup automático em segundo plano roda; por isso [Backups.tsx:17](../../../src/features/projects/Backups.tsx#L17) faz polling a cada 10 segundos. Além disso, `Backups.tsx` exige mínimo de 60 segundos (1 minuto) no input, enquanto o núcleo aceita qualquer inteiro `> 0`.
   - `diagnostic.get` ([core/src/diagnostic.rs:193-199](../../../core/src/diagnostic.rs#L193-L199)) preenche `"Etapa da falha: componente"` sempre que `diagnostic.log` não está vazio, mesmo quando o log contém apenas `gpu_probe_fallback` ou `catalog_verification_failed`.
   - `components.models.manifest` usa `snake_case` (`source_url`, `installed_revision`, `update_available`, `worker_installed`, `catalog_version`, `catalog_source`), enquanto `tts.catalog` e `components.catalog.*` usam `camelCase` (`sourceUrl`, `installedRevision`, `updateAvailable`, `catalogVersion`, `embeddedVersion`).
