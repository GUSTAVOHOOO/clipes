# Revisão total pré-lançamento — Clipes v2.0.0

- **Base revisada:** `master` (`8e0ab2466a03a19d3cfd50b69774d3c7454332c4`, branch `GUSTAVOHOOO/revisao-total`)
- **Data:** 2026-11-19
- **Escopo:** Auditoria independente de código, arquitetura, contratos, segurança, testes, CI/CD, empacotamento e documentação (somente leitura; nenhuma alteração em código de produto).
- **Veredito geral:** **BLOQUEIA** (1 achado **P0** de integridade de dados/backups + 8 achados **P1** relevantes para o release).

---

## Veredito por frente

| # | Frente | Veredito | P0 | P1 | P2 | P3 |
| :-: | :--- | :--- | :-: | :-: | :-: | :-: |
| 1 | Segurança | **SHIP COM RESSALVA** | 0 | 2 | 1 | 1 |
| 2 | Correção e dados | **BLOQUEIA** | 1 | 2 | 2 | 0 |
| 3 | Front v2 | **SHIP COM RESSALVA** | 0 | 1 | 2 | 1 |
| 4 | Arquitetura (`codebase-design`) | **SHIP COM RESSALVA** | 0 | 0 | 3 | 0 |
| 5 | Testes e CI | **SHIP COM RESSALVA** | 0 | 2 | 1 | 0 |
| 6 | Release e distribuição | **SHIP COM RESSALVA** | 0 | 1 | 1 | 0 |
| 7 | Higiene do repositório | **SHIP COM RESSALVA** | 0 | 0 | 1 | 1 |
| — | **Total** | **BLOQUEIA** | **1** | **8** | **11** | **3** |

*(Observação: os 3 aprofundamentos arquiteturais da Frente 4 são melhorias estruturais P2 que preservam compatibilidade com a v1; os bloqueios/ressalvas concretos de código, CI e docs concentram-se nos itens P0 e P1 abaixo.)*

---

## Verificações executadas nesta revisão

| Verificação | Escopo / Comando | Resultado observado |
| :--- | :--- | :--- |
| `cargo deny check` | `core` + `src-tauri` | `advisories ok, bans ok, licenses ok, sources ok` (1 aviso: `OFL-1.1` em `deny.toml:7` não aparece no grafo de crates Rust). |
| `design-system-v2` typecheck | `bun run --cwd design-system-v2 typecheck` | Passou (`tsc -p .`, exit 0). |
| `design-system-v2` contraste | `bun run --cwd design-system-v2 contraste` | Passou ("Todos os pares passam." nos modos escuro, claro e alto contraste). |
| `front-v2` typecheck | `bun run --cwd front-v2 typecheck` | Passou (`tsc --noEmit`, exit 0). |
| `front-v2` Vitest | `bun run --cwd front-v2 test -- --maxWorkers=2` | **85 arquivos, 712 testes passaram** (316,84 s). |
| Scripts Node | `node --test scripts/linux-validation.test.mjs` | 6/6 testes passaram (`license-policy.test.mjs` e `smoke-package.test.mjs` não rodaram sem `node_modules` na raiz). |
| Auditoria estática de contratos | Script Python sobre `core/src/*.rs` × `front-v2/src/` × `TABELA_ERROS` | 242 comandos registrados em `core/src/`, 207 chamados em `front-v2/src/` (0 comandos inexistentes); ~90 códigos `CoreError` não mapeados em `TABELA_ERROS`. |
| Auditoria de links Markdown | Script Python sobre 142 arquivos `.md` | 18 links relativos quebrados em `docs/produto/front-v2/telas/{C,E,F}-*.md`. |

*(Não compilamos o workspace Rust completo nem executamos a suíte Playwright/Tauri E2E local conforme limite do dispatch.)*

---

## Frente 1 — Segurança (**SHIP COM RESSALVA**)

**Pontos sólidos verificados:**
- **Loopback media server (`src-tauri/src/media_server.rs`)**: escuta exclusivamente em `127.0.0.1:0`, exige token aleatório de 32 bytes (`getrandom`, 64 hex chars) validado com `constant_time_eq`, restringe CORS às origens Tauri (`tauri://localhost`, `http(s)://tauri.localhost`; `:1420`/`:1430` apenas sob `cfg!(debug_assertions)`), envia `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`, limita cabeçalhos a 16 KiB e faz streaming em blocos de 64 KiB.
- **Protocolo `clipes-media` (`src-tauri/src/main.rs:45-79`, `core/src/media.rs:59-108`)**: resolve apenas identificadores opacos (`proxy/<64hex>`, `thumbs/<64hex>`, `source/<id>`, etc.), sem aceitar caminhos de arquivo pela URL, com teto de 8 MiB por resposta `Range`.
- **Cofre de chaves (`core/src/vault.rs`)**: usa `keyring::Entry` (Windows Credential Manager / Linux Secret Service) em builds release; `CLIPES_TEST_VAULT_FILE` é isolado estritamente sob `#[cfg(debug_assertions)]` (`vault.rs:5,96,109,120`).
- **Provedores HTTP e CLI (`core/src/provider.rs`, `core/src/provider/adapters.rs`, `core/src/provider_cli.rs`)**: proíbe credenciais/query/fragment na URL (`provider.rs:21-31`), bloqueia envio de chave em HTTP não-loopback (`insecure_endpoint` em `adapters.rs:462-466`), desabilita redirecionamentos (`Policy::none()`) e proxy (`.no_proxy()`), fixa DNS resolvido (`resolve_to_addrs`), e no Codex CLI força `--sandbox read-only` desabilitando ferramentas externas (`provider_cli.rs:290-334`).
- **Execução de processos (`core/src/process.rs`)**: `Command::new` direto sem shell; `yt-dlp` recebe `--` antes da URL (`url_import.rs:443-444`) e `--restrict-filenames`, com verificação de `canonical.parent() == canonical_dir`; `ass=` do FFmpeg usa diretório temporário privado com nome relativo (`core/src/export/pipeline.rs:549`).
- **Atualizador e componentes (`src-tauri/tauri.conf.json:38-42`, `core/src/components.rs`, `core/src/components/update.rs`, `core/src/components/catalog.rs`)**: `pubkey` Minisign configurada no `tauri.conf.json`, catálogo de modelos verifica assinatura Ed25519 com chave fixa (`CATALOG_PUBLIC_KEY_HEX`) e anti-rollback, `yt-dlp` verifica assinatura OpenPGP com fingerprint fixo (`AC0CBBE6848D6A873464AF4E57CF65933B5A7581`) e todos os binários/modelos validam SHA-256 antes de instalar.
- **Logs e diagnósticos (`core/src/diagnostic.rs`, `core/src/audit.rs`, `core/src/worker.rs:56`)**: vocabulário fechado de códigos/eventos; trilha de auditoria grava apenas hashes SHA-256; erros livres do worker Python são descartados.

