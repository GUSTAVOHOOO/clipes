# Stack desktop local-first para o Clipes

**Consulta: 12/11/2026.** Fontes públicas primárias; avaliação funcional em sala limpa. Não foram executados benchmarks próprios.

## Resumo executivo

Recomendo **Tauri 2 + interface web em TypeScript**, com núcleo Rust pequeno e processos auxiliares independentes para FFmpeg, Motor de transcrição e CLIs de Provedores.
É uma recomendação **condicional**: um protótipo deve comprovar preview, legendas e busca na timeline em Windows, Linux e macOS antes de fixar a stack.
Distribuir app e caminho CPU como base, baixar modelos e pacotes de aceleração separadamente, com consentimento e verificação; GPU é oportunística, com retorno explícito à CPU.
WebView2 reduz o runtime embutido no Windows, mas WebKit e codecs variam nos outros sistemas; preparar proxy de preview com FFmpeg quando necessário.
Electron é o plano B caso a consistência do player ou produtividade compensem o Chromium incluído; Qt é forte se edição nativa complexa virar prioridade.
Nenhuma comparação de RAM ou tamanho do Clipes foi medida; a decisão depende de testes com Fonte, modelos e máquinas equivalentes.

## Escopo e matriz de trade-offs

A v1 trabalha com Fonte local/VOD, Transcrição local por padrão e Provedores via CLI de assinatura, chave de API ou modelo local. PT-BR e EN são requisitos da interface e das mensagens do Motor; a escolha do shell não garante qualidade de Transcrição ou de localização. As avaliações abaixo são **inferências qualitativas**, baseadas nas fontes das seções seguintes; não são medições equivalentes.

| Opção | ML, FFmpeg e CLI | Preview e timeline | Distribuição, memória, updates | Contribuição e risco |
|---|---|---|---|---|
| **Tauri** | Sidecars por plataforma; Rust coordena processos e arquivos. | HTML/CSS e componentes web; codecs dependem do WebView do sistema, exigindo proxy ou player alternativo. | Shell potencialmente pequeno; updater oficial assinado; custo real inclui runtime, modelos e processos. | Web familiar, mas Rust e diferenças entre WebViews aumentam a superfície de teste. |
| **Electron** | Node inicia processos; Python ou binários podem ser empacotados separadamente. | Chromium comum oferece base web mais uniforme, mas não garante todos os codecs. | Inclui Chromium e Node; updater nativo Windows/macOS, Linux requer outra estratégia; RAM não medida. | Ecossistema web e ferramentas maduras; maior distribuição esperada, não quantificada. |
| **Flutter** | Dart pode coordenar processos; plugins e binários específicos precisam ser mantidos por SO. | UI desenhada pelo Flutter; escolher player desktop suportado: plugin oficial de vídeo não cobre Windows/Linux. | Engine e plugins fazem parte do pacote; atualização precisa de solução própria ou de distribuição. | Dart adiciona linguagem; não presumir que plugins móveis funcionem no desktop. |
| **Qt** | C++/Qt pode coordenar processos ou integrar bibliotecas nativas. | Qt Multimedia e MLT são opções robustas; maior investimento em C++/QML e integração. | Deploy de bibliotecas e plugins; mecanismo de atualização depende da distribuição escolhida. | Boa base para editor complexo; analisar obrigações LGPL/GPL e módulos concretos. |
| **Wails** | Backend Go coordena processos; frontend web; ML permanece externo. | WebViews do sistema trazem a mesma classe de variação de codecs. | Sem navegador embutido; updater e empacotamento de dependências exigem escolhas adicionais. | Go + web; validar maturidade de plugins e manutenção de mídia no projeto. |
| **Servidor local + navegador** | Servidor Python ou nativo controla FFmpeg, Motor e CLI. | Interface web viável; navegador escolhido e acesso a arquivos exigem desenho cuidadoso. | Sem shell embutido, mas instalação, ciclo de vida, porta, segurança e updates ficam com o projeto. | Útil para desenvolvimento/headless; experiência desktop e distribuição ficam por construir. |

## Evidências e implicações por stack

