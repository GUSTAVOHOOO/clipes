---
status: accepted
---

# Apache-2.0, FFmpeg sob demanda e política de modelos

O Clipes é licenciado sob **Apache-2.0**: código, documentação e assets do repositório. Decisão do dev em 12/11/2026, no grilling do [#21](https://github.com/GUSTAVOHOOO/clipes/issues/21).

Os motivos:
- é a licença do HyperFrames, de onde copiamos código ([ADR-0002](0002-hyperframes-como-referencia-render-ffmpeg-libass.md));
- tem concessão explícita de patentes, o que importa num app de vídeo;
- não afasta quem quer contribuir ou usar o Clipes.

O risco aceito é que alguém faça um fork fechado e o venda. A vantagem do Clipes está em ser local, gratuito e aberto, e não no segredo do código.

## Regras que acompanham a licença

1. **O FFmpeg é um executável separado, baixado sob demanda.** Uma build GPL conhecida (BtbN ou gyan.dev) é baixada sob demanda, com a opção de usar o FFmpeg já instalado no sistema. O Clipes chama o executável e nunca linka as bibliotecas do FFmpeg, então a GPL não alcança o código do Clipes. A tela de download mostra a licença e o link do código-fonte da build. Como não somos nós que distribuímos o encoder H.264, o instalador também fica fora da questão de patentes do H.264.
2. **Os modelos e componentes baixados sob demanda** precisam ter código **e** pesos que permitam uso comercial e sejam compatíveis com o Clipes. A tela de download mostra a licença de cada um. As atribuições exigidas, como a CC-BY-4.0 do Parakeet, aparecem na tela "Sobre" e no `THIRD_PARTY_NOTICES.md`. Nada com licença não comercial ou de pesquisa entra, nem como opção. Já ficaram fora por isso: XTTS-v2, os pesos oficiais do F5-TTS, o Fish S2-Pro, o YOLO da Ultralytics (AGPL) e o GSAP no núcleo.
3. **O que o usuário gera é dele.** Isso vale para Cortes, Roteiros, Narrações e Empacotamento. O app não coloca marca d'água. Os direitos sobre a Fonte continuam sendo do criador dela, e a Permissão é responsabilidade do usuário.
4. **As contribuições usam DCO.** Cada commit leva `Signed-off-by`, verificado por um app do GitHub. Não há CLA.

## Opções consideradas

- **MIT:** é equivalente na prática, mas não tem a cláusula de patentes. O código copiado do HyperFrames continuaria exigindo os avisos da Apache.
- **GPLv3 ou AGPLv3:** protegeriam contra forks fechados, mas afastariam empresas e contribuidores. A proteção também valeria pouco para um app desktop, já que o diferencial não é o código.
- **Empacotar o FFmpeg GPL no instalador:** é juridicamente viável como agregação, mas deixa o instalador pesado e põe o Clipes como distribuidor do encoder H.264.
- **FFmpeg LGPL sem x264:** é mais limpo, mas a qualidade e o suporte pioram em máquinas só com CPU.
