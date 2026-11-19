# Testes ponta a ponta (E2E) no Tauri

O repositório mantém duas suítes complementares de interface. Consulte o [glossário](../../GLOSSARY.md), o [ADR-0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md) e [CONTRIBUTING.md](../../CONTRIBUTING.md) para os contratos gerais do aplicativo.

## Diferença entre `bun run test:ui` e `bun run test:e2e`

| Aspecto | `bun run test:ui` ([`scripts/ui.mjs`](../../scripts/ui.mjs)) | `bun run test:e2e` ([`scripts/e2e-tauri.mjs`](../../scripts/e2e-tauri.mjs)) |
| --- | --- | --- |
| Alvo | Servidor Vite no navegador com `VITE_CORE_MOCK=1` e `VITE_UPDATER_MOCK=available` | Binário desktop nativo Tauri v2 (`target/debug/clipes` / `clipes.exe`) com o front v2 embutido, compilado com `VITE_E2E=1` |
| Motor / driver | Playwright + Chromium | `tauri-driver` + driver nativo da WebView + WebdriverIO (`remote()`, `browserName: 'wry'`) |
| Núcleo (`clipes-core`) | Simulado em TypeScript na camada de UI | Real em Rust via IPC do Tauri (`core_dispatch`), SQLite (`project.sqlite`), fila de jobs e subprocessos |
| Capturas de tela | `shots/` | `shots-e2e/` (ignorado no `.gitignore`) |
| Quando usar | Iteração rápida de layout, foco/teclado, temas, tradução (`pt-BR`/`en`) e estados simulados por query string | Validar integração real entre WebView nativa, IPC Tauri, persistência em disco, `ffmpeg`/`ffprobe` e cofre isolado |

`bun run test:ui` não compila Rust e cobre rapidamente variações visuais e de estado; `bun run test:e2e` garante que os fluxos funcionam no executável real sem mocks de `core_dispatch`.

## Pré-requisitos

Em ambos os sistemas suportados são necessários:

- Rust estável (`cargo` e `rustc`), Bun, Node.js, `ffmpeg` e `ffprobe` disponíveis no `PATH` (no Windows, `%USERPROFILE%\.cargo\bin` também é procurado automaticamente pelos scripts).
- Dependências JavaScript instaladas com `bun install`.
- `tauri-driver` instalado via Cargo:

```sh
cargo install tauri-driver --locked
```

> No macOS (`darwin`), `tauri-driver` não é suportado porque o `WKWebView` não expõe WebDriver nativo; [`scripts/setup-webdriver.mjs`](../../scripts/setup-webdriver.mjs) recusa a execução nessa plataforma.

### Windows

1. Tenha o **Microsoft Edge WebView2 Runtime** instalado (client ID `{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`).
2. Instale o `tauri-driver` (se `%USERPROFILE%\.cargo\bin` não estiver no `PATH` do PowerShell):
   ```powershell
   & "$env:USERPROFILE\.cargo\bin\cargo.exe" install tauri-driver --locked
   ```
3. Prepare e valide os drivers:
   ```powershell
   bun run e2e:setup
   ```

O Tauri usa o **WebView2 Runtime**, cuja versão (`pv` nas chaves `EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` do registro) frequentemente difere da versão do navegador Microsoft Edge instalado. `bun run e2e:setup` lê essa versão no registro, baixa o pacote oficial correspondente (`edgedriver_win64.zip`, `edgedriver_arm64.zip` ou `edgedriver_win32.zip`) e extrai `msedgedriver.exe` em `%TEMP%\clipes-webdriver\<versao>\msedgedriver.exe`, reutilizando o cache nas execuções seguintes. Se a versão exata responder HTTP 404, o script consulta `LATEST_RELEASE_<major>_WINDOWS` (decodificando UTF-16LE com BOM quando presente) como fallback.

Para executar a suíte completa no Windows:

```powershell
bun run test:e2e
```

