---
status: accepted
---

# Dois tipos de vídeo, TTS na v1 e regras de Transformação

O Clipes atende a dois públicos com dois tipos de vídeo:

- **Corte direto**, para Canais de cortes: produção automática e rápida. A monetização corre risco pela política de conteúdo reutilizado do YouTube, que vale mesmo com permissão do criador. Isso pode valer a pena, dependendo do streamer.
- **Vídeo transformado**, para Canais dark: produção "caseira", com um humano no loop. Usa Narração, Roteiro e compilação com narrativa.

O TTS entra na **v1** (antes era melhoria futura), porque é o caminho principal de Narração para quem não quer usar a própria voz. Decisão do dev em 12/11/2026, a partir da [pesquisa de Canais dark](../research/2026-11-12-canais-dark.md). Publicação direta nas redes e dublagem continuam como melhorias futuras.

## Regras de negócio

1. **O tipo é escolhido antes da produção e fica visível.** Todo vídeo é um Corte direto ou um Vídeo transformado. O app mostra o tipo e o que ele implica.
2. **O risco do Corte direto é dito, não escondido.** Ao produzir Cortes diretos, o app avisa uma vez por canal que a monetização pode ser recusada mesmo com permissão. Não bloqueia: a escolha é do usuário.
3. **Permissão por Fonte.** Toda Fonte de terceiros tem uma Permissão registrada (quem autorizou, onde, escopo) ou um aviso de que não tem. A Permissão protege contra direitos autorais, mas não garante monetização.
4. **Transformação exige contribuição criativa.** Um Vídeo transformado precisa de pelo menos uma Transformação real: Narração com comentário ou análise, Roteiro com contexto ou compilação com narrativa. Legenda, enquadramento, título, filtros, mudança de velocidade, crop ou música trocada **não contam**.
5. **Humano no loop no Vídeo transformado.** O Provedor pode sugerir Roteiro, ganchos e ordem da compilação, mas o usuário revisa e aprova o Roteiro antes da Narração ser gerada ou gravada. Não existe Vídeo transformado 100% automático.
6. **A Narração pode ser TTS ou a voz do usuário.** As duas opções existem desde a v1. O TTS lê um Roteiro revisado, nunca texto gerado e não revisado.
7. **Sem produção em massa indistinguível.** O app não gera em lote vídeos quase iguais (mesmo template, mesma música, roteiro genérico). A política de spam do YouTube cita exatamente "ler roteiro gerado por IA" em volume.
8. **Nenhum recurso de evasão.** O Clipes não oferece nada para escapar de detecção: acelerar áudio, filtros pesados, crop, espelhamento ou alteração de tom para enganar o Content ID.
9. **Ritmo de publicação com limite sugerido** por canal, para evitar o padrão de spam. Vale quando a publicação direta existir; até lá, fica como orientação no app.

## Opções consideradas

- **Só Vídeo transformado:** mais seguro, mas abandona os Canais de cortes, que querem velocidade e muitas vezes têm acordo com o streamer.
- **Só Corte direto (como Opus e Vizard):** é o que os concorrentes fazem, mas deixa os Canais dark expostos à desmonetização sem oferecer saída.
- **TTS só depois da v1:** sem TTS, a v1 só teria a voz do usuário como Narração. A maioria dos Canais dark não quer usar a própria voz.
