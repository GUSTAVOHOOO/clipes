# Testes ponta a ponta (E2E) no Tauri

O repositório mantém duas suítes complementares de interface. Consulte o [glossário](../../GLOSSARY.md), o [ADR-0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md) e [CONTRIBUTING.md](../../CONTRIBUTING.md) para os contratos gerais do aplicativo.

## Diferença entre `bun run test:ui` e `bun run test:e2e`

| Aspecto | `bun run test:ui` ([`scripts/ui.mjs`](../../scripts/ui.mjs)) | `bun run test:e2e` ([`scripts/e2e-tauri.mjs`](../../scripts/e2e-tauri.mjs)) |
| --- | --- | --- |
| Alvo | Servidor Vite no navegador com `VITE_CORE_MOCK=1` e `VITE_UPDATER_MOCK=available` | Binário desktop nativo Tauri v2 (`target/debug/clipes` / `clipes.exe`) compilado com `VITE_E2E=1` |
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

> **Limitação no CI (`windows-latest`, [#282](https://github.com/GUSTAVOHOOO/clipes/issues/282)):** no GitHub Actions, o runner `windows-latest` executa os passos como administrador elevado (`runneradmin`), e a partir do WebView2 Runtime v150+ processos elevados ignoram variáveis `WEBVIEW2_*` (incluindo `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` usada pelo `tauri-driver`). Por isso, no CI o job `e2e` em [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) roda apenas em `ubuntu-latest`, enquanto no Windows a suíte E2E é executada localmente com usuário padrão (não elevado).

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

`VITE_CORE_MOCK` e `VITE_UPDATER_MOCK` são removidas do ambiente de compilação. O comando roda `tsc --noEmit && vite build`, embute `dist/` no executável `target/debug/clipes` (ou `clipes.exe`), evita empacotar instaladores (`--no-bundle`) e preserva `debug_assertions` ativo em Rust (`--debug`).

Na conexão WebDriver, o script inicia `tauri-driver` em portas locais livres (`--port` e `--native-port`) e conecta via `remote()` do `webdriverio` com `browserName: 'wry'` e `'wdio:enforceWebDriverClassic': true` (necessário porque `tauri-driver` e `WebKitWebDriver` falam WebDriver clássico, não BiDi).

### 2. Fronteira nativa da UI (`src/lib/desktop.ts`)

No Tauri v2, `window.__TAURI_INTERNALS__.invoke` é definida como não gravável e não configurável, de modo que não deve ser sobrescrita na WebView. Além disso, diálogos nativos do sistema (`@tauri-apps/plugin-dialog`), abertura de links externos (`@tauri-apps/plugin-opener`), escrita na área de transferência (`@tauri-apps/plugin-clipboard-manager`), `window.confirm` nativo e a verificação automática do updater no boot (`@tauri-apps/plugin-updater`) bloqueariam a execução automatizada ou alterariam o estado da máquina hospedeira.

[`src/lib/desktop.ts`](../../src/lib/desktop.ts) (tipado em [`src/vite-env.d.ts`](../../src/vite-env.d.ts)) centraliza seis funções de fronteira: `openDialog`, `saveDialog`, `openExternalUrl`, `copyText`, `confirmAction` e `getUpdaterBehavior` (`shouldMockUpdater`).

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

## Mapa das Sessões 1 e 2 e capturas

A execução roda duas sessões consecutivas do aplicativo sobre o mesmo `CLIPES_DATA_DIR`, gravando dez capturas em `shots-e2e/`:

### Sessão 1 — Primeira execução, Casca, Sobre, Componentes, Relatos e Preferências

1. **Assistente de primeira execução** (`01-assistant.png`): abre automaticamente com `CLIPES_DATA_DIR` vazio, detecta `Codex CLI`, `Claude Code CLI` e `OpenCode CLI` no `PATH`, exercita o cancelamento e a confirmação do aviso de envio do Codex CLI e conclui.
2. **Casca, atualização e Sobre** (`02-palette.png`, `03-about.png`): ativa o fluxo simulado de atualização via `sessionStorage` (`clipes.e2e.updaterMode = 'available'`), instala e fecha o aviso; abre a Paleta de comandos (`Ctrl+K`) para ir a `Sobre` (versão `0.1.0` e `Apache-2.0`); abre e fecha as gavetas esquerda (`[`, conferindo foco preso com `Tab`) e direita (`]`) com `Escape`.
3. **Componentes** (`04-components.png`): verifica licenças do manifesto (`GPL-3.0-or-later`, `Unlicense`) e estado do `yt-dlp`, cancela confirmação de download, abre/cancela atualização do `yt-dlp`, valida e registra o `ffmpeg` do sistema, salva novo limite de cache (`12` GB), instala o Worker de ML (`Protocolo 1`, `faster-whisper fake`) e confere habilitação e diálogo de download de modelos.
4. **Relatos e diagnóstico** (`05-report.png`): alterna entre `Sugerir ideia` e `Relatar problema`, valida o aviso de possível segredo ao digitar `"chave"`, revisa o diagnóstico real (`Clipes: 0.1.0`, `FFmpeg do sistema`), exporta `diagnostico-clipes.txt` conferindo os bytes em disco e testa `Abrir no GitHub` abaixo de 8 KB (parâmetros `template=bug.yml` e `body`) e acima de 8 KB (9.000 caracteres copiados para a área de transferência interceptada e URL truncada).
5. **Preferências** (`06-preferences-light.png`, `07-tasks-costs.png`): salva e remove chave Groq validando `vault.json`; alterna tema (`claro`) e idioma (`en`); testa consentimento remoto (`192.0.2.10`) com trap de foco e recusa de chave em HTTP sem TLS; estima custos em `Costs` (incluindo faixa acima de 272.000 tokens de entrada e sobrescrita/remoção de preço); valida conexão real com o servidor HTTP local (`Bearer sk-local-server-1234`); ativa e testa `OpenCode CLI` (sucesso e cota gratuita esgotada) e desativa; retorna a `pt-BR` e tema `escuro`, cria Perfis de Provedor (`Local rápido` com chave própria `…9999` ausente do HTML e `Nuvem remota`), configura rotas e veto **Somente local** por tarefa, remove perfil conferindo o alerta de perfil ausente e reabre/pula o Assistente.

### Sessão 2 — Persistência pós-reinício, Projetos, Fontes, Transcrição e Backups

1. **Persistência e Projetos**: reabre o binário no mesmo `CLIPES_DATA_DIR` confirmando que o Assistente não reabre; cria `Canal.clipes` (conferindo `project.sqlite` em disco) e `Secundario.clipes`, e alterna de volta para `Canal.clipes` pela lista de recentes.
2. **Veto "Somente local" do Projeto**: ativa **Somente local** no Projeto, verifica o aviso na tabela `Tarefas` em `Preferências` e desativa.
3. **Fontes locais e por URL** (`08-project-sources.png`): importa `source.mkv` selecionando a segunda faixa de áudio e **Permissão** concedida (`Criadora Oficial`, `Contrato assinado`, `Cortes e tradução`); aguarda o job `Onda e miniaturas` concluir e verifica `cache/previews/`; altera o `mtime` do arquivo para exercitar `Fonte alterada` → `Verificar identidade`; renomeia para `source-moved.mkv` para exercitar `Fonte offline` → `Relocalizar`; troca a pasta de download, aceita o `Aviso sobre os Termos` e importa `video123.mp4` sem permissão via `fake-ytdlp` + `ffprobe`.
4. **Transcrição e Timeline** (`09-transcription-timeline.png`): com `worker.hold` em `after-first`, inicia a Transcrição local, aguarda `33%` e cancela (`Transcrição interrompida · 33%`); seleciona o Motor `Groq` para verificar estimativa de custo e os diálogos `Apagar Transcrição parcial?` e `Enviar áudio ao Groq?` (cancelando antes do envio); volta ao Motor `local`, remove `worker.hold`, retoma até `Transcrição pronta` e verifica palavras, `Silêncio` e idioma `pt` na timeline.
5. **Backups** (`10-backups.png`): salva intervalo (`15` min) e cópias mantidas (`5`), cria backup manual, liga **Somente local** no Projeto e restaura o backup anterior confirmando a cópia `Antes da restauração` e a reversão de **Somente local** para desligado no `project.sqlite`.

## Flags e variáveis de ambiente suportadas

| Flag / variável | Script | Efeito |
| --- | --- | --- |
| `--install-tauri-driver` | `scripts/setup-webdriver.mjs` | Instala `tauri-driver` via `cargo install tauri-driver --locked` quando ausente (ex.: `bun run e2e:setup -- --install-tauri-driver`). |
| `--skip-build` ou `CLIPES_E2E_SKIP_BUILD=1` | `scripts/e2e-tauri.mjs` | Pula a recompilação se `target/debug/clipes(.exe)` e `target/debug/fake-worker(.exe)` já existirem (ex.: `bun run test:e2e -- --skip-build`). |
| `TAURI_DRIVER_BIN` | ambos | Caminho explícito para o executável `tauri-driver`. |
| `MSEDGEDRIVER_BIN` | ambos (Windows) | Caminho explícito para `msedgedriver.exe`, pulando a leitura do registro do WebView2 e o download em `%TEMP%\clipes-webdriver`. |
| `WEBKIT_WEBDRIVER_BIN` | ambos (Linux) | Caminho explícito para `WebKitWebDriver`. |

## Onde ficam as capturas e como depurar falhas

- **Capturas (`shots-e2e/`)**: gravadas na raiz do repositório (`01-assistant.png` a `10-backups.png`) à medida que cada etapa avança. Ao investigar uma falha, inspecione a última imagem atualizada para ver o estado da janela antes do erro.
- **Mensagens de espera e texto visível**: cada etapa imprime `[e2e] ...` no console. Quando `waitForText` expira, o erro inclui o seletor avaliado e os primeiros 500 caracteres do texto visível naquele escopo (`Texto atual: ...`). Quando `tagElement` ou `waitForDialog` expira, a mensagem detalha o controle ou título esperado.
- **Erros da WebView e logs do `tauri-driver`**: exceções não tratadas (`error` e `unhandledrejection`) são acumuladas em `window.__e2eErrors` e aferidas ao final de cada sessão. Se qualquer comando da sessão falhar, o script imprime as últimas 20 saídas de `stdout`/`stderr` do `tauri-driver` (`[e2e] Logs recentes do tauri-driver:`).
- **Reexecução rápida durante ajustes no teste**: quando apenas `scripts/e2e-tauri.mjs` mudou (sem alterações em `src/`, `src-tauri/` ou `core/`), use `bun run test:e2e -- --skip-build` para evitar nova compilação do Tauri. Se mudar `src/` ou `core/`, rode sem `--skip-build` para atualizar o bundle embutido no binário.
- **Limpeza e problemas conhecidos**: o bloco `finally` encerra a árvore de processos (`taskkill /PID <pid> /T /F` no Windows; `SIGKILL` no grupo de processos no Linux) e remove `<tempRoot>`. Se o processo Node for encerrado abruptamente por fora, confira se não restaram processos `tauri-driver`, `msedgedriver`/`WebKitWebDriver`, `clipes` ou pastas `clipes-e2e-*` no diretório temporário, e consulte [Impedimentos conhecidos](../agents/impedimentos.md).