> **Execução no CI (`windows-latest`, [#282](https://github.com/GUSTAVOHOOO/clipes/issues/282)):** no GitHub Actions, o runner `windows-latest` executa os passos como administrador elevado (`runneradmin`), e a partir do WebView2 Runtime v150+ processos elevados ignoram variáveis `WEBVIEW2_*` (incluindo `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` usada pelo `msedgedriver` sob o `tauri-driver`). Para que o job `e2e` em [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) rode também em `windows-latest`, um step exclusivo do Windows configura a política de máquina `HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments` (`clipes.exe` = `--remote-debugging-port=0`), que continua sendo honrada em processos elevados. Localmente, execute a suíte E2E com usuário padrão (não elevado) para evitar alterar políticas do registro da máquina.

### Linux (Ubuntu/Debian e CI)

1. Além dos pacotes de compilação do Tauri, instale `webkit2gtk-driver`, `xvfb` e `ffmpeg`:
   ```sh
   sudo apt-get update && sudo apt-get install -y \
     libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
     webkit2gtk-driver xvfb ffmpeg
   ```
2. Instale `tauri-driver` (`cargo install tauri-driver --locked`) e verifique o ambiente com `bun run e2e:setup` (procura `WebKitWebDriver` em `/usr/bin`, `/usr/local/bin` e `PATH`).
3. Em ambientes sem servidor gráfico físico (como o job `e2e` em [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)), rode sob `xvfb-run` desativando o renderizador DMA-BUF e o modo de composição do WebKitGTK:
   ```sh
   xvfb-run -a env WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 bun run test:e2e
   ```

## Como a suíte funciona

### 1. Build de depuração com `VITE_E2E=1`

[`scripts/e2e-tauri.mjs`](../../scripts/e2e-tauri.mjs) compila o aplicativo com:

```sh
VITE_E2E=1 bun run tauri build --debug --no-bundle
```

`VITE_CORE_MOCK` e `VITE_UPDATER_MOCK` são removidas do ambiente de compilação. O comando roda `tsc --noEmit && vite build`, embute `front-v2/dist/` no executável `target/debug/clipes` (ou `clipes.exe`), evita empacotar instaladores (`--no-bundle`) e preserva `debug_assertions` ativo em Rust (`--debug`).

Na conexão WebDriver, o script inicia `tauri-driver` em portas locais livres (`--port` e `--native-port`) e conecta via `remote()` do `webdriverio` com `browserName: 'wry'` e `'wdio:enforceWebDriverClassic': true` (necessário porque `tauri-driver` e `WebKitWebDriver` falam WebDriver clássico, não BiDi).

### 2. Fronteira nativa da UI (`front-v2/src/core/desktop.ts`)

No Tauri v2, `window.__TAURI_INTERNALS__.invoke` é definida como não gravável e não configurável, de modo que não deve ser sobrescrita na WebView. Além disso, diálogos nativos do sistema (`@tauri-apps/plugin-dialog`), abertura de links externos (`@tauri-apps/plugin-opener`), escrita na área de transferência (`@tauri-apps/plugin-clipboard-manager`), `window.confirm` nativo e a verificação automática do updater no boot (`@tauri-apps/plugin-updater`) bloqueariam a execução automatizada ou alterariam o estado da máquina hospedeira.

[`front-v2/src/core/desktop.ts`](../../front-v2/src/core/desktop.ts) centraliza as funções de fronteira (`selecionarArquivoDialogo`/`salvarDialogo`, `abrirUrlExterna`, `abrirNoSistema`, `copiarTexto`, `notificarSistema`, `relaunchApp` e `getUpdaterBehavior`). `garantirEstadoE2E()` é chamado em `front-v2/src/main.tsx` quando `VITE_E2E=1`, antes de montar a árvore React.

- Quando `import.meta.env.VITE_E2E === '1'`, o módulo inicializa `window.__CLIPES_E2E__` com `dialogQueue`, `dialogCalls`, `confirmQueue`, `confirmCalls`, `openedUrls`, `copiedText` e `updaterMode` (lido de `sessionStorage.getItem('clipes.e2e.updaterMode')`, padrão `'off'`). O teste enfileira caminhos **reais** dentro do diretório temporário (por exemplo, a pasta pai do Projeto, o vídeo `.mkv` ou o arquivo `diagnostico-clipes.txt`) e aciona os botões reais da UI; o caminho selecionado segue normalmente por `core_dispatch` até o `clipes-core` e o `project.sqlite`.
- Em builds de produção (`VITE_E2E` ausente), `import.meta.env.VITE_E2E === '1'` avalia estaticamente para `false` e todo o código de `__CLIPES_E2E__` é removido por tree-shaking no bundle final.

### 3. Isolamento de dados e de cofre (`CLIPES_DATA_DIR` e `CLIPES_TEST_VAULT_FILE`)

Cada execução cria uma árvore temporária `clipes-e2e-*` no diretório temporário do sistema e a apaga no bloco `finally`:

- **`CLIPES_DATA_DIR`** (`<tempRoot>/data`): isola todos os arquivos globais do núcleo (`projects.json`, `assistant.json`, `provider.json`, `provider-cli.json`, `provider-prices.json`, `token-calibration.json`, `component-settings.json`, `url-import.json`, `transcription-consent.json`, `diagnostic.log`), além de `components/`, `models/` e `cache/previews/`.
- **`CLIPES_TEST_VAULT_FILE`** (`<tempRoot>/vault.json`): implementado em [`core/src/vault.rs`](../../core/src/vault.rs) **estritamente sob `#[cfg(debug_assertions)]`**. Quando a variável está definida num binário de depuração, `vault::get`, `vault::set` e `vault::remove` (usados por Provedores e pela chave Groq) gravam pares `<service>:<account>` num arquivo JSON atômico em vez de acessar o Windows Credential Manager ou o Secret Service do Linux. Em builds de release (`#[cfg(not(debug_assertions))]`), o módulo `file_vault` não é compilado e apenas `keyring::Entry` existe.

### 4. Binários auxiliares, servidor HTTP local e mídia sintética

A suíte não faz downloads externos nem chamadas pagas durante os testes:

- **`fake-worker`** ([`core/tests/support/fake_worker.rs`](../../core/tests/support/fake_worker.rs), compilado por `cargo build -p clipes-core --bin fake-worker`): copiado para `<CLIPES_DATA_DIR>/components/uv` (ou `uv.exe`) junto de `uv.version` (`0.13.8`). Quando invocado como `uv`, simula `uv --version` e `uv sync`, copiando a si mesmo para o Python do ambiente virtual do worker. Quando invocado como worker Python, responde ao handshake JSONL v1 na Sessão 1 e, na Sessão 2 (`CLIPES_FAKE_WORKER_MODE=transcribe`), calcula a duração real dos blocos WAV RIFF extraídos pelo `ffmpeg`, emite palavras e silêncios sintéticos e respeita o arquivo de retenção `CLIPES_FAKE_WORKER_HOLD` (incluindo o valor `after-first` para segurar a partir do segundo bloco e exercitar cancelamento e retomada). Entre as sessões 1 e 2, o script também grava `model.state.json` para `whisper-turbo` e `whisper-small` em `<CLIPES_DATA_DIR>/models/`.
- **`fake_ytdlp`** ([`core/tests/fixtures/fake_ytdlp.rs`](../../core/tests/fixtures/fake_ytdlp.rs)): compilado com `rustc` para `<CLIPES_DATA_DIR>/components/yt-dlp` (ou `.exe`) com `yt-dlp.state.json` (versão `2027.01.01.000000` e SHA-256 correspondente). Recebe `CLIPES_FAKE_YTDLP_MEDIA` apontando para `url-fixture.mp4`, copiando um arquivo `.mp4` válido para a pasta de downloads para que o `ffprobe` real o inspecione.
- **`fake_provider_cli`** ([`core/tests/fixtures/fake_provider_cli.rs`](../../core/tests/fixtures/fake_provider_cli.rs)): compilado com `rustc` em `<tempRoot>/cli-bin/` como `codex` e `claude` (no `PATH` do `tauri-driver`), registrando invocações em `FAKE_LOG`.
- **`fake_opencode`** ([`core/tests/fixtures/fake_opencode.rs`](../../core/tests/fixtures/fake_opencode.rs)): compilado em `<tempRoot>/cli-bin/opencode`, simulando `opencode v2.2.7`, eventos JSONL estruturados e o erro `provider.free-limit` quando `<cliBinDir>/mode` contém `free-limit`.
- **Servidor HTTP fake local e endereço remoto de teste**: `startFakeProviderServer()` abre um servidor `node:http` em `127.0.0.1:<porta>/v1` que lê o corpo inteiro da requisição antes de responder JSON compatível com OpenAI e armazena os cabeçalhos `Authorization` recebidos. Para testar consentimento remoto, exigência de HTTPS e bloqueios de **Somente local** sem tráfego externo, os testes usam o IP reservado de documentação `192.0.2.10` (`http://192.0.2.10/v1` e `https://192.0.2.10/v1`).
- **Mídia sintética (`ffmpeg`)**: `prepareFixtures` gera `source.mkv` (3 s, `64x64`, vídeo `mpeg4` e duas faixas de áudio `pcm_s16le` em 440 Hz e 880 Hz) e `url-fixture.mp4` (2 s, `64x64`, vídeo `mpeg4` e áudio `aac`). A sessão define `CLIPES_TRANSCRIBE_BLOCK_SECONDS=2` para fatiar o áudio de 3 s em mais de um bloco.

## Mapa das Sessões 1, 2 e 3 e capturas

O e2e roda no **front v2** (`front-v2/`, rotas por hash). A execução roda três sessões consecutivas do aplicativo sobre o mesmo `CLIPES_DATA_DIR`, gravando 16 capturas em `shots-e2e/`. `CLIPES_E2E_SESSIONS` (lista separada por vírgula, padrão `1,2,3`) escolhe as sessões, por exemplo `CLIPES_E2E_SESSIONS=3 bun run test:e2e`.

Os helpers de `createUi` falam com os componentes Base UI do front v2: o nome acessível ignora `kbd` e `svg`; `clickButton` também acha `tab`, `radio`, `menuitem`, `summary` e `a[href]` e cai para `click()` programático quando um toast cobre o botão (os toasts são `role="dialog"` com `aria-modal=false`); `selectField` aceita `<select>` nativo ou combobox (abre o gatilho e escolhe o `[role=option]` pelo texto); `setChecked`/`isChecked` leem `aria-checked` de `role=switch|checkbox`; `navigateHash`, `waitForHash` e `reloadApp(hash, textoPronto)` navegam pelas rotas `#/...`. A janela abre em 1366×768.

### Sessão 1 — Assistente, Paleta, Componentes, Relatos, Provedores e Aparência

1. **Assistente** (`01-assistant.png`): abre em `#/assistente?passo=1` com `CLIPES_DATA_DIR` vazio, usa o FFmpeg do sistema e detecta o Codex CLI; o consentimento é um checkbox ("Concordo em enviar apenas texto…"), e o `ConfirmDialog` de consentimento do Codex só existe em Provedores.
2. **Paleta e atualização** (`02-palette.png`, `03-about.png`): `Ctrl+K` abre a Paleta e vai a `Sobre` (versão lida de `src-tauri/tauri.conf.json`); o updater mockado (`clipes.e2e.updaterMode = 'available'`) vai de `Verificar atualizações` a `Baixar e instalar`; `Ctrl+J`/`Esc` na Fila e `F6` entre regiões.
3. **Componentes** (`04-components.png`): diálogos de licença do FFmpeg e do yt-dlp, instalação do Worker de ML, download de modelo e limite de cache (10 → 12 GB, persistido ao navegar).
4. **Relatos** (`05-report.png`): fluxo de 2 passos (ADR-0006: nenhuma ação de envio no passo 1), aviso de possível segredo, diagnóstico real com a versão do app, exportação `.txt` conferida em disco e `Abrir no GitHub` abaixo e acima de 8000 bytes.
5. **Provedores e Aparência** (`06-preferences-light.png`, `07-tasks-costs.png`): chave Groq no cofre isolado, Perfis `Local rápido` (chave própria) e `Nuvem remota`, roteamento por Tarefa, **Somente local**, remoção de Perfil, tema claro/escuro, Alto Contraste, reabrir e pular o Assistente.

### Sessão 2 — Persistência pós-reinício, Projetos, Fontes, Transcrição e Backups

1. **Persistência e Projetos**: o Assistente não reabre e o tema escuro persiste; cria `Canal.clipes` e `Secundario.clipes` (conferindo `project.sqlite`) e abre um Projeto recente.
2. **Veto Somente local**: o selo no topo e o bloqueio em Provedores aparecem e somem ao desligar.
3. **Fontes** (`08-project-sources.png`): importa `source.mkv` (2 faixas de áudio, Permissão), confere o cache de prévia, exercita `Fonte alterada` e `Fonte offline` (`reloadApp`, verificar e relocalizar), importa por URL com `fake-ytdlp` (Termos, trocar pasta).
4. **Transcrição** (`09-transcription-timeline.png`): Transcrição local com `worker.hold`, cancelar mantendo os blocos (`Transcrevendo bloco 1 de 1 33%`) e retomar.
5. **Backups** (`10-backups.png`): configuração, backup manual e restauração que reverte **Somente local**.

### Sessão 3 — Fluxo do mandato: Projeto V1 → revisar → editar → exportar

`prepareV1ProjectFixture` monta `<tempRoot>/projects/ProjetoV1.clipes/project.sqlite` a partir de `core/tests/fixtures/project-pre-0104.sqlite` (esquema V1, com migrações pendentes), com `node:sqlite`, e gera `v1-source.mp4` (1280×720, 30 s, H.264 + AAC 48 kHz). A Fonte é gravada com o hash parcial e o `mtime` reais (a mesma conta de `core/src/sources.rs::partial`), senão o app a trataria como alterada, e com Permissão `granted`.

As tabelas de Transcrição e de seleção vêm de migrações Rust posteriores ao banco V1 e só existem depois que o app abre o Projeto. Por isso `seedV1Selection` roda logo após a abertura: 4 Frases de 7,5 s, uma execução de seleção V1 (`revision = 1`, `video_kind = 'direct'`, `state = 'completed'`) e 2 candidatos pendentes, e o app é recarregado.

1. **Abrir o Projeto V1** (`s3-01-projeto-v1-fontes.png`): `Abrir pasta .clipes` em `#/inicio`, `project.pre-migration.sqlite` no disco e a Fonte `v1-source.mp4` em `#/projeto/:id/fontes`.
2. **Revisar** (`s3-02-cortes-v1.png`, `s3-03-revisao-aprovada.png`): `Abrir bancada de revisão`, conversão individual (#292) desabilitada em Corte direto, `±1 Frase` na borda final, `Aprovar`.
3. **Editar** (`s3-04-editor.png`): `Abrir no editor`, `Ctrl+S` e o estado `Salvo`.
4. **Exportar** (`s3-05-exportado.png`): `Exportar Corte`, destino `corte-v1-exportado.mp4` por `queueDialog`, `Iniciar exportação` e MP4 conferido com `ffprobe` (`h264` 1080×1920, `aac` 48000 Hz). Depois `#/projeto/:id/exportacao` (`s3-06-exportacao.png`).
5. **Fechamento (#291)**: `window.close()` sem jobs ativos.

### O que ficou fora da migração e por quê

Nada foi desligado: os itens abaixo são cobertura do e2e V1 que o front v2 ainda não oferece (ou que já é coberta por outra suíte) e seguem testados em `front-v2/e2e/*.spec.ts`, nos testes de componente e nos testes do core.

- Gavetas `[` e `]`: não existem no front v2.
- Sessão 1: teste de conexão HTTP remota com consentimento e exigência de TLS (`192.0.2.10`), CLI OpenCode (sucesso e `free-limit`), Custos (estimador e sobrescrita de preço; exigem Projeto aberto), idioma `en` (o front v2 só tem `pt`).
- Sessão 2: troca de Motor para Groq com `Apagar Transcrição parcial?` e consentimento de áudio; correção de palavra com `F2` na Transcrição.
- O Projeto V1 da Sessão 3 recebe o seed de Transcrição e seleção depois da migração (veja acima); não há fixture V1 completa com todas as tabelas.

### Achados de ambiente

- O `fake-ytdlp` emite só `42%` e nunca `100%`: o job "Baixando Fonte" fica `rodando` no store do front até recarregar a WebView, o que bloqueia `Restaurar backup` (guarda `jobsAtivos`). O e2e usa `reloadApp` antes dos backups. No produto real o yt-dlp emite 100%.
- Quando um passo falha, o script salva `shots-e2e/falha-ultima.png` e imprime o `hash` atual e o texto visível.

## Flags e variáveis de ambiente suportadas

| Flag / variável | Script | Efeito |
| --- | --- | --- |
| `--install-tauri-driver` | `scripts/setup-webdriver.mjs` | Instala `tauri-driver` via `cargo install tauri-driver --locked` quando ausente (ex.: `bun run e2e:setup -- --install-tauri-driver`). |
| `--skip-build` ou `CLIPES_E2E_SKIP_BUILD=1` | `scripts/e2e-tauri.mjs` | Pula a recompilação se `target/debug/clipes(.exe)` e `target/debug/fake-worker(.exe)` já existirem (ex.: `bun run test:e2e -- --skip-build`). |
| `CLIPES_E2E_SESSIONS` | `scripts/e2e-tauri.mjs` | Sessões a rodar, separadas por vírgula (padrão `1,2,3`; ex.: `CLIPES_E2E_SESSIONS=3`). A Sessão 2 depende do estado da 1 (Assistente concluído); a 3 é independente. |
| `TAURI_DRIVER_BIN` | ambos | Caminho explícito para o executável `tauri-driver`. |
| `MSEDGEDRIVER_BIN` | ambos (Windows) | Caminho explícito para `msedgedriver.exe`, pulando a leitura do registro do WebView2 e o download em `%TEMP%\clipes-webdriver`. |
| `WEBKIT_WEBDRIVER_BIN` | ambos (Linux) | Caminho explícito para `WebKitWebDriver`. |

## Onde ficam as capturas e como depurar falhas

- **Capturas (`shots-e2e/`)**: gravadas na raiz do repositório (`01-assistant.png` a `10-backups.png` e `s3-01-…` a `s3-06-…`) à medida que cada etapa avança; numa falha, `falha-ultima.png` guarda o estado da janela, e o console imprime o `hash` e o texto visível. Ao investigar uma falha, inspecione a última imagem atualizada para ver o estado da janela antes do erro.
- **Mensagens de espera e texto visível**: cada etapa imprime `[e2e] ...` no console. Quando `waitForText` expira, o erro inclui o seletor avaliado e os primeiros 500 caracteres do texto visível naquele escopo (`Texto atual: ...`). Quando `tagElement` ou `waitForDialog` expira, a mensagem detalha o controle ou título esperado.
- **Erros da WebView e logs do `tauri-driver`**: exceções não tratadas (`error` e `unhandledrejection`) são acumuladas em `window.__e2eErrors` e aferidas ao final de cada sessão. Se qualquer comando da sessão falhar, o script imprime as últimas 20 saídas de `stdout`/`stderr` do `tauri-driver` (`[e2e] Logs recentes do tauri-driver:`).
- **Reexecução rápida durante ajustes no teste**: quando apenas `scripts/e2e-tauri.mjs` mudou (sem alterações em `src/`, `src-tauri/` ou `core/`), use `bun run test:e2e -- --skip-build` para evitar nova compilação do Tauri. Se mudar `src/` ou `core/`, rode sem `--skip-build` para atualizar o bundle embutido no binário.
- **Limpeza e problemas conhecidos**: o bloco `finally` encerra a árvore de processos (`taskkill /PID <pid> /T /F` no Windows; `SIGKILL` no grupo de processos no Linux) e remove `<tempRoot>`. Se o processo Node for encerrado abruptamente por fora, confira se não restaram processos `tauri-driver`, `msedgedriver`/`WebKitWebDriver`, `clipes` ou pastas `clipes-e2e-*` no diretório temporário, e consulte [Impedimentos conhecidos](../agents/impedimentos.md).
