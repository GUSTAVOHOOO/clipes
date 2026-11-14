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

## Gabarito independente MFA (ticket #102)

O relatório e as limitações estão em [bordas MFA](../../docs/research/2026-11-14-bordas-mfa.md). O lock explícito de conda é para Windows x86-64; todos os ambientes, modelos, áudios, corpus e saídas ficam no TEMP. Instale micromamba fora do repo e use `micromamba create -p "$env:TEMP\clipes-mfa-env" -f benchmarks/transcricao/mfa-win-64.lock`. No Windows com espaço no nome do usuário, aplique a solução de `docs/agents/impedimentos.md` para o PATH curto, defina `MFA_ROOT_DIR="$env:TEMP\clipes-mfa-data"` e execute o módulo com o Python do ambiente. Abaixo `$mfa` representa esse executável com `-m montreal_forced_aligner` (não inclua modelos nem resultados no Git).

Baixe explicitamente as releases `acoustic portuguese_mfa --version 2.0.0a`, `dictionary portuguese_mfa --version 2.0.0a`, `acoustic english_mfa --version 3.1.0`, `dictionary english_mfa --version 3.1.0`, `g2p portuguese_brazil_mfa --version 2.0.0a` e `g2p english_us_mfa --version 3.0.0` com `mfa model download`. Não substitua esses modelos sem autorização. Execute os comandos com os áudios do dataset já verificados:

```powershell
$short = cmd /c 'for %I in ("%TEMP%\clipes-mfa-env") do @echo %~sI'
$env:PATH="$short\Library\bin;$short\Scripts;$short;$env:PATH"
$env:MFA_ROOT_DIR="$env:TEMP\clipes-mfa-data"
py benchmarks/transcricao/preparar_mfa.py --media "$env:TEMP\clipes-dataset" --output "$env:TEMP\clipes-mfa-corpus-v2"
foreach ($row in @(@('pt','portuguese_mfa','portuguese_brazil_mfa'), @('en','english_mfa','english_us_mfa'))) {
  $lang,$model,$g2p = $row
  & "$short\python.exe" -m montreal_forced_aligner validate "$env:TEMP\clipes-mfa-corpus-v2\$lang" $model --ignore_acoustics --output_directory "$env:TEMP\clipes-mfa-validation-v2-$lang" --no_use_mp
  $oov = "$env:TEMP\clipes-mfa-validation-v2-$lang\oovs_found_$model.txt"
  & "$short\python.exe" -m montreal_forced_aligner g2p $oov $g2p "$env:TEMP\clipes-mfa-$lang-v2-g2p.dict" --no_use_mp
  py benchmarks/transcricao/preparar_dicionario_mfa.py --acoustic "$env:MFA_ROOT_DIR\pretrained_models\acoustic\$model.zip" --dictionary "$env:MFA_ROOT_DIR\pretrained_models\dictionary\$model.dict" --g2p "$env:TEMP\clipes-mfa-$lang-v2-g2p.dict" --oov $oov --output "$env:TEMP\clipes-mfa-$lang-combined.dict"
  & "$short\python.exe" -m montreal_forced_aligner align "$env:TEMP\clipes-mfa-corpus-v2\$lang" "$env:TEMP\clipes-mfa-$lang-combined.dict" $model "$env:TEMP\clipes-mfa-aligned-$lang" --output_format json --single_speaker --num_jobs 3 --no_use_mp
}
```

Confira o código de saída de cada comando antes de prosseguir; em particular, não alinhe quando o teste de fones ou de OOV falhar. A tentativa com beam aumentado foi feita em corpus separado, com os mesmos WAV/LAB dos trechos sem alinhamento e YAML `beam: 30` e `retry_beam: 200`, usando `--config_path`, um job e um nome de diretório diferente (o MFA reaproveita cache por nome). Os seis JSON recuperados e o JSON recuperado do trecho EN com duplicação foram copiados para os diretórios de saída originais; as falhas restantes são registradas automaticamente. Para reproduzir exatamente os trechos e o tratamento, veja a seção de exclusões no relatório. Execute então:

```powershell
py benchmarks/transcricao/gerar_referencia_mfa.py --corpus "$env:TEMP\clipes-mfa-corpus-v2" --aligned-pt "$env:TEMP\clipes-mfa-aligned-pt" --aligned-en "$env:TEMP\clipes-mfa-aligned-en" --g2p-pt "$env:TEMP\clipes-mfa-pt-v2-g2p.dict" --g2p-en "$env:TEMP\clipes-mfa-en-v2-g2p.dict" --output "$env:TEMP\clipes-mfa-referencia.json"
py benchmarks/transcricao/diagnose_mfa.py --reference "$env:TEMP\clipes-mfa-referencia.json" --results "$env:TEMP\clipes-benchmark32\int8_float16.json"
py benchmarks/transcricao/diagnose_mfa.py --reference "$env:TEMP\clipes-mfa-referencia.json" --results "$env:TEMP\clipes-benchmark32\cpu.json"
py benchmarks/transcricao/diagnose_mfa.py --reference "$env:TEMP\clipes-mfa-referencia.json" --results "$env:TEMP\clipes-benchmark32\ctc.json" --ctc
py benchmarks/transcricao/gerar_kit_bordas.py --corpus "$env:TEMP\clipes-mfa-corpus-v2" --reference "$env:TEMP\clipes-mfa-referencia.json" --aligned-pt "$env:TEMP\clipes-mfa-aligned-pt" --aligned-en "$env:TEMP\clipes-mfa-aligned-en" --g2p-pt "$env:TEMP\clipes-mfa-pt-v2-g2p.dict" --g2p-en "$env:TEMP\clipes-mfa-en-v2-g2p.dict" --media "$env:TEMP\clipes-dataset" --output "$env:TEMP\clipes-bordas-kit"
```

O gerador do kit sobrescreve os rótulos: não o execute sobre um kit já revisado. Importe os rótulos ajustados com `py benchmarks/transcricao/kit_bordas.py "$env:TEMP\clipes-bordas-kit" "$env:TEMP\clipes-bordas-revisadas.json"`. O JSON é evidência local, não modifica a referência nem substitui a comparação humana pendente.
