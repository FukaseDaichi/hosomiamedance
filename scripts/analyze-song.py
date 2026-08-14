#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["librosa", "numpy", "soundfile", "audioread"]
# ///
"""新しい音源の BPM・拍位相・小節頭・区間エネルギーを実測する。

bake-chart.py の BPM / BEAT0 / BAR0 / LAST_BAR / SECTIONS を決めるための計測ツール。
曲を追加するときに一度だけ走らせ、出た値を定数として bake-chart.py に書き写す。

使い方:
    uv run scripts/analyze-song.py public/assets/hosomiamagoidance.mp3
"""

import sys
from pathlib import Path

import librosa
import numpy as np
# librosa 1.0 は lazy loader 越しだと feature.rhythm を解決できないので直接引く
from librosa.feature.rhythm import tempo as estimate_tempo


# BPM 探索の許容域。倍・半テンポを弾くため、上限は下限の 2 倍未満にしておく
BPM_LO, BPM_HI = 95.0, 185.0


def main() -> int:
    if len(sys.argv) < 2:
        print("使い方: analyze-song.py <mp3>", file=sys.stderr)
        return 1
    src = Path(sys.argv[1])

    y, sr = librosa.load(str(src), sr=22050, mono=True)
    dur = len(y) / sr
    hop = 256
    print(f"# {src}")
    print(f"長さ: {dur:.3f} 秒")

    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    db = librosa.amplitude_to_db(S, ref=np.max)

    onset = librosa.onset.onset_strength(S=db, sr=sr, hop_length=hop)
    onset = onset / (onset.max() + 1e-9)
    times = librosa.times_like(onset, sr=sr, hop_length=hop)

    # 低域のオンセット(キック)。小節頭の判定に使う
    lo = (freqs >= 30) & (freqs < 160)
    kick = librosa.onset.onset_strength(S=db[lo], sr=sr, hop_length=hop)
    kick = kick / (kick.max() + 1e-9)

    # --- BPM と拍位相 ---------------------------------------------------
    # librosa の推定を種にして、BPM と位相をグリッド探索で詰める。
    # 「拍の位置のオンセット強度の合計」が最大になる (bpm, phase) を選ぶ。
    seed = float(np.atleast_1d(estimate_tempo(onset_envelope=onset, sr=sr, hop_length=hop))[0])
    print(f"librosa の推定 BPM: {seed:.3f}")

    def score(bpm, phase):
        spb = 60.0 / bpm
        n = int((dur - phase) / spb)
        if n < 8:
            return -1.0
        idx = np.clip(np.round((phase + np.arange(n) * spb) * sr / hop).astype(int), 0, len(onset) - 1)
        # 前後1フレームの最大を取り、量子化誤差を吸収する
        v = np.maximum(np.maximum(onset[np.maximum(idx - 1, 0)], onset[idx]),
                       onset[np.minimum(idx + 1, len(onset) - 1)])
        return float(v.mean())

    # 倍・半テンポも候補にする(librosa は倍率を取り違えることがある)。
    # ただし候補はダンス曲の実用域に絞る。「拍の位置の平均オンセット強度」は
    # 拍が疎なほど高く出るため、半テンポを候補に残すと必ずそちらが勝ってしまう
    cands = []
    for base in {seed, seed * 2, seed / 2}:
        if not (BPM_LO <= base <= BPM_HI):
            continue
        # librosa の推定はテンポグラムの分解能ぶん外すので、窓は広めに取る。
        # 狭いと最適値が窓の縁に張り付き、それと気づかないまま採用してしまう
        for bpm in np.arange(base - 5.0, base + 5.0, 0.004):
            spb = 60.0 / bpm
            best = max(((score(bpm, ph), ph) for ph in np.arange(0, spb, 0.002)), default=(-1, 0))
            cands.append((best[0], bpm, best[1]))
    cands.sort(reverse=True)
    _s, bpm, beat0 = cands[0]
    spb = 60.0 / bpm
    print(f"実測 BPM: {bpm:.3f}   1拍目(BEAT0): {beat0:.4f} 秒")
    # 近接値を潰した上位。1位が突出していなければ拍が曖昧なので、
    # そのまま定数にせず候補を聴き比べること
    top: list[tuple[float, float, float]] = []
    for s, b, ph in cands:
        if all(abs(b - b2) > 0.5 for _s2, b2, _p2 in top):
            top.append((s, b, ph))
        if len(top) == 4:
            break
    print("  上位候補: " + "  ".join(f"{b:.3f}({s:.4f})" for s, b, _p in top))

    # --- 小節頭 ---------------------------------------------------------
    # 4拍のうちどの位相が小節頭か。低域(キック)が最も強い拍を 1 拍目とみなす
    n_beats = int((dur - beat0) / spb)
    kv = []
    for off in range(4):
        idx = np.clip(np.round((beat0 + np.arange(off, n_beats, 4) * spb) * sr / hop).astype(int),
                      0, len(kick) - 1)
        v = np.maximum(np.maximum(kick[np.maximum(idx - 1, 0)], kick[idx]),
                       kick[np.minimum(idx + 1, len(kick) - 1)])
        kv.append(float(v.mean()))
    off = int(np.argmax(kv))
    bar0 = beat0 + off * spb
    bar = 4 * spb
    n_bars = int((dur - bar0) / bar)
    print(f"小節頭のオフセット: {off} 拍目   BAR0: {bar0:.4f} 秒   全 {n_bars} 小節")
    print(f"  4拍それぞれの低域強度: {[round(v, 3) for v in kv]}")

    # --- 小節ごとのエネルギー ------------------------------------------
    # SECTIONS(区間と密度倍率)を決めるための材料。
    # rms=全体の音量、kick=低域の勢い、onset=手数の目安
    print("\n小節  時刻     rms   kick  onset  " + "-" * 20)
    rms = librosa.feature.rms(S=S, frame_length=2048, hop_length=hop)[0]
    rms = rms / (rms.max() + 1e-9)
    for b in range(n_bars):
        t0, t1 = bar0 + b * bar, bar0 + (b + 1) * bar
        i0, i1 = int(t0 * sr / hop), int(t1 * sr / hop)
        i1 = min(i1, len(rms))
        if i0 >= i1:
            break
        r = float(rms[i0:i1].mean())
        k = float(kick[i0:i1].mean())
        o = float(onset[i0:i1].mean())
        print(f"{b:4d}  {t0:6.2f}  {r:.3f}  {k:.3f}  {o:.3f}  " + "#" * int(r * 40))
    return 0


if __name__ == "__main__":
    sys.exit(main())
