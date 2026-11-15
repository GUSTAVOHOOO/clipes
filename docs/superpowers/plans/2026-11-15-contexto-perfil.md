# Descoberta de contexto por Perfil de Provedor (#143)

Contrato: `provider.context.get {profileId?, task?, refresh?}` devolve contexto
efetivo, origem fechada, explicação fixa, máximo do modelo, contexto carregado
e saída máxima com suas origens. Reutiliza o campo `context` do #142.
Prioridade: usuário, carregado, servidor, catálogo, fallback (4096 Ollama,
8192 demais); todo teto confirmado aplicável reduz o valor escolhido.

Decisões do coordenador em 15/11/2026:

- Nenhum discriminador novo no perfil. OpenRouter usa `/models`, OpenAI não
  é sondado, demais remotos OpenAI usam `/models`. Loopback tenta LM Studio,
  llama.cpp e modelos compatíveis, nessa ordem, parando quando reconhecido.
- Consulta padrão lê cache e metadados passivos. Somente `refresh: true`, pelo
  botão explícito na UI, pode pré-carregar Ollama com `num_ctx` e saída mínima.
  O aviso informa o efeito na memória. Consentimento remoto e os vetos de
  Somente local precedem transporte e cofre; nenhum endpoint pago gera texto.

Implementação sequencial neste worktree, sem auxiliares:

1. Testes headless de fallback, catálogo, edição e metadados falsos; verificar
   falha por comando ausente. Implementar resolvedor e parsers em
   `core/src/provider/context.rs`, registrado por inventory.
2. Reutilizar DNS fixado, bloqueio de proxy/redirecionamento, autenticação,
   timeout e CancelToken do transporte. Integrar leitura segura dos perfis e
   `with_context`; não mudar o formato de completion dos demais servidores.
3. Cache atômico separado (`provider-context.json`): identidade hash de perfil,
   endpoint, modelo e configuração, somente números e categorias persistidos.
   Mudança da configuração invalida dados; remoção apaga cache do perfil.
4. Campo editável e contexto/origem/explicação na tela existente em Foco, PT/EN,
   botão de atualização e confirmação remota com ConfirmDialog. Verificar UI.
5. Testes dirigidos em cada etapa; antes de sair de draft executar fmt,
   workspace, clippy, typecheck, build, contraste e UI. CI Ubuntu/Windows,
   licenças e DCO verdes, PR contra master com Closes #143.

Todos os testes usam `CLIPES_DATA_DIR` isolado e servidores de loopback falsos;
as fixtures citam documentação oficial. Não usar chaves reais. Commits DCO
pequenos e PR draft cedo. Nenhuma migração SQL é necessária.
