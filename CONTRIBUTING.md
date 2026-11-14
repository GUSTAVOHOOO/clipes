# Contribuindo com o Clipes

Obrigado por contribuir! Consulte o [glossário](GLOSSARY.md) e os [ADRs](docs/adr/) para entender os termos e as decisões do projeto.

## Por onde começar

- Para erros, ideias e propostas de Provedor ou modelo, escolha o formulário em [Issues](https://github.com/GUSTAVOHOOO/clipes/issues/new/choose). Confira se já existe uma issue parecida. Descreva o contexto e revise o texto antes de publicá-lo: issues são públicas.
- Para dúvidas de uso, use [Discussions](https://github.com/GUSTAVOHOOO/clipes/discussions). Para vulnerabilidades, siga [SECURITY.md](SECURITY.md), sem abrir issue pública.
- Para contribuir com código, procure uma issue existente ou abra uma para discutir o trabalho. Crie um fork e uma branch a partir de `master`, faça alterações focadas e abra um pull request para `master` explicando o que mudou, a issue relacionada e como testou. Responda à revisão e atualize o PR quando necessário.
- Consulte os guias de [Provedor](docs/contribuindo/provedor.md) e [Motor de transcrição](docs/contribuindo/motor-de-transcricao.md) para contribuições nessas áreas.

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

O crate `core` não depende do Tauri. A UI chama o único adaptador `core_dispatch`, que repassa nome e argumentos JSON ao mesmo `dispatch` usado pelo harness. Cada módulo de feature registra seus próprios comandos com `inventory::submit!`; incluir o módulo no crate exige no máximo uma linha `mod`, sem alterar uma lista central de comandos. Os eventos `core-progress` usam o mesmo `ProgressEvent` serializável, com job, etapa, porcentagem, mensagem e erro tipado opcional. O callback do despacho entrega os eventos ao adaptador Tauri ou ao harness. Processos externos devem usar `core::process::spawn`, que inicia o executável diretamente, sem shell. Como exceção de infraestrutura do shell, plugins oficiais do Tauri como updater e process são usados diretamente pela UI; a lógica de domínio continua exclusivamente no `core_dispatch`.

### Chave do updater

O mantenedor gera o par de assinatura uma única vez com `bun run tauri signer generate -- -w "%USERPROFILE%\.tauri\clipes-updater.key"`. Guarde a senha em `%USERPROFILE%\.tauri\clipes-updater.password.txt`, ao lado da chave. Faça backup seguro dos dois arquivos; nunca commite nem compartilhe a chave privada ou a senha. Configure `TAURI_SIGNING_PRIVATE_KEY` com o conteúdo da chave e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` com sua senha nos secrets do repositório GitHub. A chave pública em `src-tauri/tauri.conf.json` pode ser compartilhada. Pull requests compilam sem assinatura; builds de tags usam os secrets para assinar os artefatos de atualização.

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

Documentos `clip`, `style`, `script` e `packaging` são objetos JSON com `schemaVersion` igual a 1 e `revision` inteira não negativa. Cada tipo registra seu validador e suas migrações próprias; campos de domínio serão definidos pelos tickets correspondentes. O comando `documents.validate` migra e valida o documento no núcleo; versões futuras são recusadas.
