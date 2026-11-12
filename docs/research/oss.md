# Projetos open source de geração de Cortes

**Consulta: 12 de novembro de 2026.** Fontes públicas primárias; sem execução dos projetos nem teste comparativo de qualidade. Estrelas e data de `pushed_at` são retrato da API do GitHub, não prova de manutenção contínua, qualidade ou data do último release. A atividade de push pode incluir branches além da principal.

## Resumo executivo

Recomendo construir a experiência desktop, a escolha editável de Cortes e os adaptadores de Provedor e de Motor de transcrição do Clipes. Para o pipeline, avaliar como dependências FFmpeg, faster-whisper, PySceneDetect, MediaPipe e libass; usar WhisperX apenas se o alinhamento adicional compensar seus custos. OpenClipper é a referência mais próxima para Windows local-first, e OpenShorts para um pipeline completo, mas nenhum foi validado para todos os requisitos do Clipes. ClipsAI e auto-subtitle são referências menores, com atividade antiga. Licenças de código, modelos, codecs e binários devem ser verificadas separadamente. Qualidade, desempenho em CPU e compatibilidade multiplataforma precisam de testes próprios antes de escolher versões e distribuir componentes.

## Critérios e leitura

O foco é Fonte local ou VOD, saída editável em 9:16 com Transcrição por palavra, legendas, escolha de Cortes e execução em CPU; GPU é aceleração opcional. Os projetos abaixo são descritos conforme seus mantenedores e código. Onde consta **inferência**, é julgamento desta pesquisa, não promessa do projeto. Não há aqui comparação medida de precisão, visual, tempo nem avaliação independente de licenças. Links de API fornecem dados mutáveis de atividade na data da consulta.

## Projetos de ponta a ponta e referências

### OpenClipper

