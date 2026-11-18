# Impedimentos conhecidos

Problemas que já travaram agentes neste repo e o que fazer quando aparecerem.
Formato: **sintoma → causa → ação**. Acrescente uma entrada quando resolver um impedimento novo.

## Agentes e orquestração (Orca + Codex)

### Codex recusa o modelo
- **Sintoma:** `The 'gpt-6.1' model is not supported when using Codex with a ChatGPT account.`
- **Causa:** a conta ChatGPT só aceita ids com faixa.
- **Ação:** use `gpt-6.1-sol` (ticket difícil), `gpt-6.1-terra` (comum) ou `gpt-6-luna` (simples). Se um worker falhar 2x, suba uma faixa.

### Worker não sobe: `agent_readiness: agent-update-prompt`
- **Sintoma:** `worker-start` (ou `send` que reabre um worker) falha; o terminal mostra `Update available` do Codex.
- **Causa:** o Codex pergunta se deve se atualizar e espera tecla.
- **Ação:** libere a sessão (`orca orchestration worker-release --dispatch <id>`), atualize o Codex quando nenhum worker Codex estiver rodando e tente de novo. Não responda o prompt pelo terminal do worker.

### Nome da branch do worktree
- **Sintoma:** o worktree criado por `--name ticket-<n>` está na branch `GUSTAVOHOOO/ticket-<n>`, não `ticket-<n>`.
- **Ação:** use a branch já criada; não crie outra.

### Worker não consegue limpar o que abriu
- **Sintoma:** a revisão automática do worker bloqueia `Stop-Process`, apagar arquivos temporários ou abrir o Chrome.
- **Ação:** o worker pede ao coordenador via `ask` com PIDs e caminhos exatos; o coordenador confere o comando de cada processo antes de encerrar e apaga os arquivos.

