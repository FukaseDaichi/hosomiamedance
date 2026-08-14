#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["faster-whisper"]
# ///
"""音源を Whisper large-v3 に通し、歌唱の実測タイムスタンプを出す。

src/lyrics.ts の t / end を決めるための計測ツール。曲を追加するときに走らせる。
出てくる認識結果はあくまで時刻の手がかりで、表示テキストには使わない
(ゲーム内はひらがな表記で統一するため、Suno に渡した原詞を当てる)。

ウィスパーボイスのように歌声が伴奏に埋もれている曲は、素の mp3 に通すと
Whisper が幻覚(「作詞・作曲…」等の定型句を全編に貼る)を起こす。その場合は
先にボーカルを分離した wav を作り、それを入力にする:

    uv run scripts/separate-vocals.py public/assets/foo.mp3

使い方:
    uv run scripts/transcribe-lyrics.py <音源> [原詞のテキストファイル]

原詞を渡すと initial_prompt として与え、表記と語彙を寄せる。
"""

import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) < 2:
        print("使い方: transcribe-lyrics.py <音源> [原詞ファイル]", file=sys.stderr)
        return 1
    src = Path(sys.argv[1])
    prompt = None
    if len(sys.argv) > 2:
        prompt = Path(sys.argv[2]).read_text(encoding="utf-8").strip()

    model = WhisperModel("large-v3", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        str(src),
        language="ja",
        word_timestamps=True,
        initial_prompt=prompt,
        # 既定の True だと直前の出力に引きずられ、一度出た幻覚が全編に伝播する。
        # 歌は文脈が繋がらないので切って構わない
        condition_on_previous_text=False,
        # 間奏を「歌」と誤検出させないよう、無音判定を強めに寄せる
        no_speech_threshold=0.4,
        # 尤度が低いときに温度を上げて引き直す(定型句の反復から抜けるため)
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        compression_ratio_threshold=2.0,
        vad_filter=False,
    )

    for seg in segments:
        print(f"[{seg.start:7.2f} - {seg.end:7.2f}] {seg.text.strip()}")
        for w in seg.words or []:
            print(f"      {w.start:7.2f} {w.word}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
