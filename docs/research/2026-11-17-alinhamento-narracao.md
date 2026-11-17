# Alinhamento por palavra da Narração (#81) — medição de precisão de bordas

Esta medição avalia o alinhamento forçado (`WhisperModel.find_alignment` + `refine_word_silences`) usado na tarefa `align` do worker Python (`worker/src/clipes_worker/align.py`) sobre uma amostra própria offline em português e inglês, sem o dataset do #28 e sem acesso à rede.

## Amostra e referência

- **Blocos avaliados (26 palavras anotadas, 32 bordas)**:
  1. `pt-alienista` (`pt`, 12 palavras, 15 bordas) sobre `worker/src/clipes_worker/data/probe-pt.wav` (`9,00 s`, 16 kHz mono PCM).
  2. `en-intro` (`en`, 14 palavras, 17 bordas) sobre `worker/src/clipes_worker/data/probe-en.wav` (`9,00 s`, 16 kHz mono PCM).
- **Referência (`benchmarks/narration/sample_reference.json`)**: bordas de início e/ou fim anotadas manualmente por inspeção da envoltória RMS de 10 ms em pausas entre frases, fechamentos consonantais e quedas acústicas nítidas (bordas coarticuladas sem quebra acústica clara não foram forçadas).
- **Refinamento acústico pós-DTW (`refine_word_silences`)**: o DTW de cross-attention do `faster-whisper` tende a estender a borda de palavras adjacentes a pausas (`>= 130 ms`) sobre o silêncio (por exemplo, `"and"` em `probe-en.wav` ou `"e"` em `probe-pt.wav`). A remoção de silêncio RMS nas bordas preserva oclusões consonantais curtas (`<= 120 ms`) e descarta sangramento através de pausas.

## Ambiente e configuração

- Modelo local: `whisper-turbo` em CPU (`compute_type = "int8"`), via `uv run --frozen --extra cpu --project worker python benchmarks/narration/measure_alignment.py`.
- Reprodução:

```powershell
$env:CLIPES_ALIGN_TEST_MODEL_DIR = "$env:LOCALAPPDATA\Clipes\models\whisper-turbo"
uv run --frozen --extra cpu --project worker python benchmarks/narration/measure_alignment.py
```

Para executar também o teste de ponta a ponta via núcleo Rust (com worker Python real e banco SQLite isolado em `CLIPES_DATA_DIR`):

```powershell
$env:CLIPES_ALIGN_TEST_MODEL_DIR = "$env:LOCALAPPDATA\Clipes\models\whisper-turbo"
$env:CLIPES_ALIGN_TEST_PYTHON = (Resolve-Path worker\.venv\Scripts\python.exe).Path
cargo test -p clipes-core --test narration_align real_whisper_sample -- --ignored --nocapture
```

## Resultados medidos

Alvo do ticket #81: mediana `<= 80 ms` e `p90 <= 200 ms`.

| Recorte | Palavras anotadas | Bordas | Mediana (ms) | p90 (ms) | Máximo (ms) |
|---|---:|---:|---:|---:|---:|
| PT (`pt-alienista`) | 12 | 15 | 30,0 | 90,0 | 150,0 |
| EN (`en-intro`) | 14 | 17 | 20,0 | 154,0 | 300,0 |
| **Combinado (PT + EN)** | **26** | **32** | **25,0** | **130,0** | **300,0** |

Ambos os critérios do #81 foram atendidos (`mediana = 25,0 ms <= 80 ms` e `p90 = 130,0 ms <= 200 ms`), mantendo compatibilidade com os testes headless sem rede.
