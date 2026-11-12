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

**Motor de transcrição** (Transcription Engine)
O que produz a Transcrição. Pode ser local, rodando na máquina do usuário (o padrão), ou remoto, via API paga escolhida pelo usuário.
_Evitar_: modelo de transcrição (o modelo é uma escolha dentro de um Motor)

**Provedor** (Provider)
O backend de LLM que escolhe e pontua Cortes, sugere o Empacotamento e os Roteiros e traduz legendas. Ele recebe só texto e aponta trechos da Transcrição: nunca define tempos por conta própria. Existe em três tipos: **assinatura via CLI** (um agente como Claude Code ou Codex usando a assinatura do usuário), **chave de API** e **modelo local**.
_Evitar_: IA, modelo, conta
