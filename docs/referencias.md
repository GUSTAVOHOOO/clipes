# Referências externas

Projetos de fora que estudamos e que valem uma segunda visita. Cada entrada diz o que é, o que serve para o Clipes e onde isso já foi parar nas issues. Para copiar código, siga a regra de licença do [ADR-0002](adr/0002-hyperframes-como-referencia-render-ffmpeg-libass.md): manter o cabeçalho original, marcar "Modificado pelo Clipes" e registrar em `THIRD_PARTY_NOTICES.md`.

## HyperFrames

- **Link:** https://github.com/heygen-com/hyperframes (HeyGen, Apache-2.0)
- **O que é:** vídeo escrito em HTML/CSS/JS e renderizado quadro a quadro num Chrome headless.
- **Decisão:** é referência e fonte de código; o render do Clipes é FFmpeg + libass. Ver [ADR-0002](adr/0002-hyperframes-como-referencia-render-ffmpeg-libass.md).

## OpenMotion

- **Link:** https://github.com/nexu-io/openmotion (nexu-io, Apache-2.0)
- **Visto em:** 15/11/2026. Na época, fixava `hyperframes@0.9.7`, `gsap@3.15.0` e `puppeteer-core`.
- **O que é:** um estúdio para recriar vídeos de marca e lançamento de produto em HTML, comandado por um agente local (Claude Code, Codex e outros) via MCP. Roda em cima do HyperFrames, então o render dele é o mesmo Chrome headless que o ADR-0002 descartou como render principal.
- **Atenção:** o repositório tem ~600 MB. Para ler, prefira `gh api repos/nexu-io/openmotion/contents/<caminho>` a clonar.

O que serve para o Clipes:

| # | Ideia | Onde está no OpenMotion | Para onde foi |
|---|---|---|---|
| 1 | Edição de legenda por palavra guardada à parte, ligada a um ID estável da palavra (`caption-overrides.json` com IDs como `"w0"`), para sobreviver quando a legenda é gerada de novo | `studio/src/captions/types.ts` (`CaptionSegment.wordId`) | [#65](https://github.com/GUSTAVOHOOO/clipes/issues/65). No Clipes, a identidade da palavra já é `(transcript_id, position)` e a correção de texto fica em `corrected_text` (#52) |
| 2 | Verificação técnica do arquivo exportado: ffprobe, decodificação completa, duração com tolerância, busca em quadros representativos, SHA-256 e relatório `passed/failed` | `scripts/verify-export.ts` | [#59](https://github.com/GUSTAVOHOOO/clipes/issues/59) e [#64](https://github.com/GUSTAVOHOOO/clipes/issues/64) |
| 3 | Modelo de estilo da legenda karaokê: `activeColor`/`dimColor`, contorno, sombras, brilho, caixa de fundo, animação de entrada, destaque e saída | `studio/src/captions/types.ts` (`CaptionStyle`, `CaptionAnimationSet`) | [#65](https://github.com/GUSTAVOHOOO/clipes/issues/65). A animação deles usa GSAP, que fica fora (ADR-0002) |
| 4 | TTS com Kokoro | `gateway/catalog.ts` (Kokoro via fal.ai, na nuvem) | Já estava planejado localmente em [#79](https://github.com/GUSTAVOHOOO/clipes/issues/79) |
| 5 | Brand Kit / Motion.md: a identidade do canal num arquivo Markdown que a IA lê | `docs/motion-md.md`, `docs/motion-package-spec.md` | [#72](https://github.com/GUSTAVOHOOO/clipes/issues/72) |
| 6 | Servidor MCP para agentes de fora comandarem o projeto, com checagem de revisão (`expectedRevision`) contra edição desatualizada | `mcp.ts`, `mcp-tools.ts`, `docs/mcp-phase1-tools.md` | [#192](https://github.com/GUSTAVOHOOO/clipes/issues/192), pós-v1, em triagem |

O que não serve: o render em HTML/Chrome, os templates de vídeo de marca, a geração de vídeo e música por IA (Seedance, Suno) e o plugin do ChatGPT.
