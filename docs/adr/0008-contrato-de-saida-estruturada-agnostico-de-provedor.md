---
status: accepted
---

# Contrato de saída estruturada agnóstico de Provedor: schema mínimo no fio, validação completa no núcleo

O núcleo envia ao Provedor um schema **mínimo** (o "schema fio") e valida sempre a resposta contra o **schema completo** e os verificadores da Tarefa de IA. Decisão do dev em 14/11/2026, a partir da [pesquisa do harness (#114)](https://github.com/GUSTAVOHOOO/clipes/issues/114), em complemento ao [ADR-0007](0007-tarefas-de-ia-como-workflows-fixos-no-nucleo.md) e ao [ADR-0004](0004-stack-tauri-react-nucleo-rust-worker-python.md).

OpenAI, Anthropic e Gemini oferecem saída estruturada nativa, e servidores locais (Ollama, LM Studio, llama.cpp) aplicam gramática. Todos cobrem só um **subconjunto** de JSON Schema, e cada doc manda validar no código da aplicação. Como o Clipes aceita qualquer Provedor, o contrato não pode depender do que apenas alguns aceitam.

## As regras

1. **O schema fio leva só o que todos aceitam:** objetos com campos obrigatórios, `additionalProperties: false`, tipos, enums, arrays e `schemaVersion`. O Clipes **não depende** de `minLength`, `maxLength`, `pattern`, `minItems` e afins para segurança.
2. **O núcleo valida sempre, em duas camadas:** o schema completo (com `jsonschema`, como já faz) e os verificadores determinísticos da tarefa. A camada de verificação é a garantia; o schema do Provedor é só uma ajuda.
3. **Sem tool calling.** A saída estruturada cobre todas as tarefas e é suportada nos três formatos HTTP. Em modelo local, a gramática do servidor é muito mais robusta do que tool calling de modelo pequeno.
4. **Modelo local usa o schema nativo do servidor** quando existe (`nativeSchema`) **e** o schema também descrito no prompt, porque Ollama e llama.cpp recomendam isso e a gramática não é injetada no prompt. Para modelos fracos: janelas menores e saída curta (só IDs e Nota).
5. **Campos de justificativa ficam livres no schema.** Restringir demais o formato pode piorar o raciocínio do modelo.
6. **Falha de validação depois de um reparo vira erro tipado, visível ao usuário.** Truncamento, recusa e JSON inválido são erros distintos. Não há troca automática de Provedor ([ADR-0010](0010-perfis-multiplos-de-provedor-tarefa-para-perfil-e-somente-local.md)).
7. **Capacidades por tipo de adaptador são dado, não `if` espalhado:** um registro com schema nativo, se informa `usage`, se sinaliza recusa e janela de contexto máxima.

## Opções consideradas

- **Enviar o schema completo a cada Provedor:** um Provedor recusa o schema por uma palavra-chave que outro ignora, e a segurança passaria a depender do que cada um aplica.
- **Tool calling para obter JSON:** não é suportado de forma uniforme e é frágil em modelo local pequeno.
- **Embutir um motor de gramática (XGrammar):** o servidor de inferência local já aplica gramática; o núcleo não precisa embutir um.
- **Confiar só no schema nativo, sem validação local:** as docs dos Provedores dizem para validar sempre, e o schema nativo não expressa regras como "toda Frase existe na janela enviada".
