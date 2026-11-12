# Catálogo funcional: Vizard.ai

Consulta: 12/11/2026. Escopo: fontes públicas, sem acesso indevido nem engenharia reversa de código. O catálogo cobre as funções identificadas; não é prova de exaustividade do produto em evolução. Planos e interfaces podem mudar.

## Resumo executivo

- O Vizard transforma uma Fonte falada em Cortes editáveis, com Transcrição, enquadramento e legendas, e complementa o fluxo com publicação e colaboração. [Vizard](https://help.vizard.ai/en/articles/8768631-how-does-vizard-work)
- Recomendo ao Clipes priorizar Transcrição local com timestamps, seleção de trechos por Provedor, revisão textual, enquadramento corrigível e exportação de Cortes com legendas.
- A vantagem mais útil do Vizard para estudar é permitir edição no plano gratuito; OpusClip anuncia editor nos planos pagos. [Vizard](https://vizard.ai/pricing), [OpusClip](https://www.opus.pro/pricing)
- Não prometer equivalência ao ClipAnything: o Opus anuncia compreensão multimodal de ação e áudio não falado; o Vizard orienta o clipping para diálogo. [Opus](https://www.opus.pro/clipanything), [Vizard](https://help.vizard.ai/en/articles/8767566-how-many-clips-can-ai-generate)
- O Vizard Agent é uma oferta adjacente, com créditos próprios; geração de vídeo, dublagem e colaboração remota ficam atrás do fluxo VOD local da v1. [Agent API](https://agent.vizard.ai/api)

## Planos e limites observáveis

| Plano do produto de Cortes | Oferta e limites publicados |
|---|---|
| Free | US$ 0, 60 créditos/mês, 1 conta social, Fonte de até 60 min/1 GB/1080p, exportação até 10 min/720p, armazenamento por 3 dias e editor completo. [Preço](https://vizard.ai/pricing) |
| Creator | Pago; a partir de 600 créditos/mês, espaço privado, 6 contas sociais, Fonte até 600 min/30 GB/4K, exportação 4K e 100 GB de armazenamento. Remoção de marca d'água é anunciada como benefício pago. [Preço](https://vizard.ai/pricing) |
| Business | Pago; a partir de 600 créditos/mês, espaço compartilhado, 20 contas sociais, compartilhamento de projetos, kit de marca e armazenamento enquanto assina; limites de Fonte e exportação como Creator. [Preço](https://vizard.ai/pricing) |

A página apresenta valores pagos dinâmicos como US$ 0 no texto extraído, portanto não são preços confiáveis; confirmar no seletor de cobrança. A tabela anuncia 1/3/10 requisições por minuto e 10/20/60 por hora, respectivamente, mas a documentação de API diz que acesso de clipping exige Creator ou Business: disponibilidade no Free é contraditória. A página da API também diz máximo de 10 GB por envio, distinto dos 30 GB da interface paga. [Preço](https://vizard.ai/pricing), [preço da API](https://docs.vizard.ai/docs/pricing). Em clipping ou Transcrição, 1 crédito corresponde a 1 minuto processado, cobrado uma vez por projeto mesmo usando ambos. [Créditos](https://help.vizard.ai/en/articles/12017624-how-credits-are-used-for-ai-processing)

**Legenda do catálogo:** F = Free, C = Creator, B = Business; “não confirmado” significa que a tabela pública menciona a função, mas os indicadores de elegibilidade não ficaram legíveis. A disponibilidade de um recurso não implica créditos, cotas ou ausência de marca d'água ilimitados. As técnicas descritas abaixo são **inferências**, não alegações sobre a implementação proprietária. Os equivalentes são referências funcionais, não auditorias de maturidade, compatibilidade ou licença.

## Catálogo: criação e edição

| Função e evidência | Entrada → saída e benefício | Plano | Provável técnica e equivalente aberto |
|---|---|---|---|
| [Importação e projeto](https://help.vizard.ai/en/collections/8477560-upload) | Arquivo ou link → projeto para processamento; aceita legenda externa. | F/C/B, sujeitos aos limites acima. | **Inferência:** ingestão, validação e decodificação; [FFmpeg](https://ffmpeg.org/) e [yt-dlp](https://github.com/yt-dlp/yt-dlp) para fontes suportadas. |
| [Transcrição e idiomas](https://help.vizard.ai/en/articles/8767561-what-languages-are-supported) | Fala da Fonte → texto usado no editor e em legendas; lista português e inglês, sem especificar variante PT-BR. | F/C/B; TXT e SRT por plano na tabela, mas associação exata não confirmada. [Preço](https://vizard.ai/pricing) | **Inferência:** reconhecimento de fala e alinhamento temporal; [whisper.cpp](https://github.com/ggml-org/whisper.cpp) ou [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Não foi confirmado que o Vizard exporta timestamps por palavra. |
| [Legendas importadas](https://help.vizard.ai/en/articles/13568601-how-to-add-subtitle-file-to-your-video) | SRT com tempos, ou TXT/DOC/DOCX com tempos gerados, mais Fonte → legendas sincronizadas. | Não confirmado. | **Inferência:** parsing e alinhamento forçado; [WhisperX](https://github.com/m-bain/whisperX). |
| [Seleção automática, duração e prompt](https://help.vizard.ai/en/articles/8767566-how-many-clips-can-ai-generate) | Fonte falada, duração e eventual pedido textual → candidatos; prompts reduzem quantidade de resultados; mais material falado oferece mais oportunidades. | F/C/B, com créditos. | **Inferência:** segmentação de Transcrição, LLM para momentos e pontuação, ajuste em frases; [AutoClip](https://github.com/Gutsken/Autoclip). A avaliação de viralidade não é garantia de resultado. |
| [Preferências de Corte](https://help.vizard.ai/en/articles/9188600-what-are-clip-preferences) | Duração, 9:16/1:1, modelos, emojis e destaque → Cortes formatados; modelo pode adaptar layout ao conteúdo. | Clipping em F/C/B; elegibilidade de cada estilo não confirmada. | **Inferência:** parâmetros estruturados aplicados a uma composição; [OpenClipper](https://github.com/GrepCut/OpenClipper). |
| [Edição textual e manual](https://help.vizard.ai/en/articles/8984381-how-to-extend-and-add-more-content-to-ai-generated-clips) | Texto selecionado ou restauração de trecho → Corte manual ou ampliação de candidato. Permite corrigir frases cortadas. | F/C/B para editor; limites por recurso não confirmados. | **Inferência:** mapa texto-tempo e lista de intervalos não destrutiva; [Chopify](https://github.com/mehbul/chopify). |
| [Legendas e estilo](https://help.vizard.ai/en/collections/8474224-editor) | Transcrição → legendas sobre o Corte; editar emojis, unir/dividir linhas e removê-las. | Editor F/C/B; funções individuais não confirmadas. | **Inferência:** segmentação temporal, estilos e composição; [FFmpeg/libass](https://ffmpeg.org/ffmpeg-filters.html#subtitles), [Reframe](https://github.com/Prekzursil/Reframe). |
| [Tradução de legendas](https://help.vizard.ai/en/articles/8767561-what-languages-are-supported) | Legendas e idioma-alvo → legendas traduzidas, incluindo português e inglês na lista. | Não confirmado. | **Inferência:** tradução por segmentos e redistribuição temporal; [Argos Translate](https://github.com/argosopentech/argos-translate). Qualidade e suporte a PT-BR exigem teste. |
| [Enquadramento e cenas](https://help.vizard.ai/en/articles/9188600-what-are-clip-preferences) | Vídeo horizontal e layout escolhido → composição vertical ou quadrada; layouts podem priorizar palestrante ou tela. | Auto reframe consta na tabela; plano exato não confirmado. | **Inferência:** detecção/seguimento de rosto, falante e regiões de tela; suavização e renderização; [OpenClipper](https://github.com/GrepCut/OpenClipper). |
| [Templates, outros e marca](https://vizard.ai/pricing) | Estilos, fontes, logos e outros → identidade aplicada a Cortes. | Kit de marca e workspace compartilhado em B; disponibilidade exata de templates próprios, fontes e outros em F/C não confirmada. | **Inferência:** modelos de composição com parâmetros reutilizáveis; [OpenShot](https://www.openshot.org/) como editor aberto, sem paridade automática comprovada. |
| [B-roll, emojis e palavras em destaque](https://vizard.ai/pricing) | Conteúdo e estilo → inserções visuais e destaque textual. | Itens constam na comparação; elegibilidade não confirmada. | **Inferência:** classificação semântica e seleção de mídia/emoji, render com timestamps; [clipyyy](https://github.com/T3-Venture-Labs-Limited/clipyyy) oferece B-roll opcional de acervo externo, não equivalente à geração. |
| [AI Edit beta](https://help.vizard.ai/en/articles/16658532-what-is-ai-edit) | Corte 9:16 com pessoa detectada, 15 s–3 min, mais estilo → versão com transições, B-roll e zoom. Custa 0,5 crédito/s; sem lote, agendamento ou API nesse recurso. | Não confirmado. | **Inferência:** análise de áudio/vídeo e planejamento de efeitos na timeline; [Reframe](https://github.com/Prekzursil/Reframe) é aproximação parcial. Não confundir com modo de edição de vídeo curto da API. |
| [Modo de edição da API](https://docs.vizard.ai/docs/submit-a-short-video-for-editing) | Vídeo com menos de 3 min e opções de subtítulo/B-roll/emoji/logo/outro → vídeo editado, sem procurar Cortes (`getClips=0`). | API documentada para C/B. | **Inferência:** pipeline parametrizado de composição; [FFmpeg](https://ffmpeg.org/) e [AutoClip](https://github.com/Gutsken/Autoclip), combinados. |

## Publicação, integração e produtos adjacentes

| Função e evidência | Entrada → saída e benefício | Plano | Provável técnica e equivalente aberto |
|---|---|---|---|
| [Publicação e calendário](https://help.vizard.ai/en/articles/10441547-how-to-schedule-using-the-calendar) | Cortes exportados, contas, data, descrição e hashtags → posts programados; sugestão de texto editável. | Uma/seis/vinte contas em F/C/B; agendamento e publicação por plano não confirmados. | **Inferência:** OAuth, fila agendada e APIs das redes; [Mixpost](https://github.com/inovector/mixpost), paridade por rede não verificada. |
| [Capas](https://help.vizard.ai/en/articles/10441615-how-to-customize-thumbnails-for-my-videos) | JPG/PNG ou quadro do vídeo → capa; disponibilidade depende da rede. | Não confirmado. | **Inferência:** extração de quadro ou upload via API social; [FFmpeg](https://ffmpeg.org/) para extração. |
| [Compartilhamento e equipe](https://vizard.ai/pricing) | Projeto/exportação e participantes → revisão e trabalho compartilhados; kit de marca. | B inclui projetos, workspace e membros; link de exportação consta na tabela, plano exato não confirmado. | **Inferência:** armazenamento, identidades e ACL; [Nextcloud](https://github.com/nextcloud/server) aproxima compartilhamento, não edição colaborativa equivalente. |
| [API de clipping e publicação](https://docs.vizard.ai/docs/pricing) | Envio programático de Fonte → projeto visível no workspace e Cortes editáveis; [endpoint publica](https://docs.vizard.ai/docs/publish-clips-to-social-media) em conta conectada. | C/B segundo docs; inconsistência com tabela acima. | **Inferência:** jobs assíncronos, armazenamento e endpoints autenticados; [clipyyy](https://github.com/T3-Venture-Labs-Limited/clipyyy) oferece CLI JSON, não a mesma API. |
| [Vizard Agent](https://agent.vizard.ai/api) | Brief, arquivos e modelo → projeto de edição, perguntas e vídeos; templates incluem podcast, anúncios, vídeo gerado, dublagem, avatar, multicâmera e Transcrição. | Planos próprios: Free com Flash e até 2 projetos; Creator com Pro/Max/Ultra; créditos e cobrança próprios. [Planos](https://agent.vizard.ai/pricing) | **Inferência:** agente orquestra ferramentas de edição e geração; [Reframe](https://github.com/Prekzursil/Reframe) tem editor por prompt e é aproximação parcial, não equivalente aos templates generativos. Não presumir que todas as saídas do Agent existam no editor de Cortes. |

O [review independente CIHQ](https://creatorintelhq.com/reviews/vizard-ai-review/) relata teste de upload, legendas, enquadramento e marca d'água, observando erros de legenda e enquadramento; é fonte secundária com links de afiliado e não prova comportamento universal. A [Capterra](https://www.capterra.com/p/10009818/Vizard/reviews/) inclui relatos de ajustes manuais e dificuldade com idiomas; avaliações são experiências individuais, não benchmark.

## Comparação funcional com OpusClip

| Diferença documentada | Implicação |
|---|---|
| Vizard anuncia editor completo no Free; a [página de preços do Opus](https://www.opus.pro/pricing) reserva edição ao plano pago, e seu [blog](https://www.opus.pro/blog/best-ai-video-search-tools) diz que Free não tem edição. [Vizard](https://vizard.ai/pricing) | Diferencial de disponibilidade do Vizard, não exclusividade funcional. |
| O [ClipAnything](https://www.opus.pro/clipanything) anuncia busca por ação, objeto, som e emoção, inclusive vídeo com pouco diálogo; o [Vizard](https://help.vizard.ai/en/articles/8767566-how-many-clips-can-ai-generate) recomenda diálogo e oferece busca por prompt. | Opus anuncia capacidade multimodal mais ampla; não se pode concluir que o Vizard nunca analisa imagem ou som. |
| [Opus](https://www.opus.pro/pricing) anuncia remoção de silêncio e palavras de preenchimento no Starter e exportação para editores profissionais em planos superiores. | Não encontrei documentação primária suficiente para afirmar ausência dessas funções no Vizard; tratar como diferencial confirmado apenas da oferta documentada. |
| [Vizard Agent](https://agent.vizard.ai/api) documenta vários templates e API de agente, inclusive multicâmera e localização. | O escopo é amplo, mas não foi demonstrado que algum desses templates seja exclusivo perante toda a linha Opus; comparar produto a produto antes de alegar exclusividade. |

Ambos anunciam clipping, legendas, enquadramento, publicação e opções para equipes; isso não estabelece igualdade de qualidade nem suporte idêntico por plano. [Vizard](https://vizard.ai/pricing), [Opus](https://www.opus.pro/pricing).

## Ranking para Clipes

1. **Transcrição local e correção:** base dos Cortes e das legendas; testar PT-BR/EN, timestamps por palavra, CPU e aceleração GPU opcional. [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
2. **Seleção e revisão humana:** Provedor configurável sugere intervalos, título e justificativa; edição textual recupera contexto quando uma frase é truncada. [Vizard](https://help.vizard.ai/en/articles/8984381-how-to-extend-and-add-more-content-to-ai-generated-clips)
3. **Legendas sincronizadas e exportação:** prévia, correção e formatos sociais formam a entrega mínima utilizável. [Editor](https://help.vizard.ai/en/collections/8474224-editor)
4. **Enquadramento automático corrigível:** seguir falante, preservar tela e oferecer composição manual; testar várias pessoas e jogos antes de assumir qualidade. [Preferências](https://help.vizard.ai/en/articles/9188600-what-are-clip-preferences)
5. **Modelos de estilo locais:** configurações reutilizáveis para consistência, sem obrigar serviço de marca. [Preço](https://vizard.ai/pricing)
6. **Busca por prompt, B-roll e publicação:** úteis depois da base; multimodal e integrações de rede elevam custo e dependências. [Vizard](https://help.vizard.ai/en/articles/8767566-how-many-clips-can-ai-generate), [calendário](https://help.vizard.ai/en/articles/10441547-how-to-schedule-using-the-calendar)

A ordem é recomendação deste estudo, não roadmap aprovado. O Clipes deve manter VOD, desktop Windows primeiro com arquitetura portátil, Provedor selecionável e dados locais por padrão, conforme restrições do projeto.

## Fluxos que valem captura HAR

Capturar somente sessão e Fonte próprias com permissão, usando recursos acessíveis normalmente; remover tokens, cookies, URLs assinadas e dados pessoais antes de compartilhar. HAR documenta tráfego observável, não autoriza contornar limites nem copiar código ou assets.

1. Importar pequena Fonte pública própria, escolher idioma, duração e prompt; observar envio, estados, falhas e cobrança.
2. Abrir candidato e corrigir início/fim por Transcrição; comparar preview, persistência e exportação.
3. Alterar proporção, cenas e enquadramento com dois falantes/tela; observar operações e resultados.
4. Editar palavras, quebrar legendas, importar SRT e traduzir PT-BR/EN; observar sincronização e tratamento de erro.
5. Aplicar modelo, B-roll e AI Edit se disponíveis na conta; registrar elegibilidade, custos e estados sem ultrapassar a cota.
6. Exportar e recuperar arquivo; opcionalmente conectar conta de teste e agendar/cancelar uma publicação, sem publicar conteúdo involuntariamente.
7. Na API autorizada, submeter projeto e acompanhar estados e resultado; não presumir que endpoints internos da interface sejam públicos.

## Perguntas em aberto

- Quais ticks por recurso e preços pagos atuais aparecem no seletor interativo? A extração textual omite marcações e valores corretos.
- A API realmente aceita Free? A página de preços apresenta limite Free, enquanto a documentação exige plano pago; qual limite de arquivo vale em cada fluxo?
- Quais recursos têm interface em PT-BR, timestamps por palavra exportáveis e qualidade verificável de Transcrição em PT-BR?
- Que precisão e latência têm seleção, corte de frases, múltiplos falantes e reframing em VODs de jogos, música e fala ruidosa? Não houve ensaio controlado.
- Quais funções são exclusivas de cada produto frente à linha completa Opus, inclusive Agent Opus? Ausência em fontes consultadas não demonstra inexistência.
- Quais funções de AI Edit, importação, tradução e publicação estão efetivamente disponíveis em cada plano e região? Os créditos do Agent e do produto principal são intercambiáveis? Não confirmado.
