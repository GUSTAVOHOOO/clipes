# Roteiro em blocos e trava da Narração

O Roteiro (#73) só existe para Cortes do Vídeo transformado (`selection_runs.video_kind = 'transformed'`, #67). Um Corte direto que peça Roteiro recebe o erro tipado `script_requires_transformed`. Vale a regra 5 do [ADR-0001](../adr/0001-dois-tipos-de-video-e-regras-de-transformacao.md): o usuário revisa e aprova o Roteiro antes de a Narração ser gerada ou gravada, e não existe aprovação em massa.

## Cadeia leve de Tarefas de IA

Duas Tarefas fixas no núcleo (`core/src/script.rs`), sem juiz, voting, tool calling nem tarefa de lote, ambas roteadas pelo Perfil de Provedor e pelo veto "somente local" da Tarefa `script` (`ai_task::routing_id` mapeia `script_block` para `script`):

1. `script` (`outline_prompt.md`): uma chamada com o esboço dos blocos. Cada bloco tem `title`, `intent` e `refs` (IDs de Frases do Corte).
2. `script_block` (`block_prompt.md`): uma chamada por bloco com o texto da Narração. A mesma Tarefa regenera um bloco, e então o pedido leva o texto do bloco anterior e do seguinte (`#ANTERIOR` e `#PROXIMO`; `-` quando não existem ou ainda não foram escritos).

Os prompts estão travados em `prompt-lock.json`. A Transcrição e os textos do esboço e dos vizinhos chegam em campo de dados, e o prompt diz que são dados não confiáveis. A cadeia anda quando o documento é lido (`script.get` e os comandos de escrita): o job do esboço termina, o núcleo grava os blocos e enfileira um job de texto por bloco. O estado fica todo no Projeto, então uma queda entre dois passos só repete o passo.

## Limites (constantes em `core/src/script.rs`, calibráveis)

- De 3 a 12 blocos por Corte (`MIN_BLOCKS`, `MAX_BLOCKS`).
- Título do bloco: até 80 caracteres. Intenção no esboço: até 200. Texto do bloco (o que a Narração lê): de 1 a 800 caracteres. A soma da Narração de todos os blocos: até 6000 caracteres. Referências: até 50 Frases por bloco, todas do Corte.
- Na primeira escrita cada bloco recebe `min(800, 6000 / n)` caracteres (`max=` na linha `#BLOCO`), o que garante a soma. Na regeneração e na edição, o limite é o que sobra da soma.
- Códigos fixos de violação: `language_mismatch`, `too_few_blocks`, `too_many_blocks`, `title_empty`, `title_too_long`, `intent_empty`, `intent_too_long`, `narration_empty`, `narration_too_long`, `script_too_long`, `forbidden_character` (`<` e `>`), `invented_url`, `unknown_sentence_id` e `too_many_refs`.

## Documento e histórico

Migração `0073_001_script`. `script_generations` guarda uma linha por esboço (job, idioma, versão da Tarefa, hash do prompt, perfil, segurança e o esboço). `script_blocks` guarda os blocos de uma geração. `script_block_versions` é só de acréscimo: cada texto gerado (`generated`), regenerado (`regenerated`) ou editado (`edit`) é uma versão. `script_approvals` guarda uma linha por aprovação de uma versão. Regenerar o Roteiro inteiro cria outra geração; nada é apagado. O documento é `script` (`schemaVersion` 1, validado por `documents.validate`).

## Trava da Narração

`script::narration_allowed(candidate) -> Result<(), CoreError>` é o estado do núcleo que os comandos que geram ou importam a Narração (#79, #83 e #84) chamam antes de qualquer coisa. Ela passa só se o Corte é do Vídeo transformado e aprovado, o Roteiro mais recente tem blocos, nenhuma geração está em andamento e todo bloco tem a versão atual aprovada. Caso contrário, `script_not_approved`, com `usage.reason` (`no_script`, `generating` ou `pending_blocks`) e `usage.pending`. A aprovação vale para uma versão: editar ou regenerar um bloco cria outra versão e ele volta a `pendente`. O comando `script.narration_allowed` expõe a mesma função ao harness e à UI.

## Comandos

- `script.estimate {candidate, language?, block?}`: idioma e custo estimado (da cadeia inteira, ou só do bloco).
- `script.generate {candidate, language?, confirmed?}`: enfileira o esboço. Provedor pago exige `confirmed` (`confirmation_required` traz a estimativa), que vale para a cadeia. Já em andamento: `generation_in_progress`.
- `script.get {candidate}`: documento com o Roteiro atual (`current.blocks` com `status` `pendente` ou `aprovado`, `pending`, `approved`, `totalChars`), `narrationAllowed`, o job do esboço, `busy`, os limites e o histórico em `generations`.
- `script.edit {candidate, block, title?, narration?, refs?}`: nova versão do bloco (`edit_invalid` com os códigos das violações).
- `script.approve {candidate, block}`: aprova a versão atual de um bloco. Não existe comando para aprovar todos.
- `script.regenerate {candidate, block, confirmed?}`: nova chamada com o bloco anterior e o seguinte.

Testes: `core/tests/script.rs` (headless, Provedor falso, sem rede) e a seção do Roteiro em `scripts/ui.mjs`. A UI fica em `src/features/projects/Script.tsx`.
