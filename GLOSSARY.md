# Glossário

Termos canônicos do domínio. Português na conversa e nos docs; o nome em inglês entre parênteses é o usado no código.

**Canal dark** (Dark Channel)
Canal de vídeos sem rosto nem identidade do apresentador, que publica Cortes e vídeos produzidos a partir de Fontes de terceiros com permissão (por exemplo, criadores que liberam cortes). É o público-alvo do Clipes: o produto é uma fábrica de Cortes e vídeos para Canais dark.
_Evitar_: canal faceless, canal de cortes

**Fonte** (Source)
O vídeo original de onde os Cortes são extraídos: um arquivo local ou uma live já gravada (VOD).
_Evitar_: vídeo original, input

**VOD** (VOD)
Gravação de uma live depois de encerrada. É o único tipo de live que vira Fonte; corte em tempo real não existe neste vocabulário.

**Corte** (Clip)
Trecho curto gerado a partir de uma Fonte, com legenda e enquadramento próprios, pronto para exportar.
_Evitar_: clipe, short, highlight

**Transcrição** (Transcript)
O texto falado da Fonte com timestamps por palavra. Os Cortes são escolhidos a partir dela e as legendas saem dela.
_Evitar_: legenda (legenda é o que aparece no Corte, derivada da Transcrição)

**Motor de transcrição** (Transcription Engine)
O que produz a Transcrição. Pode ser local, rodando na máquina do usuário (o padrão), ou remoto, via API paga escolhida pelo usuário.
_Evitar_: modelo de transcrição (o modelo é uma escolha dentro de um Motor)

**Provedor** (Provider)
O backend de LLM que escolhe e pontua Cortes e escreve títulos. Existe em três tipos: **assinatura via CLI** (um agente como Claude Code ou Codex usando a assinatura do usuário), **chave de API** e **modelo local**.
_Evitar_: IA, modelo, conta
