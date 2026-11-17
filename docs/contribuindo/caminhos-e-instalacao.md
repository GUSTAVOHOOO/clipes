# Caminhos de instalação, dados, configurações e caches (#231)

O Clipes mantém os **binários de instalação**, os **dados/caches globais do app** e os **Projetos** em locais separados. Desinstalar o app não apaga Projetos nem dados do usuário por padrão.

A resolução central fica em [`core/src/paths.rs`](../../core/src/paths.rs) usando o identificador do app `io.github.gustavohooo.clipes` (definido em [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json)).

## Mapa por plataforma

### Windows (instalador NSIS `currentUser`)

| Categoria | Caminho | Conteúdo |
|---|---|---|
| Instalação (`$INSTDIR`) | `%LOCALAPPDATA%\Clipes` | `clipes.exe`, `uninstall.exe` |
| Dados globais | `%LOCALAPPDATA%\io.github.gustavohooo.clipes` | `components/`, `models/`, `worker/`, `projects.json`, `transcription-hardware.json`, `diagnostic.log`, `ytdlp-diagnostic.json`, `export-encoder.json`, marcador `.migrated-v1.json` |
| Configurações globais | `%LOCALAPPDATA%\io.github.gustavohooo.clipes` | `settings.json`, `transcription-consent.json`, `export-settings.json`, `url-import.json`, `assistant.json`, `provider.json`, `provider-cli.json`, `provider-prices.json`, `token-calibration.json`, `provider-context.json` |
| Caches do núcleo | `%LOCALAPPDATA%\io.github.gustavohooo.clipes\cache` | `proxies/`, `thumbnails/`, `waves/`, `transcribe/` |
| Dados do WebView2 (Tauri) | `%APPDATA%\io.github.gustavohooo.clipes\EBWebView` | Perfil/cache do WebView2 |
| Chaves de API | Cofre do Windows (`keyring`) | Serviços `io.github.gustavohooo.clipes.provider` e `io.github.gustavohooo.clipes.transcription` |
| Projetos | Pasta escolhida pelo usuário | `<Nome>.clipes/` (`project.sqlite`, `backups/`, etc.) |

### Linux (AppImage / `.deb`)

| Categoria | Caminho (XDG com fallback padrão) | Conteúdo |
|---|---|---|
| Instalação | AppImage portátil (onde o usuário salvar) ou `.deb` (`/usr/bin/clipes`, `/usr/lib/Clipes/`) | Binário e recursos do app |
| Dados globais | `$XDG_DATA_HOME/io.github.gustavohooo.clipes` (`~/.local/share/io.github.gustavohooo.clipes`) | `components/`, `models/`, `worker/`, `projects.json`, `transcription-hardware.json`, `diagnostic.log`, `ytdlp-diagnostic.json`, `export-encoder.json`, marcador `.migrated-v1.json` |
| Configurações globais | `$XDG_CONFIG_HOME/io.github.gustavohooo.clipes` (`~/.config/io.github.gustavohooo.clipes`) | `settings.json`, `transcription-consent.json`, `export-settings.json`, `url-import.json`, `assistant.json`, `provider.json`, `provider-cli.json`, `provider-prices.json`, `token-calibration.json`, `provider-context.json` |
| Caches do núcleo | `$XDG_CACHE_HOME/io.github.gustavohooo.clipes` (`~/.cache/io.github.gustavohooo.clipes`) | `proxies/`, `thumbnails/`, `waves/`, `transcribe/` |
| Chaves de API | Secret Service (`keyring`) | Serviços `io.github.gustavohooo.clipes.provider` e `io.github.gustavohooo.clipes.transcription` |
| Projetos | Pasta escolhida pelo usuário | `<Nome>.clipes/` |

O `.deb` declara `gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad` e `gstreamer1.0-libav` em `bundle.linux.deb.depends` (o Tauri acrescenta `libwebkit2gtk-4.1-0` e `libgtk-3-0` automaticamente). O **AppImage** usa `bundleMediaFramework: false` (embute apenas as bibliotecas-base GStreamer trazidas pelo WebKitGTK, sem plugins nem `libav`, alinhado ao [ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)) e depende dos plugins GStreamer do host; em Debian/Ubuntu limpo, instale `sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav`.

### macOS (quando aplicável)

| Categoria | Caminho | Conteúdo |
|---|---|---|
| Instalação | `/Applications/Clipes.app` | Bundle `.app` |
| Dados e configurações | `~/Library/Application Support/io.github.gustavohooo.clipes` | Dados e configurações globais listados acima |
| Caches do núcleo | `~/Library/Caches/io.github.gustavohooo.clipes` | `proxies/`, `thumbnails/`, `waves/`, `transcribe/` |
| Chaves de API | Keychain (`keyring`) | Serviços `io.github.gustavohooo.clipes.provider` e `io.github.gustavohooo.clipes.transcription` |
| Projetos | Pasta escolhida pelo usuário | `<Nome>.clipes/` |

## Isolamento em testes (`CLIPES_DATA_DIR`)

Definir `CLIPES_DATA_DIR` no ambiente do processo redireciona **todos** os arquivos globais de dados, configurações (incluindo `component-settings.json`) e cache (`<CLIPES_DATA_DIR>/cache`) para esse diretório e **desliga** a migração automática do legado. Testes de integração sem `CLIPES_DATA_DIR` falham imediatamente em `paths::app_dirs` / `paths::ensure_migrated` para nunca tocar diretórios reais do usuário.

## Migração do layout anterior

Versões anteriores gravavam dados em `dirs::data_local_dir()/Clipes` (que no Windows dividia `%LOCALAPPDATA%\Clipes` com o instalador NSIS) e configurações de Provedor/Assistente via `ProjectDirs("io", "github.gustavohooo", "clipes")` (`%APPDATA%\github.gustavohooo\clipes\config` no Windows, `~/.config/clipes` no Linux).

Na inicialização do shell Tauri (`src-tauri/src/main.rs`), sem `CLIPES_DATA_DIR`, `paths::ensure_migrated` executa uma migração única e idempotente (`paths::migrate_legacy_data`); `paths::app_dirs` apenas resolve os caminhos sem efeitos colaterais:

1. Move **apenas a lista explícita** de arquivos e subpastas conhecidos de dados/configurações, **nunca** a pasta inteira nem os binários instalados (`clipes.exe`, `uninstall.exe`).
2. Usa `rename` direto no mesmo volume (sem copiar GBs de modelos ou cache), com fallback para cópia atômica + remoção apenas entre volumes distintos.
3. Nunca sobrescreve arquivos que já existam no destino; em pastas existentes no destino, faz merge por entrada.
4. Atualiza `settings.json` apenas quando `data_dir`, `cache_dir` ou `ffmpeg_path` gerenciado apontavam para o diretório legado padrão, e ajusta `worker/venv/pyvenv.cfg` quando o `worker/` é movido.
5. Grava `.migrated-v1.json` (apenas códigos fixos, sem caminhos pessoais) quando conclui sem erros.

## Desinstalador NSIS (Windows)

O desinstalador padrão do Tauri v2 remove `clipes.exe`, `uninstall.exe` e executa `RMDir "$INSTDIR"` (não recursivo). A opção **"Remover dados do programa"** (`DeleteAppDataCheckbox` em PT-BR/EN) vem **desmarcada por padrão** e só remove `$APPDATA\io.github.gustavohooo.clipes` e `$LOCALAPPDATA\io.github.gustavohooo.clipes` se o usuário a marcar explicitamente.