### Decisão que não está no ticket nem nos ADRs
- **Ação:** o worker pergunta via `ask`; o coordenador leva ao dev e não decide sozinho. A resposta vira registro no PR (ADR curto ou seção de doc).
- **Já decidido:** o seam do núcleo usa um crate Rust sem Tauri, registro de comandos por módulo com `inventory`, despacho único (nome + JSON) para UI e harness, `ProgressEvent` tipado e `core::process::spawn` sem shell (PR #86). O identificador do app é `io.github.gustavohooo.clipes`.

## Git e GitHub

### DCO obrigatório
- O app DCO está instalado: todo commit precisa de `Signed-off-by`. Use `git commit -s`; para corrigir o último commit ainda não publicado, `git commit --amend -s`.

### Servidor HTTP falso falha no Windows
- **Sintoma:** teste de Provedor espera `provider_http`, mas recebe `network` no CI Windows.
- **Causa:** o servidor falso responde e fecha antes de ler a requisição inteira; o fechamento pode causar reset TCP. Um socket aceito de listener não bloqueante também pode permanecer não bloqueante no Windows.
- **Ação:** coloque o socket aceito em modo bloqueante com timeout e leia os cabeçalhos até `\r\n\r\n` e o corpo inteiro pelo `Content-Length` antes de responder; teste também a requisição fragmentada.
- **Cancelamento de download:** não feche uma resposta com `Content-Length` maior que o corpo enviado para simular progresso: no Windows a leitura pode falhar antes do callback. Mantenha a resposta aberta e sincronize a entrega do restante com o callback de progresso.

### Sem CI
- Até o PR #86 entrar, o repo não tinha CI (`gh pr checks` responde `no checks reported`). Sem checks, revise pelo diff, pelos critérios de aceite e pela evidência de testes do worker, e diga isso no resumo.

### Teste de diálogo falha intermitentemente no CI
- **Sintoma:** Playwright encontra dois botões com o mesmo nome após fechar um diálogo Foco.
- **Causa:** a animação de saída ainda mantém o botão do diálogo na árvore enquanto o teste tenta abrir o próximo diálogo.
- **Ação:** aguarde o diálogo anterior ficar oculto e restrinja o seletor de abertura à seção que contém o botão.

### Testes com biblioteca e fontes de momentos diferentes após merge
- **Sintoma:** um `cargo test --workspace` iniciado antes do merge falha com `Invalid provider type` num teste de Ollama adicionado pelo merge, embora o código atual aceite esse tipo.
- **Causa:** a execução já tinha compilado a biblioteca anterior ao merge e depois compilou o teste novo; a árvore mudou durante o comando.
- **Ação:** finalize o merge antes de executar a verificação e repita o comando com a árvore estável. Não altere o Provedor para contornar o resultado da execução antiga.

### Arquivo binário em `worker/` corrompido no commit
- **Sintoma:** um `.wav` (ou outro binário) novo em `worker/` entra no commit com tamanho diferente do original; o teste que confere o cabeçalho `RIFF` ou o hash falha.
- **Causa:** `.gitattributes` marca `worker/** text eol=lf`, e o Git converte CRLF dentro do binário.
- **Ação:** acrescente uma regra `binary` específica depois da regra geral (já existe para `worker/src/clipes_worker/data/*.wav`) e confira com `git show :caminho | wc -c`.

### Tickets da mesma onda mexendo nos mesmos arquivos da raiz
- **Ação:** faça o merge de um PR e mande o outro worker fazer rebase em `origin/master` antes de abrir (ou atualizar) o PR. Nada de push forçado em branch alheia.

### Release publicada sem `.AppImage`, `.deb` e `latest.json` (v1.0.0)
- **Sintoma:** o job `release` cria a release só com o `.exe` e as `.sig`, e falha no Python com `StopIteration` ao procurar o `.deb`.
- **Causa:** o artefato `linux` guarda `appimage/` e `deb/` em subpastas, e o `test a && test b` não para o script com `set -e` quando um `test` do meio falha.
- **Ação:** `release.yml` achata `installers/` antes de publicar e faz um `test` por linha. Para completar uma release já criada, baixe os artefatos do run (`gh run download <id>`), confira os `.sig` com os já publicados, gere `SHA256SUMS.txt` e `latest.json` no formato do workflow e suba com `gh release upload <tag> ... --clobber`. Não mova a tag.

### Catálogo (`catalog-*`) falha ao compilar `libdbus-sys`
- **Causa:** o `keyring` com `sync-secret-service` (cofre do #165) precisa de `pkg-config` e `libdbus-1-dev` no Ubuntu.
- **Ação:** `catalog.yml` instala os dois antes do `cargo test`. Uma tag `catalog-N` cujo run falhou antes de publicar pode ser apagada e criada de novo depois do conserto.

## Mídia do YouTube (yt-dlp)

### HTTP 403 ou download parado em 0 bytes
- **Causa:** yt-dlp desatualizado. Em 2026-11 a versão 2026.10.26 falhava; a nightly baixou normalmente, **sem cookies**.
- **Ação:** atualize antes de qualquer outra tentativa:
  ```sh
  py -m pip install -U --pre "yt-dlp[default]"
  py -m yt_dlp --version
  py -m yt_dlp --test -f ba <url>   # baixa só 10 KiB para provar que funciona
  ```
- Não use `--no-check-certificates`.
- Baixe para fora do repo (ex.: `%TEMP%\clipes-dataset`) ou para uma pasta no `.gitignore`. Nunca commite mídia.

### Cookies do navegador no Windows
- `--cookies-from-browser chrome` → `Could not copy Chrome cookie database` (a criptografia app-bound bloqueia, mesmo com o Chrome fechado).
- `--cookies-from-browser edge` → `Failed to decrypt with DPAPI`.
- **Ação:** só use cookies se a nightly sem cookies falhar. Nesse caso, veja a próxima entrada.

### Login do Google bloqueado em navegador automatizado
- **Sintoma:** `Esse navegador ou app pode não ser seguro` ao logar no Chromium do Playwright.
- **Ação:** abra o Chrome instalado, sem flags de automação, com perfil e porta próprios; o dev faz login; o agente se conecta por CDP:
  ```powershell
  & "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\clipes-yt-chrome" --remote-debugging-port=9333 --no-first-run "https://accounts.google.com/ServiceLogin?continue=https://www.youtube.com/"
  ```
  Depois, `chromium.connectOverCDP('http://127.0.0.1:9333')`, exporte os cookies para um `cookies.txt` (formato Netscape) fora do repo e passe `--cookies` ao yt-dlp.
- **Limpeza obrigatória:** apague o `cookies.txt`, feche esse Chrome e apague o perfil `%TEMP%\clipes-yt-chrome`. Cookies e perfis nunca vão para o repo.

### Vídeo com restrição de idade (#194)
- **Sintoma:** `Sign in to confirm your age` (sem cookies) ou `Sorry, this content is age-restricted. To view this video, please provide more info so we can be sure you're an adult` (com cookies).
- **Causa:** o portão é a **conta ser adulta e verificada**; cookies, deno e PO Token sozinhos não bastam. A segunda mensagem significa sessão reconhecida, conta não verificada. PO Token (bgutil) não destrava a idade.
- **Ação:** para detectar sem login, `yt-dlp --skip-download --ignore-no-formats-error --print "%(age_limit)s %(availability)s" -- <url>` (`18` e `needs_auth`). Vídeo +18 embedável baixa só com deno, sem login; não embedável não. Veja `docs/research/2026-11-16-youtube-restricao-idade.md`.

### Sem deno, o yt-dlp perde formatos no YouTube
- **Sintoma:** `No supported JavaScript runtime could be found` e `n challenge solving failed`.
- **Ação:** só o deno vem habilitado por padrão; deixe no PATH, ao lado do `yt-dlp.exe`, ou passe `--js-runtimes deno:<caminho>`. Instale só em `%TEMP%\clipes-<n>-*` e apague no fim.

### Cookies exportados logo após o login não têm sessão do YouTube
- **Sintoma:** `cookies.txt` com `SAPISID`, mas sem `LOGIN_INFO`; o yt-dlp segue pedindo login.
- **Causa:** o login terminou em `accounts.google.com` e o YouTube ainda não criou a sessão.
- **Ação:** depois do login, abra `https://www.youtube.com/` no mesmo perfil, confira `LOGIN_INFO` (só o nome, nunca o valor) e então exporte; feche o Chrome logo depois (o YouTube rotaciona cookies de abas abertas).

### Plugin do bgutil não carrega com `yt-dlp.exe` standalone
- **Ação:** `pip install --target <dir>/bgutil bgutil-ytdlp-pot-provider` e passe `--plugin-dirs <dir>` (a pasta que contém `bgutil/yt_dlp_plugins`). Servidor: clonar o repo, `npm ci`, `npx tsc`, `node build/main.js --port 4416` (escuta em loopback); encerre o PID depois, conferindo a linha de comando.

### Nunca abrir issue ou PR no yt-dlp com texto de agente
- O yt-dlp tem uma política "NO AI / NO LLM" e bloqueia o autor. Reporte o problema ao dev; ele decide se e como relatar.

## Ambiente Windows

### Fixture de vídeo sem rotação no FFmpeg 8
- **Sintoma:** remuxar com `-metadata:s:v:0 rotate=90` termina com sucesso, mas
  `ffprobe` não encontra display matrix e o vídeo continua sem rotação.
- **Causa:** nessa versão, a tag sozinha não produz a matriz de exibição.
- **Ação:** para gerar o fixture sintético, use `-display_rotation 90` **antes**
  de `-i`, com `-c copy`, e confirme `side_data_list.rotation` via `ffprobe`.
  O harness `export_parity` faz essa confirmação antes de comparar os quadros.

### `-filter_complex_script` removido no FFmpeg 9 (CI Windows)
- **Sintoma:** `export_loudness` e `export_parity` passam no Ubuntu (FFmpeg 6.x) e localmente no FFmpeg 8.1, mas falham com `export_failed` no CI Windows (`choco install ffmpeg` v9.0.2).
- **Causa:** o FFmpeg 9.0 removeu `-filter_complex_script` em favor de `-/filter_complex`, enquanto o FFmpeg 6.1 do Ubuntu ainda não tem `-/filter_complex`.
- **Ação:** passe o grafo diretamente via `-filter_complex <grafo>` (funciona do FFmpeg 6 ao 9 sem depender de sintaxe específica de versão).

### OpenCode isolado: cota gratuita esgotada
- **Sintoma:** teste real pendente: cota gratuita do OpenCode esgotada (HTTP 429 `provider.free-limit`, ~22 h), isolamento confirmado com `debug agents` e 3 tentativas fora do adaptador que chegaram ao serviço.
- **Causa:** o serviço recusou `opencode/big-pickle`, `opencode/glm-5.3-flash-free` (DB em memória) e `opencode/beam-free` (SQLite temporário). Trocar o banco não resolveu; não é falha das migrações/locks do modo `:memory:`.
- **Ação:** manter `OPENCODE_DB=:memory:` e o isolamento documentado em [OpenCode](../contribuindo/opencode.md). O adaptador retorna `cli_free_limit` com mensagem fixa e o `retryAfterMs` convertido em segundos, quando informado, sem repetir sozinho. Não usar login ou chave para contornar a cota. A prova de resposta estruturada real segue no #122 quando a cota repuser; o coordenador autorizou entregar o #135 com essa pendência explícita. Nenhum teste automático faz inferência real.

- `python` pode abrir o alias da Microsoft Store (`Python was not found`). Use `py`.
- `awk`, `sed` e `grep` não existem no PowerShell; rode-os pelo Git Bash.

### Cargo fora do PATH no Windows
- **Sintoma:** `cargo` não é reconhecido, embora o Rust esteja instalado.
- **Ação:** use `%USERPROFILE%\.cargo\bin\cargo.exe` ou acrescente `%USERPROFILE%\.cargo\bin` ao PATH da sessão.

### faster-whisper não encontra CUDA no Windows
- **Sintoma:** `Library cublas64_12.dll is not found or cannot be loaded`, mesmo com as bibliotecas NVIDIA instaladas no ambiente virtual.
- **Ação:** acrescente ao `PATH` da sessão as pastas `Lib\site-packages\nvidia\cublas\bin` e `Lib\site-packages\nvidia\cudnn\bin` desse ambiente antes de iniciar o Python. Mantenha o ambiente e os modelos fora do repo.

### Worker de ML trava no primeiro pedido, sem CPU (Windows)
- **Sintoma:** o handshake responde, mas o primeiro pedido `transcribe` nunca volta; o `python` do worker fica ocioso (~30 MB) e `faulthandler` mostra a thread principal parada em `import numpy` (`LoadLibrary`) e a thread de leitura esperando o stdin.
- **Causa:** no Windows, com o stdin num pipe do núcleo, importar bibliotecas nativas enquanto outra thread já bloqueia no stdin trava o carregamento da DLL. Num shell (Git Bash) o mesmo comando funciona, o que esconde o problema.
- **Ação:** o worker importa `numpy` e `faster_whisper` em `server.preload_native_libraries()` antes de iniciar a thread de leitura; não mova esses imports para dentro da tarefa. Para reproduzir, inicie o worker com `subprocess.Popen` e pipes e mande o pedido depois do handshake (não use `printf | python`).

### Repositório do modelo no Hugging Face mudou de nome
- **Sintoma:** `huggingface.co/api/models/mobiuslabsgmbh/faster-whisper-large-v3-turbo/...` responde `307` para `dropbox-dash/faster-whisper-large-v3-turbo`; `curl` sem `-L` recebe só o texto do redirecionamento.
- **Causa:** o repositório foi renomeado; a revisão fixada continua a mesma (`0a363e91...`) e o SHA-256 dos arquivos também.
- **Ação:** use o nome canônico atual no download e no `source_url` (um redirecionamento de repo renomeado pode sumir) e cite o nome antigo só para rastrear o benchmark. O cliente de download só segue redirecionamentos para `huggingface.co` e `hf.co`.

### Download de modelo preso após interromper `py` no Windows
- **Sintoma:** outro processo de download fica esperando um lock do cache Hugging Face; o arquivo `.incomplete` continua com zero bytes.
- **Causa:** interromper o processo que chamou `py` pode deixar o interpretador filho ainda ativo segurando o lock.
- **Ação:** confira o comando e o PID do filho pertencente à execução interrompida antes de encerrá-lo; então retome o download. Não apague modelos ou caches de outros processos.

### Download de modelo Hugging Face parado com fallback HTTP
- **Sintoma:** o download de `Systran/faster-whisper-small` pelo fallback HTTP não progride após a conexão.
- **Ação:** instale `hf_xet` no ambiente isolado e repita o download; para interromper a tentativa anterior, confira o PID do interpretador filho conforme a entrada anterior.

### Hash de transcrição diverge após checkout Windows
- **Sintoma:** testes de integridade falham no SHA-256 dos JSON revisados, embora o conteúdo textual seja o mesmo.
- **Causa:** `core.autocrlf` converteu LF para CRLF; o manifesto fixa o hash dos bytes com LF.
- **Ação:** preserve ou restaure LF nos JSON afetados antes de conferir os hashes; não atualize o manifesto para aceitar uma conversão local.

### Pasta de downloads ausente em CI Linux
- **Sintoma:** `dirs::download_dir()` retorna `None` no runner sem configuração de diretórios XDG.
- **Ação:** quando Vídeos e Downloads do sistema não estiverem configurados, use `~/Downloads/Clipes`; isole os dados do teste com `CLIPES_DATA_DIR`.

### MFA no Windows falha com WinError 5 em `compute-mfcc-feats`
- **Sintoma:** MFA 3.4.3 instalado em um caminho com espaços falha na checagem do Kaldi, mesmo com o executável presente.
- **Causa:** `thirdparty_binary` acrescenta aspas ao caminho e as passa como parte do nome para `subprocess` no Windows.
- **Ação:** antes de executar o MFA, anteponha ao `PATH` o caminho curto 8.3 da pasta `Library\bin` do ambiente conda. Exemplo: `$short = cmd /c 'for %I in ("%TEMP%\clipes-mfa-env") do @echo %~sI'; $env:PATH="$short\Library\bin;$short\Scripts;$short;$env:PATH"`; execute `& "$short\python.exe" -m montreal_forced_aligner ...`. Mantenha o ambiente e `MFA_ROOT_DIR` no TEMP.

### Comparação de detectores de cena em mídia real (#60)
- **Sintoma:** a avaliação do `scdet`/PySceneDetect/TransNet V2 em gameplay do #28 ficou sem rodar.
- **Causa:** `yt-dlp --download-sections` trava; só 2 downloads nativos (≤480p, sem cookies, fora do repo, timeout de 15 min) foram autorizados, e o TransNet V2 exige TensorFlow.
- **Ação:** o #60 entregou `scdet` conservador com comparação sintética em `docs/research/2026-11-15-reenquadramento-deteccao.md`. Rode `benchmarks/reenquadramento/compare.py` localmente para fechar a pendência; só agregados vão ao repo.

## Testes E2E Tauri (WebDriver)

### `tauri-driver --version` falha como se não estivesse instalado
- **Sintoma:** checar `tauri-driver --version` termina com erro de argumento desconhecido e código de saída diferente de zero.
- **Causa:** `tauri-driver` 2.1.0 usa `pico-args` e aceita apenas `--help`, `--port`, `--native-port` e `--native-driver`, rejeitando `--version`.
- **Ação:** valide a presença do executável com `tauri-driver --help` (como faz `scripts/setup-webdriver.mjs`), nunca com `--version`.

### `msedgedriver` incompatível com a WebView2 ou `LATEST_RELEASE_*` ilegível no Windows
- **Sintoma:** `tauri-driver` recusa abrir a sessão por divergência de versão com a WebView, ou a leitura de `LATEST_RELEASE_<major>_WINDOWS` retorna caracteres corrompidos/inválidos.
- **Causa:** o Tauri usa o **Microsoft Edge WebView2 Runtime** (`EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`), cuja versão `pv` pode divergir do navegador Edge instalado; além disso, o endpoint `LATEST_RELEASE_*` responde codificado em **UTF-16LE com BOM (`0xFF 0xFE`)**, não UTF-8.
- **Ação:** execute `bun run e2e:setup` (`scripts/setup-webdriver.mjs`), que lê `pv` do WebView2 Runtime no registro, baixa o `msedgedriver.exe` correspondente em `%TEMP%\clipes-webdriver\<versao>\` e decodifica `utf-16le` quando recorre ao fallback `LATEST_RELEASE_<major>_WINDOWS`.

### `TypeError` ao tentar interceptar `window.__TAURI_INTERNALS__.invoke` no Tauri v2
- **Sintoma:** tentar substituir `window.__TAURI_INTERNALS__.invoke` via `browser.execute` para simular diálogos nativos ou plugins lança `TypeError` na WebView real.
- **Causa:** no Tauri v2, `__TAURI_INTERNALS__.invoke` é definida com `writable: false` e `configurable: false`.
- **Ação:** mantenha os efeitos nativos de SO (seletores de arquivo, abertura de URL externa, área de transferência, `confirm` e modo do updater) centralizados em `src/lib/desktop.ts`, que expõe `window.__CLIPES_E2E__` somente quando compilado com `VITE_E2E=1` (removido por tree-shaking em produção).

### WebdriverIO falha ao iniciar sessão no `tauri-driver` por WebDriver BiDi
- **Sintoma:** `remote()` do WebdriverIO v9/v10 falha ao negociar sessão com `tauri-driver` / `WebKitWebDriver`.
- **Causa:** o WebdriverIO solicita WebDriver BiDi (`webSocketUrl: true`) por padrão, que `tauri-driver` e `WebKitWebDriver` rejeitam.
- **Ação:** defina `'wdio:enforceWebDriverClassic': true` ao lado de `browserName: 'wry'` nas `capabilities` de `remote()`.

### Testes E2E em binário real acessam o keyring do host ou falham no Linux sem sessão Secret Service
- **Sintoma:** salvar/remover chaves em Preferências durante o E2E sobrescreve credenciais reais no Windows Credential Manager ou retorna erro `vault` em runners Linux headless.
- **Causa:** num executável compilado (`clipes`), `#[cfg(test)]` está desligado e o núcleo chamaria `keyring::Entry` real.
- **Ação:** em builds de depuração (`#[cfg(debug_assertions)]`), passe `CLIPES_TEST_VAULT_FILE` apontando para um JSON temporário (`core/src/vault.rs`). Não habilite esse caminho fora de `debug_assertions`.

### `e2e (windows-latest)` falha no `POST /session` com WebView2 150+ em runner elevado (#282)
- **Sintoma:** no GitHub Actions (`windows-latest`, `runneradmin` elevado, WebView2 `156.0.4314.58`), `tauri-driver` + `msedgedriver` expira no `POST /session` (ou falha com `DevToolsActivePort file doesn't exist`), enquanto localmente em usuário padrão e no `ubuntu-latest` a suíte passa.
- **Causa:** a partir do WebView2 v150+, processos elevados ignoram `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` e demais variáveis `WEBVIEW2_*`, impedindo que o `msedgedriver` passe `--remote-debugging-port=0` ao WebView2.
- **Ação:** no CI (`.github/workflows/ci.yml`), um step só do Windows antes do E2E grava a política de máquina em `HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments` com valor `REG_SZ` de nome `clipes.exe` e dado `--remote-debugging-port=0`, que processos elevados honram; localmente no Windows, rode `bun run test:e2e` em usuário padrão sem elevação.

## Disco

### Disco C: cheio com vários worktrees compilando
- **Sintoma:** `No space left on device`, ou build e download de modelo falhando com poucos GB livres.
- **Causa:** cada worktree tem o próprio `target/`. No Windows, cada binário de teste gera um `.pdb` de ~177 MB em `target/debug/build/clipes-core/<hash>/out/`, e o cargo não apaga as versões antigas; um worktree passou de 18 GB. Os testes em `core/tests/` criam pastas `%TEMP%\clipes-*` com o PID e não as apagam, e os ambientes Python de tickets fechados ficam no `%TEMP%`.
- **Ação:** apague o `target/` de worktree sem `cargo` rodando (confira a última escrita), as pastas `%TEMP%\clipes-<ticket>-*` de tickets fechados e as de teste com mais de 1 h (nunca as de um worker ativo), depois rode `uv cache prune` (os venvs do uv usam hardlinks para o cache, então o espaço só volta depois disso). Em 15/11/2026 isso levou o C: de 4,9 GB para 58,6 GB livres.
