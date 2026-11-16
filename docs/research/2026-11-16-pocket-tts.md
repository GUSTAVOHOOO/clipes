# Spike #207: Pocket TTS como TTS da Narração

Data: 16/11/2026. Ticket: [#207](https://github.com/GUSTAVOHOOO/clipes/issues/207). Bloqueia o [#79](https://github.com/GUSTAVOHOOO/clipes/issues/79) (Narração por TTS). Contexto: [#18](https://github.com/GUSTAVOHOOO/clipes/issues/18) (escolha do Kokoro), ADR-0003 (política de modelos) e ADR-0004 (worker Python).
Nada de produção foi alterado. Venvs, pesos, binários e o Kokoro ficaram em `%TEMP%\clipes-pocket-*` e depois em `%TEMP%\spk207-pocket` (outro worker apagou duas vezes o padrão `clipes-pocket-*` com um glob amplo; refiz o ambiente e repeti as medições perdidas) e foram apagados. Os WAVs de escuta ficaram só em `Videos\Clipes\pocket-tts-escuta\` (fora do repo).

Convenção: **[fato]** = verificado em fonte ou teste, com link ou comando. **[inferência]** = conclusão minha, sem fonte direta.

## Resumo

1. **[fato]** Pocket TTS (Kyutai): código **MIT**, pesos **CC-BY-4.0**. Os dois passam na política de modelos do ADR-0003, com atribuição na tela "Sobre" e no `THIRD_PARTY_NOTICES.md`.
2. **[fato]** Existe um **mirror sem gate**, `kyutai/pocket-tts-without-voice-cloning`, publicado pela própria Kyutai (CC-BY-4.0, `gated: false`). O pacote Python cai nele **sozinho e em silêncio** quando o download do repo gated falha. Os pesos de PT baixaram **sem login**. O mirror é o repo oficial com os tensores `mimi.encoder.*` **zerados**: gera voz com as vozes prontas, mas **não clona** (`has_voice_cloning == False`).
3. **[fato]** Clonagem exige o repo gated `kyutai/pocket-tts` (login + aceite do termo de uso proibido). Fica fora da v1. Com o token de leitura do dev (conta com o termo aceito) a clonagem **funciona**: `has_voice_cloning == True`, 6,5–11 s para processar a referência e RTF 0,8–1,25 na geração (mais lento que com a voz pronta, ver abaixo). O binário Rust também clona com os mesmos pesos (3,5× tempo real num trecho curto).
4. **[fato]** Qualidade em PT-BR: o dev ouviu os trechos e disse que o Pocket soa **melhor que o Kokoro** em PT-BR e que a voz `rafael` soa **brasileira**. Ele não deu nota por arquivo.
5. **[fato]** Velocidade nesta máquina (Ryzen 5 5600H, RTX 3050 4 GB): o Pocket PT de 6 camadas roda a **~2× tempo real em CPU** (RTF 0,44–0,52, ~1 GB de RAM), igual ao Kokoro ONNX (RTF 0,42–0,52). **CUDA não acelera** (RTF 0,45–0,53). O binário Rust oficial chega a **~4× com `--quantize`** e usa ~520 MiB.
6. **[fato]** A variante `portuguese_24l` ("preview", mais camadas) roda **mais lenta que o tempo real** (RTF 1,6–1,8) e usa 2,3–2,8 GiB. Não serve como padrão.
7. **[fato]** A única voz pronta em PT é `rafael`, e **a licença do áudio de origem não está documentada** (a página `kyutai/tts-voices` documenta as demais; `cosette` e `jean` vêm de datasets **não comerciais** e não podem entrar, ADR-0003). É o maior risco para entregar `rafael` como voz padrão.
8. **[fato]** Integração: o **binário Rust oficial** (MIT, 7,9 MB, Windows x86, sem Python nem PyTorch) encaixa no molde de Componente (`core/src/components.rs`) e o mirror encaixa no `ModelSpec` de `core/src/components/models.rs` (repo + revisão + SHA-256, sem token). O Python+PyTorch pesa ~740 MiB no venv só para o TTS.
9. **Decisão do dev (16/11/2026) e recomendação:** **adotar o Pocket TTS com as vozes prontas (`rafael` para PT-BR) no lugar do Kokoro.** Binário Rust como Componente, pesos do mirror sem gate, **sem clonagem na v1**. Na escuta, a clonagem só copiou bem a voz de piada do WhatsApp; com a voz normal do dev (48 kHz) o resultado "não parece nada" e ele preferiu a `rafael`. Clonagem vira, no máximo, um ticket "depois", experimental, com consentimento e requisito de qualidade da referência.
10. Perguntas para o dev no fim.

## O que existe hoje no Clipes

Código lido em `core/src/components.rs`, `core/src/components/models.rs`, `worker/` (revisão da worktree em 16/11/2026).

- **[fato]** Componentes executáveis (`ffmpeg`, `yt-dlp`, `uv`) ficam num manifesto estático `(id, versão, URL, SHA-256, tamanho)` com licença e `source_url`, baixados com verificação de hash e suporte a retomada.
- **[fato]** Modelos de ML são `ModelSpec` (`components/models.rs`): `repo` do Hugging Face, `revision` fixa (SHA de commit), arquivos `(nome, bytes, sha256)` baixados de `https://huggingface.co/<repo>/resolve/<revision>/<nome>`, consentimento antes do download, licença e `source_url` na tela, marcador `model.state.json` só depois de todos os hashes conferidos. O cliente HTTP **não envia token** e só segue redirecionamentos para `huggingface.co`/`hf.co`.
- **[fato]** O worker Python (`worker/pyproject.toml`) hoje depende de `faster-whisper`, `numpy`, `opencv-python-headless` e, por extra, `onnxruntime` (CPU ou GPU). **Não há PyTorch.** A tarefa `tts` está registrada com o nome `kokoro` (`worker/src/clipes_worker/tasks.py`) e ainda não existe implementação.
- **[fato]** ADR-0004: um modelo por vez no worker, fila fixa (transcrição → reenquadramento → TTS → render); Kokoro "de preferência via ONNX Runtime e sem PyTorch, se o benchmark confirmar".
- **[fato]** ADR-0003, regra 2: código **e** pesos precisam permitir uso comercial; licença na tela de download; atribuições em "Sobre" e `THIRD_PARTY_NOTICES.md`; "nada com licença não comercial ou de pesquisa entra, nem como opção".

## Fontes primárias (consultadas em 16/11/2026)

| Fonte | O que ela estabelece |
|---|---|
| [kyutai-labs/pocket-tts](https://github.com/kyutai-labs/pocket-tts) (`LICENSE` MIT; release `v4.0.1`, 21/10/2026) | CLI/API Python, 100M parâmetros, CPU, clonagem por `.wav`, idiomas en/fr/de/pt/it/es/nl, variantes `_24l`, binário Rust em cada release, seção "Running on GPU" |
| [kyutai/pocket-tts](https://huggingface.co/kyutai/pocket-tts) (CC-BY-4.0, `gated: auto`, revisão `db04f0e6`) | pesos com encoder de clonagem; `extra_gated_prompt` com o uso proibido |
| [kyutai/pocket-tts-without-voice-cloning](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning) (CC-BY-4.0, `gated: false`, revisão `a7056f50`) | mirror oficial sem gate; inclui `remove_voice_cloning_and_push.py`, que zera `mimi.encoder.*` |
| [kyutai/tts-voices](https://huggingface.co/kyutai/tts-voices) | licença de cada fonte de voz (CC0, CC-BY, **CC-BY-NC**) |
| [arXiv 2509.06926](https://arxiv.org/abs/2509.06926), "Continuous Audio Language Models" (v3, 13/01/2026) | o método (CALM) e o lançamento do Pocket TTS de 100M parâmetros "faster than real time on a laptop CPU" |
| Posts técnicos da Kyutai: [2026-01-13](https://kyutai.org/blog/2026-01-13-pocket-tts), [2026-09-28](https://kyutai.org/blog/2026-09-28-pocket-tts-drifting), [2026-10-20](https://kyutai.org/blog/2026-10-20-pocket-tts-small) | citados no README. **Não li o corpo:** as páginas são renderizadas por JavaScript e o HTML vem vazio; uso só o título e o resumo do arXiv |
| [gradium-ai/xn-ptts](https://github.com/gradium-ai/xn-ptts) ("Phonon"; código MIT OR Apache-2.0) | a base do port Rust. Os pesos **Phonon 40m (inclui `pt`) são CC BY-NC 4.0**; só o Phonon 31m (inglês) é Apache-2.0 |
| [Alias-Alias/pocket-3-3-0-tts-onnx](https://huggingface.co/Alias-Alias/pocket-3-3-0-tts-onnx) (CC-BY-4.0, não oficial; [kyutai-labs/pocket-tts#345](https://github.com/kyutai-labs/pocket-tts/issues/345)) | export ONNX INT8 do v3.3.0 em 7 idiomas, derivado do mirror sem clonagem |
| [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0), [VolgaGerm/PocketTTS.cpp](https://github.com/VolgaGerm/PocketTTS.cpp) (MIT, último push 29/03/2026), [babybirdprd/pocket-tts](https://github.com/babybirdprd/pocket-tts) (MIT, Candle) | listados no README do Pocket TTS como implementações alternativas. Não testei nenhuma |

Observação: o port Rust que o ticket chamava de `xn-ptts` hoje se chama **Phonon**. O binário `pocket-tts` oficial é um fork dele, mantido pela própria Kyutai em `rust/` (MIT). Quem escolher o Phonon pelo nome vai cair nos pesos **não comerciais** em PT.

## Testes

Máquina: Windows 11, **AMD Ryzen 5 5600H** (6 núcleos, 12 threads), 15,4 GB de RAM, **RTX 3050 Laptop 4 GB** (driver 616.92, CUDA 13.4). `uv 0.12.17`, Python 3.12.14, sempre com `python -I`. Pesos de PT do mirror sem gate, revisão `1e08e6a2…`. RTF = tempo de geração ÷ duração do áudio (menor é melhor); "×" = quantas vezes mais rápido que o tempo real. Cada trecho tem 14–19 s de áudio. A duração varia um pouco entre execuções, porque a amostragem tem ruído.

Textos (originais, escritos para este spike; nenhum vem do dataset #28): `01-gtarp` (GTA RP), `02-reacao` (reação), `03-explicativo` (explicativo) em PT-BR e `04-en` em inglês. Estão em `Videos\Clipes\pocket-tts-escuta\textos.json`.

### Comandos

```sh
uv venv --python 3.12 %TEMP%\clipes-pocket-venv
uv pip install --python %TEMP%\clipes-pocket-venv\Scripts\python.exe pocket-tts psutil soundfile   # pocket-tts 4.0.1, torch 2.15.0 (CPU, o padrão no Windows)
python -I bench.py portuguese rafael cpu                 # TTSModel.load_model("portuguese") + generate_audio, RSS por polling de 50 ms
# CUDA: venv separado com torch 2.14.1+cu130 (download.pytorch.org/whl/cu130); model.to("cuda")
pocket-tts.exe generate --language portuguese --text "..." --output-path x.wav [--quantize]   # binário Rust 3.3.0
kokoro-onnx 1.0 (onnxruntime 1.32.0 CPU), kokoro-v1.0.onnx (325 MB) + voices-v1.0.bin, voz pf_dora (pt-br) e af_heart (en-us)
```

### Resultados

| Configuração | RTF | × tempo real | RAM (RSS de pico) | Notas |
|---|---|---|---|---|
| Pocket 6 camadas, PyTorch **CPU** (PT, `rafael`) | 0,44–0,52 | 1,9–2,3× | 980 MiB | carga do modelo 2,2 s (cache quente); `torch.get_num_threads()` = 1 |
| Pocket 6 camadas, PyTorch CPU (EN, `alba`) | 0,50–0,55 | 1,8–2,0× | 1,1–1,4 GiB | |
| Pocket 6 camadas, **CUDA** (RTX 3050, PT) | 0,45–0,53 | 1,9–2,2× | 1,5 GiB (RSS) + **529 MiB** de VRAM alocada | torch 2.14.1+cu130; **sem ganho** sobre a CPU, como o README já avisa para CPUs fortes |
| Pocket **24 camadas** (`portuguese_24l`), CPU | 1,59–1,85 | 0,54–0,63× | 2,3–2,8 GiB | **mais lento que o tempo real**; carga de 29–33 s; o README chama de "preview" |
| Pocket, **binário Rust** 3.3.0, CPU (PT) | ~0,44–0,64 com a carga do modelo incluída | 1,6–2,3× | 770–855 MiB | 4 threads por padrão |
| Pocket, binário Rust, `--quantize` (int8) | ~0,24 com a carga incluída | ~4,2× | **524 MiB** | só um trecho medido; a qualidade do int8 **não foi escutada** |
| Kokoro-82M ONNX, CPU (PT-BR, `pf_dora`) | 0,42–0,52 | 1,9–2,4× | 750 MiB | `pm_alex` (masculina): RTF 0,45, 916 MiB |
| Kokoro-82M ONNX, CPU (EN, `af_heart`) | 0,44–0,55 | 1,8–2,3× | 917 MiB | |

Leituras:

- **[fato]** O Pocket de 6 camadas e o Kokoro ONNX empatam em velocidade e RAM nesta CPU. A decisão não depende de desempenho.
- **[fato]** Os números de `×` do README (~6× num MacBook Air M4) não se repetem aqui: o Ryzen roda a ~2×. O README também cita ~2,3–2,5× em CPU de nuvem x86 e ~6,3× numa GPU T4; na RTX 3050 não houve ganho.
- **[fato]** Para uma Narração de 1 min, a geração leva ~30 s em CPU. Para um Roteiro de 5 min, ~2,5 min. É aceitável para um passo em fila, ruim para "ouvir o bloco" a cada edição: o #73 (Roteiro em blocos) deve regenerar **bloco a bloco**.
- **[fato]** Os tempos do binário Rust incluem o carregamento do modelo a cada execução e a duração do áudio foi estimada pelo tamanho do arquivo (24 kHz, 16 bits, cabeçalho de 44 bytes). São aproximados.
- **Não medi:** Kokoro em CUDA (exigiria `onnxruntime-gpu`; não instalei), latência do primeiro bloco de áudio (README: ~200 ms) e o Pocket em CPUs mais fracas que o Ryzen 5 5600H.

Peso instalado (medido no `%TEMP%`): venv Python com `pocket-tts` + PyTorch CPU = **741 MiB**; o mesmo com PyTorch CUDA 13 = **2,9 GiB**. Pesos de PT: `model.safetensors` 219 029 196 bytes (209 MiB) + tokenizer 247 014 + vozes. Binário Rust: zip de 7,9 MB. Export ONNX INT8 de PT: 170 MiB (com 8 vozes).

## Escuta do dev

Os WAVs ficam em `C:\Users\Windows 11\Videos\Clipes\pocket-tts-escuta\` (a pasta só é apagada quando o dev disser). O dev **não deu nota por arquivo**; o veredito veio em frase:

| Pergunta | Resposta do dev (16/11/2026) |
|---|---|
| Pocket (`pocket-pt-01..03`, `rafael`) × Kokoro (`kokoro-ptbr-01..03`, `pf_dora`) em PT-BR | **O Pocket soa melhor.** |
| `rafael` soa PT-BR ou português de Portugal? | **Soa brasileira.** |
| Pocket 24 camadas (`pocket-pt24l-01-gtarp`) | não comentado |
| Clone da voz de piada (WhatsApp, `pocket-clone-*`) | reproduziu muito bem ("ficou massa, muito bom") |
| Clone da voz normal, 48 kHz (`pocket-clone-v3-*`) | **"não parece nada"** (semelhança 1–2 de 5, nota aproximada do relato do dev); ele prefere a `rafael`, "bem melhor" |
| Kokoro masculina (`kokoro-ptbr-masc-01-gtarp`) | não comentado |
| Inglês (`pocket-en-04` × `kokoro-en-04`) | não comentado |

### Clonagem (voz do dev)

Referência: áudio de WhatsApp do dev (`.ogg`, Opus mono 48 kHz, **43 s, já comprimido**), lido do texto `texto-para-gravar.txt`, convertido com `ffmpeg` para WAV 24 kHz mono em `%TEMP%` e cortado. A cópia da voz do dev não saiu de `%TEMP%` nem da pasta de escuta. Modelo: `kyutai/pocket-tts` (gated), PT de 6 camadas, mesmo pacote 4.0.1.

| Referência | Resultado (transcrição do Whisper `small` do trecho `01-gtarp`) |
|---|---|
| 28 s (do início) | **ininteligível**: o Whisper só ouviu "Caro. Zinico." e a fala saiu com 8 s (o texto tem 19 s com a voz pronta) |
| 20 s, com `highpass` + `loudnorm` | inteligível, mas a geração **parou antes do fim** do texto |
| 10 s (do início) | inteligível, completo |
| 15 s (do segundo 12 em diante) | inteligível, completo, com 2–3 palavras trocadas (usada nos WAVs finais) |

- **[fato]** Em um teste (n = 1 gravação) uma referência de **28 s** quebrou a geração e de **10–15 s** funcionou. O README só diz que o pacote trunca em 30 s. **[inferência]** Referências longas ou com trechos difíceis (aqui, a voz caricata e a compressão do WhatsApp) deixam o condicionamento instável. O app deve cortar a referência para ~10–15 s, avisar e deixar o usuário **escutar a prévia** antes de aceitar.
- **[fato]** Tempos com voz clonada (CPU): processar a referência 6,5–11 s (uma vez por voz; `export-voice` salva isso em `.safetensors` para reuso); geração RTF 0,80–0,83 (trechos 01 e 02) e 1,25 (03, máquina com outros processos). Pico de RAM 1,2–1,6 GiB.
- **[fato]** O dev ouviu: na gravação do WhatsApp ele **fez de propósito uma voz caricata**, e o clone **reproduziu essa voz muito bem** ("ficou massa, muito bom"). Conclusão: a clonagem copia bem o **timbre e o jeito de falar** da referência, inclusive o exagero. Para narrar um canal ele quer uma referência melhor (a voz normal, no microfone, sem WhatsApp). Uma gravação nova virá depois; os resultados dela entram numa atualização deste documento.
- **[fato]** O README manda "limpar" a amostra, porque a qualidade do áudio de referência é reproduzida. A referência comprimida (Opus do WhatsApp) **pode** ter piorado o resultado, mas não separei esse efeito do da voz caricata.

**Segunda referência (voz normal, `minha-voz-v2.m4a`, AAC 8 kHz mono, ~16 kbps, 53 s).** Recortei 14 s, 24 kHz, e gerei `pocket-clone-v2-01..04`. **[fato]** Saída inteligível e completa. O dev pediu para ignorar esse arquivo.

**Terceira referência (voz normal, `minha-voz-v3.m4a`, AAC 48 kHz mono, 68 kbps, 53 s).** Recortei 14 s, 24 kHz, e gerei `pocket-clone-v3-01..04`. **[fato]** Saída inteligível e completa nos quatro trechos (Whisper `small`, 1–3 palavras trocadas), RTF 0,80–1,57 em CPU. **[fato]** Escuta do dev: **"não parece nada"**; ele prefere a `rafael`.

Comparação das três referências (mesmo modelo, mesmos textos):

| Referência | Qualidade | Inteligível? | Semelhança (dev) |
|---|---|---|---|
| WhatsApp, voz de piada (Opus 48 kHz, 28 s, recorte de 15 s) | comprimida, voz caricata | 28 s: **não**; 10 e 15 s: sim | **boa**: copiou bem a voz de piada |
| v2, voz normal (AAC 8 kHz, 16 kbps, 14 s) | "ligação", nada acima de 4 kHz | sim | não ouvida (o dev pediu para ignorar) |
| v3, voz normal (AAC 48 kHz, 68 kbps, 14 s) | boa | sim | **"não parece nada"** (1–2 de 5) |

- **[fato]** A qualidade da referência (8 kHz × 48 kHz) **não** decidiu a inteligibilidade: as duas saíram inteligíveis. O que separou "copiou bem" de "não parece nada" foi o **tipo de voz**.
- **[inferência]** O modelo captura bem timbre e maneirismo **marcantes** (voz caricata) e mal uma voz neutra. Com uma só pessoa e sem comparação cega, isso é hipótese, não regra. Não há evidência de que uma referência melhor resolveria.
- **Qualidade mínima de referência, se a clonagem voltar [inferência]:** 10–15 s de fala corrida, mono, 24 kHz ou mais (abaixo de 16 kHz, avisar), sem música, eco ou ventilador, sem compressão forte (evitar WhatsApp e ligação), uma só pessoa, prévia obrigatória antes de aceitar. Referências longas (28 s) quebraram.

| Arquivo (pasta de escuta) | Conteúdo |
|---|---|
| `pocket-clone-01-gtarp`, `-02-reacao`, `-03-explicativo`, `-04-en` | voz do dev (ref. de 15 s) |
| `pocket-clone10s-01-gtarp` | voz do dev (ref. de 10 s) |
| `pocket-clone-v2-01..04` | voz normal do dev, referência de 14 s em 8 kHz |
| `pocket-clone-v3-01..04` | voz normal do dev, referência de 14 s em 48 kHz |

## Integração: Python+PyTorch × port Rust × ONNX

| Critério | A. Python + PyTorch no worker | B. Binário Rust oficial (Componente) | C. ONNX da comunidade |
|---|---|---|---|
| Origem | `pip install pocket-tts` (Kyutai) | `pocket-tts-<v>-x86_64-pc-windows-msvc.zip` da release (Kyutai) | [Alias-Alias/pocket-3-3-0-tts-onnx](https://huggingface.co/Alias-Alias/pocket-3-3-0-tts-onnx) (terceiros, "unofficial") |
| Licença do código | MIT | MIT (fork do xn-ptts, MIT OR Apache-2.0) | CC-BY-4.0 (pacote); não há runtime pronto no Clipes |
| Pesos | CC-BY-4.0 | CC-BY-4.0 (mesmos arquivos, compartilha o cache HF) | CC-BY-4.0, derivados do mirror **sem clonagem** |
| Tamanho | venv 741 MiB (PyTorch CPU) + 209 MiB de pesos | 7,9 MB (exe) + 209 MiB de pesos | 170 MiB para PT (INT8, com 8 vozes) |
| Encaixe no Clipes | cabe no worker (`uv` já é Componente), mas **traz PyTorch**, que o ADR-0004 quis evitar | **é o molde do FFmpeg/yt-dlp**: URL fixa + SHA-256 + `core::process::spawn` sem shell; os pesos entram como `ModelSpec` | o worker já tem `onnxruntime`, mas faltaria escrever o front-end (SentencePiece, laço de estado, amostragem, decoder Mimi) |
| Clonagem | sim (pesos gated) | sim, com pesos gated (**testado**: clonou a voz do dev com token, 3,5× tempo real num trecho curto) | **não** (derivado do mirror sem encoder) |
| GPU | não ajuda | só CPU | não testado |
| Esforço | **baixo** (5 linhas de API) | **baixo/médio**: chamar o exe, ler o WAV, tratar erros e progresso | **alto**; ainda mantém a dependência de um terceiro |
| Riscos | PyTorch no venv do usuário, instalação de ~1 GB; conflito com `onnxruntime-gpu` já no extra `cuda`? **[inferência]**: não conflita, mas pesa | binário 3.3.0 dentro da release 4.0.1 (o número do exe fica atrás do pacote); x86 exige AVX2 (há build `-v2`); ruído de amostragem **diferente** do Python (não bit a bit) | export não oficial, validação só numérica, sem teste de escuta; esquema de bundle próprio |



**Recomendação de integração [inferência]:** **B (binário Rust)** para a v1. Mantém o worker Python sem PyTorch (a razão do ADR-0004 para o Kokoro continua valendo para o ONNX Runtime do reenquadramento), reaproveita o fluxo de Componentes e é só um exe para atualizar. Uma clonagem futura usaria o mesmo exe com os pesos gated. A opção A fica como plano B se o exe falhar numa CPU sem AVX2 ou se aparecer um recurso que só o Python expõe (hoje: `--checkpoint`). Isso exige uma **emenda ao ADR-0004**: o TTS deixa de rodar no worker de ML e passa a ser um Componente executável chamado pelo núcleo.

## Download sem login e o termo de uso proibido

- **[fato]** O gate do repo oficial é `gated: auto` e traz um `extra_gated_prompt` (texto abaixo). Quem aceita informa empresa/universidade e finalidade (Trabalho, Estudos, Diversão).
- **[fato]** O **mirror oficial** `kyutai/pocket-tts-without-voice-cloning` está sem gate (`gated: false`), mas o cartão do repo **ainda traz o mesmo texto** de uso proibido nos metadados. O texto vale como política de uso do modelo, não como barreira técnica.
- **[fato]** O download sem login foi testado: sem `HF_TOKEN`, sem `hf auth login`, `HF_HOME` em `%TEMP%`, `TTSModel.load_model("portuguese")` baixou `languages/portuguese/model.safetensors` (219 029 196 bytes, SHA-256 `28e20f32515ba8bd0eaec69671f11f8921414fcdc375aa072fa09f46cc1057c5`) do mirror e **seguiu sem erro**. O pacote só avisa `You are sending unauthenticated requests to the HF Hub`.
- **[fato]** O pacote cai para o mirror **sem avisar**: `tts_model.py` captura a exceção do download do repo gated e liga `has_voice_cloning = False`. Quem chamar `get_state_for_audio_prompt("meu.wav")` recebe `ValueError(VOICE_CLONING_UNSUPPORTED)`. O Clipes não deve depender desse fallback implícito: o `ModelSpec` deve apontar **direto** para o repo que quer.
- **[fato]** O CC-BY-4.0 permite copiar e redistribuir os pesos, com atribuição, link da licença e indicação de mudanças. A Kyutai já publica a cópia sem gate. **[inferência]** Hospedar uma cópia nas releases do Clipes é permitido pela licença, mas **desnecessário** para o mirror (o Hugging Face serve sem login, com revisão fixa e SHA-256, como o Whisper) e **desaconselhável** para os pesos com clonagem: seria contornar o gate que a Kyutai escolheu, e isso não está claro na licença. Se o dev quiser hospedar, vale perguntar à Kyutai primeiro.
- **[fato]** Arquivos de PT que a v1 baixaria do mirror (revisão do pacote 4.0.1):

  | Arquivo | Revisão | Tamanho (bytes) | SHA-256 |
  |---|---|---|---|
  | `languages/portuguese/model.safetensors` | `1e08e6a23401048648a9fdcfde2f89348215c2a7` | 219 029 196 | `28e20f32515ba8bd0eaec69671f11f8921414fcdc375aa072fa09f46cc1057c5` |
  | `languages/portuguese/tokenizer.json` | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` | 247 014 | `b33e269f7f042a763080d71ba087d74d2f6759674b238a723c028e436b1a25ab` |
  | `languages/portuguese/embeddings/rafael.safetensors` | `a7056f505a4a8ca72d8b5fb1440071d6f1a35739` | 6 244 152 | `5aadaa0adf8d4c095f8c90cd2ece0006bbd5c66325ed01af9f955ddc8a2b5236` |

  O `ModelSpec` atual não envia token, só segue redirecionamentos para `huggingface.co`/`hf.co` e fixa **uma** revisão por modelo; as três revisões acima são diferentes e precisariam virar uma só (a mais nova do mirror, `a7056f50`, a confirmar com SHA-256 novos).

### Como o termo aparece na tela de Componentes

Texto do termo da Kyutai (inglês, copiado do cartão do modelo em 16/11/2026):

> Prohibited use: Use of our model must comply with all applicable laws and regulations and must not result in, involve, or facilitate any illegal, harmful, deceptive, fraudulent, or unauthorized activity. Prohibited uses include, without limitation, voice impersonation or cloning without explicit and lawful consent; misinformation, disinformation, or deception (including fake news, fraudulent calls, or presenting generated content as genuine recordings of real people or events); and the generation of unlawful, harmful, libelous, abusive, harassing, discriminatory, hateful, or privacy-invasive content. We disclaim all liability for any non-compliant use.

Proposta [inferência]:

1. O cartão do Componente "Pocket TTS (PT-BR)" mostra, como nos outros modelos: **licença** (`MIT` código / `CC-BY-4.0` pesos), `source_url` (a revisão no Hugging Face), tamanho e integridade.
2. Acima do botão **Baixar**, um bloco "Uso proibido pelo autor do modelo" com o texto original (inglês, sem tradução livre) e uma tradução de apoio. O download exige marcar "Li e aceito o termo de uso do Pocket TTS", registrado no marcador `model.state.json` (campos `terms_accepted_at` e `terms_version`, o hash do texto exibido).
3. Esse mesmo bloco reaparece em **Narração → Voz** quando o usuário escolhe um modelo com clonagem.
4. As três atribuições entram em "Sobre" e no `THIRD_PARTY_NOTICES.md`: Kyutai (pesos, CC-BY-4.0), o autor da voz `rafael` (a confirmar) e os dados que a Kyutai cita.

## Consentimento para clonar (proposta)

Decisão do dev (16/11/2026): clonagem só da **própria voz** ou da voz de **quem consentiu**, com confirmação explícita; a pesquisa propõe como registrar, respeitando o termo da Kyutai. Tudo abaixo é **[inferência]** e vai para o #79 como critério de aceite.

**Quando:** a cada **áudio de referência novo** que o usuário importa em Narração → Vozes → "Clonar uma voz". A confirmação não vale para outro arquivo.

**Texto da confirmação** (caixa desmarcada por padrão; o botão **Usar esta voz** só habilita com tudo preenchido):

> ( ) Esta voz é **minha**.
> ( ) Esta voz é de **outra pessoa que me autorizou** a cloná-la, e eu **tenho essa autorização** por escrito ou gravada.
>
> [Nome de quem autorizou: ______ ] (obrigatório no segundo caso)
>
> Confirmo que tenho consentimento explícito e legal para clonar esta voz. Não vou usá-la para imitar alguém, enganar o público, nem apresentar a Narração como a gravação real de uma pessoa. O Pocket TTS proíbe clonar voz sem consentimento.

**O que o app guarda** (no SQLite do Projeto, escrito só pelo núcleo, ADR-0005; tabela `voice_consent`):

| Campo | Conteúdo |
|---|---|
| `id`, `voice_id` | a voz clonada no Perfil de canal |
| `reference_sha256` | hash do áudio de referência (prova de qual arquivo foi confirmado) |
| `relation` | `own_voice` ou `consented_third_party` |
| `consenting_person` | nome de quem autorizou (texto livre, só no segundo caso) |
| `confirmed_at`, `app_version` | quando e em que versão |
| `statement_version`, `statement_sha256` | qual texto foi exibido |
| `model_id`, `model_revision` | qual modelo gerou |

O **áudio de referência** fica na pasta do Projeto (portátil, ADR-0005) e **nunca sai da máquina**: sem upload, sem "importar de URL" para clonagem, sem vozes de famosos prontas.

**Onde aparece:**

- Na lista de vozes: marca "Voz clonada · consentimento em 16/11/2026".
- Na Narração gerada: o registro de qual voz foi usada fica no Projeto.
- Na exportação, um lembrete **antes** de publicar: Narração sintética exige o rótulo "conteúdo alterado ou sintético" do YouTube (ver #18).
- **No relato de problemas (ADR-0006): nada.** O nome, o áudio, o hash e o texto de consentimento **não entram** na allowlist. No máximo, dois booleanos em categoria fechada (`voice_cloning_used`, `consent_recorded`) para saber se a clonagem estava envolvida num bug.

**Limite honesto [inferência]:** o app **registra** a declaração do usuário, não a verifica. O registro serve para o usuário se lembrar, para provar boa-fé e para o dev responder a uma denúncia. Não impede um usuário mal-intencionado, e isso não é prometido na tela.

## Riscos

1. **Licença da voz `rafael` (alto).** O áudio-fonte é `g-Vi8PgmSY0-enhanced-v2.wav` num branch do repo gated; a página `kyutai/tts-voices` não o documenta. O prefixo e o `-enhanced-v2` sugerem uma gravação do YouTube tratada, mas isso é **inferência**. Antes de embarcar `rafael` como voz padrão, perguntar à Kyutai (issue em `kyutai-labs/pocket-tts`) qual é a licença e quem é o autor. Alternativa: só oferecer vozes com licença clara e deixar PT-BR para a clonagem.
2. **Vozes não comerciais no pacote.** `cosette` (Expresso) e `jean` (EARS) são CC-BY-NC e ficam fora de qualquer lista no Clipes (ADR-0003, regra 2). As vozes embutidas de PT no mirror (27 embeddings) incluem as duas.
3. **Termo de uso proibido (médio).** Ele vale para o uso do modelo, inclusive em PT, mesmo no mirror sem gate. O Clipes precisa exibi-lo e não induzir o uso proibido (daí a proposta de consentimento).
4. **Binário Rust desatualizado (baixo).** O exe da release `v4.0.1` é o `3.3.0`. Fixar a versão e o SHA-256 no manifesto e rever a cada release.
5. **Qualidade em fala longa (a medir).** Medi trechos de ~15 s. O README diz que aceita texto infinito, mas o PT-BR em minutos de Narração (deriva de voz, prosódia) **não foi escutado**.
6. **Português só em um modelo "distilled" de 6 camadas (médio).** O `_24l` é "preview" e lento. O PT-BR depende de a Kyutai manter o modelo; o ecossistema comunitário (modelos de terceiros via `--config`) tem outras línguas, mas não PT-BR.
7. **AVX2 (baixo).** O exe padrão exige AVX2; há build `-v2`.

## Recomendação

**Adotar o Pocket TTS no lugar do Kokoro** (decisão do dev em 16/11/2026, com base na escuta): vozes prontas, `rafael` para PT-BR, **sem clonagem na v1**. Condição **[inferência]**: esclarecer a licença da voz `rafael` com a Kyutai antes de embarcá-la como voz padrão.

- **v1 (#79):** binário Rust oficial como Componente; pesos de PT do mirror sem gate (revisão fixa, SHA-256, sem token); Kokoro fora.
- **Depois (ticket novo, opcional, experimental):** clonagem com os pesos gated, token do Hugging Face no cofre, termo exibido, confirmação de consentimento por arquivo e requisito de qualidade da referência. A evidência deste spike para priorizá-la é fraca: só a voz de piada foi bem copiada.
- **Não adotar:** o Phonon 40m (CC-BY-NC), o `_24l` como padrão e o export ONNX não oficial como caminho principal.

## Critérios de aceite novos propostos para o #79

Substituem o primeiro critério ("Kokoro-82M no worker, de preferência via ONNX Runtime sem PyTorch") e ajustam os demais.

- [ ] Pocket TTS (vozes prontas) como TTS padrão: binário Rust oficial como Componente (versão e SHA-256 fixos) e pesos do mirror `kyutai/pocket-tts-without-voice-cloning` como `ModelSpec` (revisão fixa, SHA-256, **sem token e sem login**), baixados só depois do consentimento do usuário.
- [ ] Emenda ao ADR-0004: o TTS roda como Componente executável chamado pelo núcleo, fora do worker Python, e deixa o Kokoro/ONNX de lado.
- [ ] Voz PT-BR padrão `rafael`, **só se a licença do áudio de origem for esclarecida pela Kyutai**. Nenhuma voz CC-BY-NC na lista (`cosette` e `jean` ficam de fora).
- [ ] Tela de Componentes mostra a licença (MIT código, CC-BY-4.0 pesos), a fonte e o **texto de uso proibido da Kyutai**, com aceite registrado. Atribuição em "Sobre" e no `THIRD_PARTY_NOTICES.md`.
- [ ] Só lê Roteiro aprovado (trava no núcleo, #73).
- [ ] Vozes PT-BR e EN, com a voz padrão no Perfil de canal (#18).
- [ ] Narração gerada **por bloco** do Roteiro, para regenerar um bloco sem refazer tudo.
- [ ] RTF e RAM em CPU e na RTX 3050 medidos e registrados no PR, e teste de escuta em PT-BR e EN. Referência: RTF ~0,5 em CPU, ~1 GB de RAM, CUDA sem ganho.
- [ ] Teste de **fala longa** (3 min ou mais) escutado pelo dev antes de fechar o ticket.
- [ ] **Sem clonagem na v1.** Nenhum campo para importar áudio de referência. Se o dev quiser, vira ticket separado, experimental, com: pesos gated via token no cofre; confirmação de consentimento por arquivo e tabela `voice_consent` (proposta acima); referência de 10–15 s, mono, 24 kHz ou mais, com prévia; marca na lista de vozes; lembrete do rótulo de conteúdo sintético na exportação; nada disso no relato de problemas.

## Perguntas para o dev

1. Se a Kyutai não esclarecer a licença da `rafael`, lançamos com outra voz de licença clara ou esperamos a resposta? Posso redigir a issue pública em `kyutai-labs/pocket-tts` perguntando a licença e o autor.
2. Aceita a emenda ao ADR-0004 (TTS como Componente executável fora do worker)?
3. Abrimos o ticket "depois" da clonagem experimental, ou descartamos?
