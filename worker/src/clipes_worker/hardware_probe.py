"""Tarefa `probe` (#50): mede o que o hardware aguenta, sem tocar no banco.

Três modos, sempre num processo de worker próprio, que o núcleo encerra se travar:

- `info`: versão do CTranslate2 e tipos de cálculo que ele aceita na GPU, sem carregar modelo.
- `clip`: carrega o modelo na precisão pedida e transcreve o clipe embutido (português e
  inglês, `word_timestamps`) com `batch_size` 1, ou o lote pedido, com 8 cópias do trecho em
  português e `clip_timestamps`.
- `audio`: transcreve um trecho de uma Fonte (WAV 16 kHz mono) com o mesmo caminho do Motor
  local e devolve o tempo de carregamento separado do tempo de transcrição.

A política (cadeia de precisão, escada de lotes, tempo limite, cache) fica no núcleo.
O clipe é de domínio público (LibriVox) e CC0 (Wikimedia Commons); fontes em THIRD_PARTY_NOTICES.md.
"""

import time
from pathlib import Path

from .protocol import WorkerError
from .transcribe import (
    COMPUTE_TYPES,
    DEVICES,
    SAMPLE_RATE,
    BEAM_SIZE,
    Transcriber,
    load_faster_whisper,
    read_wav,
)

MODES = ("info", "clip", "audio")
MAX_CLIP_BATCH = 8
CLIP_FILES = (("pt", "probe-pt.wav"), ("en", "probe-en.wav"))
DATA = Path(__file__).parent / "data"


def clip_parts(reader=read_wav):
    """Os trechos do clipe embutido: `[(idioma, áudio)]`."""
    return [(language, reader(DATA / name)) for language, name in CLIP_FILES]


def runtime_info():
    """Versão do CTranslate2 e tipos de cálculo da GPU (vazio se não houver GPU utilizável)."""
    import ctranslate2

    try:
        types = sorted(ctranslate2.get_supported_compute_types("cuda"))
    except Exception:
        types = []
    return {"ct2_version": ctranslate2.__version__, "cuda_compute_types": types}


def run_clip(pipeline, parts, batch_size):
    """Roda o clipe no pipeline em lote. Devolve `(palavras por idioma, segundos de áudio)`."""
    import numpy as np

    def words(audio, language, **options):
        segments, _ = pipeline.transcribe(
            audio,
            language=language,
            task="transcribe",
            beam_size=BEAM_SIZE,
            word_timestamps=True,
            vad_filter=False,
            batch_size=batch_size,
            **options,
        )
        return sum(len(segment.words or []) for segment in segments)

    if batch_size == 1:
        counts = {language: words(audio, language) for language, audio in parts}
        return counts, sum(len(audio) for _, audio in parts) / SAMPLE_RATE
    portuguese = parts[0][1]
    audio = np.concatenate([portuguese] * MAX_CLIP_BATCH)
    size = len(portuguese)
    seconds = size / SAMPLE_RATE  # `clip_timestamps` do pipeline em lote são em segundos
    clips = [{"start": i * seconds, "end": (i + 1) * seconds} for i in range(MAX_CLIP_BATCH)]
    return {"pt": words(audio, "pt", clip_timestamps=clips)}, len(audio) / SAMPLE_RATE


class Prober:
    def __init__(self, transcriber, load_s, clock=time.monotonic):
        self._transcriber, self._load_s, self._clock = transcriber, load_s, clock

    def close(self):
        self._transcriber.close()

    def run(self, params, ctx, reader=read_wav):
        ctx.checkpoint()
        started = self._clock()
        if params["mode"] == "clip":
            words, audio_s = self._transcriber.clip(params["batch_size"])
        else:
            audio = reader(params["audio"])
            audio_s = len(audio) / SAMPLE_RATE
            words = len(self._transcriber.block(audio, True, 1, ctx)["words"])
        run_s = self._clock() - started
        ctx.checkpoint()
        return {"load_s": round(self._load_s, 3), "run_s": round(run_s, 3), "audio_s": round(audio_s, 3), "words": words}


def load_prober(directory, device, compute_type, loader=load_faster_whisper, clock=time.monotonic):
    started = clock()
    transcriber = loader(directory, device, compute_type)
    return Prober(transcriber, clock() - started, clock)


def _check_params(params):
    mode = params.get("mode")
    if mode not in MODES:
        raise WorkerError("invalid_message")
    if mode == "info":
        return mode, None
    model = params.get("model")
    if not isinstance(model, dict):
        raise WorkerError("invalid_message")
    model_id, directory = model.get("id"), model.get("dir")
    batch = params.get("batch_size")
    if (
        not isinstance(model_id, str)
        or not isinstance(directory, str)
        or model.get("device") not in DEVICES
        or model.get("compute_type") not in COMPUTE_TYPES
        or (mode == "audio" and not isinstance(params.get("audio"), str))
        or (mode == "clip" and (not isinstance(batch, int) or isinstance(batch, bool) or not 1 <= batch <= MAX_CLIP_BATCH))
    ):
        raise WorkerError("invalid_message")
    return mode, model


def probe_task(loader=load_faster_whisper, info=runtime_info, reader=read_wav):
    from .tasks import Task

    def resolve(params):
        mode, model = _check_params(params)
        if mode == "info":
            return "probe:info", lambda: None
        name = f"probe:{model['id']}:{model['device']}:{model['compute_type']}"
        return name, lambda: load_prober(model["dir"], model["device"], model["compute_type"], loader)

    def run(prober, params, ctx):
        if params["mode"] == "info":
            return info()
        return prober.run(params, ctx, reader)

    return Task("probe", lambda: None, run, resolve)
