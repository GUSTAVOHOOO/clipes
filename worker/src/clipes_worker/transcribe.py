"""Tarefa `transcribe`: um bloco de áudio por pedido (Motor local, faster-whisper).

Parâmetros validados pelo benchmark #32 (docs/research/2026-11-14-benchmark-transcricao.md):
VAD Silero com limiar 0,75 e silêncio mínimo de 200 ms, idioma detectado em cada trecho
de VAD, `BatchedInferencePipeline`, beam 5, `word_timestamps=True`, tarefa `transcribe`.
Os timestamps de palavra são os nativos do modelo, sem alinhamento (decisão do dev, #102).

Desvio do benchmark, aprovado pelo coordenador: o benchmark usava `VadOptions` sem teto
(`max_speech_duration_s=inf`), mas o pipeline com `vad_filter=False` levanta
`RuntimeError` num trecho de 30 s ou mais, e uma live longa terá trechos assim. Aqui o
teto é `max_speech_duration_s=30`, o mesmo que o próprio faster-whisper aplica ao VAD
embutido do pipeline; limiar e silêncio mínimo continuam os do benchmark.

O worker nunca abre o banco: devolve palavras e silêncios ao núcleo, que grava.
"""

import wave
from pathlib import Path

from .protocol import WorkerError

SAMPLE_RATE = 16000
VAD_THRESHOLD = 0.75
VAD_MIN_SILENCE_MS = 200
VAD_MAX_SPEECH_S = 30
BEAM_SIZE = 5
DEVICES = ("cuda", "cpu")
COMPUTE_TYPES = ("int8_float16", "float16", "int8")
# Códigos ISO-639-1 do tokenizador Whisper (mesma lista de `core/src/transcription/groq.rs`).
LANGUAGES = frozenset({
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar",
    "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu",
    "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa",
    "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn",
    "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc",
    "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn",
    "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "ln", "ha", "ba", "jw", "su",
})


def read_wav(path):
    """Lê um WAV PCM 16 bits mono de 16 kHz como float32 em [-1, 1]."""
    import numpy as np

    try:
        with wave.open(str(path), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, SAMPLE_RATE):
                raise WorkerError("invalid_message")
            frames = wav.readframes(wav.getnframes())
    except (OSError, EOFError, wave.Error):
        raise WorkerError("invalid_message") from None
    return np.frombuffer(frames, dtype="<i2").astype("float32") / 32768.0


def _us(samples):
    return round(samples * 1_000_000 / SAMPLE_RATE)


def speech_boundaries(audio, final, spans):
    total = len(audio)
    spans = [dict(span) for span in spans(audio)]
    covered = total
    if not final and spans and spans[-1]["end"] >= total - 1 and spans[-1]["start"] > 0:
        covered = spans.pop()["start"]
    return spans, covered


def silences_for(spans, covered):
    silences, cursor = [], 0
    for span in spans:
        if span["start"] > cursor:
            silences.append({"start_us": _us(cursor), "end_us": _us(span["start"])})
        cursor = max(cursor, span["end"])
    if covered > cursor:
        silences.append({"start_us": _us(cursor), "end_us": _us(covered)})
    return silences


def speech_spans(audio):
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    options = VadOptions(threshold=VAD_THRESHOLD, min_silence_duration_ms=VAD_MIN_SILENCE_MS,
                         max_speech_duration_s=VAD_MAX_SPEECH_S)
    return get_speech_timestamps(audio, options)


def vad_task(spans=speech_spans, reader=read_wav):
    from .tasks import Task

    def run(_, params, ctx):
        audio, final = params.get("audio"), params.get("final")
        if not isinstance(audio, str) or not isinstance(final, bool):
            raise WorkerError("invalid_message")
        ctx.checkpoint()
        selected, covered = speech_boundaries(reader(audio), final, spans)
        ctx.checkpoint()
        return {"covered_us": _us(covered), "silences": silences_for(selected, covered),
                "spans": [{"start_us": _us(s["start"]), "end_us": _us(s["end"])} for s in selected]}

    return Task("silero-vad", lambda: None, run)


