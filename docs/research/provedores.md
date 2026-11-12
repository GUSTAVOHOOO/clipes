# Integração de Provedores de IA

Consulta em **12/11/2026**. Escopo: VOD, Windows primeiro, Linux/macOS na arquitetura; PT-BR e EN. A pesquisa usa documentação dos fabricantes; capacidades e regras dependem de versão, plano e modelo.

## Resumo executivo

- Criar uma interface própria de Provedor de LLM, com adaptadores para API, servidor local e CLI/SDK autorizado, e uma interface independente para Motor de transcrição.
- Priorizar APIs com chave e servidores locais; preservar a opção de assinatura, mas só habilitar cada integração após confirmar os termos do caminho específico.
- Claude tem documentação oficial conflitante sobre assinatura em produtos terceiros; Gemini proíbe reutilizar OAuth para acessar diretamente seu backend; OpenAI documenta um caminho específico de login para apps elegíveis.
- Distinguir JSON de transporte, JSON Schema e validação semântica: validar localmente todo resultado e jamais assumir paridade de recursos.
- Manter Transcrição local como padrão, com CPU e aceleração por GPU quando disponível; exigir tempos por palavra também dos Motores remotos.
- Usar bibliotecas como detalhes substituíveis: AI SDK em TypeScript ou LiteLLM em Python são opções, não contrato de domínio nem solução universal para CLIs.
- Não enviar conteúdo ou mudar de Provedor, plano ou cobrança automaticamente; mostrar destino, custo e limites ao usuário.

## Matriz de capacidades de Provedores

Legenda: **E** = estruturado por esquema documentado; **J** = envelope JSON, sem garantia de esquema do conteúdo; **D** = dependente do modelo/servidor; **?** = não confirmado. Streaming significa eventos ou texto parcial, não resultado final validado.