**Tauri.** O Tauri incorpora binários externos como sidecars, inclusive aplicações Python empacotadas, com binários por target e permissões explícitas ([documentação](https://v2.tauri.app/develop/sidecar/)). Usa WebView2 no Windows, WKWebView no macOS e WebKitGTK no Linux ([versões de WebView](https://v2.tauri.app/reference/webview-versions/)). O plugin de atualização verifica assinaturas e exige configurar chaves e endpoint ([updater](https://v2.tauri.app/plugin/updater/)). No Windows, o bootstrapper baixado acrescenta 0 MB ao instalador segundo a documentação, mas exige rede se o runtime faltar; alternativas offline acrescentam aproximadamente 127 MB ou 180 MB para runtime fixo, valores do WebView, não do Clipes ([instalador](https://v2.tauri.app/distribute/windows-installer/)). **Inferência:** o tamanho inicial pode ser menor que Electron, sem promessa sobre RAM total.

**Electron.** Seu modelo multiprocesso herda a arquitetura do Chromium; processos utilitários ou filhos podem hospedar tarefas pesadas ([modelo de processos](https://www.electronjs.org/docs/latest/tutorial/process-model)). O updater integrado cobre Windows/macOS e não Linux; macOS requer assinatura ([autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)). **Inferência:** Chromium distribuído reduz diferenças de engine, mas os codecs habilitados no build ainda precisam de testes, e um processo ML separado continua necessário para isolar falhas e carga.

**Flutter.** Flutter oferece destinos Windows, Linux e macOS e plugins por plataforma ([desktop](https://docs.flutter.dev/platform-integration/desktop)). Seu cookbook informa que o plugin `video_player` não funciona no Linux e Windows ([vídeo](https://docs.flutter.dev/cookbook/plugins/play-video)). **Inferência:** um editor desktop precisa selecionar e manter outro backend de player e testar sua compatibilidade, independentemente de bibliotecas de timeline móveis.

**Qt.** Qt Multimedia oferece player, saída de vídeo e backend FFmpeg; bibliotecas e plugins devem ser distribuídos adequadamente, com diferenças de formato e aceleração por plataforma. O módulo tem opções comerciais e licenças livres LGPL/GPL ([Qt Multimedia](https://doc.qt.io/qt-6/qtmultimedia-index.html)). **Inferência:** é alternativa convincente para edição mais avançada, ao custo de maior esforço nativo e verificação de licença dos módulos escolhidos.

**Wails.** Wails v2 combina Go com interface web, suporta os três sistemas e usa WebView nativo, incluindo WebView2 no Windows ([introdução](https://v2.wails.io/docs/introduction/)). **Inferência:** compartilha a principal incerteza de preview do Tauri; preferi Tauri pela documentação específica de sidecars e updater, sem presumir que Wails não consiga implementá-los.

**Servidor local.** [Cut/Storm](https://github.com/vorniches/cutstorm) demonstra editor no navegador com FFmpeg e Whisper em contêiner local. **Inferência:** um servidor instalado diretamente também pode coordenar os processos, mas exige controle de acesso ao localhost, ciclo de vida e integração com arquivos; Docker não deve ser pressuposto como requisito do usuário final.

## Processamento, instalação e operação

### Motor de transcrição e GPU

Faster-whisper é um candidato Python com CPU e quantização; seu projeto documenta que GPU NVIDIA requer cuBLAS CUDA 12 e cuDNN 9 para versões recentes de CTranslate2, com combinações antigas distintas, e informa timestamps por palavra ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)). Outra hipótese é um processo nativo baseado em [whisper.cpp](https://github.com/ggml-org/whisper.cpp), cujo código inclui opções de CPU, CUDA, Vulkan e Metal ([opções de build](https://github.com/ggml-org/whisper.cpp/blob/master/ggml/CMakeLists.txt)). **Inferência:** a existência de backend não prova suporte funcional a toda GPU ou qualidade de timestamps suficiente para o Clipes; validar os targets e versões concretos.

Proposta de distribuição: (1) instalar shell, FFmpeg e Motor CPU versionado; (2) perguntar antes de baixar modelo, informando tamanho, origem, licença e espaço; (3) detectar GPU/driver, oferecer pacote acelerado compatível como download separado; (4) conferir assinatura ou hash de manifesto confiável, instalar atomicamente em diretório do usuário e permitir remoção; (5) executar teste real do backend, registrar motivo de falha e oferecer CPU com aviso de lentidão. Cache de modelos e runtimes separado da atualização do app permite operação offline **após** aquisição dos artefatos. O pacote CUDA não substitui driver compatível; definir e validar redistribuição NVIDIA, versões, integridade e caminho de DLL por plataforma antes da entrega. **Inferência:** isso evita embutir todas as variantes no instalador inicial, mas não elimina o download total para quem usa GPU.

Processo auxiliar Python pode ser empacotado por SO/arquitetura, sem exigir Python global; alternativa nativa evita runtime Python, mas exige adaptar e medir o Motor. Protocolo local versionado por stdin/stdout ou IPC deve ter progresso, cancelamento, erros, encerramento e recuperação; não enviar Fonte ou Transcrição à rede sem escolha explícita de Provedor remoto. Essas são propostas de arquitetura, não capacidades automaticamente garantidas pelo framework.

### FFmpeg, preview e edição

Distribuir `ffmpeg` e `ffprobe` compatíveis por plataforma; usar argumentos separados, acompanhar progresso, cancelar e preservar arquivos de projeto. A licença do FFmpeg é LGPL por padrão, mas componentes opcionais GPL mudam a licença do build: registrar configuração e cumprir obrigações correspondentes ([FFmpeg](https://ffmpeg.org/legal.html)).

Proposta: gerar metadados, miniaturas e waveform em processo auxiliar; tocar um proxy em formato validado no WebView e sobrepor legendas e enquadramento na UI. A timeline guarda tempos da Fonte e da Transcrição por palavra, com edição não destrutiva; exportação via FFmpeg aplica as mesmas decisões. **Inferência:** proxy melhora compatibilidade, mas custa disco e tempo e não garante precisão de quadro, sincronização ou equivalência visual entre preview e exportação; testar taxa variável, seeking, legendas PT-BR/EN, vídeos longos e formatos reais. Não depender de suporte universal a H.264/AAC sem verificá-lo em cada ambiente.

### CLIs de Provedores e segurança

O Tauri documenta execução de sidecars e controle de permissões ([sidecar](https://v2.tauri.app/develop/sidecar/)); Node pode executar processos filhos ([Node child_process](https://nodejs.org/api/child_process.html)). Proposta: descobrir CLI instalada ou aceitar caminho selecionado pelo usuário, validar executável e versão, iniciar sem interpolar comando no shell, capturar saída e erro, suportar cancelamento e autenticação interativa quando necessária. Assegurar que caminhos com espaços e diferenças Windows/macOS/Linux funcionem; não expor execução arbitrária ao frontend. Não presumir que assinatura, termos ou modo não interativo de cada CLI permitam integração: validar com cada Provedor e nunca coletar credenciais em logs.

### Atualizações e medições

Manter versões independentes para shell, FFmpeg, Motor, runtime e modelos; assinatura do updater do Tauri cobre os artefatos do próprio mecanismo, não automaticamente pacotes adicionais ([updater](https://v2.tauri.app/plugin/updater/)). Definir distribuição Linux por pacote/AppImage e assinatura/notarização macOS antes da primeira release. Medir instalador baixado, espaço instalado, downloads adicionais, RAM total dos processos em repouso e com Transcrição/exportação, tempo de inicialização e falhas; comparar nas mesmas máquinas, Fonte, modelo e versões. Não há números comparáveis estabelecidos nesta pesquisa.

## Exemplos públicos

- **Tauri:** [Transcribe](https://github.com/morethancoder/transcribe) declara Tauri v2 e servidor web local, transcrição em dispositivo com whisper.cpp e reprodução com palavras destacadas; é exemplo de Transcrição, não prova de editor completo.
- **Electron:** [ScriptCut](https://github.com/FernandoAbishai/ScriptCut) declara Electron + React, backend FastAPI, Motores locais e FFmpeg para exportação de vídeo.
- **Flutter:** [MozCut](https://github.com/nobaab/mozcut) se apresenta como editor desktop Flutter + FFmpeg para Windows, Linux e macOS; funcionalidades e maturidade devem ser verificadas por release.
- **Qt:** [Kdenlive](https://kdenlive.org/about/) descreve interface C++/Qt e MLT apoiado em FFmpeg para edição de vídeo.
- **Wails:** [vintecinco_dl](https://github.com/owbryd/vintecinco_dl) declara Wails v2 e usa FFmpeg para unir vídeo e áudio; é downloader, não editor de timeline nem exemplo de ML.
- **Servidor local:** [Cut/Storm](https://github.com/vorniches/cutstorm) declara editor web local em contêiner, com legendas Whisper e exportação FFmpeg; é demonstração funcional, não evidência de instalação desktop simples.

Essas descrições são declarações dos respectivos projetos, sem auditoria independente nem cópia de código ou assets.

## Recomendação e critérios de validação

Escolher Tauri 2 provisoriamente e criar uma prova de conceito com uma Fonte VOD local: importar, gerar Transcrição CPU com timestamps por palavra, exibir preview com legenda editável e timeline, exportar Corte com FFmpeg, executar uma CLI configurada e repetir com aceleração disponível. Testar Windows primeiro e depois Linux/macOS com os mesmos casos; verificar offline depois da instalação dos artefatos. Medir os indicadores acima e comparar Electron se preview WebView falhar, ou Qt se a edição exigir controle de mídia que o protótipo web não consiga fornecer. São critérios propostos, não resultados já demonstrados.

## Perguntas em aberto

- Quais codecs, containers, VFR, duração e precisão de seeking constituem o conjunto mínimo de Fontes suportadas em cada sistema? Qual proxy oferece fidelidade suficiente?
- Qual Motor e modelo entregam timestamps por palavra aceitáveis em PT-BR e EN, com latência e RAM adequadas em CPU, CUDA, Vulkan e Metal? Não foram medidos qualidade nem desempenho.
- Quais drivers, versões CUDA/cuDNN e licenças de redistribuição serão suportados, e quais GPUs AMD/Intel terão aceleração efetivamente testada?
- Qual solução de atualização e distribuição Linux, assinatura Windows e notarização macOS cabem no orçamento e no projeto?
- Quais CLIs de Provedores permitem uso não interativo sob seus termos atuais, como tratar autenticação e quais limites de assinatura se aplicam?
- Quais bibliotecas de timeline e de player têm manutenção, licença e suporte suficientes para os três sistemas? Como validar equivalência visual entre preview e exportação?
- Qual tamanho de instalador, memória e custo de manutenção resultam de builds reais? Não foram feitos testes comparativos nem confirmados custos de hospedagem de modelos.
