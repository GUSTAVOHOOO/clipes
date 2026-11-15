# Glossário

Termos canônicos do domínio. Português na conversa e nos docs; o nome em inglês entre parênteses é o usado no código.

## Públicos e tipos de vídeo

**Canal de cortes** (Clip Channel)
Canal que publica Cortes diretos das lives de um criador, normalmente com a permissão dele (por exemplo, em programas de cortes). Um dos dois públicos do Clipes.
_Evitar_: canal dark (são públicos diferentes)

**Canal dark** (Dark Channel)
Canal sem rosto nem identidade do apresentador que publica Vídeos transformados feitos a partir de Fontes de terceiros com permissão. O outro público do Clipes.
_Evitar_: canal faceless

**Corte direto** (Direct Clip)
Corte publicado como saiu da Fonte, só com legenda, enquadramento e título, sem Transformação. Monetização em risco pela política de conteúdo reutilizado, mesmo com permissão do criador.
_Evitar_: corte cru, clip puro

**Vídeo transformado** (Transformed Video)
Vídeo feito a partir de um ou mais Cortes com Transformação, produzido com um humano no loop que revisa e assina a contribuição criativa.
_Evitar_: vídeo dark, vídeo autoral

**Transformação** (Transformation)
Contribuição criativa própria que muda o sentido de um material de terceiros: narração com comentário ou análise, roteiro com contexto, compilação com narrativa. Legenda, enquadramento, título, filtros e mudança de velocidade não são Transformação.

**Narração** (Narration)
Faixa de voz por cima do vídeo que entrega a Transformação: gravada pelo usuário ou sintetizada (TTS) a partir de um Roteiro.
_Evitar_: voice-over, locução

**Roteiro** (Script)
Texto da Narração. Pode ser sugerido pelo Provedor a partir da Transcrição, mas só vale depois que o usuário o revisa.

**Perfil de canal** (Channel Profile)
Conjunto salvo de escolhas para um canal do usuário: tipo de vídeo padrão, idioma, voz da Narração, estilo de legenda e Fontes permitidas. Um usuário pode ter vários, um por canal.
_Evitar_: preset, template, conta

**Empacotamento** (Packaging)
O que acompanha um vídeo na publicação, sugerido a partir da Transcrição e editável: título, descrição com crédito da Fonte, tags, hashtags e ideia de thumbnail.
_Evitar_: metadados, SEO

**Permissão** (Permission)
Registro de que o criador da Fonte autorizou o uso do material, com origem e escopo. Protege contra reivindicações de direitos autorais, mas não garante monetização.

## Material e processamento

**Projeto** (Project)
O conjunto portátil de tudo o que o usuário produz para um canal: Fontes, Transcrições, Cortes, Vídeos transformados e Empacotamento, junto com o Perfil de canal. Por padrão, é um por canal. A Fonte fica referenciada, não copiada: se o arquivo sumir, a Fonte fica offline até ser relocalizada.
_Evitar_: biblioteca, workspace, pasta

**Fonte** (Source)
O vídeo original de onde os Cortes são extraídos: um arquivo local ou uma live já gravada (VOD).
_Evitar_: vídeo original, input

**VOD** (VOD)
Gravação de uma live depois de encerrada. É o único tipo de live que vira Fonte; corte em tempo real não existe neste vocabulário.

**Corte** (Clip)
Trecho curto gerado a partir de uma Fonte, com legenda e enquadramento próprios, pronto para exportar.
_Evitar_: clipe, short, highlight

**Transcrição** (Transcript)
O texto falado da Fonte com timestamps por palavra, registrado no idioma em que foi dito. Os Cortes são escolhidos a partir dela e as legendas saem dela.
_Evitar_: legenda (legenda é o que aparece no Corte, derivada da Transcrição)

**Frase** (Sentence)
Menor trecho da Transcrição que pode ser apontado: termina numa pontuação ou numa pausa da fala. As bordas de um Corte sempre coincidem com bordas de Frase.
_Evitar_: segmento, sentença

**Janela de contexto** (Context Window)
Limite de tokens que um modelo comporta numa chamada, incluindo entrada, saída e raciocínio quando houver. O contexto efetivo de um Perfil de Provedor é o limite disponível para aquela configuração; pode ser menor que o máximo anunciado pelo modelo.
_Evitar_: janela sozinha (confunde com Janela de seleção)

**Janela de seleção** (Selection Window)
Trecho da Transcrição analisado numa etapa da seleção de Cortes. Janelas vizinhas se sobrepõem para preservar Cortes nas bordas; o núcleo dimensiona cada uma para caber na Janela de contexto do Perfil de Provedor.
_Evitar_: janela sozinha, Janela de contexto (é o limite do modelo, não o trecho)

**Nota** (Score)
Avaliação explicável do potencial de um Corte, formada por eixos nomeados (como Gancho, Autossuficiência e Fechamento), cada um com uma justificativa. Não é previsão de views.
_Evitar_: score viral, pontuação de viralidade

**Motor de transcrição** (Transcription Engine)
O que produz a Transcrição. Pode ser local, rodando na máquina do usuário (o padrão), ou remoto, via API paga escolhida pelo usuário.
_Evitar_: modelo de transcrição (o modelo é uma escolha dentro de um Motor)

**Provedor** (Provider)
O backend de LLM que escolhe e pontua Cortes, sugere o Empacotamento e os Roteiros e traduz legendas. Ele recebe só texto e aponta trechos da Transcrição: nunca define tempos por conta própria. Existe em três tipos: **assinatura via CLI** (um agente como Claude Code ou Codex usando a assinatura do usuário), **chave de API** e **modelo local**.
_Evitar_: IA, modelo, conta

**Perfil de Provedor** (Provider Profile)
Conjunto salvo de um Provedor já configurado: nome livre, tipo, endpoint, modelo, preço e chave no cofre. Pode haver vários ao mesmo tempo, e cada Tarefa de IA aponta para um por regra fixa que o usuário escolhe. Não existe perfil padrão de fábrica, e nem o Projeto nem o Perfil de canal escolhem um.
_Evitar_: perfil sozinho (confunde com Perfil de canal), conta, preset

**Tarefa de IA** (AI Task)
Cada trabalho que o Provedor faz no app: seleção de Cortes, Empacotamento, Roteiro e tradução. É um workflow fixo no núcleo, com prompt versionado, schema de saída, verificadores e orçamento, e nunca um agente com ferramentas.
_Evitar_: agente, prompt, chamada (a chamada é só um passo da tarefa)

**Somente local** (Local Only)
Restrição que proíbe enviar texto para fora da máquina. Vale por tarefa e como veto por Projeto: só proíbe, nunca escolhe Provedor. Local quer dizer só loopback; servidor na rede local e CLIs não contam.
_Evitar_: modo offline, modo privado
