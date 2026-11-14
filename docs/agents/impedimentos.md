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

### Tickets da mesma onda mexendo nos mesmos arquivos da raiz
- **Ação:** faça o merge de um PR e mande o outro worker fazer rebase em `origin/master` antes de abrir (ou atualizar) o PR. Nada de push forçado em branch alheia.

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

## Ambiente Windows

- `python` pode abrir o alias da Microsoft Store (`Python was not found`). Use `py`.
- `awk`, `sed` e `grep` não existem no PowerShell; rode-os pelo Git Bash.

### Cargo fora do PATH no Windows
- **Sintoma:** `cargo` não é reconhecido, embora o Rust esteja instalado.
- **Ação:** use `%USERPROFILE%\.cargo\bin\cargo.exe` ou acrescente `%USERPROFILE%\.cargo\bin` ao PATH da sessão.

### faster-whisper não encontra CUDA no Windows
- **Sintoma:** `Library cublas64_12.dll is not found or cannot be loaded`, mesmo com as bibliotecas NVIDIA instaladas no ambiente virtual.
- **Ação:** acrescente ao `PATH` da sessão as pastas `Lib\site-packages\nvidia\cublas\bin` e `Lib\site-packages\nvidia\cudnn\bin` desse ambiente antes de iniciar o Python. Mantenha o ambiente e os modelos fora do repo.

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
