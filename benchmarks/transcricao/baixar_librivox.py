"""Baixa o áudio de domínio público (LibriVox) do benchmark de agrupamento (#162).

Escolhe dois capítulos, um em português e um em inglês, confere o SHA-256 e extrai os
primeiros minutos como WAV mono 16 kHz. Nada disto vai para o Git: use uma pasta em %TEMP%.
Nunca use áudio, vídeo ou transcrição do dataset #28.

    py benchmarks/transcricao/baixar_librivox.py --output "$env:TEMP\clipes-162-media" --ffmpeg ffmpeg
"""
import argparse
import hashlib
import subprocess
import urllib.request
from pathlib import Path

# LibriVox dedica as gravações ao domínio público (https://librivox.org/pages/public-domain/).
SOURCES = {
    "pt": (
        "https://archive.org/download/dom_casmurro_2102_librivox/domcasmurro_05_assis_64kb.mp3",
        "77900092eae11e4e0875acd01960a90b7940f8a4bf6abdafbf60f7092b5411ee",
        "Dom Casmurro, cap. 5 (Machado de Assis), LibriVox, português",
    ),
    "en": (
        "https://archive.org/download/artofwar_1402_librivox/artofwar_02_suntzu_64kb.mp3",
        "a06e5430403fe48d4f3f7c0b8f56cd4f50c3b8cc1319113410c0c257adf46cb2",
        "The Art of War, parte 2 (Sun Tzu), LibriVox, inglês",
    ),
}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--seconds", type=int, default=600, help="duração do WAV extraído")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for language, (url, expected, _) in SOURCES.items():
        mp3 = args.output / f"{language}.mp3"
        if not mp3.exists():
            urllib.request.urlretrieve(url, mp3)
        if sha256(mp3) != expected:
            raise SystemExit(f"SHA-256 inesperado em {language}.mp3")
        wav = args.output / f"{language}.wav"
        subprocess.run(
            [args.ffmpeg, "-v", "error", "-y", "-i", str(mp3), "-t", str(args.seconds), "-ac", "1",
             "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
            check=True,
        )
        print(language, "ok", wav)


if __name__ == "__main__":
    main()
