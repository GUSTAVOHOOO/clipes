# Pesquisa: Eficiência Máxima do CI do Clipes

**Data:** 2026-11-18
**Escopo:** Análise empírica dos workflows em `.github/workflows/` (`ci.yml`, `release.yml`, `catalog.yml`, `linux-validation.yml`), diagnóstico do gargalo pós-PR #402 / #409 / #411, avaliação quantitativa de 16 alavancas de otimização e plano em tickets prontos para implementação.
**Status:** Pesquisa concluída (sem edição de código nem de `.github/`).

---

## Resumo Executivo — Os 5 Maiores Ganhos

1. **Corrigir os flakes raiz + estabilizar cache `Swatinem/rust-cache` (`save-if: master`, `shared-key`, `debug = 0`)**: **16 de 17** falhas de job nos últimos 40 runs foram flakes (`sources_delete.rs:745` derrubou `rust (windows-latest)` em **50% dos runs — 3/6**), zerando o hit rate do cache Windows (**0/6**) e empurrando o armazenamento de caches para **8,76 GiB / 10 GiB** (evicção iminente). Isolar `save-if` na `master`, remover `debuginfo` em teste (`debug = 0`) e eliminar o flake #1 reduz `rust (windows-latest)` de **19m52s** para **~7–9 min** e evita reruns inteiros de **25–37 min**.
2. **`cargo nextest` + eliminação de `rustc` em runtime + `rust-lld` / `lld-link` + consolidação dos 107 binários de teste**: Hoje `cargo test --workspace` compila/linka **110 binários sequenciais** (107 arquivos em `core/tests/*.rs`), 13 arquivos usam `static SERIAL: Mutex<()>` (serializando 38 testes só em `transcription.rs`) e 15 arquivos invocam `rustc` em runtime (38× em `transcription.rs`). Migrar para `cargo nextest` (processo por teste) + linker rápido (`rust-lld`/`lld-link`) + `[[bin]]` pré-compilados para fixtures corta a etapa Rust em **~4–6 min no Ubuntu** (de 9m30s para ~3m30s–5m) e **~8–11 min no Windows**.
3. **Desafogar o teto de 20 runners simultâneos (fila pós-#402 saltou de 2–3s para 4–14m30s p90)**: O plano GitHub Free para repos públicos limita a **20 jobs simultâneos**. Após o #402, cada PR + `master` + `release.yml` passou a disputar ~8–14 slots ao mesmo tempo durante ondas. Filtrar `licenses` (só quando lockfiles/manifests mudam), tirar `release.yml` de PRs rotineiros (ou rodar só na `master`/tag), e reduzir a matriz de `front-v1`/`front-v2`/`worker` na `master` para Ubuntu (mantendo Win em `rust`/`e2e`) corta a fila p90 de **9–14 min** para **< 1–2 min** e economiza **~9–12 min de máquina por PR** em `release.yml`.
4. **Restringir E2E Tauri em PR + cachear `tauri-driver` (`taiki-e/install-action`)**: A execução real do WebDriver em `e2e (windows-latest)` leva apenas **29 segundos** (Sessões 1 + 2), mas o job leva **9m19s mediano (+ 3m36s fila)** por causa de `cargo install tauri-driver` (46s sem cache), `bun install` Windows (34s), `choco install ffmpeg` (24s) e recompilação de `clipes.exe` + `fake-worker.exe` (~3m47s mesmo com cache hit). Cachear/instalar binário pré-compilado do `tauri-driver` + só disparar E2E em PR quando IPC/Tauri/front-v1/scripts E2E mudam (em vez de todo diff em `core/`) economiza **~9–13 min** em PRs puramente internos do núcleo.
5. **Corrigir furo de segurança no filtro de caminhos (`worker/**` embutido em `core/`) e enxugar artefatos pesados**: `core/src/components/worker.rs` usa `include_bytes!` em `worker/**` e `core/tests/support/fake_worker.rs` usa `include_str!` em `worker/protocol/examples/*.jsonl`, mas os filtros `rust`, `tauri` e `release.yml` **não incluem `worker/`** (risco de falso verde). Em paralelo, `release.yml` já acumulou **988 artefatos** (~120 MiB/build com retenção padrão de 90 dias); reduzir `retention-days: 3` em PR ou mover build de instaladores para `master`/tag elimina ~120 MiB de upload por push de PR.

---

## 1. Medição (Base Empírica: Últimos 40 Runs Completos de `CI` + Auxiliares)

Dados coletados via `gh run list`, `gh api repos/GUSTAVOHOOO/clipes/actions/runs/{id}/jobs`, `/attempts/{n}/jobs`, `/actions/caches`, `/actions/artifacts` e logs brutos dos jobs em **18/11/2026**.

- **Amostra principal (`CI`):** 40 runs completos mais recentes até o run `44373167038` (`18/11/2026 18:45Z`), divididos em:
  - **Pré-#402:** 16 runs (12 `pull_request`, 4 `push` na `master`).
  - **Pós-#402 (`>= 44359629580`):** 24 runs (17 `pull_request`, 7 `push` na `master`).
- **Amostras complementares:** 15 runs completos de `Instaladores e release` (`release.yml`), 5 runs de `Validação no Linux` (`linux-validation.yml`), 10 PRs recentes para DCO, 29 entradas ativas de cache e 988 artefatos armazenados.

### 1.1 Resumo Geral por Evento (Wall-Clock do Run Completo, excl. Cancelados)

| Recorte | Evento | Runs (Fail / Cancel) | Mediana | p90 | Mín–Máx | Reruns (`attempt > 1`) |
|---|---|---:|---:|---:|---:|---:|
| **Todos (40)** | `pull_request` | 29 (4 fail / 6 cancel) | **26m45s** | **37m17s** | 4m58s–90m21s | 3 |
| **Todos (40)** | `push` (`master`) | 11 (5 fail / 1 cancel) | **29m27s** | **38m37s** | 18m46s–38m45s | 1 |
| **Pré-#402 (16)** | `pull_request` | 12 (1 fail / 2 cancel) | **27m00s** | **46m15s** | 12m36s–90m21s | 2 |
| **Pré-#402 (16)** | `push` (`master`) | 4 (2 fail / 0 cancel) | **32m48s** | **37m18s** | 27m35s–38m36s | 0 |
| **Pós-#402 (24)** | `pull_request` | 17 (3 fail / 4 cancel) | **26m42s** | **33m09s** | 4m58s–37m28s | 1 |
| **Pós-#402 (24)** | `push` (`master`) | 7 (3 fail / 1 cancel) | **25m01s** | **37m49s** | 18m46s–38m45s | 1 |

> [!IMPORTANT]
> O #402 derrubou o piso mínimo de PR (de `12m36s` para `4m58s` em PRs de `docs`/`front-v2`) e reduziu a mediana na `master` em ~7m47s (`32m48s → 25m01s`). Porém, a **mediana em PR quase não mudou (`27m00s → 26m42s`)** porque a **fila por concorrência explodiu** no pós-#402 e os jobs de Rust (`10m38s` Ubuntu / `19m52s` Windows) + E2E (`9m04s`) continuaram dominando.

### 1.2 Tabela por Job (Duração, Fila, Falha, Flake e Cache)

Tempos calculados sobre jobs executados e não cancelados; **fila** = `started_at - created_at`. A taxa de falha e de flake contabiliza todas as tentativas (`attempts`, incluindo tentativas anteriores em runs com `run_attempt > 1`).

#### A. Visão Pós-#402 (24 runs, arquitetura atual) vs Pré-#402 (16 runs)

| Job (`CI`) | Período | Exec. (Skip / Canc) | Falhas (Taxa) | Flakes (Taxa) | Med. Duração | p90 Duração | Med. Fila | p90 Fila | Cache Hit (Rust / Bun) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `changes` | Pós-#402 | 18 (0 / 0) | 0 (0,0%) | 0 (0,0%) | **0m06s** | 0m14s | **4m00s** | **9m21s** | N/A |
| `rust (ubuntu-latest)` | Pós-#402 | 11 (7 / 1) | 0 (0,0%) | 0 (0,0%) | **10m38s** | 12m38s | **4m15s** | **9m36s** | **30% (3/10)** / N/A |
| `rust (windows-latest)` | Pós-#402 | 6 (0 / 0) | **3 (50,0%)** | **3 (50,0%)** | **19m52s** | **22m46s** | 2m36s | 5m38s | **0% (0/6)** / N/A |
| `e2e (ubuntu-latest)` | Pós-#402 | 12 (5 / 1) | 0 (0,0%) | 0 (0,0%) | 5m19s | 6m25s | 2m16s | **10m27s** | **36% (4/11)** / **100% (11/11)** |
| `e2e (windows-latest)` | Pós-#402 | 19 (5 / 1) | 1 (5,3%) | 1 (5,3%) | **9m04s** | **10m55s** | **3m36s** | **10m23s** | **28% (5/18)** / **100% (18/18)** |
| `front-v1 (ubuntu-latest)` | Pós-#402 | 13 (5 / 0) | 0 (0,0%) | 0 (0,0%) | 3m36s | 14m19s | **4m38s** | **14m16s** | N/A / **100% (13/13)** |
| `front-v1 (windows-latest)` | Pós-#402 | 6 (0 / 0) | 0 (0,0%) | 0 (0,0%) | 4m52s | 5m22s | 3m08s | 9m02s | N/A / **100% (6/6)** |
| `front-v2 (ubuntu-latest)` | Pós-#402 | 16 (2 / 0) | 3 (18,8%) | 3 (18,8%) | **1m32s** | 4m08s | **4m00s** | **14m30s** | N/A / **100% (16/16)** |
| `front-v2 (windows-latest)` | Pós-#402 | 6 (0 / 0) | 0 (0,0%) | 0 (0,0%) | 2m46s | 2m54s | 2m29s | 9m40s | N/A / **100% (6/6)** |
| `worker (ubuntu-latest)` | Pós-#402 | 15 (9 / 0) | 0 (0,0%) | 0 (0,0%) | 0m12s | 0m18s | 3m05s | **12m51s** | N/A (uv cache) |
| `worker (windows-latest)` | Pós-#402 | 12 (0 / 0) | 0 (0,0%) | 0 (0,0%) | 0m24s | 0m30s | 2m58s | **11m22s** | N/A (uv cache) |
| `licenses` | Pós-#402 | 24 (0 / 0) | 0 (0,0%) | 0 (0,0%) | 0m27s | 0m35s | 2m02s | 9m04s | N/A |
| `ci-ok` | Pós-#402 | 18 (0 / 0) | 6 (agreg.) | — | 0m04s | 0m05s | 0m23s | 2m06s | N/A |
| `check (ubuntu-latest)` | Pré-#402 | 15 (0 / 1) | 2 (13,3%)* | 2 (13,3%)* | 14m59s | 30m27s | **0m02s** | 3m17s | Sem `rust-cache` |
| `check (windows-latest)` | Pré-#402 | 15 (0 / 2) | 1 (6,7%)* | 1 (6,7%)* | **26m42s** | 28m36s | **0m02s** | 3m20s | Sem `rust-cache` |

*\*Considerando todas as tentativas nos 40 runs (22 tentativas de `check (ubuntu-latest)` com 7 falhas por flake = 31,8%; 17 tentativas de `check (windows-latest)` com 2 falhas por flake = 11,8%, 1 recuperada em rerun).*

#### B. Workflows Auxiliares & DCO

| Workflow / Check | Medida | Mediana | p90 | Fila Mediana | Observação |
|---|---|---:|---:|---:|---|
| `Instaladores e release` (`windows-latest`) | 12 runs | **9m08s** | 11m47s | 2m06s | Roda em PR de `core/`/`src/` **sem `rust-cache`** |
| `Instaladores e release` (`ubuntu-latest`) | 11 runs | **8m34s** | 11m01s | 2m47s | Sobe artefato de **110,4 MiB** por PR |
| `Validação no Linux` (`ubuntu-latest`) | 5 runs | ~10m | ~11m | — | Roda só em paths Linux/AppImage/CutPreview; sem `concurrency` |
| Check `DCO` (App ID `1861`) | 10 PRs | **0–1s** | **1s** | 0s | GitHub App síncrono; **zero** consumo de runner |

### 1.3 Tabela por Step dos Jobs Críticos (40 Runs)

#### `rust (ubuntu-latest)` e `rust (windows-latest)`

| Step | Ubuntu (`n=10`) Med / p90 | Windows (`n=6`) Med / p90 | Diagnóstico |
|---|---:|---:|---|
| `cargo test --workspace` | **9m30s / 10m44s** | **18m52s / 20m04s** | Gargalo #1 absoluto da `master` |
| `Install Linux dependencies` / `Install FFmpeg (Win)` | 0m36s / 0m59s | 0m23s / 0m26s | `apt-get` + `webkit2gtk` não cacheados |
| `Post Run Swatinem/rust-cache@v2` | 0m15s / 0m21s | **1m32s / 1m41s** | Compactação/upload de 670–812 MiB no Windows |
| `dtolnay/rust-toolchain@stable` | 0m09s / 0m09s | 0m22s / 0m23s | Baixa toolchain toda vez |
| `Swatinem/rust-cache@v2` (restore) | 0m02s / 0m24s | 0m01s / 0m03s | No Windows foi 0/6 hits (1–3s = miss rápido) |
| `benchmarks/transcricao` unittest + `ffmpeg -h filter=ass` | 0m00s / 0m01s | 0m02s / 0m03s | Irrelevante |

**Decomposição interna de `cargo test --workspace` (medição nos logs brutos):**

- **Ubuntu com cache HIT** (run `44373167038`): compilação + linkagem = **2m34s (155s)**; execução sequencial dos 110 binários (587 testes) = **5m40s (340s)**. Soma dos wall-times por binário = 336,4s.
- **Ubuntu com cache MISS** (run `44370674233`): compilação + linkagem = **4m12s (253s)**; execução = **4m48s (288s)**. O cache atual economizou apenas **~1m38s** no Ubuntu!
- **Windows com cache MISS** (runs `44371470799` e `44373167038`): compilação + linkagem = **5m43s–8m22s (343s–503s)**; execução dos 110 binários (585 testes) = **9m32s–11m45s (572s–705s)**.
- **Binários de teste mais lentos (run `44373167038`):**
  - `tests/source_batches.rs` (1 teste): **72,05s** no Windows
  - `tests/transcription.rs` (38 testes, **38× invocando `rustc`** + mutex `SERIAL`): **40,14s** Ubuntu / **59,12s** Windows
  - `tests/proxy.rs` (3 testes, FFmpeg real): **36,48s** Ubuntu / **51,74s** Windows
  - `tests/caption_parity.rs` (3 testes, FFmpeg + libass): **23,01s** Ubuntu / **29,31s** Windows
  - `tests/probe.rs` (12 testes): **20,45s** Ubuntu / **24,47s** Windows
  - `tests/export_parity.rs` (6 testes, FFmpeg real): **18,92s** Ubuntu / **26,25s** Windows
  - `tests/editor_assets.rs` (2 testes): **16,50s** Ubuntu / **26,15s** Windows
  - `core` lib unittests (236 testes): **13,66s** Ubuntu / **13,64s** Windows

#### `e2e (windows-latest)` e `e2e (ubuntu-latest)`

| Step | Windows (`n=33`) Med / p90 | Ubuntu (`n=26`) Med / p90 | Observação |
|---|---:|---:|---|
| `Run Tauri E2E` (`scripts/e2e-tauri.mjs`) | **6m48s / 7m31s** | **4m20s / 5m19s** | Ver decomposição abaixo! |
| `cargo install tauri-driver --locked` | **0m46s / 1m07s** | 0m13s / 0m18s | Recompilado do zero em **100% dos runs** |
| `Install Linux deps` / `Ensure FFmpeg (Win)` | 0m24s / 0m37s | **0m40s / 10m54s** | Ubuntu teve pico de 33m46s em `apt-get`! |
| `Post Run Swatinem/rust-cache@v2` | **0m43s / 0m51s** | 0m00s / 0m13s | Salva ~796 MiB no Windows |
| `bun install --frozen-lockfile` | **0m34s / 0m44s** | 0m02s / 0m04s | NTFS I/O lento no Windows |
| `dtolnay/rust-toolchain@stable` | 0m21s / 0m25s | 0m10s / 0m11s | — |
| `Swatinem/rust-cache@v2` (restore) | 0m04s / 0m35s | 0m14s / 0m26s | Hit rate: 28% Win / 36% Ubuntu |

**Decomposição de `Run Tauri E2E (Windows)` com cache HIT (run `44371470799`):**
- `bun run tauri build --debug --no-bundle` (que re-executa `tsc && vite build` + linka `clipes.exe`): **2m20s** (`18:46:38 → 18:48:58`)
- `cargo build -p clipes-core --bin fake-worker`: **1m27s** (`18:48:58 → 18:50:25`)
- Execução real Sessão 1 + Sessão 2 no WebDriver (+ 4× `rustc` de fixtures): **29 segundos** (`18:50:25 → 18:50:54`)!
Ou seja, **90%+ do tempo do step `e2e` não é o teste E2E em si — é setup e build redundante.**

#### `front-v2`, `front-v1`, `worker` e `licenses`

- **`front-v2 (ubuntu-latest)`** (`n=17`): mediana **1m27s** (p90 **3m41s**). Steps: `bunx playwright test` (28s), `bun run test` Vitest (25s), `playwright install chromium` (18s med / **2m31s p90** / 6m08s máx), `build` (2s), `bun install` (1s), `typecheck` (1s). **Mas a fila mediana foi 4m00s e p90 14m30s!**
- **`front-v1 (ubuntu-latest)`** (`n=14`): mediana **3m33s** (p90 **13m00s**). Steps: `bun run test:ui` (2m27s), `Install FFmpeg` (20s med / **9m17s p90** / 18m10s máx!), `Install browser deps` (15s med / 1m52s p90), `build` (8s), `typecheck` (5s). No Windows (`n=6`), `test:ui` leva 2m38s e `bun install` 43s.
- **`worker`**: Ubuntu **12s** (4s pytest), Windows **22s** (5s pytest). Só sofre na fila (3m med / 12m51s p90).
- **`licenses`** (`n=40`): mediana **27s** (`cargo deny` 6s, `dtolnay/rust-toolchain` 9s, `bun install` ×2 2s, JS check 1s). Roda em **todo** run e entra na fila (9m04s p90).

### 1.4 Caches e Artefatos Atuais

- **GitHub Actions Caches:** **29 entradas = 8,76 GiB** (de **10 GiB** máximos por repositório):
  - `v0-rust-e2e`: 6 entradas = **4.908,6 MiB** (~796 MiB no Windows, ~930 MiB no Ubuntu, duplicadas por PR: `refs/pull/402/merge`, `409`, `410`, `397` + `master`).
  - `v0-rust-rust`: 5 entradas = **3.915,7 MiB** (~670–812 MiB cada, `refs/pull/402`, `403`, `409` + `master`).
  - `bun-*`: 4 entradas = **142,1 MiB** (~34–37 MiB cada, 100% hit).
  - `tauri-driver-Linux-2`: 6 entradas = **4,7 MiB** (usado apenas em `linux-validation.yml`, não em `ci.yml`).
  - `setup-uv-1-*`: 8 entradas = **~0 MiB** (pruned).
- **Artefatos:** **988 artefatos acumulados** (amostra dos últimos 100 = **5.995,4 MiB**):
  - `linux` (`AppImage` + `.deb`): **110,42 MiB** mediano por build (`release.yml` em PR + tag).
  - `windows-nsis` (`.exe`): **9,06 MiB** mediano por build.

### 1.5 Auditoria de Flakes nos 40 Runs

Dos **17** registros de falha em jobs nos últimos 40 runs (contando tentativas prévias):

| Causa | Ocorrências | Jobs afetados | Status na #395 |
|---|---:|---|---|
| `core/tests/sources_delete.rs:745` (`source_busy` vs `Ok`) | **5** | `rust (windows)` (3/6!), `check (windows)` (1), `check (ubuntu)` (1) | Reportado em comentário do #394, **aberto** |
| `toHaveFocus()` em diálogos base-ui (`ConfigProvedores`, `EntradaFonte`) | **7** | `check (ubuntu)` (5), `front-v2 (ubuntu)` (2) | Mitigado no PR #398 (`f231990`, 18:27Z); `Fontes.test.tsx:288` segue citado |
| `e2e (windows)` `DevToolsActivePort file doesn't exist` (`44370674233`) | **1** | `e2e (windows-latest)` | Similar ao `WAIT_UNTIL_TIMEOUT` na #395 |
| `front-v2/e2e/shell.spec.ts:84` (`F6` → `dentro: false`) (`44365136273`) | **1** | `front-v2 (ubuntu-latest)` | **Novo**, ainda não citado na #395 |
| `scripts/editor-montage.mjs:159` (`testEditorDucking` timeout 30s) (`44359407239`) | **1** | `check (windows-latest)` | **Novo**, ainda não citado na #395 |
| `spawn ffmpeg ENOENT` (rascunho do PR #402 antes do fix) | **1** | `front-v1 (ubuntu-latest)` | Erro real de config (não flake) |

### 1.6 Caminho Crítico Atual

1. **PR típico de `front-v2/` (sem tocar `src/lib/`):**
   `changes` (4m00s fila + 6s) → `front-v2 (ubuntu-latest)` (4m00s fila + 1m32s exec) → `ci-ok` (23s fila + 4s). Em paralelo roda `licenses` (2m02s fila + 27s).
   - **Gargalo:** **~85–90% do tempo é fila** nos runners (mediana ~6–10 min fora de pico, até ~20 min em onda). Execução útil real = **1m38s**.
2. **PR típico de `core/` ou `src-tauri/`:**
   `changes` (4m00s fila + 6s) → `max(rust (ubuntu-latest) [4m15s fila + 10m38s], e2e (windows-latest) [3m36s fila + 9m04s])` → `ci-ok` (23s fila + 4s) — **além** de disparar `release.yml` em paralelo (mais 2 slots: `9m08s` Win + `8m34s` Ubuntu).
   - **Caminho crítico:** **~15–19 min mediano (~26–33 min p90 com fila)**.
3. **Push na `master`:**
   `changes` (6s + fila) → **`rust (windows-latest)` (2m36s fila + 19m52s med / 22m46s p90)** → `ci-ok`.
   - **Caminho crítico:** `rust (windows-latest)` sozinho responde por ~80% do caminho crítico na `master` (**25m01s mediano, 37m49s p90** no pós-#402), agravado pelos **50% de falha** em `sources_delete.rs:745`.

---

## 2. Achados e Ganhos Estimados por Alavanca

### 2.1 Cache de Rust (`Swatinem/rust-cache@v2` vs `sccache`, chaves, restore em PR, `release.yml`)

- **Achado 1 — Cada PR polui o cache e estoura os 10 GiB:** Hoje `Swatinem/rust-cache@v2` roda com configuração padrão em `rust` e `e2e`. Cada PR salva duas chaves próprias (`v0-rust-rust-*` ~812 MiB e `v0-rust-e2e-*` ~796 MiB), consumindo ~1,6 GiB por PR. Com apenas 11 entradas Rust, o repo já está em **8,76 GiB / 10 GiB**, causando evicção LRU prematura dos caches da `master`.
- **Achado 2 — `rust` e `e2e` não compartilham dependências compiladas e `release.yml` não tem cache algum:** `rust` e `e2e` geram chaves separadas (`rust` vs `e2e`). E `release.yml` (que roda em todo PR de `core/`/`src/`) recompila todas as crates do zero em `release` por ~9–11 min.
- **Achado 3 — `rust (windows-latest)` teve 0% de cache hit (0/6):** Como o job falhou 3 vezes por flake (`sources_delete.rs:745`) e `cache-on-failure` é `false` por padrão, a `master` não conseguiu nem gravar um baseline até o run `44371470799`, enquanto pushes concorrentes na `master` perdiam o cache um do outro.
- **`Swatinem/rust-cache` vs `mozilla/sccache`:**
  - `Swatinem/rust-cache@v2` (com `save-if: ${{ github.ref == 'refs/heads/master' }}`, `shared-key`, e `debug = 0`) é muito mais simples, não sofre com contenda de PDB/MSVC e evita que PRs encham a cota de 10 GiB.
  - `mozilla/sccache` (`SCCACHE_GHA_ENABLED: "true"`) compartilha compilação crate-a-crate entre branches/jobs distintos e suporta C/C++ (útil para `libsqlite3-sys` via `rusqlite` bundled), mas **exige `/Z7` (`-C debuginfo=2` não ou `CARGO_PROFILE_*_DEBUG=0`)** no Windows MSVC para não quebrar com `/Zi` e caminhos absolutos do runner, além de gerar centenas de requisições à Cache API por build (latência maior em jobs curtos e risco de cache thrashing no backend GHA).
- **Recomendação:** Manter `Swatinem/rust-cache@v2` em `ci.yml` e adicionar em `release.yml` com:
  - `save-if: ${{ github.ref == 'refs/heads/master' || startsWith(github.ref, 'refs/tags/') }}`
  - `shared-key: "ci-${{ runner.os }}"` entre `rust` e `e2e` (ou `prefix-key` específico para `release` para não misturar objetos `--release` com `debug` e inchar a entrada além de ~400 MiB).
- **Ganho estimado:** **~1,5–2,5 min** no Ubuntu (em `rust` e `e2e`), **~3–5 min** no Windows (`rust` e `e2e`) ao elevar o hit rate de 0–30% para **>85%**, e **~4–6 min** no `release.yml` (se permanecer em PRs). Economia de cache: **8,76 GiB → ~2–3 GiB** estáveis.

### 2.2 `cargo nextest` vs `cargo test`

- **Achado:** `cargo test --workspace` executa **110 binários sequencialmente**, um após o outro. Dentro de cada binário, **13 arquivos em `core/tests/` usam `static SERIAL: Mutex<()>`** (ex.: `transcription.rs` com 38 testes rodando 1 por vez em 40–59s) porque compartilham variáveis de ambiente (`CLIPES_DATA_DIR`, `CLIPES_FFPROBE`) e sessão global de SQLite no processo.
- **Como `cargo nextest` resolve:** `cargo-nextest` (instalável em ~1–2s via `taiki-e/install-action@v2` com `tool: nextest`, sem compilar!) executa **cada `#[test]` em um processo separado**, permitindo:
  1. Paralelizar todos os 587 testes entre os **4 vCPUs** do runner público simultaneamente, eliminando a barreira entre os 110 binários.
  2. Paralelizar os 38 testes de `transcription.rs` e dos demais 12 arquivos com `SERIAL` (cada processo tem seu próprio `env` e `TempDir`!). *Obs.: verificar apenas que nenhum teste usa porta TCP fixa ou path fixo fora de `TempDir`.*
  3. Usar **retries nativos por filtro** (ver seção 2.13).
- **Ressalva:** `cargo nextest` não executa `doctests` (`Doc-tests clipes_core`, hoje 0 testes ou triviais — pode-se manter `cargo test --doc` em 2s se houver doctests no futuro).
- **Ganho estimado:** **~2,5–4 min no Ubuntu** (execução dos testes de ~5m40s para ~1m40s–2m30s) e **~4–7 min no Windows** (de ~10–11m para ~3m30s–5m).

### 2.3 `cargo check` vs build completo + eliminação de `rustc` em runtime de teste

- **Achado 1 (`rustc` em runtime):** **15 arquivos em `core/tests/*.rs`** (incluindo `transcription.rs`, `assistant.rs`, `hardware_probe.rs`, `tts_narration.rs`, `url_import.rs`) chamam `Command::new("rustc")` para compilar `fake_ffmpeg.rs`, `fake_ytdlp.rs`, etc. **durante a execução dos testes** (38 compilações só em `transcription.rs`!). Em `core/Cargo.toml`, `fake-worker`, `fake-export` e `fake-encoders` já são `[[bin]]` pré-compilados com `env!("CARGO_BIN_EXE_...")`, mas `fake_ffmpeg`, `fake_ytdlp`, `fake_deno`, `fake_provider_cli`, `fake_opencode`, `fake_pocket_tts` ainda não são!
  - Transformá-los em `[[bin]]` em `core/Cargo.toml` (ou compilar 1 vez via `OnceLock` / cargo bin) elimina ~40–60 invocações avulsas de `rustc` por execução de teste (**~1–2 min** no Windows e **~30–45s** no Ubuntu, além de eliminar locks/antivírus Defender no Windows!).
- **Achado 2 (`cargo check` vs `cargo test`):** `cargo check --workspace --all-targets` verifica tipos/empréstimos sem linkar nem rodar testes (~30–60s). **Não** substitui `cargo test` em PRs que tocam `core/`, pois causaria **falso verde** de lógica/SQLite/FFmpeg. Porém, é útil como passo prévio rápido (fail-fast antes do E2E) ou em PRs que tocam *apenas* `src-tauri/` sem mudar `core/`, caso se queira validar compilação do binário Tauri sem buildar debug completo quando o E2E for pulado.
- **Ganho estimado:** **~1–2 min** removendo `rustc` de runtime em `core/tests/` (risco zero).

### 2.4 Profile de Teste (`debug = 0`, `CARGO_INCREMENTAL=0`, linker `lld`/`mold`, `opt-level` de deps e consolidação de testes)

- **Achado:** O repositório **não tem `.cargo/config.toml` nem `[profile.test]`/`[profile.dev]` customizados** no `Cargo.toml` raiz. Consequências medidas:
  - Compilar e linkar **110 binários** com `debug = 2` (padrão) gera **~177 MB de `.pdb` por binário no Windows** (documentado em `docs/agents/impedimentos.md` — até **~18 GB** no disco!), incha o `rust-cache` para **812–930 MiB**, e força `link.exe` (Windows) a processar gigabytes de debuginfo em 110 invocações separadas.
- **Sub-alavancas:**
  1. **`debug = 0` (ou `"line-tables-only"`) em `[profile.test]` e `[profile.dev]`** (via `CARGO_PROFILE_TEST_DEBUG=0` ou `Cargo.toml`):
     - Elimina ~80% do tamanho dos binários/PDBs, encolhe o `rust-cache` de ~812 MiB para **~150–250 MiB** (cortando `Post Run rust-cache` no Windows de 1m32s para ~20s), e reduz o tempo de linkagem em **~30–50%**! *Sugestão prática:* `"line-tables-only"` preserva linha/arquivo no backtrace de panics com custo mínimo, ou `0` no CI via env `CARGO_PROFILE_TEST_DEBUG=0` + `CARGO_PROFILE_DEV_DEBUG=0`.
  2. **`CARGO_INCREMENTAL=0` no CI:** Desabilita metadata incremental em runners efêmeros, reduzindo tempo de compilação em ~5–10% e tamanho do cache.
  3. **Linker rápido (`rust-lld` / `lld-link` / `mold`):**
     - Desde o **Rust 1.90.0**, `x86_64-unknown-linux-gnu` já usa `rust-lld` por padrão (ganhos medidos pelo projeto Rust de ~40% em rebuilds incrementais e ~20% em full debug builds; `mold` pode ganhar mais ~10–20% no link, exigindo `sudo apt-get install mold clang`).
     - No **Windows (`x86_64-pc-windows-msvc`)**, Cargo ainda usa `link.exe` por padrão! Configurar `RUSTFLAGS="-C linker=lld-link"` (já disponível via LLVM pré-instalado no `windows-latest` ou `rust-lld`) corta o link dos 110 binários no Windows em **~20–50%**.
  4. **`opt-level` de dependências (`[profile.test.package."*"] opt-level = 2` ou `3`):**
     - **Atenção:** no Clipes, os testes mais lentos (`source_batches.rs` 72s, `proxy.rs` 52s, `caption_parity.rs` 29s, `export_parity.rs` 26s) são limitados por **I/O de subprocessos (`ffmpeg`, `rustc`, `sleep`/polling)**, **não** por CPU em Rust puro (os 236 unit tests de `core` já rodam em **13,6s** tanto no Ubuntu quanto no Windows!). Compilar `rusqlite`, `reqwest`, `pgp`, `serde` com `opt-level = 3` aumentaria o tempo de compilação inicial (cache miss) sem acelerar `ffmpeg`! **Não vale ativar `opt-level = 3` global nas deps de teste** (no máximo, testar apenas se `pgp`/`sha2` pesassem, o que não é o caso).
  5. **Consolidar os 107 arquivos `core/tests/*.rs` em 1–3 crates/binários de integração** (padrão recomendado pelo guia *Matklad: Delete Cargo Integration Tests* — `core/tests/integration/main.rs` com `mod ...`):
     - Troca **107 linkagens pesadas** por **1 única linkagem** de `clipes-core` + deps! No `cargo nextest`, todos os testes continuam rodando em processos separados e paralelos, com **100× menos overhead de linker e 1 único `.pdb`**.
- **Ganho estimado combinado:** **~1,5–3 min no Ubuntu** e **~4–7 min no Windows** (além de reduzir o cache para <250 MiB e resolver o problema de disco C: do dev!).

### 2.5 Particionar Testes Rust (`cargo nextest --partition` + Matriz / `archive`)

- **Achado:** `cargo nextest archive` permite compilar uma vez e rodar `--partition hash:1/N` (ou `slice:1/N`) em N runners paralelos.
- **Avaliação para o Clipes hoje:**
  - **Contra-indicado em PRs agora** devido ao limite de **20 runners simultâneos** do plano Free! Hoje o repositório já sofre **4–14 min de fila** por excesso de jobs simultâneos. Multiplicar o job `rust` em 2–4 shards multiplicaria a fila em ondas!
  - Além disso, com `nextest` + `[[bin]]` de fixtures + `debug = 0`, um único runner `ubuntu-latest` (4 vCPUs) deve rodar toda a suíte Rust em **~3–5 min** — menor que o próprio overhead de `upload-artifact` + `download-artifact` + fila de um segundo runner!
  - **Onde pode fazer sentido no futuro:** apenas na `master` para `rust (windows-latest)` (2 shards se o Windows continuar >8–10 min após `nextest` + `lld-link`), depois de reduzir a concorrência dos outros jobs.
- **Ganho estimado:** **0 min (negativo em ondas)** em PRs; **~2–4 min** apenas em `windows-latest` na `master` *se* sobrar capacidade de concorrência.

### 2.6 Paralelismo e `needs` Desnecessários

- **Achado 1 — Pressão nos 20 slots simultâneos:** Pós-#402, cada PR de `core/` dispara no `CI` até **5 runners simultâneos** (`changes` → `rust`, `e2e`, `licenses`, mais `front-v1`/`worker` se tocar `scripts`/`worker`) **+ 2 runners simultâneos em `release.yml`** = **7 runners por PR**! Em uma onda de 4 PRs + 2 merges na `master` (que abre 10 jobs no `CI`), são **~40+ jobs disputando 20 slots**, explicando a fila p90 de **14m30s**.
- **Achado 2 — `licenses` roda em todo PR (`needs:` vazio):** Mesmo num PR de 1 linha em `docs/`, `licenses` sobe 1 VM Ubuntu, baixa Rust + `cargo-deny` + `bun` + `node_modules` (27s de execução + 2–9 min na fila), ocupando 1 slot de concorrência. Se depender de `changes` (rodar só quando `Cargo.toml`, `Cargo.lock`, `deny.toml`, `package.json`, `bun.lock`, `design-system/package.json`, `design-system/bun.lock`, `scripts/*license*` ou `ci.yml` mudam), 90%+ dos PRs de código/UI/docs pulam `licenses` sem perda de segurança (e `master` sempre roda!).
- **Achado 3 — `release.yml` em PRs:** Roda builds completos `--bundles nsis` (Windows, **9m08s**) e `--bundles appimage,deb` (Ubuntu, **8m34s**) em **todo push de PR** que toca `core/`, `src-tauri/` ou `src/`. Na maioria das ondas, o empacotamento Tauri quebra raramente comparado ao ciclo de iteração do PR; mover `release.yml` de `pull_request` para **`push: branches: [master]` + `tags`** (ou `pull_request` apenas se tocar `src-tauri/tauri.conf.json`, `capabilities/`, `icons/`, `Cargo.toml`, `package.json`, `.github/workflows/release.yml`, ou sob label `test-release`) libera **2 runners pesados** (incluindo 1 Windows) em todo push de PR de `core/`/`src/`.
- **Achado 4 — `e2e` executa `bun run build` duas vezes ou recompila `tauri-driver`:** `tauri build --debug --no-bundle` já executa `beforeBuildCommand` (`bun run build`), mas `cargo install tauri-driver --locked` roda do zero toda vez (**46s Windows / 13s Ubuntu**). Trocar por `taiki-e/install-action@v2` (`tool: tauri-driver`) ou `actions/cache` (como já existe em `linux-validation.yml`) leva **~2s**.
- **Ganho estimado:** Redução da **fila p90 de 9–14m30s para ~1–3m** + economia direta de **~18 min de VM por push de PR de `core/`/`src/`** no `release.yml` e **~45s** no `e2e`.

### 2.7 `cancel-in-progress` por Concorrência

- **Achado:**
  - `ci.yml` já tem `concurrency: group: ci-${{ github.event.pull_request.number || github.sha }}` com `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. Isso está ótimo para PRs e preserva histórico de commits na `master` (embora 7 runs cancelados nos últimos 40 tenham sido justamente novos pushes em PR).
  - **`linux-validation.yml` NÃO tem bloco `concurrency`!** Se houver pushes seguidos num PR que toca `linux-validation.yml`, runs antigos desperdiçam 10 min de Ubuntu.
  - **Na `master`:** Nunca usar `cancel-in-progress: true` por `refs/heads/master`, pois pularia validação de commits já mergeados se um segundo merge entrar em seguida (risco de mascarar regressão do commit intermediário). Se quiser serializar sem cancelar na `master`, a fila natural de 1–2 merges ou um **Merge Queue** resolve melhor.
- **Ganho estimado:** **~10 min** ocasionais ao adicionar `concurrency` em `linux-validation.yml` (`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`).

### 2.8 Filtros por Caminho & Corretude do `ci-ok` com Jobs Pulados

Auditamos os `include_str!` / `include_bytes!` de `core/` e `src-tauri/`, e os imports de `front-v2/`:

- **Bug real de filtro (risco de falso verde):**
  - `core/src/components/worker.rs` usa `include_bytes!` em **16 arquivos de `worker/`** (`pyproject.toml`, `uv.lock`, `worker/src/clipes_worker/*.py`, `*.wav`), e `core/tests/support/fake_worker.rs` usa `include_str!` em **7 arquivos de `worker/protocol/examples/*.jsonl`**.
  - Entretanto, em `ci.yml`, o filtro `rust` (linha 46) e o filtro `tauri` (linha 49), bem como `release.yml` (linhas 8–20), **NÃO incluem `worker/`**! Um PR alterando apenas `worker/` pula `rust`, `e2e` e `release.yml`, podendo quebrar a compilação do núcleo Rust sem ser detectado antes do merge!
- **Falso positivo caro no filtro `tauri`:**
  - `tauri` inclui `scripts/` inteiro (`^(core|src-tauri|src|scripts|catalog)/`). Logo, editar `scripts/contraste.ts`, `scripts/check-licenses.mjs` ou `scripts/linux-validation.mjs` dispara `e2e (windows-latest)` (~9–13 min)! Restringir para `scripts/(e2e-tauri|setup-webdriver)\.mjs` evita esse desperdício.
- **Outros ajustes de filtro:**
  - Se for adicionado `.cargo/config.toml`, ele **precisa** entrar no `ci` regex ou nos filtros `rust`, `tauri`, `release.yml`.
  - `licenses` deve filtrar por `(Cargo\.(toml|lock)|deny\.toml|package\.json|bun\.lock|design-system/(package\.json|bun\.lock)|scripts/.*license.*|\.github/workflows/ci\.yml)` em PR (sempre rodar na `master`). Além disso, hoje `licenses` não audita `front-v2/package.json` nem `design-system-v2/package.json` (vale incluir quando `front-v2` entrar no app principal).
- **Corretude do `ci-ok` (`ci.yml` linhas 242–253):**
  - `ci-ok` usa `if: always()`, `needs: [changes, rust, front-v1, front-v2, e2e, worker, licenses]`, e falha se `contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')`.
  - Isso garante que jobs com `result == 'skipped'` contem como ok (necessário para branch protection exigir apenas `ci-ok`).
  - **Cuidados necessários:**
    1. Se `changes` falhar, `needs.changes.result == 'failure'`, os dependentes serão `skipped`, e `ci-ok` falhará corretamente.
    2. Se no futuro `merge_group` for ativado, `git diff --name-only "origin/${{ github.base_ref }}...HEAD"` no job `changes` precisa tratar `merge_group` (onde `github.base_ref` é vazio — deve cair no ramo `__ALL__` ou comparar `github.event.merge_group.base_sha...head_sha`). Hoje `if [[ "$GITHUB_EVENT_NAME" != "pull_request" ]]` já cairia em `__ALL__` (seguro, porém rodaria tudo).
    3. Em `pull_request` com merge conflict (ou fork?), `github.base_ref` existe após `actions/checkout@v4` (que faz checkout do merge ref `refs/pull/<n>/merge`), mas exige `fetch-depth: 0` (já presente na linha 28).
- **Ganho estimado:** Eliminação de falso verde em PRs de `worker/` + economia de **~9–13 min** em PRs que tocam apenas `scripts/` não-E2E + economia de **1 slot e ~2–9 min de fila** por PR ao filtrar `licenses`.

### 2.9 Cache de Bun/Node e Playwright Browsers

- **Achado 1 (`oven-sh/setup-bun@v2`):** Já possui cache automático de dependências/runtime com **100% de cache hit** (70/70 jobs medidos pós-#402 entre `e2e`, `front-v1` e `front-v2`). Em `ubuntu-latest`, `bun install --frozen-lockfile` já leva apenas **1–2s**! No `windows-latest`, leva **26–43s** por custo inerente de extração de milhares de arquivos pequenos em NTFS (pouca margem de ganho sem `actions/cache` do `node_modules`, que costuma ter custo parecido para descompactar e risco de symlink quebrado no Windows).
- **Achado 2 (`Playwright browsers`):**
  - A **documentação oficial da Playwright recomenda explicitamente NÃO cachear os binários dos browsers no CI**, pois baixar + extrair do cache GHA demora quase o mesmo que baixar da CDN do Playwright (~15–18s), além de `playwright install --with-deps` no Linux ainda precisar rodar `apt-get` para bibliotecas do SO.
  - **Porém**, nossos dados mostram que `apt-get` no Ubuntu tem **variância alta**: `Install browser (Linux)` em `front-v2` teve mediana de 18s mas **p90 de 2m31s** (máx 6m08s), e `Install FFmpeg (Linux)` em `front-v1` teve **p90 de 9m17s** (máx 18m10s)!
  - **Solução melhor que cachear browser:** Rodar `front-v2` (e opcionalmente `front-v1`) dentro do container oficial `mcr.microsoft.com/playwright:v1.5x.0-noble` (com a mesma versão de `package.json` = `1.65.0` quando disponível, ou instalar `bun` em 2s dentro da imagem) elimina completamente `apt-get` + download do Chromium! Alternativa simples para `front-v2`: `vitest` (25s) não precisa de browser e pode rodar antes ou separado; para Playwright no Linux sem container, manter download padrão da CDN (18s med) e só usar `apt-get` se não usar imagem.
- **Ganho estimado:** **~18s–2m (p90)** em `front-v2` usando container Playwright (cuidado: sincronizar tag da imagem com `front-v2/package.json` `1.65.0`). Sem container, cachear o binário do Chromium **não** traz ganho líquido relevante.

### 2.10 E2E Tauri só Quando Necessário (e Shards)

- **Achado:** Como medido na seção 1.3, o teste WebDriver em si (`e2e-tauri.mjs`, Sessões 1 + 2) leva **apenas 29s** no Windows e **51s** no Ubuntu! Os outros **~8m30s–9m** no Windows são: compilação de `clipes.exe` + `fake-worker.exe` (~3m47s), `cargo install tauri-driver` (46s), `bun install` (34s), `choco install ffmpeg` (24s), `rust-cache` save (43s), + **fila de 3m36s–10m23s**.
- **Por que sharding do `e2e` Tauri PIORA hoje:** Dividir Sessão 1 e Sessão 2 em 2 jobs pagaria **2× todo o overhead de 8m30s** de setup/build + **2× slots de Windows** para economizar metade de 29s (= **14 segundos**)! Sharding só compensaria se passassem de ~5 min de execução pura ou se um único build gerasse artefato compartilhado para N runners.
- **Como reduzir drasticamente `e2e`:**
  1. **Instalar `tauri-driver` pré-compilado** via `taiki-e/install-action` ou `actions/cache` (como `linux-validation.yml`): **-45s no Windows / -12s no Ubuntu**.
  2. **Não recompilar `vite build` nem `fake-worker` sequencialmente sem cache:** `debug = 0` + `lld-link` + `save-if: master` no `rust-cache` acelera `clipes.exe` + `fake-worker.exe` em **~1,5–2 min**.
  3. **Gatilho inteligente em PR:** Hoje qualquer arquivo em `core/` (ex.: `core/src/selection.rs` ou `core/tests/ai.rs`) dispara o E2E Tauri Windows inteiro! Se o E2E Tauri em PR rodar quando o diff toca `src-tauri/`, `src/`, `package.json`, `bun.lock`, `vite.config.ts`, `scripts/e2e-tauri*`, `scripts/setup-webdriver*`, `core/src/lib.rs`, `core/src/dispatch*`, `core/src/projects.rs` ou `core/Cargo.toml` — e rodar **sempre na `master`** (ou via label `run-e2e` no PR) — PRs puramente internos de algoritmos/testes do `core/` economizam **~9–13 min + 1 slot Windows**! *Risco:* falso verde no PR se uma assinatura JSON de comando em `core/src/*.rs` mudar sem alterar `lib.rs` (mitigado por `cargo test` que testa os contratos `dispatch` no `rust` job e pelo E2E completo na `master`).
- **Ganho estimado:** **~2–3 min** por execução (otimizando build/setup) ou **~9–13 min** em PRs internos de `core/`.

### 2.11 Runners Maiores / ARM do GitHub vs Custo

- **Fato de billing (repositório público `GUSTAVOHOOO/clipes`):**
  - **Runners padrão (`ubuntu-latest`, `windows-latest`):** Em repositórios públicos, são **100% gratuitos (minutos ilimitados)** e oferecem **4 vCPUs e 16 GB RAM** (contra 2 vCPUs / 8 GB em repos privados), com teto de **20 jobs simultâneos** no plano GitHub Free.
  - **Larger Runners (8, 16, 32, 64 vCPUs):** **São SEMPRE pagos por minuto mesmo em repositórios públicos** (~$0,016/min para Linux 4-vCPU larger / ~$0,032/min para 8-vCPU Linux / ainda mais caro no Windows), e exigem plano Team/Enterprise.
  - **Runners ARM64 públicos (`ubuntu-24.04-arm`):** São gratuitos em repos públicos (2 vCPUs / 8 GB segundo tabela padrão), porém o Clipes distribui **x86_64** (`AppImage`/`deb`/`NSIS`), `tauri-driver` + `WebKitWebDriver` + FFmpeg precisam validar a arquitetura de distribuição, e 2 vCPUs ARM não batem os 4 vCPUs x86_64 padrão.
- **Conclusão:** **Não vale pagar Larger Runners nem migrar para ARM64** antes de esgotar as otimizações gratuitas (`nextest`, `debug=0`, `lld-link`, remoção de `rustc` em runtime, filtro de concorrência), que já trazem o `CI` para a faixa de **~4–10 min** sem custo financeiro. Só faria sentido considerar 1 runner Linux 8-vCPU ou self-hosted dedicado se o volume de PRs crescer muito e o teto de 20 slots continuar gargalando.

### 2.12 Artefatos Pesados (`release.yml`)

- **Achado:** `release.yml` já acumulou **988 artefatos** (últimos 100 somam **5,99 GiB**): cada build de PR sobe `linux` (**110,42 MiB**) e `windows-nsis` (**9,06 MiB**) com retenção padrão de **90 dias**!
- **Solução:**
  1. Em `pull_request`, **não subir** `upload-artifact` (ou colocar `retention-days: 3` se alguém quiser baixar manualmente para testar). Só manter retenção normal nas tags de release (ou `retention-days: 7`, já que em tag os binários vão para o GitHub Release imediatamente após o job `release`).
  2. Melhor ainda: se `release.yml` deixar de rodar em todo PR de `core/`/`src/` (passando para `push: branches: [master]` + `tags`, ou só PRs que tocam configuração de empacotamento), elimina **~120 MiB de upload** e **2 runners (~9 min cada)** por push de PR.
- **Ganho estimado:** **~10–20s** por upload evitado + economia maciça de storage/quota de artefatos e **2 runners** por push de PR.

### 2.13 Retry Seletivo de Flakes Conhecidos (Issue #395)

- **Achado:** Nos 40 runs, **16 de 17 falhas** foram flakes, causando reruns inteiros de **20–37 min** e zerando o cache Windows (`0/6`).
- **Ordem correta (corrigir raiz > retry seletivo):**
  1. **Corrigir a raiz (prioridade máxima):**
     - `core/tests/sources_delete.rs:745` (5 ocorrências, **50% de falha no Windows**): o teste insere um job `kind='transcription'` em `queued`, e o executor em background o consome/falha antes de `sources.delete`. Trocar o seed do teste para um `kind` não consumido ou pausar o executor resolve a causa raiz sem alterar produção (como já diagnosticado na #395).
     - `front-v2/e2e/shell.spec.ts:84`: após `page.keyboard.press('F6')`, usar `await expect(async () => ...).toPass()` em vez de `page.evaluate()` imediato.
     - `scripts/editor-montage.mjs:159`: aumentar estabilidade do drag / aguardar evento de ponteiro antes do `waitForFunction`.
     - `scripts/e2e-tauri.mjs:610` (`DevToolsActivePort` / `WAIT_UNTIL_TIMEOUT`): adicionar retry **localizado dentro de `withTauriSession`** apenas na criação da sessão WebDriver (`newSession` com backoff de 1–2s se `DevToolsActivePort` falhar no boot frio do `msedgedriver` no Windows).
  2. **Retry seletivo onde ainda houver corrida residual:**
     - **Playwright (`front-v2/playwright.config.ts`):** `retries: process.env.CI ? 1 : 0` (padrão oficial Playwright, com `trace: 'on-first-retry'` para diagnosticar flakes sem perder o sinal!).
     - **`cargo-nextest` (`.config/nextest.toml`):** usar `retries` **apenas com `[[profile.ci.overrides]]` por filtro específico** (ex.: só nos testes da #395 enquanto não são consertados, com `junit` registrando se passou no retry!). **Nunca** colocar `retries = 2` global, pois esconderia regressões determinísticas e dobraria tempo em falhas reais.
     - **Vitest:** **Não** usar retry global (corrigir `waitFor` como feito no #398; se necessário, `retry` apenas em `it(..., { retry: 1 })` pontual com issue aberta).
- **Ganho estimado:** Eliminação de **~80–90% dos reruns manuais** (cada rerun desperdiça **15–37 min** de ciclo do PR/master) e recuperação imediata do cache Windows (`0% → >85%`).

### 2.14 Merge Queue vs `strict`

- **Estado atual:** A proteção da `master` tem `strict: false` ("Require branches to be up to date" **desligado**), exigindo `ci-ok` e `DCO`.
- **Análise:**
  - Ativar `strict: true` seria **catastrófico** para o fluxo de ondas de múltiplos workers do Clipes: a cada merge na `master`, todos os outros PRs da onda ficariam desatualizados e teriam de fazer rebase + rodar CI inteiro de novo (serializando merges a 1 a cada 15–30 min).
  - **GitHub Merge Queue (`merge_group`):** Está disponível gratuitamente em repositórios públicos e testa commits especulativos (`master + PR1 + PR2`) automaticamente sem exigir rebase manual. **Porém**, no estado atual:
    1. Como o repo ainda tem fila de **4–14m p90** pelo teto de 20 runners e flakes de **50%** no Windows, ativar Merge Queue *agora* adicionaria mais runs especulativos (`merge_group`) nos mesmos 20 slots, agravando a fila e ejetando PRs inocentes por flake do `sources_delete.rs`!
    2. `ci.yml` (`changes`) precisa ser adaptado para `merge_group` caso ativado.
  - **Recomendação:** Manter `strict: false` agora (como está), **consertar flakes e reduzir tempo do CI para <6–8 min primeiro**, e só avaliar ativar `Merge Queue` quando o fluxo de ondas gerar conflitos lógicos frequentes pós-merge na `master`.

### 2.15 Matriz Win + Ubuntu na `master` (Precisa Mesmo?)

Analisando os 40 runs para responder com dados reais onde o Windows trouxe valor vs custo:

| Job na `master` | Custo Windows (Med / p90) | Valor real de rodar Windows em todo commit da `master` | Veredito |
|---|---|---|---|
| `rust` | **19m52s / 22m46s** | **Alto:** já pegou bugs reais de Windows (`impedimentos.md`: FFmpeg 9 `-filter_complex_script`, sockets TCP reset, CRLF/hashes, `keyring` Windows Credential Manager, locks de arquivo). | **Manter na `master`**, otimizando para ~7–9 min (`nextest` + `debug=0` + `lld-link` + fix `sources_delete`). |
| `e2e` | **9m04s / 10m55s** | **Alto:** Windows é o principal alvo distribuído (WebView2, política `HKLM` de remote debugging, `msedgedriver`). Já `e2e (ubuntu-latest)` (5m19s) testa WebKitGTK, que também vale manter ou rodar junto com `linux-validation`. | **Manter Win + Ubuntu na `master`** (ou mover `e2e (ubuntu)` para `linux-validation` se quiser economizar 1 slot). |
| `front-v1` | **4m52s / 5m22s** | **Baixo em todo commit:** Vite/React/Playwright Chromium já são validados no `ubuntu-latest` (3m36s). Nas 40 execuções, `front-v1 (windows)` teve 0 falhas exclusivas úteis (a única falha foi timeout de `editor-montage`). | **Rodar só no Ubuntu na `master`** + agendamento noturno (`schedule`) ou manual no Windows! |
| `front-v2` | **2m46s / 2m54s** | **Baixo em todo commit:** JS/TS + Vitest jsdom + Playwright Chromium + mock TS; `ubuntu-latest` já valida em 1m32s (0 falhas exclusivas de Windows nos 40 runs). | **Rodar só no Ubuntu na `master`** (e opcionalmente Windows em `schedule` noturno). |
| `worker` | **0m24s / 0m30s** (+ 3–11m fila) | **Médio-baixo:** testa JSONL/Python e `uv.lock`; apesar de rápido na execução (24s), consome **1 slot Windows** e pega **2m58s med / 11m22s p90 de fila**! | Manter Ubuntu na `master`; rodar Windows só se `worker/` mudar (ou em `schedule`/tag). |

- **Ganho estimado:** Tirar `front-v1`, `front-v2` e `worker` da matriz Windows na `master` (quando não tocados ou movendo Win JS/Python para cron noturno) libera **3 runners Windows por merge** na `master`, reduzindo drasticamente a fila de `rust (windows)` e `e2e (windows)`!

### 2.16 Tempo de DCO

- **Medição:** Nos últimos 10 PRs (#401–#413), o check `DCO` (`app_id: 1861`) completou em **0 a 1 segundo** após o push/sync, sem usar nenhum runner de GitHub Actions.
- **Conclusão:** Impacto **zero** no tempo de CI; manter como está.

---

## 3. Recomendações Priorizadas (`Ganho ÷ Esforço`)

Legenda de Esforço: **P** (< 1h / edição simples), **M** (2–4h / ajuste de testes ou Cargo), **G** (1+ dia / refatoração estrutural).

| # | Ação Recomendada | Ganho Estimado | Esforço | Score (G/E) | Riscos (Falso Verde / Cache Poisoning / Flake Novo) | Como Validar |
|---:|---|---|---:|---:|---|---|
| **1** | **Corrigir flake raiz `sources_delete.rs:745`** (seed sem job real consumível pelo executor) + `shell.spec.ts:84` + retry de boot no `withTauriSession` | **50% → ~0% falhas** em `rust (win)`; destrava cache Win (-5 a 10m) | **P** | **10/10** | **Baixo:** risco de mascarar bug só se relaxasse o assert em vez de corrigir o seed do teste. | Rodar 10× em loop `cargo test --test sources_delete` no Windows + 5 merges seguidos verdes na `master`. |
| **2** | **`Swatinem/rust-cache@v2` otimizado**: `save-if: github.ref == 'refs/heads/master'`, `shared-key`, `CARGO_INCREMENTAL=0`, e adicionar em `release.yml` | **1,5–5m** em `rust`/`e2e`/`release`; cache **8,8→2,5 GiB** | **P** | **9/10** | **Cache poisoning:** mínimo se PRs apenas restaurarem (`save-if: master`). **Falso verde:** nulo. | Conferir hit rate `>85%` em 5 PRs seguidos e `gh cache list` abaixo de 4 GiB. |
| **3** | **Profile de teste rápido + linker rápido**: `CARGO_PROFILE_TEST_DEBUG=0` (ou `line-tables-only`), `CARGO_PROFILE_DEV_DEBUG=0`, `RUSTFLAGS="-C linker=lld-link"` no Windows (`rust-lld` já ativo no Linux >=1.90) | **2–4m** Win + **1m** Ubuntu; cache -70%; -18 GB PDB local | **P** | **9/10** | **Diagnóstico:** `debug=0` omite linha exata em panics (mitigável com `line-tables-only`). `lld-link` raramente diverge de `link.exe` em recursos `.rc` do Tauri (testar build Win). | Comparar tempo de `rust` e `e2e` no Win/Ubuntu antes vs depois e conferir backtrace legível + `tauri build`. |
| **4** | **Desafogar fila de 20 runners**: `licenses` só em arquivos de deps/lockfile; tirar `release.yml` de PRs rotineiros (ou só paths de empacotamento); `retention-days: 3` em artefatos de PR; `concurrency` em `linux-validation.yml`; instalar `tauri-driver` via `taiki-e/install-action` | **-4 a -10m de fila p90** em ondas + **-18m VM** por PR de core/src + **-45s** no `e2e` | **P** | **9/10** | **Falso verde:** um PR poderia quebrar empacotamento NSIS/AppImage até chegar na `master` (mitigado mantendo `release.yml` na `master` + PRs que toquem `tauri.conf.json`/`Cargo.toml`/`package.json`). | Medir mediana/p90 de fila em uma onda de 4+ PRs simultâneos e checar geração de artefatos na `master`. |
| **5** | **Corrigir filtro `worker/`** em `rust`, `tauri` e `release.yml` + restringir `scripts/` no `tauri` | **Corrige falso verde** de `include_bytes!`; **-9m** em PRs de `scripts/` não-E2E | **P** | **8/10** | **Falso verde:** nenhum (fecha furo atual!). | Abrir PR teste tocando `worker/protocol/...` e `scripts/contraste.ts` para verificar jobs disparados. |
| **6** | **Enxugar matriz Win na `master`**: rodar `front-v1`, `front-v2` e `worker` apenas no Ubuntu por push na `master` (Win em `schedule` noturno), mantendo Win obrigatório em `rust` e `e2e` | **-3 slots Win** por push na `master` (reduz fila de `rust (win)` e `e2e (win)`) | **P** | **8/10** | **Falso verde:** bug exclusivo Windows em `scripts/ui.mjs` ou `worker/` seria visto só no cron noturno (mitigável mantendo `rust` + `e2e` Win síncronos). | Validar 1 semana de cron noturno verde + queda de fila na `master`. |
| **7** | **Migrar `cargo test --workspace` para `cargo nextest`** (via `taiki-e/install-action@v2` `nextest`) + `[[bin]]` pré-compilados em vez de `rustc` em runtime nos 15 testes | **2,5–4m** Ubuntu + **4–7m** Win | **M** | **8/10** | **Flake novo:** testes em `core/tests/` que rodam em processos paralelos pela 1ª vez podem revelar disputa por diretório/porta não isolada por `TempDir`. `nextest` não roda doctests (`cargo test --doc` separado). | Rodar `cargo nextest run --workspace` 5× seguidas em Ubuntu e Windows; auditar testes com `TempDir` único. |
| **8** | **Restringir disparo de `e2e` em PR** (somente `src-tauri/`, `src/`, `core/src/lib.rs`, `scripts/e2e-tauri*`, configs de build; mantendo sempre na `master`) | **-9 a -13m** em PRs puramente internos de `core/` | **P–M** | **7/10** | **Falso verde:** mudança em contrato JSON de comando em `core/src/*.rs` pode quebrar UI até chegar na `master` (mitigado por `rust` unit/integration tests + `e2e` completo na `master`). | Verificar que PRs de `src-tauri/`/`src/`/`lib.rs` disparam `e2e` e PRs de módulo interno passam rápido e integram na `master`. |
| **9** | **Consolidar os 107 arquivos `core/tests/*.rs`** em poucos binários de integração (`tests/integration/main.rs`) | **1–3m** Ubuntu/Win no link + -100+ binários/PDBs | **M** | **6/10** | **Baixo:** exige ajustar paths relativos de `#[path = "support/..."]` e `include_bytes!`; atenção se algum teste dependia de `static` isolado por binário (com `nextest`, cada teste já é um processo!). | Comparar contagem exata de testes executados (`587`) antes e depois da consolidação. |
| **10** | **Retry seletivo com registro** (`playwright` `retries: 1` em CI + `nextest` `[[profile.ci.overrides]]` apenas para testes da #395 + `mcr.microsoft.com/playwright` container para `front-v2`) | Evita reruns de **20–37m** e picos de `apt-get` (2–6m) | **M** | **6/10** | **Mascarar flake novo:** só usar `overrides` em testes específicos listados na #395 com issue aberta, nunca retry global em Rust. | Verificar JUnit/relatório apontando testes flaky sem falhar o PR, mas mantendo alerta na #395. |
| **11** | **Merge Queue (`merge_group`)** e **Particionamento `nextest` (`--partition hash:1/2`) na `master` Win** | Segurança pós-merge / **-2 a 4m** no `rust (win)` | **M–G** | **4/10** | **Piora fila** se aplicado antes dos itens 1–7! `merge_group` exige adaptar `changes` e não pode ter `strict: true`. | Só habilitar após o tempo médio de `CI` cair para <8 min e a fila p90 para <2 min. |

---

## 4. Fontes Oficiais e Referências

- **GitHub Actions — Runners padrão, specs e preços (públicos vs larger runners):**
  - [Standard GitHub-hosted runners](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners/about-github-hosted-runners)
  - [Larger runners (sempre pagos, inclusive em repos públicos)](https://docs.github.com/en/actions/using-github-hosted-runners/about-larger-runners/about-larger-runners)
  - [Usage limits, billing, and administration (20 concurrent jobs no Free tier)](https://docs.github.com/en/actions/administering-github-actions/usage-limits-billing-and-administration)
- **GitHub Actions — Cache (limite de 10 GiB, LRU, branch scoping, concurrency):**
  - [Caching dependencies to speed up workflows](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows)
  - [Using concurrency (`cancel-in-progress`)](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/using-concurrency)
  - [Managing a merge queue (`merge_group`)](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- **Rust — Cache, Linkers, Profiles e `cargo-nextest`:**
  - [`Swatinem/rust-cache` (`shared-key`, `save-if`, `cache-on-failure`, `prefix-key`)](https://github.com/Swatinem/rust-cache)
  - [`mozilla/sccache` (GitHub Actions backend & MSVC `/Z7`)](https://github.com/mozilla/sccache)
  - [Rust 1.90.0 Release Notes — `rust-lld` padrão em `x86_64-unknown-linux-gnu`](https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/)
  - [The Cargo Book — Profiles (`debug`, `opt-level`, `incremental`)](https://doc.rust-lang.org/cargo/reference/profiles.html)
  - [`cargo-nextest` — CI features, partitioning & retries](https://nexte.st/docs/ci-features/)
  - [`taiki-e/install-action` (instalação pré-compilada de `nextest`, `tauri-driver`, `cargo-deny`)](https://github.com/taiki-e/install-action)
  - [Matklad — Delete Cargo Integration Tests (consolidação de `tests/*.rs`)](https://matklad.github.io/2021/02/27/delete-cargo-integration-tests.html)
- **Frontend / Playwright / Vitest:**
  - [Playwright Docs — Continuous Integration (não recomenda cachear browser binaries) & Sharding](https://playwright.dev/docs/ci)
  - [Vitest Docs — Improving Performance (`pool`, `vmThreads`, `isolate`, `happy-dom`)](https://vitest.dev/guide/improving-performance)
- **Evidências locais do repositório:**
  - `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/linux-validation.yml`, `.github/workflows/catalog.yml`
  - `docs/agents/impedimentos.md` (seções Disco, Testes E2E Tauri e Flakes #395)
  - Issue `#395` e commits `#402` (`7d38cf6`), `#409` (`84b2ea4`), `#411` (`d6d3f2c`), `#398` (`f231990`).

---

## 5. Plano em Tickets Pequenos (Prontos para Virar Issues)

> **Nota:** Nenhum arquivo de `.github/` nem issue nova foram criados nesta pesquisa. Os tickets abaixo são independentes e ordenados para execução incremental segura.

### Ticket 1 — `test(core,front-v2,e2e): eliminar flakes raiz da #395 (sources_delete, shell F6, boot WebDriver)`
- **Arquivos tocados:** `core/tests/sources_delete.rs`, `front-v2/e2e/shell.spec.ts`, `scripts/e2e-tauri.mjs`, `scripts/editor-montage.mjs`.
- **Escopo:**
  - Em `sources_delete.rs`, usar `kind` não consumível pelo executor (ou pausar executor) no seed de `refuses_delete_when_active_or_uncertain_job_exists_for_source`.
  - Em `front-v2/e2e/shell.spec.ts:84`, aguardar o foco pós-`F6` com `toPass()`/`waitFor`.
  - Em `scripts/e2e-tauri.mjs`, adicionar retry de boot (até 2 tentativas) apenas na chamada `remote()` quando `DevToolsActivePort` falhar no setup do `msedgedriver`.
- **Critério de aceite:** 10 execuções seguidas de `sources_delete` no Windows sem falha; 5 pushes seguidos na `master` sem falha de flake nos jobs `rust (windows-latest)` e `front-v2`.

### Ticket 2 — `ci: corrigir filtro de caminhos para incluir worker/ e restringir scripts/ e licenses`
- **Arquivos tocados:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`.
- **Escopo:**
  - Adicionar `worker/` aos filtros `rust` e `tauri` de `ci.yml` e em `release.yml` (porque `core/src/components/worker.rs` e `fake_worker.rs` usam `include_bytes!`/`include_str!`).
  - Restringir `scripts/` no filtro `tauri` para `scripts/(e2e-tauri|setup-webdriver)\.mjs`.
  - Fazer `licenses` depender de `changes` (rodando em PR apenas se lockfiles, `package.json`, `Cargo.toml`, `deny.toml`, `scripts/*license*` ou `ci.yml` mudarem; sempre na `master`).
  - Adicionar `concurrency` com `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` em `.github/workflows/linux-validation.yml`.
- **Critério de aceite:** PR alterando apenas `worker/protocol/...` dispara `rust`; PR alterando apenas `docs/` ou `front-v2/src/...` pula `licenses`; PR alterando `scripts/contraste.ts` pula `e2e`; `ci-ok` segue verde com jobs pulados.

### Ticket 3 — `ci: otimizar Swatinem/rust-cache (save-if master, shared-key) e adicionar cache + retenção no release.yml`
- **Arquivos tocados:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`.
- **Escopo:**
  - Em `ci.yml` (`rust` e `e2e`), configurar `Swatinem/rust-cache@v2` com `save-if: ${{ github.ref == 'refs/heads/master' }}`, `shared-key: "ci-${{ runner.os }}"` e `CARGO_INCREMENTAL=0`.
  - Em `release.yml`, adicionar `Swatinem/rust-cache@v2` (`prefix-key: "v0-rust-release"`, `save-if: ${{ github.ref == 'refs/heads/master' || startsWith(github.ref, 'refs/tags/') }}`) e definir `retention-days: 3` nos artefatos de `pull_request` (ou rodar `release.yml` em PR só quando arquivos de empacotamento/manifest mudarem).
- **Critério de aceite:** Uso total de cache em `gh cache list` cai para `< 4 GiB`; taxa de hit de `rust-cache` em PRs e na `master` >= 80%; artefatos de PR expiram em 3 dias (ou `release.yml` não roda em PRs comuns de código).

### Ticket 4 — `build(rust): desabilitar debuginfo em dev/test no CI e configurar linker rápido (lld-link no Windows)`
- **Arquivos tocados:** `.github/workflows/ci.yml` (ou `.cargo/config.toml` + `Cargo.toml` raiz, se aplicável localmente).
- **Escopo:**
  - Configurar `CARGO_PROFILE_TEST_DEBUG=0` (ou `"line-tables-only"`) e `CARGO_PROFILE_DEV_DEBUG=0` no CI (e avaliar `[profile.test] debug = "line-tables-only"` no `Cargo.toml` raiz para beneficiar também o disco local do dev).
  - Configurar `RUSTFLAGS="-C linker=lld-link"` nos jobs Windows (`rust` e `e2e`).
  - Se criar `.cargo/config.toml`, incluí-lo no filtro `rust`/`tauri`/`release.yml`.
- **Critério de aceite:** Build e `cargo test --workspace` passam em Ubuntu e Windows; tamanho de cada cache `v0-rust-*` cai para `< 300 MiB`; tempo de compilação+linkagem no Windows cai >= 25%.

### Ticket 5 — `test(core): pré-compilar fixtures via [[bin]] em vez de invocar rustc em runtime`
- **Arquivos tocados:** `core/Cargo.toml` e os 15 arquivos de `core/tests/` que chamam `rustc` (`transcription.rs`, `assistant.rs`, `call_audit_cli.rs`, `chat.rs`, `energy.rs`, `hardware_probe.rs`, `narration_align.rs`, `preview.rs`, `provider_cli.rs`, `provider_cli_cancel.rs`, `provider_opencode.rs`, `queue_resume.rs`, `source_batches_signals.rs`, `tts_narration.rs`, `url_import.rs`).
- **Escopo:** Registrar `fake_ffmpeg`, `fake_ffmpeg_pcm`, `fake_ytdlp`, `fake_deno`, `fake_provider_cli`, `fake_slow_cli`, `fake_opencode`, `fake_pocket_tts` como `[[bin]]` (`test = false`, `doctest = false`) em `core/Cargo.toml` e usar `env!("CARGO_BIN_EXE_...")` nos testes.
- **Critério de aceite:** `rg "rustc" core/tests/` retorna zero resultados; todos os 587+ testes passam em Ubuntu e Windows com redução de >= 45s na execução.

### Ticket 6 — `ci: migrar testes Rust para cargo nextest e instalar tauri-driver pré-compilado`
- **Arquivos tocados:** `.github/workflows/ci.yml`, `.config/nextest.toml` (novo, opcional para filtros/perfis).
- **Escopo:**
  - Instalar `cargo-nextest` via `taiki-e/install-action@v2` (`tool: nextest`) e substituir `cargo test --workspace` por `cargo nextest run --workspace` (+ `cargo test --workspace --doc` se necessário).
  - No job `e2e`, substituir `cargo install tauri-driver --locked` por `taiki-e/install-action@v2` (`tool: tauri-driver`) ou `actions/cache`.
- **Critério de aceite:** Todos os testes do workspace passam em 5 execuções seguidas sob `nextest` em Ubuntu e Windows (confirmando ausência de conflitos de porta/arquivo entre processos paralelos); `rust (ubuntu)` <= 5m30s e `rust (windows)` <= 11m.

### Ticket 7 — `ci: enxugar matriz Windows de front/worker na master e refinar gatilho E2E Tauri em PR`
- **Arquivos tocados:** `.github/workflows/ci.yml` (e opcional `.github/workflows/nightly.yml`).
- **Escopo:**
  - Na `master`, rodar `front-v1`, `front-v2` e `worker` apenas no `ubuntu-latest` (mantendo `windows-latest` em `rust` e `e2e`, e movendo testes Windows de `front-v1`/`front-v2`/`worker` para um workflow agendado diário se desejado).
  - Avaliar restringir `tauri` (`e2e`) em PRs para mudanças em `src-tauri/`, `src/`, `core/src/lib.rs`, `core/Cargo.toml`, `scripts/e2e-tauri*`, `scripts/setup-webdriver*`, mantendo `e2e` completo em toda entrada na `master`.
- **Critério de aceite:** Fila p90 de jobs em ondas cai para `< 3 min`; PRs internos de `core/` completam em `< 8 min` e pushes na `master` em `< 12 min`.

### Ticket 8 — `refactor(core): consolidar integration tests de core/tests/*.rs em crate/binário unificado (opcional / fase 2)`
- **Arquivos tocados:** `core/tests/`.
- **Escopo:** Agrupar os 107 arquivos `core/tests/*.rs` em `core/tests/integration/main.rs` (ou 2–3 grupos por domínio) mantendo os mesmos módulos e funções `#[test]`.
- **Critério de aceite:** Exatamente o mesmo conjunto de testes descobertos e aprovados via `cargo nextest list` antes e depois; tempo de linkagem cai para < 30s com 1 único binário/PDB.
