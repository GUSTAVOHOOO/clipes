# Protocolo núcleo ↔ worker de ML (v1)

O núcleo Rust inicia o worker Python (`python -m clipes_worker`) sem shell e conversa por **JSON lines**: uma mensagem JSON por linha, UTF-8, no stdin (núcleo → worker) e no stdout (worker → núcleo). O stderr é descartado pelo núcleo. O worker nunca abre o banco: tudo o que produz volta ao núcleo em mensagens `result`. Decisão e contexto: [ADR-0004](../../docs/adr/0004-stack-tauri-react-nucleo-rust-worker-python.md).

Toda mensagem tem `v` (versão do protocolo, hoje `1`) e `type`. Linhas inválidas ou com `v` desconhecido recebem `error` com código `invalid_message` e `id: null`; o worker continua rodando.

## Mensagens

Núcleo → worker:

| `type` | Campos | Efeito |
| --- | --- | --- |
| `hello` | `protocol` | Primeira mensagem. O worker responde `handshake`, ou `error` `protocol_mismatch` e encerra. |
| `request` | `id`, `task`, `params` | Pede uma tarefa (`transcribe`, `reframe` ou `tts`). O `id` é texto único por pedido. |
| `cancel` | `id` | Cancela o pedido `id`, em andamento ou ainda na fila. |
| `shutdown` | — | O worker libera o modelo e encerra. |

Worker → núcleo:

| `type` | Campos | Significado |
| --- | --- | --- |
| `handshake` | `protocol`, `worker`, `python`, `libs` | Versões do worker, do Python e de cada biblioteca (`null` se ausente). A tela de Componentes mostra estes valores. |
| `event` | `event`, `model` | `model_loaded` ou `model_released`. |
| `progress` | `id`, `stage`, `percentage`, `message` | Progresso do pedido, de 0 a 100. |
| `result` | `id`, `data` | Fim bem-sucedido; `data` é um objeto. |
| `error` | `id`, `code`, `message` | Falha tipada. `id` é `null` para erros que não pertencem a um pedido. |

Os pedidos rodam um de cada vez, na ordem de chegada. O `cancel` é lido enquanto uma tarefa roda e vale também para um pedido ainda na fila; o worker responde `error` `cancelled` no próximo ponto de checagem. Se não responder em 5 s, o núcleo encerra o processo.

### Erros tipados

`code` é um de: `invalid_message`, `protocol_mismatch`, `unknown_task`, `model_missing`, `out_of_memory`, `cancelled`, `internal`. O `message` do worker é um texto fixo por código e nunca inclui caminhos nem texto de exceção; o núcleo o troca por sua própria mensagem fixa (ADR-0006). Do lado do núcleo existem também `worker_start`, `worker_crashed`, `worker_timeout` e `worker_protocol`.

### Um modelo por vez

O worker mantém no máximo um modelo carregado. Ao trocar de modelo, libera o anterior (`model_released`) antes de carregar o próximo (`model_loaded`). Ao encerrar, libera sem anunciar. Os modelos de ML são baixados por outro fluxo; sem o arquivo, a tarefa responde `model_missing`.

## Exemplos compartilhados

`examples/*.jsonl` são conversas completas. Cada linha é `{"from":"core"|"worker","message":{...}}`; o texto `"*"` num valor aceita qualquer valor (versões do ambiente). Os dois lados leem os mesmos arquivos:

- **Worker Python** (`worker/tests/test_examples.py`): envia as linhas `core` e confere que as respostas batem com as linhas `worker`, na ordem.
- **Núcleo** (`core/tests/worker.rs`): o executável de teste `fake-worker` reproduz as linhas `worker` e exige que o núcleo envie exatamente as linhas `core`.

| Arquivo | Conversa |
| --- | --- |
| `handshake.jsonl` | `hello` → `handshake` → `shutdown`. |
| `run-ok.jsonl` | Pedido com evento de modelo, progresso e resultado. |
| `model-swap.jsonl` | Dois pedidos: o primeiro modelo é liberado antes do segundo carregar. |
| `cancel.jsonl` | Cancelamento no meio do pedido. |
| `error.jsonl` | `model_missing` e `unknown_task`. |
| `protocol-mismatch.jsonl` | `hello` com protocolo desconhecido (lado do worker). |

Para mudar o protocolo, aumente `PROTOCOL_VERSION` nos dois lados, atualize os exemplos e esta página.

## Instalação

O Componente `uv` (versão, URL e SHA-256 fixados em `core/src/components.rs`) instala um Python standalone gerenciado e as dependências travadas em `uv.lock` num ambiente dentro do diretório de dados do app (`worker/venv`). O núcleo passa `UV_PYTHON_PREFERENCE=only-managed`, `--python-preference only-managed` e `--frozen`, e remove variáveis que apontariam para outro Python. O extra `cuda` só é instalado se `nvidia-smi` detectar uma GPU NVIDIA.

Para testar localmente: `uv run --project worker pytest worker/tests` e `uv run --project worker python worker/check_licenses.py`. Para atualizar uma dependência, edite `worker/pyproject.toml`, rode `uv lock --project worker` e confira as licenças.
