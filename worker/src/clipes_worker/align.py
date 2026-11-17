"""Tarefa `align`: alinhamento por palavra da Narração contra o texto do Roteiro (#81).

Usa o mesmo modelo `faster-whisper` local da Transcrição:
1. Transcreve o áudio (`word_timestamps=True`, idioma fixo) para obter `spoken_words` e
   permitir ao núcleo detectar desvios/improvisos contra o Roteiro.
2. Executa alinhamento forçado (`WhisperModel.find_alignment`) em janelas de até 30 s
   sobre o texto conhecido do Roteiro para obter as bordas precisas de `script_words`.

O worker nunca abre o banco e nunca decide regras de revisão: apenas devolve
`spoken_words`, `script_words` e `silences` em µs relativos ao WAV de entrada.
"""

import re
import unicodedata
from pathlib import Path

from .protocol import WorkerError
from .transcribe import (
    BEAM_SIZE,
    COMPUTE_TYPES,
    DEVICES,
    LANGUAGES,
    SAMPLE_RATE,
    _out_of_memory,
    read_wav,
    silences_for,
    speech_spans,
)

MAX_ALIGN_WINDOW_S = 30
MAX_ALIGN_WINDOW_SAMPLES = MAX_ALIGN_WINDOW_S * SAMPLE_RATE
PREPEND_PUNCTUATIONS = "\"'“¿([{-"
APPEND_PUNCTUATIONS = "\"'.。,，!！?？:：”)]}、"


def _norm_token(text):
    cleaned = unicodedata.normalize("NFKC", text).casefold()
    return "".join(ch for ch in cleaned if ch.isalnum())