- **O que faz e stack:** aplicativo desktop Windows, Tauri/Rust/React, Transcrição local Whisper ou Parakeet e remota, enquadramento por cenas e sujeitos, legendas estilizadas e exportação em lote; também documenta seleção externa de Cortes por índices de palavras via MCP. [README](https://github.com/GrepCut/OpenClipper).
- **Licença, maturidade e atividade:** código MIT, mas os modelos e terceiros têm licenças próprias; 18 estrelas, push em 07/11/2026. Comunidade pequena no momento da consulta. [Licença e avisos](https://github.com/GrepCut/OpenClipper#license); [API](https://api.github.com/repos/GrepCut/OpenClipper).
- **Qualidade e reaproveitamento:** funcionalidades são alegações do mantenedor, sem benchmark aqui. **Inferência:** é referência prioritária de arquitetura desktop, edição e trajetória de enquadramento, mas a ênfase em Windows não comprova portabilidade a Linux/macOS; não adotar como base completa sem auditoria. O projeto distingue detecção por rosto/sujeito de seleção por agente; avaliar desempenho e licenças dos modelos antes de extrair código. [README](https://github.com/GrepCut/OpenClipper).

### OpenShorts

- **O que faz e stack:** gera Cortes verticais com seleção de momentos, rastreamento facial, legendas e edição; backend Python/FastAPI, faster-whisper, MediaPipe, OpenCV, YOLOv8 e FFmpeg, frontend React e execução Docker. O seletor aceita Gemini ou endpoint compatível com OpenAI, incluindo Ollama. [README e stack](https://github.com/mutonby/openshorts).
- **Licença, maturidade e atividade:** repositório MIT; 7.878 estrelas e push em 12/11/2026. É um sistema com várias integrações e atividade recente, mas estrelas não medem confiabilidade. [API](https://api.github.com/repos/mutonby/openshorts); [licença](https://github.com/mutonby/openshorts/blob/main/LICENSE).
- **Qualidade e reaproveitamento:** sem teste próprio; desempenho, resultados em PT-BR e uso exclusivamente local não foram verificados. **Inferência:** boa referência para particionar Transcrição, seleção e renderização; a arquitetura web/Docker e dependências externas tornam a adoção integral menos direta para desktop. Auditar a licença específica do YOLO e de cada modelo antes de reutilizar. [Stack](https://github.com/mutonby/openshorts#tech-stack); [licenciamento Ultralytics](https://www.ultralytics.com/license).

### ClipsAI

- **O que faz e stack:** biblioteca Python que identifica segmentos a partir da fala e calcula reenquadramento; usa WhisperX, embeddings e processamento de vídeo. O código do reenquadrador usa MTCNN/FaceNet para faces, MediaPipe para análise da boca, segmentos de falantes e mudanças de cena. [README](https://github.com/ClipsAI/clipsai); [implementação do reenquadrador](https://github.com/ClipsAI/clipsai/blob/main/clipsai/resize/resizer.py).
- **Licença, maturidade e atividade:** MIT, 565 estrelas, último push registrado em 17/01/2024. [API](https://api.github.com/repos/ClipsAI/clipsai).
- **Qualidade e reaproveitamento:** não comprovamos qualidade ou funcionamento atual no Windows. **Inferência:** a combinação de cena, falante e face é uma boa referência algorítmica, mas a atividade antiga e as dependências de aprendizado de máquina pedem protótipo de compatibilidade antes de utilizá-la diretamente. Detectar boca em imagens não garante identificar corretamente quem fala, sobretudo em sobreposição ou voz fora de quadro. [Código](https://github.com/ClipsAI/clipsai/blob/main/clipsai/resize/resizer.py).

### auto-subtitle

- **O que faz e stack:** script Python com Whisper e FFmpeg que gera e sobrepõe legendas; documenta instalação inclusive no Windows. Não documenta escolha de Cortes ou animação palavra a palavra. [README](https://github.com/m1guelpf/auto-subtitle).
- **Licença, maturidade e atividade:** MIT, 2.298 estrelas, push em 12/07/2024; repositório pequeno. [API](https://api.github.com/repos/m1guelpf/auto-subtitle).
- **Qualidade e reaproveitamento:** o próprio README recomenda modelos maiores especialmente para idiomas além de inglês; precisão PT-BR e sincronização não foram medidas. **Inferência:** referência simples para a etapa de legendagem, não um renderizador completo de legendas animadas. [README](https://github.com/m1guelpf/auto-subtitle).

## Componentes especializados

### Transcrição: faster-whisper e WhisperX

- **faster-whisper:** Python/CTranslate2, MIT; oferece timestamps por palavra, VAD, CPU int8 e CUDA conforme exemplos. Tinha 26.690 estrelas e push em 12/11/2026. É candidato inicial a Motor local, com tamanho de modelo configurável. [README](https://github.com/SYSTRAN/faster-whisper); [API](https://api.github.com/repos/SYSTRAN/faster-whisper). Aceleração CUDA documentada não prova suporte a toda GPU de Windows; nenhuma precisão ou velocidade foi medida aqui.
- **WhisperX:** Python, BSD-2-Clause; combina reconhecimento, VAD e alinhamento por modelo específico de idioma, com diarização opcional e exemplo de CPU. Tinha 25.234 estrelas e push em 22/10/2026. O projeto informa limitações com palavras não alinháveis e fala sobreposta; o paper descreve o método e sua avaliação, não garante precisão em todas as Fontes. [README](https://github.com/m-bain/whisperX); [API](https://api.github.com/repos/m-bain/whisperX); [paper](https://arxiv.org/abs/2303.00747).
- **Inferência:** começar com faster-whisper e deixar WhisperX como opção a ser medida em PT-BR/EN; não confundir a licença da biblioteca com licença, disponibilidade ou exigências de acesso dos modelos de alinhamento e diarização. Preservar indicação de timestamps ausentes ou incertos.

### Cena e enquadramento: PySceneDetect e MediaPipe

- **PySceneDetect:** biblioteca Python/OpenCV para detectar transições e cenas, BSD-3-Clause, com pacote e builds para Windows; release 0.7.3 em 08/11/2026, 5.438 estrelas e push em 10/11/2026. [README](https://github.com/Breakthrough/PySceneDetect); [API](https://api.github.com/repos/Breakthrough/PySceneDetect). **Inferência:** bom candidato para delimitar mudanças de enquadramento; transição visual não é indicação de qualidade editorial.
- **MediaPipe:** framework multiplataforma de visão e aprendizado de máquina em C++/Python, Apache-2.0; a tarefa de detecção facial produz caixas e pontos faciais para imagens ou vídeo. [Repositório](https://github.com/google-ai-edge/mediapipe); [documentação do detector facial](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector). **Inferência:** reutilizar o detector e construir associação temporal, suavização e escolha do sujeito; uma face detectada sozinha não identifica o falante ativo. Qualidade, custo em CPU e modelos distribuíveis ainda exigem medição e auditoria.

### Renderização: FFmpeg e libass

- **FFmpeg:** ferramentas e bibliotecas multimídia para tratamento e exportação; filtros incluem `subtitles`, dependente de libass. Licença base LGPL 2.1 ou posterior, podendo passar a GPL conforme opções e componentes da compilação. [Filtros oficiais](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1); [licenciamento](https://ffmpeg.org/legal.html). **Inferência:** candidato principal para recorte e codificação multiplataforma; validar o binário e codecs distribuídos em cada plataforma.
- **libass:** renderizador portável ASS/SSA; repositório apresenta licença ISC e release 0.17.5 em 24/06/2026. ASS suporta efeitos de karaoke temporizados, que podem servir ao destaque de palavras. [libass](https://github.com/libass/libass); [referência ASS de karaoke](https://aegisub.org/docs/latest/ass_tags/#karaoke-effect). **Inferência:** gerar eventos ASS a partir da Transcrição e renderizar com libass/FFmpeg é um caminho viável; é necessário validar fontes, quebras, acentos, precisão temporal e consistência entre preview e exportação. Nenhuma qualidade visual foi medida.

## Recomendação: reaproveitar e construir

| Etapa | Reaproveitar ou avaliar | Construir no Clipes e validar |
| --- | --- | --- |
| Mídia | FFmpeg e libass, com builds e licenças auditados | Orquestração, progresso, cancelamento, preview e exportação por Corte; caminhos e empacotamento Windows/Linux/macOS. |
| Transcrição | faster-whisper como primeiro candidato; WhisperX opcional após medição | Interface de Motor intercambiável, adapter remoto, normalização por palavra e tratamento de erros; CPU como caminho obrigatório e GPU quando disponível. |
| Escolha de Cortes | Estudar seleção por índices do OpenClipper e pipeline do OpenShorts | Contrato de Provedor para CLI de assinatura, API e local; particionamento da Transcrição longa, validação de timestamps, deduplicação, pontuação e edição humana. Não presumir que uma assinatura permita integração CLI sem verificar seus termos. |
| Reenquadramento | PySceneDetect e detector facial MediaPipe; estudar ClipsAI e OpenClipper | Associação temporal e suavização, política por cena, fallback central, ajustes manuais e opção para múltiplos falantes. |
| Legendas | ASS/libass e timestamps do Motor; estudar auto-subtitle | Paginação, destaque por palavra, estilos, prévia fiel e correção textual e temporal em PT-BR/EN. |

**Plano de validação sugerido (inferência):** conjunto de Fontes consentidas em PT-BR e EN, incluindo VOD longo, câmera fixa, dois falantes, sobreposição, ausência de rosto, jogos e mudanças de cena; anotar intervalos e palavras de referência. Medir tempo e memória em CPU Windows e GPUs disponíveis, erro de palavra e tempo, taxa de Cortes úteis avaliada por pessoas, estabilidade do enquadramento, legibilidade e sincronia das legendas; repetir em Linux/macOS antes de declarar portabilidade. Comparar as mesmas Fontes e configurações entre alternativas; registrar modelos, hardware, licenças e falhas. As sugestões são critérios de avaliação, não resultados obtidos.

## Perguntas em aberto

1. Qual a qualidade real da seleção de Cortes, dos timestamps e das legendas em PT-BR e EN, inclusive com sotaques, música e fala sobreposta?
2. Qual combinação de Motor, tamanho de modelo e backend de GPU atende à memória e ao tempo aceitáveis em Windows com CPU, NVIDIA, AMD e Intel, e depois em Linux/macOS?
3. Quais modelos, pesos, codecs, fontes e binários podem ser redistribuídos na licença escolhida pelo Clipes, e quais exigem download, avisos ou aceitação separada?
4. OpenClipper e ClipsAI funcionam nos três sistemas com as versões atuais de dependências? Sua extração de componentes é viável sem acoplamento excessivo?
5. Quais CLIs de assinatura permitem uso integrado e automatizado nas condições dos respectivos Provedores, e como sinalizar limites e autenticação ao usuário?
6. Qual estratégia de preview produz resultados visualmente equivalentes ao FFmpeg/libass em fontes, emojis, acentos e animações?
