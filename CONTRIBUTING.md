# Contribuindo com o Clipes

Obrigado por contribuir! Consulte o [glossário](GLOSSARY.md) e os [ADRs](docs/adr/) para entender os termos e as decisões do projeto.

## Por onde começar

- Para erros, ideias e propostas de Provedor ou modelo, escolha o formulário em [Issues](https://github.com/GUSTAVOHOOO/clipes/issues/new/choose). Confira se já existe uma issue parecida. Descreva o contexto e revise o texto antes de publicá-lo: issues são públicas.
- Para dúvidas de uso, use [Discussions](https://github.com/GUSTAVOHOOO/clipes/discussions). Para vulnerabilidades, siga [SECURITY.md](SECURITY.md), sem abrir issue pública.
- Para contribuir com código, procure uma issue existente ou abra uma para discutir o trabalho. Crie um fork e uma branch a partir de `master`, faça alterações focadas e abra um pull request para `master` explicando o que mudou, a issue relacionada e como testou. Responda à revisão e atualize o PR quando necessário.
- Consulte os guias de [Provedor](docs/contribuindo/provedor.md), [Motor de transcrição](docs/contribuindo/motor-de-transcricao.md), [Tarefa de IA](docs/contribuindo/tarefa-de-ia.md) e [Janelas de seleção](docs/contribuindo/janelas-de-selecao.md) e [Seleção de Cortes](docs/contribuindo/selecao-de-cortes.md) e [Empacotamento](docs/contribuindo/empacotamento.md) [Capa](docs/contribuindo/capa.md) e [Roteiro](docs/contribuindo/roteiro.md) para contribuições nessas áreas.

## DCO e licença

As contribuições são licenciadas sob [Apache-2.0](LICENSE). Cada commit deve ter uma linha `Signed-off-by` com seu nome e e-mail, certificando o [Developer Certificate of Origin (DCO)](https://developercertificate.org/). Não há CLA. Configure sua identidade no Git e use:

```sh
git config user.name "Seu Nome"
git config user.email "seu-email@example.com"
git commit -s -m "feat: descreve a mudança"
```

Verifique o rodapé com `git log -1 --format=full`. Se faltou a assinatura no último commit local, `git commit --amend -s` a acrescenta. Não assine em nome de outra pessoa.

## Desenvolvimento

O Clipes usa Tauri 2, React, TypeScript e Bun. Instale Rust (toolchain estável), Bun e os [pré-requisitos do Tauri para seu sistema](https://v2.tauri.app/start/prerequisites/). No Windows, instale também o WebView2 e as ferramentas de compilação C++ do Visual Studio.

```sh
bun install
bun run tauri dev
```

A janela mostra a versão retornada pelo núcleo. Para executar o harness sem abrir uma janela e observar o resultado e os eventos:

```sh
cargo run -p clipes-core --example headless
```

Para verificar o projeto:

```sh
cargo test --workspace
bun run typecheck
bun run build
```

## Contrato do núcleo

O [ângulo antes do Roteiro](docs/contribuindo/angulos.md) descreve a tarefa `angles`,
que herda a rota de `script`, os comandos de escolha e os blocos desatualizados ao
trocar a promessa do Vídeo transformado.

Export local, contrato de entrada do Corte, ASS compartilhado com preview, harness
de paridade e pontos de extensão do pipeline: [Export](docs/contribuindo/export.md).

O crate `core` não depende do Tauri. A UI chama o único adaptador `core_dispatch`, que repassa nome e argumentos JSON ao mesmo `dispatch` usado pelo harness. Cada módulo de feature registra seus próprios comandos com `inventory::submit!`; incluir o módulo no crate exige no máximo uma linha `mod`, sem alterar uma lista central de comandos. Os eventos `core-progress` usam o mesmo `ProgressEvent` serializável, com job, etapa, porcentagem, mensagem e erro tipado opcional. O callback do despacho entrega os eventos ao adaptador Tauri ou ao harness. Processos externos devem usar `core::process::spawn`, que inicia o executável diretamente, sem shell. Como exceção de infraestrutura do shell, plugins oficiais do Tauri como updater e process são usados diretamente pela UI; a lógica de domínio continua exclusivamente no `core_dispatch`.

### Chave do updater

O mantenedor gera o par de assinatura uma única vez com `bun run tauri signer generate -- -w "%USERPROFILE%\.tauri\clipes-updater.key"`. Guarde a senha em `%USERPROFILE%\.tauri\clipes-updater.password.txt`, ao lado da chave. Faça backup seguro dos dois arquivos; nunca commite nem compartilhe a chave privada ou a senha. Configure `TAURI_SIGNING_PRIVATE_KEY` com o conteúdo da chave e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` com sua senha nos secrets do repositório GitHub. A chave pública em `src-tauri/tauri.conf.json` pode ser compartilhada. Pull requests compilam sem assinatura; builds de tags usam os secrets para assinar os artefatos de atualização.

Na inicialização, `set_event_emitter` instala uma única vez o receptor compartilhado dos eventos assíncronos da fila; sem receptor, eles são descartados. Eventos da fila identificam o Projeto e o job. O despacho síncrono continua usando seu callback emprestado. Cada Projeto aberto tem um único thread de fila, que executa um job de cada vez; a interface consulta também `jobs.list` para recuperar o estado atual. Jobs `ai:<tarefa>` executam Tarefas de IA (`core/src/jobs/ai.rs`); veja [Tarefa de IA](docs/contribuindo/tarefa-de-ia.md). O job `energy` (#54) mede o volume da Fonte depois da Transcrição; veja [Seleção de Cortes](docs/contribuindo/selecao-de-cortes.md#energia-do-áudio-54). O job `chat` (#151) busca e agrega o replay do chat de uma Fonte importada por URL; veja [Chat da live](docs/contribuindo/selecao-de-cortes.md#chat-da-live-151).

## Demonstração do design system

A demonstração Foco pode ser executada em design-system com bun install --frozen-lockfile e bun run dev --host 127.0.0.1 --port 5180 --strictPort. Abra http://localhost:5180. Execute bun run build em design-system para verificar a compilação. A [documentação](design-system/README.md) explica os limites e outras verificações. Ela não processa vídeo de produção.

## Configuração do GitHub para mantenedores

Após integrar estes arquivos, um administrador precisa:

1. Ativar **Discussions** nas configurações do repositório para que o link de dúvidas funcione.
2. Ativar **Private vulnerability reporting** em Security / Code security para receber relatos pelo link de [SECURITY.md](SECURITY.md).
3. Instalar e configurar um **app de DCO** para verificar o `Signed-off-by` de cada commit dos pull requests e exigir a verificação na proteção de `master`.
4. Confirmar que a label `needs-triage` existe e que os três formulários aparecem no seletor de issues da branch padrão.

Os formulários recebem `template`, `title` e o texto no parâmetro `body` da URL `issues/new`; cada formulário usa o campo `body` para aceitar esse preenchimento. Para textos acima do limite de URL, o usuário pode colar o diagnóstico copiado pelo app. Revise o conteúdo antes de publicar; não envie credenciais ou dados privados.

## Casca e testes de interface

A casca usa os tokens e componentes Foco, sem dados demonstrativos. Os textos ficam nas pastas das respectivas features. Uma feature pode contribuir para uma gaveta exportando `drawer` de `src/features/<feature>/drawer.tsx`, conforme o tipo `DrawerContribution` em `src/lib/drawers.ts`; o registro descobre o módulo automaticamente. Comandos da tela são registrados com `useComandos`.

Para executar a interface no navegador com o núcleo simulado, use `VITE_CORE_MOCK=1 bun run dev` (no PowerShell, `$env:VITE_CORE_MOCK='1'; bun run dev`). O núcleo real continua sendo usado pelo Tauri. Para verificar teclado, telas, console e capturas, instale o Chromium com `bunx playwright install chromium` e execute `bun run test:ui`; as capturas ficam em `shots/`. Os tokens da interface são verificados por `bun run test:contrast`.

## Projetos e migrações

Cada Projeto é uma pasta `.clipes` com `project.sqlite`; a biblioteca local é apenas um índice recuperado ao abrir a pasta. Recentes ausentes permanecem listados como indisponíveis. O núcleo é o único escritor; SQLite usa WAL e FTS5. Tempos usam `projects::Microseconds` em µs inteiros.

O núcleo mantém uma sessão de Projeto por vez. `projects.open` e `projects.create` abrem a sessão, `projects.current` a consulta e `projects.close` a encerra; abrir outro Projeto encerra o anterior. Toda escrita de módulos de domínio deve usar `projects::with_writer`, que serializa o acesso e marca o Projeto como alterado; não abra `project.sqlite` para escrita diretamente. Jobs que dependem do Projeto mantêm um `projects::start_job` durante sua execução, impedindo troca ou restauração até terminarem.

O núcleo cria backups SQLite em `backups/`, sem incluir cache, ao abrir quando o último backup já passou do intervalo e periodicamente enquanto aberto, apenas após escrita. O padrão é 30 minutos e 10 cópias por Projeto, configuráveis. Antes de restaurar, verifica uma cópia com `integrity_check` e `foreign_key_check` e preserva o estado atual; cópias pré-restauração e pré-migração não são removidas pela rotação. Falhas de backup produzem aviso tipado e não impedem o uso do Projeto.

Registre cada migração SQL com `inventory` como `projects::Migration`. Use um identificador textual único, ordenável, com o número do ticket e um sufixo próprio, por exemplo `0033_001_project`. Nunca renumere migrações de outros tickets. O núcleo aplica todas as migrações ausentes em ordem, mesmo quando uma migração de outro ticket já foi aplicada, e recusa IDs desconhecidos sem fazer downgrade. Antes de migrar um banco com tabelas, gera `project.pre-migration.sqlite` pela Online Backup API e verifica sua integridade; um banco novo sem tabelas não precisa de backup.

Para testes headless, defina `CLIPES_DATA_DIR` no ambiente do processo para isolar o índice de Projetos em `projects.json` nesse diretório; sem a variável, usa-se o diretório de dados local do app. Os comandos do núcleo não aceitam um caminho de biblioteca da UI.

### Trilha de auditoria (#125)

Cada chamada externa paga deixa uma linha em `call_audit` (migração `0125_001_call_audit`), escrita na **mesma transação** da linha de custo (`provider_costs`, por `cost::record_call`) ou, para o áudio pago do Groq, da linha de `transcription_calls`: nunca há chamada auditada sem custo, nem o contrário. A linha só tem hashes e metadados ([ADR-0009](docs/adr/0009-custo-orcamento-e-auditoria-de-chamadas-de-ia.md), regras 7 a 10): tipo de Provedor (`openai`, `anthropic`, `gemini`, `ollama`, `cli` ou `transcription`), host, `prompt_sha256`, `input_sha256`, tamanho enviado em bytes e `response_sha256`. Tarefa, versão, perfil, modelo, resultado e duração continuam só em `provider_costs` (a trilha os lê por junção); o modelo das chamadas de transcrição fica na própria trilha.

- `input_sha256` é o SHA-256 dos bytes exatos do corpo enviado, sem cabeçalhos (nunca a chave); para CLI, o prompt enviado ao stdin; para o Groq, os bytes do áudio. O tamanho é o do corpo. `response_sha256` é o do corpo recebido e fica vazio se não houve resposta.
- `host` é só o host do endpoint, sem esquema, caminho, consulta ou porta; para CLI, o id do CLI (`cli:codex`, `cli:claude`, `cli:opencode`). `prompt_sha256` vem do registro da Tarefa de IA e é vazio para a transcrição.
- Adaptador novo: anote `host`, `inputSha256`, `sentBytes` e `responseSha256` na entrada do log de chamadas (`control::with_call_scope`); um CLI usa `control::note_request` e `note_response`. Campos ausentes ficam vazios, e um valor fora do formato é descartado.
- Nenhum texto de prompt, Transcrição ou Roteiro entra na trilha, no log local ou no diagnóstico. `provider.audit.list {job?}` lê a trilha, e o diagnóstico acrescenta apenas `task_version` e `prompt_sha256` da última chamada que falhou (ou da última), só quando têm o formato esperado: inteiro e 64 caracteres hexadecimais, pois o banco pode vir de um Projeto compartilhado. Hashes de entrada e de resposta, host, tamanho, perfil e modelo não saem. Testes: `core/tests/call_audit.rs` e `core/tests/call_audit_cli.rs`.
- **A trilha é do Projeto e é portátil.** Ao compartilhar o Projeto (pasta `.clipes`, cópia ou backup), os metadados de Provedor, modelo e host vão junto, além dos hashes. Quem recebe vê qual Provedor e qual modelo processaram o conteúdo, mas nenhum texto de prompt, Transcrição ou Roteiro. Guardar o corpo completo de prompts e respostas é um opcional futuro, desligado e fora desta entrega.

O cache de onda usa o formato binário `CLPWAVE\0`, versão 1, com inteiros little-endian: quatro `u32` (versão, taxa de picos por segundo, canais e quantidade de níveis), seguidos por uma tabela de níveis com `u64` de offset absoluto em bytes e `u64` de contagem de instantes. Cada instante tem um par `i16` mínimo/máximo por canal, intercalados na ordem dos canais. Há 100 instantes por segundo; cada nível seguinte agrega quatro picos consecutivos por canal até restar aproximadamente um pico por segundo ou menos. A tabela permite ler apenas o nível e intervalo necessários para a timeline.

Documentos `clip`, `style`, `script` e `packaging` são objetos JSON com `schemaVersion` igual a 1 e `revision` inteira não negativa. Cada tipo registra seu validador e suas migrações próprias; campos de domínio serão definidos pelos tickets correspondentes. O comando `documents.validate` migra e valida o documento no núcleo; versões futuras são recusadas.

## Correção e busca na Transcrição (#52)

O texto que o Motor produziu fica em `transcript_words.text` e nunca é alterado; a correção do usuário fica em `transcript_words.corrected_text` (migração `0052_001_corrections_and_search`). Corrigir muda o texto, nunca os tempos nem a posição da palavra. **O texto efetivo de uma palavra é `corrections::EFFECTIVE_TEXT` (`COALESCE(corrected_text, text)`): tudo o que deriva da palavra (Frases, texto compacto do #140, busca e as legendas futuras) deve ler por essa função única, nunca `text` direto.** Blocos novos de uma Transcrição parcial só acrescentam posições; nunca regravam correções.

As fronteiras e os IDs das Frases são função só do texto original e dos tempos (contrato do #49 e do #140). Uma correção atualiza o texto da Frase que contém a palavra, sem recalcular fronteiras nem renumerar IDs, mesmo que a palavra ganhe ou perca pontuação; `transcription.segment` também não recalcula por causa de correções. O texto digitado é normalizado em NFC, aparado, sem vazio nem caracteres de controle, com até `MAX_CORRECTION_CHARS` caracteres; espaço interno e pontuação valem, e a convenção de espaço inicial do Motor é preservada.

Desfazer e refazer usam uma pilha por Projeto em `transcript_corrections` (texto antes e depois), persistida no SQLite do Projeto; uma correção nova limpa o refazer. A busca (`transcription.search`) usa a tabela FTS5 `sentence_search` (`unicode61 remove_diacritics 2`, então “acao” acha “ação”) sobre o texto efetivo das Frases de todas as Transcrições do Projeto. Gatilhos em `sentences` mantêm o índice na mesma transação de qualquer gravação de Frases e o limpam na exclusão em cascata. A entrada do usuário nunca vai crua ao `MATCH`: cada termo é citado e o último aceita prefixo.

## Preview do Corte (#58)

Bordas, documento do Corte, histórico, autosave e snapshots do editor (#70):
[Editor do Corte](docs/contribuindo/editor-bordas.md).

O preview de um Corte usa um proxy H.264 de GOP curto, só da janela do Corte ±2 min, gerado como job local da fila e guardado num cache **fora do Projeto** (`<cache>/proxies`, LRU por tamanho). Ele é servido pelo protocolo de mídia `clipes-media`, implementado no núcleo (`core::media::serve`, com `Range`) e traduzido pelo adaptador em `src-tauri`. O protocolo só serve um id opaco (`proxy/<chave>` ou `source/<id>`), nunca um caminho vindo da URL. A UI é `CutPreview` (`{ sourceId, startUs, endUs }`), e clicar numa palavra da Transcrição posiciona o preview nela. Fonte offline não gera nada. Detalhes, constantes e testes em [Preview do Corte](docs/contribuindo/preview-do-corte.md).

## Perfis de Provedor

`provider.json` tem a versão 2 com `profiles[]` ([ADR-0010](docs/adr/0010-perfis-multiplos-de-provedor-tarefa-para-perfil-e-somente-local.md)). Um arquivo antigo (só `endpoint`, `model`, `kind`, `nativeSchema`) é lido como o perfil `legacy` e **não é reescrito** até o usuário editar. A conta do cofre é o endpoint (o perfil `legacy` e os perfis sem `ownKey` a compartilham, junto do consentimento, que também é por endpoint); só `ownKey: true` usa a conta `profile:<id>`. A localidade é calculada por `is_local_endpoint`, nunca guardada; os CLIs `codex` e `claude` aparecem em `provider.profiles.list` como perfis não locais, mas continuam ativados por `provider.cli.*` com o aviso do #39.

A calibração de tokens é o único estado global de Provedor gravado automaticamente pelo núcleo: `token-calibration.json`, ao lado de `provider.json`, guarda somente chaves de perfil, modelo, formato e idioma e números agregados das últimas chamadas válidas. A gravação é atômica; arquivos ausentes, inválidos ou de versão desconhecida não bloqueiam chamadas e aparecem no diagnóstico com mensagem fixa. A exclusão de um perfil remove sua calibração. O arquivo legado `provider.json` não é reescrito pela calibração.

**Contexto efetivo por perfil (#143).** `provider.context.get {profileId?, task?, refresh?}` devolve `value`, `source` (`user`, `loaded`, `server`, `catalog`, `fallback`, `measured`), `detail` (servidor que respondeu), `explanation` fixa, `capped`, `warning`, `loaded`, `maxContext` e `maxOutput`, para o planejador (#144) e para a tela. Prioridade: valor do usuário (o campo `context` do perfil), contexto carregado, máximo do servidor, catálogo (#141), fallback (4096 Ollama, 8192 demais); todo teto conhecido reduz o valor. Para Ollama, o `num_ctx` enviado é o mesmo número (`cached_effective`, só do cache): usuário, carregado (`/api/ps`), 4096; nunca o máximo anunciado nem o catálogo. A consulta padrão só lê o cache e metadados passivos; a pré-carga do Ollama (`/api/chat` sem mensagens, `num_predict` 1) só ocorre com `refresh: true`, em servidor loopback ou de rede privada. Remoto sem consentimento e "somente local" não são sondados. O cache fica em `provider-context.json` (só números e categorias, chave por hash de perfil, endpoint, modelo e configuração; TTL de 5 min com contexto carregado, 6 h sem) e é apagado com o perfil. Testes: `core/tests/provider_context.rs`, com servidores falsos em loopback.

`provider.configure` sem `profileId` age como antes (substitui o `legacy` e desativa o CLI); com `profileId` faz *upsert* sem tocar no CLI. `provider.status`, `provider.key.*`, `provider.confirm`, `provider.test` e `provider.structured` aceitam `profileId` opcional (sem ele, valem para o `legacy`). Os `timeouts` por tipo do #117 continuam globais em `provider.json` (a base de todos os perfis); o perfil pode ter o seu próprio (#147, abaixo). O preço de um perfil é o de `provider.prices.*` para o par tipo e modelo (sobrescrita do usuário ou tabela embutida). Os testes headless estão em `core/tests/provider_profiles.rs` (arquivos no formato antigo, com `CLIPES_DATA_DIR`) e nos testes de `core/src/provider.rs` (cofre falso).

### Limites de saída e timeout por Perfil (#147)

Dois campos opcionais no perfil, editáveis na tela e em `provider.configure`: `maxOutput` (tokens de saída, inteiro positivo) e `timeoutSecs` (1 a 3600). Ausente mantém o valor salvo, `null` apaga; o arquivo legado continua sem ser reescrito. `provider.profiles.list` e `provider.status` devolvem também `limits` (valor efetivo e origem do teto de saída e do timeout, mais as constantes da regra). A regra mora em `core/src/provider/limits.rs` (funções puras, `provider::limits`):

- **Teto estático de saída** (`output_ceiling`): o menor entre o pedido da Tarefa, `maxOutput` do perfil e o `max_output` do modelo (o servidor informa, senão o catálogo: o mesmo que `provider.context.get` mostra). Se nem o perfil nem o modelo informam limite, vale `FALLBACK_MAX_OUTPUT_TOKENS` (4096). Sem pedido da Tarefa só o Anthropic recebe teto (a API o exige), com `DEFAULT_ASK_TOKENS` (8192, o antigo valor fixo) cortado pelos mesmos limites; os outros tipos seguem sem teto, a menos que o perfil defina `maxOutput`. Um pedido menor que o catálogo (8192 ou mais) não muda.
- **Espaço livre** (`apply_free_space`), em `run_structured` logo depois dos vetos e antes do cofre e da rede: `contexto efetivo (cached_effective) − estimativa ALTA da entrada (#140) − raciocínio reservado (DEFAULT_REASONING_RESERVE, 0)`. Corta o teto; abaixo de `MIN_USEFUL_OUTPUT_TOKENS` (512) a chamada é recusada com `output_space_insufficient` (mensagem fixa, sem `usage`), sem rede, sem linha de custo e sem trilha. O contexto vem do cache e pode ser o padrão conservador (8192, 4096 no Ollama): informe `context` no perfil se o modelo comporta mais.
- **A reserva do planejador** (#144) sai da mesma regra: `provider::output_reserve(task, profileId, ask)` devolve o pedido cortado pelo perfil e pelo modelo, e `plan_for_profile` a usa no lugar do valor cru. `ProfileRequest` e `DEFAULT_OUTPUT_RESERVE` não mudaram; sem perfil (CLI) vale o pedido. A estimativa de custo (`provider.cost.*`) usa o mesmo teto, para o orçamento não divergir do que vai no fio.
- **Timeout** (`limits::timeout`): o `timeoutSecs` do perfil, exato; senão o timeout por tipo do #117 mais `TIMEOUT_MS_PER_1K_INPUT_TOKENS` (1000 ms) por mil tokens estimados (alto). Nos dois casos, o orçamento de tempo que resta ao executor (#121; `control::set_deadline`) é o teto, conferido a cada tentativa HTTP (também depois de um `Retry-After` e no reparo); sem tempo nada é enviado (`time_budget_exhausted`). O cancelamento vale em todos os tipos, inclusive durante a espera do `Retry-After`.
- **Política preservada:** timeout de modelo local (custo zero) volta como `uncertain` e o `jobs.retry` repete sem confirmação; pago incerto só repete com confirmação mostrando o custo; `output_truncated` mantém o `usage` e nunca dispara reparo. Testes: `core/tests/output_limits.rs` (servidores falsos em loopback) e os testes de `provider::limits` e `provider::security_tests`.

### Tarefa para perfil e "somente local" (#120)

`assistant.task.set` e `assistant.default.set` aceitam `profile:<id>` (o perfil precisa existir; `profile:codex` e `profile:claude` são recusados, os CLIs continuam sendo `codex` e `claude`). Os valores antigos (`""`, `endpoint`, `codex`, `claude`) são guardados e devolvidos como estão, e `endpoint` resolve para o perfil `legacy`. Trocar a escolha de uma tarefa não mexe nas outras. Sem escolha, `Route::Unset` mantém o comportamento anterior e a sugestão de `assistant.tasks` (o primeiro perfil em loopback, marcado `measured: false`) nunca é aplicada sozinha.

Um `profile:<id>` cujo perfil foi removido aparece em `assistant.status` como `""` com o id em `missing`, e a chamada é **recusada** com `profile_unavailable`: não cai no padrão nem em outro perfil (ADR-0010, regra 4). Escolher de novo ou limpar a escolha resolve. Nada escreve no `assistant.json` ao remover um perfil.

`assistant.local_only.set {task, enabled}` liga o veto por tarefa. `provider.structured`, `provider.cost.estimate` e `provider.cost.run` resolvem a rota por `provider::routed` e, antes do consentimento, do cofre e de qualquer rede, devolvem `local_only_violation` (mensagem fixa, sem `usage`, sem texto, endpoint ou nome de Projeto) se a rota é um CLI ou um endpoint que não é loopback. A checagem usa o host literal (`localhost` ou IP de loopback), sem DNS, na hora da chamada; um `profileId` explícito não a contorna. O veto por Projeto está na próxima seção.

### Lote de Fontes (#56)

Várias Fontes processadas em sequência (Transcrição e seleção), com teto de custo por lote e erros isolados por Fonte; o avanço é recalculado dos jobs, nunca só do que o lote guarda. Veja [Lote de Fontes](docs/contribuindo/lote-de-fontes.md).

### "Somente local" como veto por Projeto (#123)

O sinalizador mora no `project.sqlite` (tabela `project_privacy`, linha única, migração `0123_001_project_local_only`, padrão desligado), viaja com o Projeto portátil e entra nos backups; restaurar um backup devolve o valor que estava nele (um backup anterior à migração é migrado e volta desligado). `projects.local_only.get` devolve `{open, enabled}` e `projects.local_only.set {enabled}` grava (`project_not_open` sem Projeto aberto). O Projeto não escolhe Provedor: só proíbe.

`provider::pick_target` é o único ponto que resolve a rota e soma os dois vetos (por tarefa, no `assistant.json`, e por Projeto, lido por `projects::project_local_only`): qualquer um dos dois devolve o mesmo `local_only_violation`, antes do consentimento, do cofre e de qualquer rede, também para CLI, para `profileId` explícito e para chamadas sem tarefa. Isso cobre "refazer com o forte" e qualquer escalada futura, desde que resolva a rota por `provider::routed`/`run_structured`. Sem Projeto aberto o veto por Projeto não se aplica. Se o sinalizador não puder ser lido por outro motivo, a chamada falha em vez de liberar o envio. `assistant.tasks` devolve `projectLocalOnly` e marca `blocked` nas linhas afetadas. O nome do Projeto e o texto nunca entram na mensagem de erro, no log nem no diagnóstico. Testes: `core/tests/project_local_only.rs`.

O custo estimado de uma tarefa usa o perfil escolhido: `provider.prices.*` por (tipo, modelo) do perfil, sem campo de preço no perfil. `provider.cost.run` devolve `route` (`profileId`, `kind`, `model`) e grava o id do perfil em `provider_costs.profile` (migração `0120_001_provider_costs_profile`). `assistant.tasks` alimenta a tabela "Tarefas" das Preferências. Testes: `core/tests/task_profiles.rs`.

### Refazer com outro perfil (#126)

`selection.redo` aceita `profileId` e `jobs.redo` refaz qualquer unidade de Tarefa de IA com um Perfil escolhido pelo usuário, só desta vez, depois de mostrar perfil, custo e se o texto sai da máquina. Respeita "somente local", o teto do lote e job `uncertain`; nunca troca perfil sozinho nem muda o padrão. Os candidatos novos entram como uma nova revisão da execução (migração `0126_001_selection_redo_profile`). Veja [Refazer com outro perfil](docs/contribuindo/refazer-com-outro-perfil.md); o "regenerar bloco" do Roteiro (#73) reusa `jobs.redo`.

## Worker de ML

O worker Python (`worker/`) roda a transcrição e os demais modelos; o núcleo o instala sob demanda pelo Componente `uv` e fala com ele por JSON lines versionado, conforme o [ADR-0004](docs/adr/0004-stack-tauri-react-nucleo-rust-worker-python.md). O protocolo, as mensagens de exemplo compartilhadas e a instalação estão em [worker/protocol/README.md](worker/protocol/README.md). A instalação é um Componente global (`components.worker.install`, com `components.cancel` e id `worker` para cancelar), não um job da fila de Projetos. Para testar, sem Python no sistema, instale o `uv` na versão fixada em `core/src/components.rs` e rode `uv run --project worker pytest worker/tests`; o núcleo é testado contra um worker falso com `cargo test -p clipes-core --test worker`.

## Transcrição local

A Transcrição de uma Fonte roda como job da fila do Projeto (`kind = 'transcription'`, safety local), iniciado por `transcription.start` (idempotente: com a Transcrição completa devolve-a; com uma parcial, um novo job continua do último bloco). O núcleo corta o áudio da faixa de microfone guardada na Fonte (`sources.audio_track`) em blocos de 10 min com o `ffmpeg`, pede cada bloco ao Motor ([`TranscriptionEngine`](core/src/transcription.rs); o Motor local fala com o worker) e grava palavras, silêncios, ponto de retomada e checkpoint do job numa só transação. Matar o processo no meio retoma do último bloco concluído, sem duplicar palavras; o cancelamento é `jobs.cancel`, e `transcription.status` e `transcription.words` leem o resultado.

As tabelas são `transcripts` e `transcript_words` (migração `0048_001_transcripts`): uma linha por palavra, com índice por ordem (`position`) e por tempo (`start_us`), silêncios como linhas `kind = 'silence'` e `speaker` reservado, sempre nulo. Os modelos (`whisper-turbo` com GPU NVIDIA, `whisper-small` em CPU) são Componentes baixados por `components.models.download`, com revisão fixa e SHA-256 por arquivo, e dependem do worker instalado. Os testes headless usam o worker falso (`cargo test -p clipes-core --test transcription`) e o pytest do worker usa modelos falsos; `CLIPES_TRANSCRIBE_BLOCK_SECONDS` só existe para os testes. A transcrição real é um teste ignorado, rodado à mão (veja `core/tests/transcription_real.rs`). A sonda de hardware, a escolha de precisão e a estimativa de tempo (`transcription.hardware.*` e `transcription.estimate`, #50) estão em [docs/contribuindo/motor-de-transcricao.md](docs/contribuindo/motor-de-transcricao.md).

## Atualização do yt-dlp

A atualização é iniciada somente após confirmação, sem consulta automática. O núcleo consulta a release nightly oficial e verifica localmente a assinatura OpenPGP destacada de `SHA2-256SUMS` antes de aceitar o SHA-256 exato do executável. A chave incorporada vem de [public.key do yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/public.key), com fingerprint `AC0CBBE6848D6A873464AF4E57CF65933B5A7581`; se a chave oficial mudar, é necessário atualizar o app com a nova chave e fingerprint verificados. A versão anterior é preservada até o novo executável passar em `--version`.

## Licenças de dependências

A política do [ADR-0003](docs/adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md) é verificada no CI. Para reproduzir, instale `cargo-deny` 0.20.2 e Bun 1.3.12 e execute na raiz:

```sh
cargo deny --locked check licenses bans advisories sources
bun install --frozen-lockfile
(cd design-system && bun install --frozen-lockfile)
node --test scripts/license-policy.test.mjs
bunx license-checker-rseidelsohn@4.4.2 --production --unknown --start . --excludePackages 'clipes@0.1.0' --json | node scripts/check-licenses.mjs
bunx license-checker-rseidelsohn@4.4.2 --production --unknown --start design-system --excludePackages '@clipes/design-system@0.1.0' --json | node scripts/check-licenses.mjs
cargo test -p clipes-core --test components every_component_has_an_allowed_license
```

As exclusões dos pacotes raiz `clipes` e `@clipes/design-system` cobrem apenas os projetos Apache-2.0, não suas dependências. Dependências transitivas de produção também são verificadas; o CI Rust inclui desenvolvimento e todos os alvos. FFmpeg GPL é a única exceção para Componentes, como executável separado. Atribuições continuam em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); a checagem não as substitui.

Para pedir uma exceção, abra uma issue descrevendo pacote, versão, licença, uso, obrigações e justificativa; aguarde revisão dos mantenedores e documente qualquer exceção junto à política. Nunca adicione licença incompatível silenciosamente. O ambiente Python fixado do worker (`worker/uv.lock`) é verificado no CI por `worker/check_licenses.py`, com a mesma allowlist e falha para licenças ausentes ou incompatíveis. As exceções por pacote ficam no próprio script, com a razão (typing-extensions PSF-2.0, partes CC0-1.0 do numpy e as bibliotecas CUDA da NVIDIA foram aprovadas pelo mantenedor em 2026-11-14, PR #111); as bibliotecas CUDA da NVIDIA (extra `cuda`, proprietárias e baixadas só com GPU NVIDIA) são conferidas por nome.
