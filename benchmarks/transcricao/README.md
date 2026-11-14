# Benchmark de transcrição

Harness independente do aplicativo. Requer Python 3.11, FFmpeg no PATH e os áudios verificados em uma pasta fora do repositório. Crie um ambiente virtual em `%TEMP%` e instale `requirements.txt`; no Windows inclua no `PATH` do processo os diretórios `Lib/site-packages/nvidia/cublas/bin` e `nvidia/cudnn/bin` do ambiente. Defina `HF_HOME` em `%TEMP%` para manter os modelos fora do Git. Use `py` no Windows.

```powershell
py -V:Astral/CPython3.11.15 -m venv "$env:TEMP\clipes-benchmark32-venv"
. "$env:TEMP\clipes-benchmark32-venv\Scripts\Activate.ps1"
py -m pip install -r benchmarks/transcricao/requirements.txt
$env:HF_HOME="$env:TEMP\clipes-benchmark32-cache"
$env:PATH="$env:VIRTUAL_ENV\Lib\site-packages\nvidia\cublas\bin;$env:VIRTUAL_ENV\Lib\site-packages\nvidia\cudnn\bin;$env:PATH"
py benchmarks/dataset/download.py --directory "$env:TEMP\clipes-dataset"
py benchmarks/transcricao/run.py --media "$env:TEMP\clipes-dataset" --output "$env:TEMP\clipes-benchmark32\float16.json" --device cuda --compute-type float16 --batch-size 1 --model turbo
py benchmarks/transcricao/run.py --media "$env:TEMP\clipes-dataset" --output "$env:TEMP\clipes-benchmark32\int8_float16.json" --device cuda --compute-type int8_float16 --batch-size 1 --model turbo
py benchmarks/transcricao/run.py --media "$env:TEMP\clipes-dataset" --output "$env:TEMP\clipes-benchmark32\int8.json" --device cuda --compute-type int8 --batch-size 1 --model turbo
py benchmarks/transcricao/run.py --media "$env:TEMP\clipes-dataset" --output "$env:TEMP\clipes-benchmark32\cpu.json" --device cpu --compute-type int8 --batch-size 8 --model small
py benchmarks/transcricao/report.py "$env:TEMP\clipes-benchmark32\float16.json"
$env:PYTHONPATH='benchmarks/transcricao'; py -m unittest discover -s benchmarks/transcricao/tests
```

Seleciona somente amostras com `review.by`, confere SHA-256 da mídia, extrai mono 16 kHz e processa cada trecho Silero VAD com detecção de idioma própria. Os resultados contêm hipóteses e ficam fora do Git. Não agregue execuções parciais como se fossem completas. O tempo mede VAD, detecção e inferência por amostra, sem carregar o modelo ou extrair áudio; o pico de memória é amostrado via NVML e inclui o uso total da GPU. WER usa caixa normalizada e ignora pontuação. O F1 alinha lexicalmente as palavras e conta inícios e fins em até 50 ms; bordas marcadas incertas são retiradas. A cobertura considera somente palavras fora dos spans incertos.

Alucinação é o número de palavras cujo ponto médio está no silêncio VAD, fora de palavras de referência e spans incertos, dividido por minutos desses intervalos. Loops são ocorrências não sobrepostas de um n-grama de três ou mais palavras repetido ao menos três vezes seguidas, por hora de amostra. As duas estimativas dependem do VAD e da referência automatizada.

Para reproduzir o alinhamento CTC PT, use um **segundo** ambiente virtual isolado, pois o WhisperX fixa uma faixa diferente de NumPy. O teste usou `torch==2.8.0`, `torchaudio==2.8.0`, `transformers==4.57.6`, `pandas==2.2.3`, `nltk==3.9.2`, `numpy==2.0.2`, `soundfile==0.13.1` e `whisperx==3.7.4` (instalado com `--no-deps`); dependências transitivas usadas estão registradas no relatório. O modelo CTC e o diretório `HF_HOME` também devem ficar no TEMP. Após gerar o JSON da configuração escolhida:

```powershell
py benchmarks/transcricao/align_ctc.py --results "$env:TEMP\clipes-benchmark32\float16.json" --media "$env:TEMP\clipes-dataset" --output "$env:TEMP\clipes-benchmark32\ctc.json"
```

O CTC é medido somente nas duas Fontes PT. Segmentos de até 15 s recebem as palavras reconhecidas pelo Whisper; palavras sem alinhamento contam como bordas não correspondidas. Ele não modifica os resultados nativos EN.

Para instalar exatamente o ambiente CTC registrado no mesmo arquivo de requisitos:

```powershell
py -V:Astral/CPython3.11.15 -m venv "$env:TEMP\clipes-benchmark32-ctc"
. "$env:TEMP\clipes-benchmark32-ctc\Scripts\Activate.ps1"
Get-Content benchmarks/transcricao/requirements.txt | Where-Object { $_ -like '# CTC *' } | ForEach-Object { $_.Substring(6) } | Set-Content "$env:TEMP\clipes-benchmark32-ctc-requirements.txt"
py -m pip install --no-deps -r "$env:TEMP\clipes-benchmark32-ctc-requirements.txt"
$env:HF_HOME="$env:TEMP\clipes-benchmark32-ctc-cache"
```

A seção CTC fixa todas as dependências efetivamente usadas na execução de alinhamento; `--no-deps` evita instalar as dependências opcionais do restante do WhisperX. `diagnose.py` recalcula erros assinados e F1 em quatro tolerâncias; `verify_timebase.py --media ...` compara busca e decodificação integral na Fonte curta.