### R-001 (P1) — Ausência de `security.csp` em `src-tauri/tauri.conf.json`
- **Issue:** [#513](https://github.com/GUSTAVOHOOO/clipes/issues/513)
- **Evidência:** `src-tauri/tauri.conf.json:12` declara apenas `"app": { "windows": [...] }`, sem o campo `security.csp`, e `front-v2/index.html:1-12` também não define `<meta http-equiv="Content-Security-Policy">`.
- **Impacto:** No Tauri v2, omitir `app.security.csp` desativa a CSP da WebView (`csp: null`), removendo defesa em profundidade contra execução de script inline/remoto ou exfiltração em caso de XSS futuro.
- **Correção sugerida:** Configurar `app.security.csp` restritiva em `src-tauri/tauri.conf.json` permitindo apenas `'self'`, `clipes-media:`, `http://127.0.0.1:*` (para mídia no Linux), `blob:`/`data:` necessários ao player/capa e estilos inline gerados pelo build se aplicável, validando em Windows e Linux E2E.
- **Esforço:** P.

### R-002 (P1) — `opener:allow-open-path` ausente em `src-tauri/capabilities/default.json`
- **Issue:** [#511](https://github.com/GUSTAVOHOOO/clipes/issues/511)
- **Evidência:** `front-v2/src/core/desktop.ts:151` chama `invoke('plugin:opener|open_path', { path: caminho })` (acionado por `front-v2/src/telas/exportacao/HistoricoLotes.tsx:161` e `front-v2/src/telas/fila/PainelFilaJobs.tsx:1245`), mas `src-tauri/capabilities/default.json:6-23` só declara `opener:allow-open-url`.
- **Impacto:** No aplicativo Tauri compilado, clicar em "Abrir pasta" ou "Abrir arquivo" na Exportação e na Fila falha silenciosamente por capability negada e cai no fallback de copiar o caminho para a área de transferência.
- **Correção sugerida:** Declarar `opener:allow-open-path` (com escopo apropriado) em `src-tauri/capabilities/default.json` e validar em E2E Tauri.
- **Esforço:** P.

### R-003 (P2) — `sources::resolve_path` não valida contenção de caminhos relativos
- **Evidência:** `core/src/sources.rs:39-49` junta `Path::new(project).join(path)` quando `stored` é relativo sem verificar `canonical.starts_with(project.canonicalize())` (checagem que `core/src/media.rs:231-235`, `core/src/audio.rs:386-388` e `core/src/tts/narration.rs:247-249` já aplicam). *(Nota: caminhos absolutos em `sources.path` são suportados por design para Fontes vinculadas fora do Projeto.)*
- **Impacto:** Um arquivo `.clipes` adulterado com `sources.path` relativo do tipo `../../../arquivo` faz `sources.list`/`sources.hash` inspecionarem arquivos fora da pasta do Projeto.
- **Correção sugerida:** Quando `path.is_relative()`, validar contenção com `canonicalize()` + `starts_with(project_root)` antes de retornar.
- **Esforço:** P.

### R-004 (P3) — Threads de conexão sem teto em `media_server.rs` e warning em `deny.toml`
- **Evidência:** `src-tauri/src/media_server.rs:105-109` cria uma `std::thread` por conexão aceita sem limite de concorrência; `deny.toml:7` inclui `"OFL-1.1"`, que gera `warning[license-not-encountered]` no `cargo deny check` porque as fontes Noto são embutidas via `include_bytes!`, não como crate.
- **Impacto:** Sem impacto prático imediato (loopback protegido por token; aviso não falha `cargo deny`).
- **Correção sugerida:** Documentar ou remover `"OFL-1.1"` de `deny.toml` (mantendo em `THIRD_PARTY_NOTICES.md`) e considerar pool/limite simples de conexões em `media_server.rs`.
- **Esforço:** P.

---

## Frente 2 — Correção e dados (**BLOQUEIA**)

**Pontos sólidos verificados:**
- **Migração `#299` (`core/src/packaging.rs:484-522`)**: a migração `0299_001_packaging_manual` copia `packaging_edits` para `_packaging_edits_backup`, remove `packaging_edits` (filha) antes de `packaging_generations` (pai) e restaura os dados sem perda.
- **Compatibilidade com Projetos v1**: `core/src/editor/edits.rs:156-199` decodifica documentos v1 (`DocumentV1`) convertendo-os para `SCHEMA_VERSION` 2 sem perda de bordas/histórico; `core/src/provider.rs:230-256` sintetiza o perfil `legacy` a partir de configurações v1; `core/src/projects.rs:96-104` bloqueia downgrade com `newer_project` quando um banco tem migrações desconhecidas.
- **Concorrência de sessão e cancelamento**: `core/src/projects/backups.rs:72-86, 235-242` usa `ProjectJob` sob `Mutex<Option<Session>>` impedindo fechar/trocar Projeto com jobs em voo; `core/src/jobs.rs:198-205` (`reconcile`) converte jobs `running` pagos interrompidos para `uncertain` e locais para `queued`; `core/src/worker.rs:210-218` envia `cancel` e força `group.terminate()` após `CANCEL_GRACE` (5 s).

### R-005 (P0) — `PRAGMA foreign_keys` desligado em `projects::open_db` deixa órfãos em `DELETE FROM transcripts` e quebra backups
- **Issue:** [#510](https://github.com/GUSTAVOHOOO/clipes/issues/510)
- **Evidência:**
  - `core/src/projects.rs:134-142` (`open_db`) define `journal_mode = WAL`, mas nunca executa `PRAGMA foreign_keys = ON`. No SQLite, chaves estrangeiras e `ON DELETE CASCADE` / `ON DELETE SET NULL` começam **desligados** por padrão em toda conexão.
  - `core/src/transcription.rs:861-867` executa `DELETE FROM transcripts WHERE id=?1` quando `switching == true` (troca de Motor/modelo numa transcrição parcial), confiando nas cláusulas `ON DELETE CASCADE` e `ON DELETE SET NULL` declaradas em `transcript_words`, `transcription_block_config`, `transcription_calls`, `transcription_blocks`, `sentences`, `transcript_corrections`, `sentence_energy`, `energy_measurements` e `selection_runs`.
  - `core/src/projects/backups.rs:137-147` (`verify`) executa `PRAGMA foreign_key_check` a cada backup automático ou manual.
- **Impacto:** Ao trocar de Motor/modelo em uma transcrição parcial, nenhuma tabela filha sofre cascata — linhas órfãs permanecem no banco referenciando o `transcript_id` apagado. A partir desse instante, `PRAGMA foreign_key_check` passa a falhar em `backups::verify()`, **quebrando permanentemente todos os backups automáticos e manuais do Projeto** (`backup_failed`).
- **Correção sugerida:** Habilitar `PRAGMA foreign_keys = ON` em `projects::open_db` (após garantir por migração idempotente a limpeza de eventuais órfãos legados em bancos antigos e confirmar a ordem das migrações), e adicionar teste de integração reproduzindo `switching` em transcrição parcial seguido de `backups.create`.
- **Esforço:** M.

### R-006 (P1) — `projects.create` deixa pasta `.clipes` parcial no disco se falhar após `create_dir`
- **Issue:** [#512](https://github.com/GUSTAVOHOOO/clipes/issues/512)
- **Evidência:** `core/src/projects.rs:193-203` executa `fs::create_dir(&path)?` antes de `Connection::open`, `migrate`, `INSERT INTO project` e `open(...)`.
- **Impacto:** Se ocorrer erro de migração, permissão ou abertura da sessão após `create_dir`, a pasta `<nome>.clipes` vazia/incompleta permanece no disco e impede criar novamente com o mesmo nome.
- **Correção sugerida:** Remover a pasta criada (`fs::remove_dir_all(&path)`) se o bloco de inicialização falhar após `fs::create_dir(&path)`.
- **Esforço:** P.

### R-007 (P1) — ~90 códigos `CoreError.code` ausentes em `TABELA_ERROS` e mensagem incorreta para `settings`
- **Issue:** [#514](https://github.com/GUSTAVOHOOO/clipes/issues/514)
- **Evidência:**
  - Comparação estática entre `core/src/*.rs` (excluindo testes) e `front-v2/src/core/erros.ts:115-623` identificou ~90 códigos não presentes em `TABELA_ERROS`, incluindo erros de runtime importantes como `worker_start`, `worker_crashed`, `worker_timeout`, `worker_internal`, `cli_free_limit`, `cli_unavailable`, `component_integrity`, `update_network`, `update_key`, `hash_mismatch`, `catalog_network`, `catalog_signature_invalid`, `gpu_unavailable`, `ram_insufficient`, `transcribe_audio`, `energy_failed`, `chat_failed`, `reframe_not_chosen`, `export_timestamps`, `translation_in_progress`, `translation_too_long` e `copy_failed`.
  - `front-v2/src/core/erros.ts:619-622` define `settings: { titulo: 'Não foi possível ler o histórico local de sonda de hardware.' }`, mas `"settings"` também é emitido por `paths.rs:44`, `components.rs:92,126,378`, `url_import.rs:20-55`, `provider.rs` e `provider_cli.rs:43-62`.
- **Impacto:** Telas que delegam a `mensagemDeErro` caem no fallback genérico `"Algo deu errado nesta operação."` (ou mostram mensagem sobre sonda de hardware quando falhou gravação de configuração de URL/Provedor).
- **Correção sugerida:** Completar `TABELA_ERROS` para todos os códigos voltados ao usuário emitidos por `core/src/` e corrigir a mensagem de `settings` para ser genérica e fiel.
- **Esforço:** P–M.

### R-008 (P2) — `.lock().unwrap()` e ausência de guarda `Drop` em mapas de jobs de `core/src/`
- **Evidência:** `core/src/components.rs:443,462,472`, `core/src/components/update.rs:151,161`, `core/src/sources.rs:184,191,195`, `core/src/url_import.rs:82,98,124` e `core/src/jobs.rs:103` usam `.lock().unwrap()`, e `components.rs:472`, `update.rs:161` e `sources.rs:191` removem o ID apenas após a chamada em vez de usar guarda RAII `Drop` (como `JobFlag` em `url_import.rs:79-84`).
- **Impacto:** Um panic em tarefa paralela envenena o mutex ou mantém o job preso como `already_downloading`/`job_running`.
- **Correção sugerida:** Padronizar guarda RAII `Drop` e tratamento seguro de mutex (`unwrap_or_else(|e| e.into_inner())` ou retorno de `CoreError`).
- **Esforço:** P.

### R-009 (P2) — Backup automático síncrono na abertura do Projeto e queries N+1 em `jobs.list`
- **Evidência:** `core/src/projects/backups.rs:258` executa `run_auto_backup(&mut s)` sincronamente dentro de `open_session` (incluindo backup completo + `PRAGMA integrity_check` + `PRAGMA foreign_key_check`) antes de liberar a abertura; `core/src/jobs.rs:530-589` chama `target_label(c, ...)` por linha dentro do `map` de `jobs.list`.
- **Impacto:** Projetos grandes com muitos jobs ou banco pesado sofrem latência perceptível ao abrir ou listar a fila.
- **Correção sugerida:** Deixar a thread periódica em segundo plano realizar o primeiro backup devido após `open_session` e pré-buscar rótulos em lote ou cachear em `jobs.list`.
- **Esforço:** M.

---

## Frente 3 — Front v2 (**SHIP COM RESSALVA**)

**Pontos sólidos verificados:**
- `design-system-v2` passou 100% no `tsc -p .` e na matriz completa de contraste (`contraste.ts`) para escuro, claro e alto contraste.
- `front-v2` passou `tsc --noEmit` e **85 suítes / 712 testes** no Vitest sem falhas.
- Todos os 207 comandos `chamar(...)` de `front-v2/src/` existem em `core/src/`.
- Guarda `semCopiasDeErro.test.ts` garante uso centralizado de `paraErroCore`.

### R-010 (P1) — Documentação anuncia suporte a EN na interface v2, mas o seletor está desabilitado
- **Issue:** [#515](https://github.com/GUSTAVOHOOO/clipes/issues/515)
- **Evidência:** `docs/releases/v2.0.0.md:9` lista `"idiomas PT-BR e EN"` entre as entregas da interface v2, mas `front-v2/src/telas/config/ConfigAparencia.tsx:55-58` marca `{ valor: 'en', rotulo: 'English', descricao: 'Em preparação', desabilitada: true }` e `ConfigAparencia.tsx:98-120` força `idioma: 'pt'` em toda atualização.
- **Impacto:** Expectativa incorreta de usuários em inglês que baixarem a v2.0.0 esperando alternar o idioma da interface.
- **Correção sugerida:** Atualizar `docs/releases/v2.0.0.md` para explicitar que a interface v2 está em PT-BR (enquanto legendas/tradução de Cortes suportam PT-BR ↔ EN), ou entregar a tradução EN da UI antes da tag.
- **Esforço:** P.

### R-011 (P2) — `Revisao.tsx` compara `source.id === runAtivo.transcriptId` no fallback de `fonteAtiva`
- **Evidência:** `front-v2/src/telas/cortes/Revisao.tsx:242-249`:
  ```ts
  const porTranscricao = fontes.find((f) => transcriptStatusBySource[f.id]?.transcript?.id === tid)
  if (porTranscricao) return porTranscricao
  const porId = fontes.find((f) => f.id === tid)
  ```
- **Impacto:** Enquanto `transcriptStatusBySource` ainda não foi carregado (ou quando IDs de `transcripts` não coincidem com `sources`), o fallback compara `source.id` com `transcript_id`, podendo exibir título/status da Fonte errada em Projetos com múltiplas Fontes ou trocas de faixa de áudio.
- **Correção sugerida:** Remover o fallback `f.id === tid` e resolver `sourceId` a partir de `execution.run.sourceId` (ou aguardar o mapa `transcriptStatusBySource`).
- **Esforço:** P.

### R-012 (P2) — Código morto (`PlaceholderTela`) e fallback residual `'0.1.0'`
- **Evidência:** `front-v2/src/App.tsx:60-212, 520-566` mantém `PlaceholderTela` e ramos `else` inalcançáveis (todas as variantes do tipo `Rota` e `SecaoConfig` já possuem retorno antecipado nas linhas `311-537`); `front-v2/src/telas/sobre/Sobre.tsx:80` usa fallback `'0.1.0'` em `res?.version ?? '0.1.0'`.
- **Impacto:** Ruído de manutenção e risco de exibir versão `0.1.0` se `app.version` retornar payload inesperado.
- **Correção sugerida:** Remover `PlaceholderTela` e a ramificação morta em `App.tsx`, e usar fallback `'2.0.0'` ou estado indisponível em `Sobre.tsx:80`.
- **Esforço:** P.

### R-013 (P3) — `toast` em dependências de `useCallback`/`useEffect`
- **Evidência:** `front-v2/src/App.tsx:231` (`aoRedirecionar` passado a `useRota`), `front-v2/src/telas/cortes/Revisao.tsx:190,226`, `Shell.tsx:490`, `ListaFontes.tsx:273,307`, `ListaLotes.tsx:157`, `DialogoExportarCorte.tsx:632`, `HistoricoLotes.tsx:169,190`, `Relatos.tsx:304,335,373`, `ConfigProvedores.tsx:277`, `ConfigExportacao.tsx:122`.
- **Impacto:** `DialogoExportarCorte` já protege o `useEffect` de polling com teste específico (`DialogoExportarCorte.test.tsx:547`), mas callbacks com `[toast]` passados a `useEffect` (como `aoRedirecionar` em `useRota`) repetem o padrão que causou o bug `#461` se a referência de `toast` mudar durante um toast ativo.
- **Correção sugerida:** Consolidar acesso via `useRef` nos callbacks passados a `useEffect`.
- **Esforço:** P.

---

## Frente 4 — Arquitetura (`codebase-design`) (**SHIP COM RESSALVA**)

Aplicando o vocabulário de `codebase-design` (**Module**, **Interface**, **Implementation**, **Depth**, **Seam**, **Adapter**, **Leverage**, **Locality**) sobre `docs/produto/arquitetura/aprofundamento.md` e o código atual do `master`:

- **Situação dos candidatos de `aprofundamento.md`:**
  - **Candidatos 1 (`jobs::ai`) e 2 (`ApprovedCut` / `clip_id_for_candidate`)**: já aplicados no núcleo (`core/src/jobs.rs:9-13`, `core/src/selection.rs:26-28`).
  - **Candidato 3 (`projects::backups` / `projects.current`)**: ainda aberto (15 ocorrências de `crate::dispatch("projects.current", ...)` intra-Rust em 13 módulos de `core/src/`).
  - **Candidatos 4, 5 e 6**: todos os 3 seguem abertos no `front-v2` e representam hoje os maiores ganhos de **Depth** e **Locality** na camada de interface (sem risco para Projetos v1).

Abaixo estão os **3 aprofundamentos recomendados** (máximo 3, correspondentes aos candidatos 4–6 verificados no `master` atual):

### Aprofundamento 1 (Candidato 4) — `origemEtapa` e `assinarTransicoes` na `Fila` (`front-v2/src/core/progresso.ts`)
- **Problema (Interface rasa):** `core-progress` substitui `stage` por `'complete'` ou `'failed'` no término de um job. Como `Job` (`progresso.ts:18-29`) não preserva a etapa inicial, os callers precisam inspecionar textos em português de `evento.message` ou manter mapas paralelos de estado.
- **Callers reais atuais:**
  1. `front-v2/src/stores/fontesProjeto.ts:346-366` (`evento.message.toLowerCase().includes('energia' | 'chat' | 'prévia' | 'preview' | 'onda')`) e `L377-399` (`sincronizarJobs` + `jobsVistos`).
  2. `front-v2/src/stores/selecaoProjeto.ts:234-240, 284-285, 437-497` (rastreia `ultimaEtapaPorJob` e `assinaturaJobs`).
  3. `front-v2/src/stores/filaGlobal.ts:195-221` e `front-v2/src/stores/exportacaoProjeto.ts` (reconciliação via `sincronizarExterno` e filtros de `ehEventoRefresh`).
- **Antes / Depois (Interface):**
  - *Antes:* `Job` tem apenas `etapa: string`; cada store duplica diff em `useEffect` e heurística textual sobre `mensagem`.
  - *Depois:* Adicionar `origemEtapa: string` em `Job` (fixada no primeiro evento não-terminal / `sincronizarExterno`) e `assinarTransicoes(fn: (t: { anterior?: Job; atual: Job }) => void): () => void` em `Fila` (`progresso.ts`), atrás da **Seam** já existente de `iniciarProgresso` (2 **Adapters** reais: `listen('core-progress')` e `assinarProgressoMock`).
- **Risco:** **Baixo** — campo aditivo em `Job`; zero alteração no núcleo Rust ou em Projetos v1.

### Aprofundamento 2 (Candidato 5) — Adaptador `BannerErroProjeto` (`front-v2/src/componentes/BannerErroProjeto.tsx`)
- **Problema (Duplicação e interface que vaza):** Hoje cada tela traduz `ErroCore` manualmente para `{ code, message: erro.detalhe || erro.message }`, invoca `mensagemDeErro(erro)` e reimplementa o roteamento de `recuperacao.rota` / `recuperacao.acao` diretamente sobre `@ds/BannerErroCore`.
- **Callers reais atuais:** 50+ usos de `<BannerErroCore>` espalhados em 28 arquivos de `front-v2/src/` (ex.: `ConfiguradorSelecao.tsx`, `AcompanhamentoSelecao.tsx`, `DetalheCandidato.tsx`, `Revisao.tsx`, `ListaFontes.tsx`, `DetalheFonte.tsx`, `EntradaFonte.tsx`, `TransformarCorte.tsx`, `PassoNarracao.tsx`, `PassoRoteiro.tsx`, `MesaProntidao.tsx`, `HistoricoLotes.tsx`, `PainelFilaJobs.tsx`, `DialogosFila.tsx`, `ConfigProvedores.tsx`, `ConfigCustos.tsx`, `ConfigComponentes.tsx`, `ConfigProjeto.tsx`, `Inicio.tsx`).
- **Antes / Depois (Interface):**
  - *Antes:* Cada tela repete `const trad = mensagemDeErro(erro)` + `<BannerErroCore erro={{ code: erro.code, message: erro.detalhe || erro.message }} traduzir={...} acaoRecuperacao={...} permitirRelato />`.
  - *Depois:* `<BannerErroProjeto erro={erro} acoes={{ 'abrir-fila': ..., confirmar: ... }} traduzirExtra={...} permitirRelato />` encapsula `mensagemDeErro`, navegação por `recuperacao.rota` e fallback `MENSAGEM_DESCONHECIDA`, mantendo `@ds/BannerErroCore` na **Seam** agnóstica de rotas.
- **Risco:** **Baixo** — componente aditivo em `front-v2`, migração gradual por tela sem alterar `CoreError`.

### Aprofundamento 3 (Candidato 6) — `destination` aditivo em `*.estimate` + cliente `provedorDestino.ts`
- **Problema (Vazamento de regras de domínio entre camadas):** `selection.estimate` (Modos 1–2), `angles.estimate`, `packaging.estimate`, `script.estimate`, `thumbnail.estimate` e `translation.estimate` devolvem apenas `profile: "<string>"` e `paid: boolean`, obrigando o frontend a buscar `provider.profiles.list` + `assistant.tasks` em paralelo e reimplementar `KINDS_CLI` e `HOSTS_LOOPBACK` em TypeScript.
- **Callers reais atuais:**
  1. `front-v2/src/stores/selecaoProjeto.ts:148-232` (`KINDS_CLI`, `HOSTS_LOOPBACK`, `resolverDestinoSelecao`).
  2. `front-v2/src/stores/empacotarCorte.ts:279`.
  3. `front-v2/src/componentes/SeletorPerfilRedo.tsx:183`.
  4. `front-v2/src/telas/fila/DialogosFila.tsx:496`.
  5. `front-v2/src/telas/corte/popovers/PopoverLegenda.tsx:232` e `front-v2/src/telas/cortes/{ConfiguradorSelecao,AcompanhamentoSelecao}.tsx`.
- **Antes / Depois (Interface):**
  - *Antes:* Tela dispara chamadas extras (`provider.profiles.list`, `assistant.tasks`) e passa os resultados a `resolverDestinoSelecao(...)` para alimentar `<ResumoCustoPrivacidade>`.
  - *Depois:* Endpoints `*.estimate` no núcleo passam a retornar também o objeto aditivo `destination: { profile, locality, leavesMachine, host, blockedByLocalOnly }` (já existente no estilo de `jobs.redo.estimate`), e `provedorDestino.ts` consome esse campo na **Seam** `@core` (mantendo o campo string `profile` original para compatibilidade v1).
- **Risco:** **Médio** — exige manter o mock TS (`src/lib/core.ts` e `*Mock.ts`) sincronizado com o novo campo `destination` aditivo.

---

## Frente 5 — Testes e CI (**SHIP COM RESSALVA**)

### R-014 (P1) — Filtros de caminhos no CI e em `release.yml` causam falsos verdes
- **Issue:** [#516](https://github.com/GUSTAVOHOOO/clipes/issues/516)
- **Evidência:**
  - `core/src/components/worker.rs:22-79` embute todos os arquivos Python e `uv.lock` de `worker/` via `include_bytes!`, mas `.github/workflows/ci.yml:46` (`rust`) e `ci.yml:49` (`tauri`) não incluem `^worker/`. Como `ci-ok` (`ci.yml:261-272`) trata jobs pulados como sucesso, um PR que altere `worker/` passa sem compilar nem testar o binário Rust/Tauri que embute o worker.
  - `.github/workflows/release.yml:8-22` lista apenas caminhos da v1 (`src/**`, `index.html`, `package.json`, etc.) e **não inclui `front-v2/**` nem `design-system-v2/**`**, embora `src-tauri/tauri.conf.json:10` já empacote `../front-v2/dist`. PRs de `front-v2` pulam o smoke test de instaladores `.exe`/`.AppImage`/`.deb`.
  - `.github/workflows/linux-validation.yml:9-10` monitora apenas `PalcoEditor.tsx` e `EditarCorte.tsx` de `front-v2/`.
- **Impacto:** Regressões no worker embutido ou no bundle empacotado do `front-v2` podem chegar à `master` ou à tag de release sem passarem pelos jobs de empacotamento e E2E.
- **Correção sugerida:** Incluir `worker/` nos filtros `rust` e `tauri` de `ci.yml`, incluir `front-v2/**` e `design-system-v2/**` em `release.yml` (ou ajustar a política de disparo na `master`), e ampliar `linux-validation.yml`.
- **Esforço:** P.

### R-015 (P1) — Flakes abertos (#395, #507) e ausência de `e2e (ubuntu-latest)` em PRs
- **Issues já abertas:** [#395](https://github.com/GUSTAVOHOOO/clipes/issues/395) e [#507](https://github.com/GUSTAVOHOOO/clipes/issues/507) *(não foi aberta nova issue duplicada; cobertura Ubuntu de PRs incluída em [#516](https://github.com/GUSTAVOHOOO/clipes/issues/516))*.
- **Evidência:**
  - `#507`: `front-v2/src/main.test.ts:22-40` monta `<App />` com `createRoot` dentro de `iniciarApp(container)` sem desmontar (`root.unmount()`) no `afterEach` (apenas `container.remove()`), causando `ReferenceError: window is not defined` pós-teardown do `jsdom` no CI Ubuntu (run `44517545342`).
  - `#395`: flakes documentados na `master` (`core/tests/sources_delete.rs:745`, `core/tests/export_batch.rs:499`, `core/tests/output_limits.rs:442`, `core/tests/narration_record.rs:337`, `core/tests/narration_import.rs:504`, `scripts/e2e-tauri.mjs` no Windows).
  - `.github/workflows/ci.yml:161` executa `e2e` em PRs apenas em `windows-latest`; regressões específicas do WebKitGTK/Linux (como `#505`/`#506`) só aparecem depois do merge na `master`.
- **Impacto:** Retrabalho frequente de reruns na `master`, cache `Swatinem/rust-cache` Windows zerado por falhas (`docs/research/ci-eficiencia.md:52`), e risco de regressão Linux no merge.
- **Correção sugerida:** Fechar `#507` desmontando o root React em `main.test.ts`, estabilizar os testes de `#395` e avaliar rodar `e2e (ubuntu-latest)` em PRs que tocam `src-tauri/`/`front-v2/` (ou via `linux-validation.yml`).
- **Esforço:** M.

### R-016 (P2) — Tempo de CI no Windows (~20 min) e acoplamento de testes de scripts à raiz
- **Evidência:** Conforme medido em `docs/research/ci-eficiencia.md:81-120`, `rust (windows-latest)` tem mediana de `19m52s` (110 binários de teste sequenciais + compilação de fixtures via `rustc` em runtime); `front-v1` (`ci.yml:82-114`) continua rodando para a UI legada; `node --test scripts/license-policy.test.mjs scripts/smoke-package.test.mjs` falha se `node_modules` da raiz não estiver instalado.
- **Impacto:** Saturação da fila de 20 runners simultâneos em ondas de PRs.
- **Correção sugerida:** Seguir o plano de `docs/research/ci-eficiencia.md` pós-release (`cargo nextest`, fixtures pré-compiladas, `save-if: master`).
- **Esforço:** G.

---

## Frente 6 — Release e distribuição (**SHIP COM RESSALVA**)

**Pontos sólidos verificados:**
- **Workflow `release.yml`**: gera NSIS (`.exe`, `currentUser`, WebView2 `downloadBootstrapper`), `.AppImage` e `.deb`, executa smoke em `ubuntu:22.04` e `ubuntu:24.04` limpos (`release.yml:79-101`), achata subpastas (`release.yml:181`), publica `SHA256SUMS.txt`, arquivos `.sig` e `latest.json` com chaves `windows-x86_64-nsis`, `windows-x86_64`, `linux-x86_64-appimage`, `linux-x86_64` e `linux-x86_64-deb`.
- **Requisitos Linux e Windows**: `.deb` declara `gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad`, `gstreamer1.0-libav` (`src-tauri/tauri.conf.json:26-31`); AppImage usa `bundleMediaFramework: false` (`tauri.conf.json:33-35`), explicitado com comando `apt install` em `README.md:231-242` e `docs/releases/v2.0.0.md:34-38`. Limitação de assinatura Authenticode (#24 / SmartScreen) está documentada com verificação por `SHA256SUMS.txt`.
- **Reversão para v1**: documentada em `docs/releases/v2.0.0.md:46-59` e verificada por `scripts/test-reversao-v1.mjs` (4 campos em `tauri.conf.json`; `src/` e `design-system/` intactos; `localStorage` da v2 separado em `clipes.preferencias.v1`).
- **Licença e atribuições**: `LICENSE` (Apache-2.0) e `THIRD_PARTY_NOTICES.md` (cobrindo inclusive `@tanstack/react-virtual@3.14.26` usado pelo `front-v2`) presentes e exibidos em `#/sobre` (`Sobre.tsx:14-15`). Não há arquivo `NOTICE` separado (compatível com Apache-2.0 §4(d)).

### R-017 (P1) — `CHANGELOG.md` ainda não possui a seção da versão `2.0.0`
- **Issue:** [#517](https://github.com/GUSTAVOHOOO/clipes/issues/517)
- **Evidência:** Todos os manifestos (`Cargo.toml` / `core/Cargo.toml:3` / `src-tauri/Cargo.toml:3` / `package.json:3` / `front-v2/package.json:4` / `design-system-v2/package.json:4` / `src-tauri/tauri.conf.json:4`) já estão em `2.0.0` e `docs/releases/v2.0.0.md` já existe, porém `CHANGELOG.md:7-13` traz apenas `## [Não lançado]` ("Interface v2 em construção") e `## [1.0.0] - 2026-11-18`.
- **Impacto:** Quebra o próprio checklist de publicação documentado em `README.md:451` e deixa o histórico de mudanças desatualizado na tag `v2.0.0`.
- **Correção sugerida:** Adicionar `## [2.0.0]` datada ao `CHANGELOG.md` referenciando `docs/releases/v2.0.0.md` antes de criar a tag `v2.0.0`.
- **Esforço:** P.

### R-018 (P2) — Divergências pontuais no `README.md` (em paralelo) e cabeçalho de `THIRD_PARTY_NOTICES.md`
- **Evidência:** `README.md:34-36` ainda possui `<!-- TODO-VIDEO: inserir demonstração -->` e `> **Demonstração:** em breve...`; `THIRD_PARTY_NOTICES.md:3` ainda diz `"Gerado por node design-system/scripts/avisos.ts ... em design-system/bun.lock"` (v1), embora já inclua pacotes da v2 como `@tanstack/react-virtual@3.14.26`. *(Nota: divergência de idioma EN entre `docs/releases/v2.0.0.md:9` e `ConfigAparencia.tsx` já está registrada em R-010 / #515.)*
- **Impacto:** Menor — apenas informativo/editorial.
- **Correção sugerida:** Atualizar `README.md:34-36` quando o vídeo ficar pronto (ou remover o placeholder na tag) e atualizar a linha 3 de `THIRD_PARTY_NOTICES.md` se houver script v2 equivalente.
- **Esforço:** P.

---

## Frente 7 — Higiene do repositório (**SHIP COM RESSALVA**)

**Pontos sólidos verificados:**
- Nenhum segredo, chave privada ou token encontrado no código versionado.
- Nenhum artefato pesado indevido no Git: os maiores arquivos rastreados são `core/assets/fonts/NotoSerif-Bold.ttf` (623,2 KB), `core/assets/fonts/NotoSans-Bold.ttf` (562,2 KB) e os dois áudios de sonda (`probe-en.wav` / `probe-pt.wav`, ~288 KB cada).
- Nenhum `FIXME` crítico em código de produto.

### R-019 (P2) — 18 links relativos quebrados em specs do `front-v2`
- **Evidência:** Verificação automática em 142 arquivos Markdown encontrou 18 links quebrados por um nível `../` faltante em:
  - `docs/produto/front-v2/telas/C-cortes-selecao-revisao.md` (`../../../GLOSSARY.md`, `../funcionalidades/...`)
  - `docs/produto/front-v2/telas/E-corte-transformar-empacotar.md` (`../../../GLOSSARY.md`, `../../adr/0001-...`, `../funcionalidades/...`)
  - `docs/produto/front-v2/telas/F-exportacao-fila-relatos.md` (`../../../GLOSSARY.md`, `../funcionalidades/...`)
- **Impacto:** Links quebrados ao navegar nas especificações pelo GitHub.
- **Correção sugerida:** Ajustar os prefixos relativos (`../../../../GLOSSARY.md`, `../../funcionalidades/...`, `../../../adr/...`).
- **Esforço:** P.

### R-020 (P3) — Referências residuais (`0.1.0` em `Sobre.tsx`, TODO-VIDEO no `README.md`)
- **Evidência:** `front-v2/src/telas/sobre/Sobre.tsx:80` usa `'0.1.0'` como fallback se `app.version` retornar vazio; `README.md:34` mantém `<!-- TODO-VIDEO: inserir demonstração -->`.
- **Impacto:** Cosmético.
- **Correção sugerida:** Atualizar fallback em `Sobre.tsx` e resolver placeholder do vídeo quando disponível.
- **Esforço:** P.

---

## O que bloqueia a v2.0.0

1. **Bloqueador absoluto (P0) — corrigir antes da tag `v2.0.0`:**
   - **R-005 ([#510](https://github.com/GUSTAVOHOOO/clipes/issues/510))**: Habilitar `PRAGMA foreign_keys = ON` em `core/src/projects.rs:134-142` (com limpeza idempotente de órfãos) para que `DELETE FROM transcripts` ao trocar de Motor/modelo (`core/src/transcription.rs:861-867`) não deixe linhas órfãs que fazem `PRAGMA foreign_key_check` falhar e inutilizam os backups do Projeto.

2. **Recomendados corrigir antes da tag `v2.0.0` (P1):**
   - **R-001 ([#513](https://github.com/GUSTAVOHOOO/clipes/issues/513))**: Definir `app.security.csp` explícita em `src-tauri/tauri.conf.json`.
   - **R-002 ([#511](https://github.com/GUSTAVOHOOO/clipes/issues/511))**: Adicionar `opener:allow-open-path` em `src-tauri/capabilities/default.json` para que "Abrir pasta" / "Abrir arquivo" funcione no app instalado.
   - **R-006 ([#512](https://github.com/GUSTAVOHOOO/clipes/issues/512))**: Limpar pasta `.clipes` parcial se `projects.create` falhar após `fs::create_dir`.
   - **R-007 ([#514](https://github.com/GUSTAVOHOOO/clipes/issues/514))**: Completar `TABELA_ERROS` em `front-v2/src/core/erros.ts` e corrigir a mensagem incorreta de `settings`.
   - **R-010 ([#515](https://github.com/GUSTAVOHOOO/clipes/issues/515))**: Alinhar `docs/releases/v2.0.0.md:9` com o estado real da interface (PT-BR; EN em preparação).
   - **R-014 ([#516](https://github.com/GUSTAVOHOOO/clipes/issues/516))**: Corrigir filtros de caminhos em `.github/workflows/ci.yml` (`worker/**`), `release.yml` (`front-v2/**`, `design-system-v2/**`) e `linux-validation.yml`.
   - **R-015 ([#395](https://github.com/GUSTAVOHOOO/clipes/issues/395), [#507](https://github.com/GUSTAVOHOOO/clipes/issues/507))**: Corrigir o flake `window is not defined` em `front-v2/src/main.test.ts` (`#507`) e acompanhar os flakes de `#395`.
   - **R-017 ([#517](https://github.com/GUSTAVOHOOO/clipes/issues/517))**: Adicionar a seção `## [2.0.0]` ao `CHANGELOG.md`.
