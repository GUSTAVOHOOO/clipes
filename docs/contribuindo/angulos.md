# Ângulo antes do Roteiro (#153)

O Vídeo transformado exige um ângulo escolhido antes de gerar o Roteiro. A tarefa
`angles` usa a rota e o veto “somente local” de `script`, sem escolha adicional nas
Preferências (decisão do mantenedor em 16/11/2026).

O Provedor recebe somente o texto compacto das Frases do Corte. Propõe 2–3 ângulos
com `name` (1–60 caracteres), `promise` (uma frase de 1–200), `audience` (1–120) e
`sentence_ids` (1–12 IDs do Corte). O núcleo valida o schema completo e rejeita nomes
normalizados iguais ou promessas com Jaccard ≥ 0,6. A normalização remove acentos e
pontuação e converte para minúsculas. O prompt evita listas genéricas.

O usuário pode escolher uma sugestão, regenerar a lista ou escrever o próprio
ângulo. Na escrita manual só nome e promessa são obrigatórios; público e IDs,
quando informados, obedecem aos mesmos limites. Não há chamada ao Provedor nem
comparação de similaridade nesse caminho.

A migração `0153_001_angles` preserva o histórico de sugestões e escolhas e a
proveniência do ângulo de cada geração do Roteiro. Trocar o ângulo com Roteiro já
existente exige confirmação. Os textos permanecem e os blocos ficam
**desatualizados (ângulo mudou)** até aprovação explícita, edição ou regeneração;
nenhum bloco desatualizado conta como aprovado (decisão do mantenedor em
16/11/2026). A UI usa `ConfirmDialog`.

O ângulo escolhido entra nos dados do esboço e de cada bloco, inclusive ao
regenerar, e na sugestão de título e de thumbnail do Vídeo transformado.
O Corte direto mantém seus dados e comportamento.

## Comandos e persistência

- `angles.estimate {candidate, language?}`: custo e indicação de Provedor pago.
- `angles.generate {candidate, language?, confirmed?}`: novo job `ai:angles`;
  a confirmação paga é verificada antes do envio. A lista anterior permanece
  disponível se a nova resposta falhar. Gerar uma lista nunca troca a escolha.
- `angles.get {candidate}`: lista válida mais recente, geração, escolha, último
  job (com erro tipado e violações), estado de execução e histórico de gerações.
- `angles.choose {candidate, generation, index, confirmed?}`: escolhe um item
  validado de uma geração desse Corte; `index` começa em zero.
- `angles.choose {candidate, angle, confirmed?}`: escreve o próprio ângulo,
  sem Provedor. A confirmação de troca é exigida no núcleo, e a escolha idêntica
  é idempotente. A troca espera a geração do Roteiro terminar.

`script.get` inclui `angle`; cada geração conserva seu ângulo original e cada
bloco informa `stale`. Uma revisão de ângulo nova invalida as aprovações da
anterior, preservando-as no histórico. Roteiros anteriores ao #153 continuam
legíveis e exigem a escolha de um ângulo para novas gerações ou regenerações.
Um Roteiro legado já aprovado mantém a Narração liberada até a escolha do primeiro
ângulo; essa escolha pede confirmação e marca os blocos como desatualizados
(decisão do mantenedor em 16/11/2026).

## Verificação

`cargo test -p clipes-core --test angles --test script --test packaging --test thumbnail`
cobre lista válida, Jaccard no limiar, acentos/pontuação, IDs fora do Corte,
limites de campos, escrita manual, trava sem ângulo, confirmação paga, vetos,
escolha de sugestão, troca confirmada, reaprovação, edição, regeneração,
proveniência, reabertura e propagação. Os testes de Empacotamento e capa também
garantem que o Corte direto não recebe `#ANGULO`.

`bun run test:ui` exercita a escolha antes do Roteiro, cancelamento e confirmação
da troca e o selo dos blocos. A captura da lista fica em `shots/angles-pt-BR.png`.

`cargo test -p clipes-core --test angles_migration` migra um Projeto com Roteiro
legado aprovado, verifica o backup e preserva sua aprovação até a primeira escolha.

Os testes automáticos não acessam rede e usam `CLIPES_DATA_DIR` temporário.
