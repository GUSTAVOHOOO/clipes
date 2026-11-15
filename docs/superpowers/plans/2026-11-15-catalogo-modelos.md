# Catálogo de modelos e preço por faixa (#141)

**Objetivo:** ampliar o catálogo existente sem alterar o registro por chamada, as migrações ou o orçamento do #124.

**Arquitetura:** `Price` preserva o formato antigo e ganha limites opcionais, data por modelo e faixas ordenadas por limiar exclusivo de entrada. `price_micro_usd` escolhe uma tarifa para a requisição inteira. Estimativas usam as extremidades do intervalo comum (#140 quando disponível), e o orçamento continua consumindo `maxMicroUsd`.

**Restrições:** somente este worktree e branch; commits DCO; `CARGO_BUILD_JOBS=2`; testes sem rede com `CLIPES_DATA_DIR`; dados desconhecidos ausentes; mensagens de erro fixas; UI existente Foco em PT/EN.

- [x] Testar pelo harness as fronteiras de cada modelo, intervalo cruzando o limiar, sobrescritas antigas e usage incompleto; executar e observar falha antes de implementar.
- [x] Estender catálogo e cálculo no seam existente; confirmar preços e limites nas fontes oficiais, preservando as entradas e sobrescritas antigas.
- [x] Mostrar intervalo e faixa na estimativa existente; documentar catálogo e regra futura de cache Anthropic.
- [x] Integrar master se #140/#142 entrarem; executar fmt, testes workspace, clippy, typecheck, build e UI. #142 integrado; #140 ainda aberto. Testes passaram; clippy estrito para em quatro avisos anteriores, sem alterações nos arquivos apontados. A varredura com `--cap-lints warn` terminou sem novos avisos.
- [x] Abrir PR #158 em draft e registrar fontes, desconhecidos e evidências de teste.

A promoção do PR é feita somente depois de CI Ubuntu/Windows/licenses/DCO verde. O #140 permanece uma integração posterior enquanto seu PR estiver aberto; o adaptador temporário fica concentrado em `input_range`.
