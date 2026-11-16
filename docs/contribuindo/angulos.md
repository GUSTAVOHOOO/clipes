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

## Plano de implementação e verificação

- [ ] Testar pelo dispatch headless com Provedor falso: lista válida, repetidos,
  escrita manual e trava sem ângulo; executar o teste e observar a falha.
- [ ] Registrar a tarefa e seus schemas/prompt/trava de hash, reutilizar a fila,
  estimativa de custo, confirmação paga, orçamento, cancelamento e auditoria.
- [ ] Persistir escolhas e revisões; aplicar a trava no núcleo e os estados dos
  blocos; testar troca, reaprovação e propagação em geração/regeneração.
- [ ] Acrescentar a seleção/escrita manual na UI do Roteiro com tokens Foco,
  confirmação de troca e custo; exercitar pelo harness UI.
- [ ] Executar fmt, testes do workspace, typecheck, build, contraste, UI e clippy;
  abrir PR draft cedo, manter a base atualizada, aguardar CI verde e marcar ready.

Os testes automáticos não acessam rede e usam `CLIPES_DATA_DIR` temporário.