def _align_word_lists(ref_words, hyp_words):
    """Alinha duas listas de palavras normalizadas por programação dinâmica (índices pareados)."""
    ref = [_norm_token(w) for w in ref_words]
    hyp = [_norm_token(w) for w in hyp_words]
    rows, cols = len(ref) + 1, len(hyp) + 1
    cost = [[0] * cols for _ in range(rows)]
    for i in range(rows):
        cost[i][0] = i
    for j in range(cols):
        cost[0][j] = j
    for i in range(1, rows):
        for j in range(1, cols):
            sub = 0 if ref[i - 1] == hyp[j - 1] and ref[i - 1] != "" else 1
            cost[i][j] = min(
                cost[i - 1][j] + 1,
                cost[i][j - 1] + 1,
                cost[i - 1][j - 1] + sub,
            )
    pairs = []
    i, j = len(ref), len(hyp)
    while i > 0 or j > 0:
        if i > 0 and j > 0:
            sub = 0 if ref[i - 1] == hyp[j - 1] and ref[i - 1] != "" else 1
            if cost[i][j] == cost[i - 1][j - 1] + sub:
                pairs.append((i - 1, j - 1))
                i -= 1
                j -= 1
                continue
        if i > 0 and cost[i][j] == cost[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs


def pack_windows(spans, total_samples):
    """Agrupa trechos de VAD em janelas contíguas de até 30 s."""
    if not spans:
        if total_samples <= 0:
            return []
        return [
            {"start": start, "end": min(total_samples, start + MAX_ALIGN_WINDOW_SAMPLES)}
            for start in range(0, total_samples, MAX_ALIGN_WINDOW_SAMPLES)
        ]

    windows = []
    for span in spans:
        s0, s1 = int(span["start"]), int(span["end"])
        if s1 <= s0:
            continue
        while s0 < s1:
            part_end = min(s1, s0 + MAX_ALIGN_WINDOW_SAMPLES)
            if windows and part_end - windows[-1]["start"] <= MAX_ALIGN_WINDOW_SAMPLES:
                windows[-1]["end"] = part_end
            else:
                windows.append({"start": s0, "end": part_end})
            s0 = part_end
    return windows


def partition_script_words(ref_words, spoken_words, windows):
    """Distribui `ref_words` pelas janelas <= 30 s em ordem monotônica."""
    if not ref_words or not windows:
        return [[] for _ in windows]
    if len(windows) == 1:
        return [list(ref_words)]

    win_bounds = [(w["start"] / SAMPLE_RATE, w["end"] / SAMPLE_RATE) for w in windows]

    def window_of(word):
        mid = ((word["start_us"] + word["end_us"]) / 2) / 1_000_000.0
        for idx, (ws, we) in enumerate(win_bounds):
            if mid <= we or idx + 1 == len(win_bounds):
                return idx
        return len(win_bounds) - 1

    hyp_texts = [w["text"] for w in spoken_words]
    pairs = _align_word_lists(ref_words, hyp_texts)

    # Primeiro índice de referência ancorado em cada janela > 0.
    anchor_start = [None] * len(windows)
    anchor_start[0] = 0
    for ref_i, hyp_j in pairs:
        w_idx = window_of(spoken_words[hyp_j])
        if anchor_start[w_idx] is None or ref_i < anchor_start[w_idx]:
            anchor_start[w_idx] = ref_i

    # Garante fronteiras monotônicas entre janelas.
    cuts = [0] * (len(windows) + 1)
    cuts[0] = 0
    cuts[-1] = len(ref_words)
    for idx in range(1, len(windows)):
        if anchor_start[idx] is not None and anchor_start[idx] >= cuts[idx - 1]:
            cuts[idx] = anchor_start[idx]
        else:
            # Fallback proporcional pela posição temporal da janela.
            total_s = max(1e-6, win_bounds[-1][1] - win_bounds[0][0])
            frac = (win_bounds[idx][0] - win_bounds[0][0]) / total_s
            est = round(frac * len(ref_words))
            cuts[idx] = max(cuts[idx - 1], min(len(ref_words), est))

    for idx in range(len(windows) - 1, 0, -1):
        if cuts[idx] > cuts[idx + 1]:
            cuts[idx] = cuts[idx + 1]

    return [ref_words[cuts[i] : cuts[i + 1]] for i in range(len(windows))]


def map_aligned_to_script_words(script_words, aligned_items, fallback_start_s, fallback_end_s):
    """Mapeia os tokens devolvidos por `find_alignment` para as palavras exatas do Roteiro."""
    if not script_words:
        return []
    cleaned = [
        {
            "text": item["word"].strip(),
            "start": float(item["start"]),
            "end": float(item["end"]),
            "probability": float(item.get("probability", 1.0)),
        }
        for item in aligned_items
        if item.get("word", "").strip()
    ]
    if not cleaned:
        step = max(0.01, (fallback_end_s - fallback_start_s) / len(script_words))
        return [
            {
                "text": w,
                "start": fallback_start_s + idx * step,
                "end": fallback_start_s + (idx + 1) * step,
                "probability": 0.0,
            }
            for idx, w in enumerate(script_words)
        ]

    # Tenta casar sequencialmente por caracteres sem espaço (preserva hífens e apóstrofos).
    out = []
    pos = 0
    for idx, sw in enumerate(script_words):
        target_chars = re.sub(r"\s+", "", sw)
        if pos < len(cleaned):
            acc = ""
            start = cleaned[pos]["start"]
            end = cleaned[pos]["end"]
            probs = []
            while pos < len(cleaned):
                piece = re.sub(r"\s+", "", cleaned[pos]["text"])
                acc += piece
                end = max(end, cleaned[pos]["end"])
                probs.append(cleaned[pos]["probability"])
                pos += 1
                if len(acc) >= len(target_chars) or acc == target_chars:
                    break
            out.append(
                {
                    "text": sw,
                    "start": start,
                    "end": max(start + 0.01, end),
                    "probability": sum(probs) / len(probs),
                }
            )
        else:
            prev_end = out[-1]["end"] if out else fallback_start_s
            rem = max(1, len(script_words) - idx)
            step = max(0.01, (fallback_end_s - prev_end) / rem)
            out.append(
                {
                    "text": sw,
                    "start": prev_end,
                    "end": prev_end + step,
                    "probability": 0.0,
                }
            )
    return out


def refine_word_silences(items, audio, frame_ms=10, rms_thresh=0.0055, min_pause_ms=130):
    """Ajusta bordas de palavra removendo silêncio acústico (>130 ms) absorvido pelo DTW."""
    import numpy as np

    samples = np.asarray(audio, dtype="float32")
    step = SAMPLE_RATE * frame_ms // 1000
    n_frames = len(samples) // step
    if n_frames <= 0 or not items:
        return items
    trimmed = samples[: n_frames * step].reshape(n_frames, step)
    rms = np.sqrt(np.mean(trimmed * trimmed, axis=1))
    if float(rms.max()) < rms_thresh:
        return items

    active = rms >= rms_thresh
    bridge_limit = max(1, (min_pause_ms // frame_ms) - 1)
    out = []
    for word_idx, item in enumerate(items):
        s_idx = max(0, min(n_frames - 1, int(float(item["start"]) * 1000 // frame_ms)))
        e_idx = max(s_idx + 1, min(n_frames, int(-(-float(item["end"]) * 1000 // frame_ms))))
        islands = []
        i = s_idx
        while i < e_idx:
            if active[i]:
                start = i
                end = i + 1
                j = i + 1
                while j < e_idx:
                    if active[j]:
                        end = j + 1
                        j += 1
                    elif j + 1 < e_idx and any(active[j : min(e_idx, j + bridge_limit)]):
                        j += 1
                    else:
                        break
                islands.append((start, end))
                i = end
            else:
                i += 1
        updated = dict(item)
        if islands:
            if word_idx == 0 and (islands[0][1] - islands[0][0]) >= 6:
                chosen = islands[0]
            else:
                chosen = max(islands, key=lambda ab: float(rms[ab[0] : ab[1]].sum()))
            ns = max(float(item["start"]), chosen[0] * frame_ms / 1000.0)
            ne = min(float(item["end"]), chosen[1] * frame_ms / 1000.0)
            if ne > ns + 0.02:
                updated["start"] = ns
                updated["end"] = ne
        out.append(updated)
    return out


def _to_us(seconds):
    return max(0, round(float(seconds) * 1_000_000))


class Aligner:
    """Alinha um áudio de Narração contra o texto do Roteiro (peças injetáveis para testes)."""

    def __init__(self, speech_spans_fn, transcribe_span_fn, force_align_span_fn, close=None):
        self._spans = speech_spans_fn
        self._transcribe = transcribe_span_fn
        self._force_align = force_align_span_fn
        self._close = close

    def close(self):
        if self._close:
            self._close()

    def align(self, audio, text, language, batch_size, ctx):
        ref_words = text.strip().split()
        if not ref_words:
            raise WorkerError("invalid_message")

        total_samples = len(audio)
        total_us = round(total_samples * 1_000_000 / SAMPLE_RATE)
        spans = [dict(s) for s in self._spans(audio)]
        if not spans and total_samples > 0:
            spans = [{"start": 0, "end": total_samples}]
        silences = silences_for(spans, total_samples)
        windows = pack_windows(spans, total_samples)

        spoken_words = []
        try:
            ctx.progress("aligning", 10, "Transcrevendo áudio da Narração")
            for idx, span in enumerate(spans):
                ctx.checkpoint()
                s0, s1 = int(span["start"]), int(span["end"])
                if s1 <= s0:
                    continue
                chunk = audio[s0:s1]
                offset = s0 / SAMPLE_RATE
                for word_text, begin_s, end_s in self._transcribe(chunk, language, batch_size):
                    cleaned = word_text.strip()
                    if not cleaned:
                        continue
                    w_start = _to_us(offset + float(begin_s))
                    w_end = max(w_start + 10_000, _to_us(offset + float(end_s)))
                    spoken_words.append(
                        {
                            "text": cleaned,
                            "start_us": min(w_start, total_us),
                            "end_us": min(max(w_start + 10_000, w_end), max(total_us, w_start + 10_000)),
                        }
                    )
                ctx.progress("aligning", 10 + (40 * (idx + 1) // max(1, len(spans))), "Transcrevendo áudio da Narração")

            window_words = partition_script_words(ref_words, spoken_words, windows)
            script_words = []
            for w_idx, (win, words_slice) in enumerate(zip(windows, window_words)):
                ctx.checkpoint()
                if not words_slice:
                    continue
                chunk = audio[win["start"] : win["end"]]
                offset = win["start"] / SAMPLE_RATE
                win_dur = max(0.01, (win["end"] - win["start"]) / SAMPLE_RATE)
                aligned_items = self._force_align(chunk, " ".join(words_slice), language)
                mapped = map_aligned_to_script_words(words_slice, aligned_items, 0.0, win_dur)
                mapped = refine_word_silences(mapped, chunk)
                for item in mapped:
                    w_start = _to_us(offset + item["start"])
                    w_end = max(w_start + 10_000, _to_us(offset + item["end"]))
                    script_words.append(
                        {
                            "text": item["text"],
                            "start_us": min(w_start, total_us),
                            "end_us": min(max(w_start + 10_000, w_end), max(total_us, w_start + 10_000)),
                            "probability": round(float(item["probability"]), 4),
                        }
                    )
                ctx.progress("aligning", 50 + (50 * (w_idx + 1) // max(1, len(windows))), "Alinhando Narração ao Roteiro")
        except (RuntimeError, MemoryError) as error:
            if _out_of_memory(error):
                raise WorkerError("out_of_memory") from None
            raise

        return {
            "spoken_words": spoken_words,
            "script_words": script_words,
            "silences": silences,
        }


def load_faster_whisper_aligner(model_dir, device, compute_type):
    """Carrega `WhisperModel` local (nunca do Hub) para transcrição + alinhamento forçado."""
    if not Path(model_dir).is_dir():
        raise WorkerError("model_missing")
    from faster_whisper import BatchedInferencePipeline, WhisperModel
    from faster_whisper.tokenizer import Tokenizer
    from faster_whisper.transcribe import merge_punctuations, pad_or_trim

    model = WhisperModel(str(model_dir), device=device, compute_type=compute_type)
    pipeline = BatchedInferencePipeline(model=model)

    def transcribe_span(chunk, language, batch_size):
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

    def force_align_span(chunk, text, language):
        features = model.feature_extractor(chunk)
        content_frames = features.shape[-1] - 1
        num_frames = min(model.feature_extractor.nb_max_frames, max(1, content_frames))
        segment = pad_or_trim(features[:, :num_frames])
        encoder_output = model.encode(segment)
        tokenizer = Tokenizer(
            model.hf_tokenizer,
            model.model.is_multilingual,
            task="transcribe",
            language=language,
        )
        text_tokens = tokenizer.encode(" " + text.strip())
        if not text_tokens:
            return []
        aligned = model.find_alignment(tokenizer, [text_tokens], encoder_output, num_frames)[0]
        if not aligned:
            return []
        merge_punctuations(aligned, PREPEND_PUNCTUATIONS, APPEND_PUNCTUATIONS)
        chunk_s = len(chunk) / SAMPLE_RATE
        for item in aligned:
            item["start"] = max(0.0, min(chunk_s, float(item["start"])))
            item["end"] = max(item["start"], min(chunk_s, float(item["end"])))
        return aligned

    return Aligner(speech_spans, transcribe_span, force_align_span)


def _check_params(params):
    model = params.get("model")
    if not isinstance(model, dict):
        raise WorkerError("invalid_message")
    model_id, directory = model.get("id"), model.get("dir")
    audio = params.get("audio")
    text = params.get("text")
    language = params.get("language")
    batch_size = params.get("batch_size", 1)
    if (
        not isinstance(model_id, str)
        or not isinstance(directory, str)
        or model.get("device") not in DEVICES
        or model.get("compute_type") not in COMPUTE_TYPES
        or not isinstance(audio, str)
        or not isinstance(text, str)
        or not text.strip()
        or not isinstance(language, str)
        or language not in LANGUAGES
        or not isinstance(batch_size, int)
        or isinstance(batch_size, bool)
        or not 1 <= batch_size <= 32
    ):
        raise WorkerError("invalid_message")
    return model_id, directory, model["device"], model["compute_type"]


def align_task(loader=load_faster_whisper_aligner, reader=read_wav):
    """Monta a Task `align`; o modelo Whisper local vem dos parâmetros do pedido."""
    from .tasks import Task

    def resolve(params):
        model_id, directory, device, compute_type = _check_params(params)
        return (
            f"faster-whisper-align:{model_id}:{device}:{compute_type}",
            lambda: loader(directory, device, compute_type),
        )

    def run(aligner, params, ctx):
        return aligner.align(
            reader(params["audio"]),
            params["text"],
            params["language"],
            params["batch_size"],
            ctx,
        )

    return Task("faster-whisper-align", lambda: None, run, resolve)