| Tipo e Provedor | Acesso / autenticação | Estrutura e streaming | Limites e observações | Fontes |
|---|---|---|---|---|
| Claude Code CLI | `claude -p`; login do Claude ou chave Console | `--output-format json`/`stream-json`; `--json-schema` para resposta; eventos parciais com `--include-partial-messages` | Uso da assinatura e elegibilidade de app terceiro têm ressalva contratual abaixo; CLI é agente com ferramentas | [Headless](https://code.claude.com/docs/en/headless), [CLI](https://code.claude.com/docs/en/cli-reference), [assinatura](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) |
| Codex CLI | `codex exec`; login ChatGPT ou chave de API | `--json` emite eventos JSONL; `--output-schema arquivo.json` define esquema da resposta final; `-o` salva última mensagem | Requer gestão de sandbox, diretório e aprovações; cotas dependem de plano | [Modo não interativo](https://developers.openai.com/codex/noninteractive/), [autenticação](https://developers.openai.com/codex/auth/), [limites](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) |
| Gemini CLI | `gemini -p`; login Google, chave Gemini ou Vertex | `--output-format json` retorna envelope com `response` textual; `stream-json` emite JSONL de eventos; esquema da resposta final via CLI: ? | Quotas variam por autenticação; regra de OAuth abaixo | [Headless](https://geminicli.com/docs/cli/headless/), [autenticação](https://geminicli.com/docs/get-started/authentication/), [quotas](https://geminicli.com/docs/resources/quota-and-pricing/) |
| Anthropic API | Chave da API; faturamento separado da assinatura | E e streaming, sujeitos ao modelo e subconjunto de schema | Taxas e limites variam por modelo e conta | [Saída estruturada](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [preços](https://platform.claude.com/docs/en/about-claude/pricing) |
| OpenAI API | Chave da API; faturamento separado do ChatGPT | E em modelos compatíveis; streaming SSE; JSON mode é distinto de schema | Recusa, truncamento e subconjunto de schema exigem tratamento | [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [preços](https://openai.com/api/pricing/) |
| Gemini API | Chave Google AI Studio ou credencial Vertex, conforme backend | E por JSON Schema e streaming em modelos compatíveis | Limites e tratamento de dados variam com o serviço e nível pago/gratuito | [Structured output](https://ai.google.dev/gemini-api/docs/structured-output), [preços](https://ai.google.dev/gemini-api/docs/pricing), [termos](https://ai.google.dev/gemini-api/terms) |
| OpenRouter | Chave OpenRouter; roteia para diferentes fornecedores | E e streaming D; exigir parâmetros compatíveis quando necessário | Modelo e rota podem alterar preço, privacidade e disponibilidade | [Structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [roteamento](https://openrouter.ai/docs/guides/routing/provider-selection), [preços](https://openrouter.ai/models) |
| Endpoint compatível com OpenAI | URL base e chave opcional | J/E e streaming D; compatibilidade de endpoint não garante parâmetros ou semântica | Só enviar credencial ao destino escolhido; verificar recursos por combinação servidor/modelo | [Provedor compatível AI SDK](https://ai-sdk.dev/providers/openai-compatible-providers) |
| Ollama local | HTTP local; modelo instalado | E com `format` contendo schema; streaming; oferece compatibilidade parcial OpenAI | Capacidade e desempenho dependem do modelo e hardware | [Saídas estruturadas](https://docs.ollama.com/capabilities/structured-outputs), [compatibilidade](https://docs.ollama.com/api/openai-compatibility) |
| llama.cpp server | HTTP local, servidor e arquivo de modelo | E via JSON Schema/gramática, D; streaming e API compatível OpenAI | Suporte e backend de aceleração dependem da compilação | [Servidor oficial](https://github.com/ggml-org/llama.cpp/tree/master/tools/server), [projeto](https://github.com/ggml-org/llama.cpp) |
| LM Studio | Servidor local e modelo carregado | E via JSON Schema e API compatível; streaming D | Alguns modelos não seguem esquema adequadamente | [Saída estruturada](https://lmstudio.ai/docs/developer/openai-compat/structured-output), [API OpenAI](https://lmstudio.ai/docs/developer/openai-compat) |

Esquema aceito pela API não garante que os tempos escolhidos correspondam à Fonte. A aplicação deve validar o conteúdo de domínio mesmo quando o formato é restrito. **Inferência de desenho:** como servidores locais são processos independentes, detectar instalação, disponibilidade, versão e modelo e oferecer diagnóstico explícito é mais robusto que assumir um daemon ativo.

## Assinaturas, CLIs e SDKs oficiais

**Claude.** `claude -p` oferece JSON final, JSONL e schema; o [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) oferece Python e TypeScript com sessões, streaming e ferramentas. A [central de ajuda](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) diz que `claude -p`, SDK e apps terceiros ainda consomem limites da assinatura; porém a [visão geral do SDK](https://code.claude.com/docs/en/agent-sdk/overview) diz que desenvolvedores terceiros não podem oferecer login claude.ai ou limites do plano em seus produtos sem aprovação prévia. São fontes oficiais com escopos e mensagens potencialmente conflitantes. **Inferência:** não anunciar essa integração como autorizada até obter confirmação específica da Anthropic para o Clipes; não extrair tokens OAuth. Limites são compartilhados com Claude e variam com carga e plano ([ajuda](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)).

**Codex.** O [SDK oficial](https://developers.openai.com/codex/sdk/) é TypeScript e oferece execução e eventos; o [app-server](https://developers.openai.com/codex/app-server/) é outra superfície para ciclo de vida e aprovações. A [OpenAI](https://openai.com/policies/sign-in-with-chatgpt-terms/) documenta Sign in with ChatGPT para apps elegíveis, exigindo, entre outras condições, execução local ou sob controle do usuário, autorização para automações, armazenamento local de tokens, uso em nome do titular e acesso à funcionalidade sem cobrança adicional. Os [termos de disponibilidade](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) distinguem ferramentas open source e apps participantes. Isso não demonstra automaticamente que qualquer invocação de CLI ou caso de uso esteja coberto: conferir o caminho e elegibilidade do Clipes. Nunca compartilhar assinatura entre usuários nem fingir ser outro aplicativo.

**Gemini.** A [referência headless](https://geminicli.com/docs/cli/headless/) documenta JSON e JSONL, mas o campo `response` é texto, não uma garantia de schema. A [FAQ](https://geminicli.com/docs/faq/) e os [termos da CLI](https://geminicli.com/docs/resources/tos-privacy/) proíbem que software terceiro capture ou reutilize OAuth da Gemini CLI para acesso direto ao backend. Não concluímos que lançar a CLI oficial inalterada seja necessariamente o mesmo que acesso direto; pedir confirmação à Google antes de distribuir essa modalidade. Para integração suportada com agentes terceiros, a FAQ indica chave Gemini/Vertex.

**Implementação operacional recomendada (inferência):** CLI instalado e autenticado pelo usuário; descobrir executável e versão, passar argumentos como vetor sem shell, usar stdin para conteúdo extenso, consumir stdout e stderr separadamente, impor limite de saída/tempo, cancelar processo e descendentes, distinguir falhas de login, quota e saída inválida. Desabilitar ferramentas e integrações externas quando o produto/versão permitir, escolher diretório isolado e tratar ausência dessa garantia como bloqueio ou risco explícito. Não usar modos de aprovação irrestrita; configurações herdadas, extensões e arquivos de contexto precisam de teste específico no Windows, Linux e macOS. Prompts e Transcrições são dados não confiáveis; não dar ao texto autoridade para executar comandos. Essas medidas são desenho proposto, não garantias documentadas de isolamento.

## Bibliotecas de abstração

| Opção | Linguagem / transporte | API e locais | Assinatura via CLI | Schema e streaming | Trade-off |
|---|---|---|---|---|---|
| [LiteLLM](https://docs.litellm.ai/) | Python SDK; proxy HTTP para outras linguagens | Muitos Provedores, inclusive OpenRouter e compatíveis; também endpoint de Transcrição | Não presumir suporte aos CLIs oficiais nem autorização de assinatura; conferir adaptador específico | Padroniza chamadas e anuncia suporte a streaming e estruturados, sujeito ao backend | Proxy implica processo e configuração extra; SDK Python traz dependências |
| [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) | TypeScript/JavaScript | Provedores oficiais e compatíveis, adaptadores comunitários | Não cobre automaticamente assinaturas ou CLIs | `generateText`/`streamText` com `Output.object` e schema | Boa opção se núcleo for TS; plugins comunitários requerem avaliação |
| [LangChain](https://docs.langchain.com/oss/python/langchain/overview) | Python e JavaScript, pacotes distintos | Muitos adaptadores e integrações | Não presumir CLI de assinatura suportada | [Saída estruturada](https://docs.langchain.com/oss/python/langchain/structured-output) e streaming, sujeitos a adaptador | Mais abstrações de agente que o caso de seleção de Cortes necessariamente exige |
| SDKs oficiais / HTTP | SDKs específicos ou HTTP em qualquer linguagem | Maior acesso a particularidades do Provedor | SDKs de agente oficiais são separados dos SDKs de API | Depende da API; APIs têm diferenças de schema e eventos | Mais código de adaptação; menos componentes intermediários |

O [LiteLLM lista endpoint de Transcrição](https://docs.litellm.ai/docs/supported_endpoints), mas um nome comum não comprova suporte uniforme a timestamps por palavra. A [lista do AI SDK](https://ai-sdk.dev/providers/ai-sdk-providers) distingue recursos por Provedor. **Inferência:** escolher biblioteca após a stack desktop ser definida; manter interface do domínio e testes de contrato próprios, sem obrigar o app a embarcar gateway.

## Motor de transcrição

| Motor | Caminho | Timestamps / execução | Fonte |
|---|---|---|---|
| whisper.cpp | Local, padrão candidato | CPU e aceleração por backends suportados; timestamps por palavra devem ser validados na configuração e versão escolhidas | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| faster-whisper | Local, candidato alternativo | CPU/GPU e `word_timestamps` documentados; distribuição de dependências de GPU exige testes no Windows | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) |
| OpenAI | API de áudio | `whisper-1` oferece `verbose_json` e granularidade por palavra, mas está descontinuado com encerramento em 26/02/2027; não basear v1 nele sem alternativa validada | [Transcrição e timestamps](https://developers.openai.com/api/docs/guides/speech-to-text) |
| Deepgram | API de áudio pré-gravado | Resposta inclui tempos por palavra; verificar idiomas, modelo e custos atuais | [Áudio pré-gravado](https://developers.deepgram.com/docs/pre-recorded-audio), [preços](https://deepgram.com/pricing) |

Contrato proposto: `transcribe(audio, languageHint, options, cancel) -> Transcript`, com progresso opcional e capacidades declaradas (`wordTimestamps`, idiomas, duração/tamanho máximo, CPU/GPU, custo e rede). Retornar palavras com texto, início e fim em segundos relativos à Fonte, idioma detectado, segmentos opcionais e metadados de origem; não fabricar precisão por palavra a partir de timestamps por segmento. Normalizar offsets dos trechos, ordenar e validar limites, tratar silêncio, overlap, retomada, falha parcial e diferença entre duração da Fonte e do áudio extraído. Se o Motor remoto não fornecer palavras, exigir alinhamento separado validado ou informar incompatibilidade. Avaliar PT-BR e EN com amostras reais, ruído e VODs longos; CPU é caminho obrigatório, GPU uma otimização detectada, sem presumir CUDA. Envio remoto de áudio requer escolha informada do usuário.

## Desenho da interface de Provedor

Contrato conceitual, independente de linguagem:

```text
Provider.describe() -> id, nome, tipo, autenticação, destino, modelos, capabilities
Provider.check(config) -> disponibilidade | erro tipado
Provider.generate(request, cancellation) -> stream<evento>
request = { tarefa, idioma, transcriptChunks, schemaVersion, jsonSchema,
            model, limits, deadline, idempotencyKey }
evento = progress | partialText | usage | result | error
result = { data, providerId, model, usage?, finishReason, schemaVersion }
```

`generate` retorna somente um `result` final após parsing e validação local; `partialText` nunca é persistido como Corte válido. A capacidade anuncia `schema` nativo, JSON apenas ou texto, streaming, tamanho de contexto, ferramentas e limites conhecidos; recurso desconhecido é desconhecido, não `true`. Mapear a mesma solicitação para adaptadores Claude/OpenAI/Gemini nativos, compatível OpenAI, locais e cada CLI aprovado. Não transformar assinatura em chave nem chamar endpoints privados. Validação de domínio: lista limitada de candidatos com `start < end`, ambos dentro da duração da Fonte e alinhados à Transcrição, título no idioma pedido e score finito em escala documentada; submeter a revisão humana. `schemaVersion` permite evolução explícita. Evitar que o LLM altere a Fonte, transcreva novamente ou gere tempos sem referência verificável.

Para VOD longo: dividir a Transcrição em janelas com sobreposição e IDs/tempos absolutos, selecionar candidatos por janela e consolidar duplicatas; respeitar orçamento de contexto, custo e duração. **Inferência:** isso reduz truncamento e permite retomar trabalhos, mas exige avaliação para não perder contexto entre janelas. Erros tipados: não instalado, autenticação, plano/quota, rate limit com `retry-after`, indisponibilidade, rede, timeout, cancelamento, schema, recusa e resposta truncada. Retentativas limitadas apenas para erros transitórios; sem fallback automático entre Provedores ou cobrança. Metadados podem ficar locais; segredos no cofre do sistema, nunca em log. Exibir previamente Provedor, modelo, destino, conteúdo transmitido e risco de custo. Testar contratos com servidores simulados e testes opcionais reais por Provedor, versões de CLI, esquemas recusados, cancelamento, idiomas, prompts hostis e Windows/Linux/macOS.

## Perguntas em aberto

1. A Anthropic autoriza especificamente o Clipes a oferecer assinatura de usuário via `claude -p` ou Agent SDK? Como conciliar ajuda e restrição do SDK? Obter resposta escrita.
2. A Google considera subprocesso oficial Gemini CLI com login próprio um uso permitido por um app terceiro? Qual a diferença contratual em relação ao acesso direto vedado?
3. O Clipes e seu fluxo específico satisfazem os requisitos atuais do Sign in with ChatGPT e de Codex para uso de plano? Quais aprovações ou restrições adicionais se aplicam?
4. Qual stack desktop e runtime serão adotados, e qual biblioteca tem menor custo de distribuição e manutenção nessa stack?
5. Qual substituto atual da OpenAI fornece timestamps por palavra para VOD após o encerramento do `whisper-1`, e qual alinhador local produz qualidade suficiente para PT-BR/EN?
6. Quais versões reais de CLIs permitem desativar todas as ferramentas, extensões e contexto herdados nos três sistemas? Testar, documentar e revalidar a cada atualização.
7. Qual combinação de modelos locais atende qualidade, latência e memória em máquinas só com CPU? Medir com corpus de avaliação representativo, sem prometer paridade.
