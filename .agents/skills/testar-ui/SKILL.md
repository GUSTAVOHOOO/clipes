---
name: testar-ui
description: Use when the user asks to test the Clipes UI, validate screens or user flows, run E2E Tauri tests, or verify changes before/after UI edits in this repository.
---

# Testar UI do Clipes (`test:e2e` e `test:ui`)

Skill local do repositório **Clipes** para rodar a validação de interface rapidamente, sem adivinhar comandos ou mocks.

## 1. Qual comando rodar

| Objetivo | Comando | O que executa |
| --- | --- | --- |
| **Fluxo real completo (Tauri + Rust)** | `bun run test:e2e` | Compila binário debug (`VITE_E2E=1`), abre a janela real via `tauri-driver` + WebdriverIO e testa todas as telas contra o `clipes-core` real. Salva capturas em `shots-e2e/`. |
| **Reexecutar E2E sem recompilar Rust/Vite** | `bun run test:e2e -- --skip-build` | Use apenas quando só `scripts/e2e-tauri.mjs` mudou (se alterou `src/`, `src-tauri/` ou `core/`, rode sem `--skip-build`). |
| **Checagem rápida só de UI (mockada)** | `bun run test:ui` | Sobe Vite com `VITE_CORE_MOCK=1` e testa no Playwright/Chromium (sem compilar Rust). Bom para iterar rápido em layout, tema e teclado. |
| **Contraste WCAG** | `bun run test:contrast` | Valida tokens de contraste da UI. |

Se o `test:e2e` acusar falta ou versão incompatível de driver no Windows/Linux, rode primeiro:

```powershell
bun run e2e:setup
```

*(No Windows, baixa o `msedgedriver.exe` compatível com o WebView2 Runtime para `%TEMP%\clipes-webdriver\`.)*

## 2. Como este setup funciona (o que não quebrar)

- **Fronteira de SO (`src/lib/desktop.ts`)**: sob `VITE_E2E=1`, ativa `window.__CLIPES_E2E__` para enfileirar caminhos de diálogo (`openDialog`/`saveDialog`), `confirmAction`, clipboard/links e updater sem abrir janelas do Windows Explorer (eliminado por tree-shaking em produção).
- **Isolamento total**: cada execução cria `%TEMP%\clipes-e2e-*`, isola dados em `CLIPES_DATA_DIR` e usa `CLIPES_TEST_VAULT_FILE` (`core/src/vault.rs`, só em `#[cfg(debug_assertions)]`) para não mexer nas chaves reais do sistema.
- **Dependências externas simuladas**: usa `ffmpeg`/`ffprobe` reais com mídia sintética, servidor HTTP local em `127.0.0.1` e binários auxiliares (`fake-worker`, `fake_ytdlp`, `fake_provider_cli`, `fake_opencode`), sem downloads externos nem chamadas pagas.

## 3. Fluxo recomendado para o agente

1. Se houve alteração visual ou de componente, rode `bun run typecheck` e `bun run test:ui`.
2. Para validar o app nativo completo, rode `bun run test:e2e`.
3. Se mudou textos de botões, títulos, rótulos ARIA ou fluxos de tela, atualize os seletores em `scripts/e2e-tauri.mjs` (e `scripts/ui.mjs`, se aplicável) antes de concluir.
4. Confira as capturas geradas em `shots-e2e/` (`01-assistant.png` a `10-backups.png`) quando precisar inspecionar visualmente as telas.

Para detalhes avançados e troubleshooting, consulte [docs/contribuindo/testes-e2e.md](../../../docs/contribuindo/testes-e2e.md) e [docs/agents/impedimentos.md](../../../docs/agents/impedimentos.md).
