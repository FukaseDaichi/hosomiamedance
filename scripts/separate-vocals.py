#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["demucs", "torch", "soundfile", "numpy", "librosa", "audioread"]
# ///
"""音源からボーカルだけを抜き出した wav を作る。

ウィスパーボイスのように歌声が伴奏に埋もれている曲は、素の mp3 を Whisper に
通しても幻覚を返すだけで時刻が取れない。先にこれでボーカルを分離してから
transcribe-lyrics.py に渡す。

出力は <入力と同じ場所>/<名前>.vocals.wav。scratch 用途なのでリポジトリには
コミットしない(.gitignore 済み)。

使い方:
    uv run scripts/separate-vocals.py public/assets/hosomiamagoidance.mp3
"""

import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


def main() -> int:
    if len(sys.argv) < 2:
        print("使い方: separate-vocals.py <音源>", file=sys.stderr)
        return 1
    src = Path(sys.argv[1])
    out = src.with_suffix(".vocals.wav")

    model = get_model("htdemucs")
    model.eval()

    # demucs 同梱の AudioFile は ffprobe を要求する。ffmpeg 無しの環境でも
    # 走らせたいので、読み込みは librosa(audioread/soundfile)に任せる
    y, _sr = librosa.load(str(src), sr=model.samplerate, mono=False)
    y = np.atleast_2d(y)
    if y.shape[0] == 1:
        y = np.repeat(y, model.audio_channels, axis=0)
    wav = torch.from_numpy(np.ascontiguousarray(y, dtype=np.float32))
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)

    with torch.no_grad():
        sources = apply_model(model, wav[None], device="cpu", progress=True)[0]
    sources = sources * ref.std() + ref.mean()

    vocals = sources[model.sources.index("vocals")]
    sf.write(out, np.asarray(vocals).T, model.samplerate)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