class Transcriber:
    """Lógica do bloco, com as peças do faster-whisper injetáveis (testada com modelos falsos).

    `speech_spans(audio)` devolve `[{"start": amostra, "end": amostra}]`;
    `detect_language(chunk)` devolve o código do idioma; `transcribe(chunk, language, batch_size)`
    devolve palavras `(texto, início_s, fim_s)` relativas ao trecho.

    Agrupamento (#162, opcional): `transcribe_clips(audio, clips, language, batch_size)` recebe o
    bloco inteiro e vários trechos de VAD como `[{"start": s, "end": s}]` (segundos no bloco) e
    devolve palavras com tempos já absolutos no bloco, numa só chamada.
    """

    def __init__(
        self, speech_spans, detect_language, transcribe, close=None, clip=None, transcribe_clips=None
    ):
        self._spans, self._language, self._transcribe = speech_spans, detect_language, transcribe
        self._close, self.clip, self._clips = close, clip, transcribe_clips

    def close(self):
        if self._close:
            self._close()

    def block(self, audio, final, batch_size, ctx, group_size=1, language=None):
        spans, covered = speech_boundaries(audio, final, self._spans)
        words, silences = [], silences_for(spans, covered)
        try:
            if group_size > 1 and self._clips:
                self._grouped(audio, spans, group_size, ctx, words, language=language)
            else:
                self._one_by_one(audio, spans, batch_size, ctx, words, language=language)
        except (RuntimeError, MemoryError) as error:
            if _out_of_memory(error):
                raise WorkerError("out_of_memory") from None
            raise
        ctx.progress("transcribing", 100, "Transcrevendo")
        return {"covered_us": _us(covered), "words": words, "silences": silences}

    def _one_by_one(self, audio, spans, batch_size, ctx, words, language=None):
        for index, span in enumerate(spans):
            ctx.progress("transcribing", 100 * index // max(1, len(spans)), "Transcrevendo")
            chunk = audio[span["start"] : span["end"]]
            lang = language if language is not None else self._language(chunk)
            offset = span["start"] / SAMPLE_RATE
            for text, begin, end in self._transcribe(chunk, lang, batch_size):
                _add_word(words, text, offset + begin, offset + end, lang)

    def _grouped(self, audio, spans, group_size, ctx, words, language=None):
        """Agrupa trechos consecutivos do mesmo idioma, até `group_size` por chamada.

        Quando `language` é informado (#195), pula a detecção por trecho e envia sempre o idioma
        fixo sem quebrar os lotes por troca falsa. Sem `language`, detecta em cada trecho. Os
        tempos de palavra saem absolutos no bloco, sem somar o início de cada trecho.
        """
        if language is not None:
            start = 0
            while start < len(spans):
                ctx.checkpoint()
                ctx.progress("transcribing", 100 * start // max(1, len(spans)), "Transcrevendo")
                end = min(len(spans), start + group_size)
                clips = [{"start": s["start"] / SAMPLE_RATE, "end": s["end"] / SAMPLE_RATE} for s in spans[start:end]]
                for text, begin, finish in self._clips(audio, clips, language, group_size):
                    _add_word(words, text, begin, finish, language)
                start = end
            return
        languages = []
        for span in spans:
            ctx.checkpoint()
            languages.append(self._language(audio[span["start"] : span["end"]]))
        start = 0
        while start < len(spans):
            ctx.progress("transcribing", 100 * start // max(1, len(spans)), "Transcrevendo")
            end = start + 1
            while end < len(spans) and end - start < group_size and languages[end] == languages[start]:
                end += 1
            clips = [{"start": s["start"] / SAMPLE_RATE, "end": s["end"] / SAMPLE_RATE} for s in spans[start:end]]
            for text, begin, finish in self._clips(audio, clips, languages[start], group_size):
                _add_word(words, text, begin, finish, languages[start])
            start = end


def _add_word(words, text, begin_s, end_s, language):
    text = text.strip()
    if text:
        words.append(
            {
                "text": text,
                "start_us": round(begin_s * 1_000_000),
                "end_us": round(end_s * 1_000_000),
                "language": language,
            }
        )


def _out_of_memory(error):
    """O CTranslate2 reporta a falta de memória da GPU como `RuntimeError` com este texto."""
    return isinstance(error, MemoryError) or "out of memory" in str(error).lower()


def load_faster_whisper(model_dir, device, compute_type):
    """Carrega o modelo de um diretório local (nunca do Hub) e monta o Transcriber."""
    if not Path(model_dir).is_dir():
        raise WorkerError("model_missing")
    from faster_whisper import BatchedInferencePipeline, WhisperModel
    model = WhisperModel(str(model_dir), device=device, compute_type=compute_type)
    pipeline = BatchedInferencePipeline(model=model)

    def transcribe(chunk, language, batch_size):
        segments, _ = pipeline.transcribe(
            chunk,
            language=language,
            task="transcribe",
            beam_size=BEAM_SIZE,
            word_timestamps=True,
            vad_filter=False,
            batch_size=batch_size,
        )
        for segment in segments:
            for word in segment.words or []:
                yield word.word, word.start, word.end

    def transcribe_clips(audio, clips, language, batch_size):
        # `clip_timestamps` em segundos: cada trecho vira um `audio_chunk` e os tempos de palavra
        # saem absolutos em `audio` (medido em docs/research/2026-11-16-agrupar-trechos-vad.md).
        segments, _ = pipeline.transcribe(
            audio,
            language=language,
            task="transcribe",
            beam_size=BEAM_SIZE,
            word_timestamps=True,
            vad_filter=False,
            clip_timestamps=clips,
            batch_size=batch_size,
        )
        for segment in segments:
            for word in segment.words or []:
                yield word.word, word.start, word.end

    def detect_language(chunk):
        return model.detect_language(audio=chunk)[0]

    def clip(batch_size):
        # Só a sonda de hardware (#50) usa o clipe embutido; a Transcrição real não passa por aqui.
        from .hardware_probe import clip_parts, run_clip

        return run_clip(pipeline, clip_parts(), batch_size)

    return Transcriber(speech_spans, detect_language, transcribe, clip=clip, transcribe_clips=transcribe_clips)


def _check_params(params):
    """Valida o pedido inteiro antes de carregar qualquer modelo."""
    model = params.get("model")
    if not isinstance(model, dict):
        raise WorkerError("invalid_message")
    model_id, directory = model.get("id"), model.get("dir")
    audio, final, batch_size = params.get("audio"), params.get("final"), params.get("batch_size")
    group = params.get("group_size", 1)
    language = params.get("language")
    if (
        not isinstance(model_id, str)
        or not isinstance(directory, str)
        or model.get("device") not in DEVICES
        or model.get("compute_type") not in COMPUTE_TYPES
        or not isinstance(audio, str)
        or not isinstance(final, bool)
        or not isinstance(batch_size, int)
        or isinstance(batch_size, bool)
        or not 1 <= batch_size <= 32
        or not isinstance(group, int)
        or isinstance(group, bool)
        or not 1 <= group <= 32
        or (language is not None and (not isinstance(language, str) or language not in LANGUAGES))
    ):
        raise WorkerError("invalid_message")
    return model_id, directory, model["device"], model["compute_type"]


def transcribe_task(loader=load_faster_whisper, reader=read_wav):
    """Monta a Task `transcribe`; o modelo vem dos parâmetros do pedido."""
    from .tasks import Task

    def resolve(params):
        model_id, directory, device, compute_type = _check_params(params)
        return f"faster-whisper:{model_id}:{device}:{compute_type}", lambda: loader(directory, device, compute_type)

    def run(transcriber, params, ctx):
        kwargs = {"language": params["language"]} if params.get("language") is not None else {}
        return transcriber.block(
            reader(params["audio"]),
            params["final"],
            params["batch_size"],
            ctx,
            params.get("group_size", 1),
            **kwargs,
        )

    return Task("faster-whisper", lambda: None, run, resolve)
