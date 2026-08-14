#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["librosa", "numpy", "soundfile", "audioread"]
# ///
"""public/assets/hosomiamedance.mp3 から難易度別の譜面 src/charts.json を生成する。

BPM・拍位相・小節線は実測済みの定数。曲が変わらない限り再探索しない。
生成のあと不変条件を検査し、破れていたら異常終了する。

使い方:
    uv run scripts/bake-chart.py            生成してから検査
    uv run scripts/bake-chart.py --verify   既存の JSON を検査するだけ
"""

import json
import sys
from pathlib import Path

SRC = Path("public/assets/hosomiamedance.mp3")
OUT = Path("src/charts.json")

BPM = 156.0
SPB = 60.0 / BPM          # 0.384615 = 1拍
BAR = 4 * SPB             # 1.538462 = 1小節
BEAT0 = 0.2292            # 1拍目の時刻
BAR0 = 0.6138             # 1小節目の頭 (= BEAT0 + SPB)
S16 = SPB / 4             # 0.096154 = 16分
SONG_END = 137.0
LAST_BAR = 86             # ここから先(アウトロ)にはノーツを置かない

LANE_L, LANE_D, LANE_U, LANE_R = 0, 1, 2, 3

# 「ひだり みぎ うえ した」の発声時刻。Step 2 で検出した値に置き換えること。
# JSON 出力時に小数第4位で丸めるので、ここも小数第4位までで書く。
CALL_TIMES = [92.2413, 93.6112, 94.7606, 95.1670]
CALL_LANES = [LANE_L, LANE_R, LANE_U, LANE_D]

DIFFS = {
    # step は 16分いくつおきに置けるか (4=4分, 2=8分, 1=16分)
    "easy":   {"step": 4, "target": 160, "gap_all": SPB},
    "normal": {"step": 2, "target": 280, "gap_all": 2 * S16},
    "hard":   {"step": 1, "target": 460, "gap_all": S16},
}
GAP_LANE = 2 * S16        # 同一レーンは全難易度で8分あける

# 連続性ボーナス。隣のグリッド点(その難易度のステップ幅で1つ隣)が選択済みなら
# 強度に加点し、点在よりも連続した流れ(ストリーム)を作る(theory.md 原則3)。
# 上げすぎると弱い音まで拾って音付け(原則1)を壊す。オンセット整合検査が上限の見張り
CONT_BONUS = 0.25

# オンセット整合検査の閾値。classify の強さがこれ未満のノーツは「音が無い所を
# 叩かせている」とみなす。採点に使う classify はノーツ選定と同じ関数なので、
# この検査は自己参照(theory.md 原則1)。CONT_BONUS の暴走を止める安全網
ONSET_MIN = 0.10
ONSET_RATE_MIN = 0.90

# レーン分布の許容範囲(%)。どのレーンも死なせず、どれか1つに寄せすぎない
LANE_MIN_PCT = 12.0
LANE_MAX_PCT = 50.0


# (開始小節, 終了小節(排他), 密度倍率)。設計書「曲の構成」表に対応する。
SECTIONS = [
    (0, 10, 0.45),   # イントロ兼サビ1。キックなし、ウォームアップ
    (10, 17, 1.00),  # ドラムイン
    (17, 24, 1.30),  # 間奏。歌がないぶん手を動かす
    (24, 40, 1.15),  # サビ2回目
    (40, 56, 0.85),  # Aメロ
    (56, 63, 0.35),  # ブレイク。溜め
    (63, 79, 1.35),  # ラスサビ
    (79, 86, 1.00),  # 締め
]


def features():
    """帯域別のオンセット強度と、中域のスペクトル重心を返す。"""
    import librosa
    import numpy as np

    y, sr = librosa.load(str(SRC), sr=22050, mono=True)
    hop = 256
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)

    def onset_band(lo, hi):
        m = (freqs >= lo) & (freqs < hi)
        e = librosa.onset.onset_strength(
            S=librosa.amplitude_to_db(S[m], ref=np.max), sr=sr, hop_length=hop
        )
        return e / (e.max() + 1e-9)

    band = (freqs >= 300) & (freqs < 3000)
    Sb = S[band]
    cent = (Sb * freqs[band][:, None]).sum(axis=0) / (Sb.sum(axis=0) + 1e-9)

    return {
        "sr": sr,
        "hop": hop,
        "kick": onset_band(30, 160),     # キック
        "body": onset_band(160, 400),    # スネアの胴
        "mel": onset_band(300, 3000),    # メロディ・ボーカル
        # 高域。設計書のとおり 4-10kHz。ハイハットの検出と、
        # スネア判定(胴と高域が同時に立つか)の両方でこの帯域を使う
        "hat": onset_band(4000, 10000),
        "cent": cent,
    }


def sample(f, name, t):
    """時刻 t の値。量子化誤差を吸収するため前後1フレームの最大を取る。"""
    env = f[name]
    i = int(round(t * f["sr"] / f["hop"]))
    i = max(0, min(len(env) - 1, i))
    lo = max(0, i - 1)
    hi = min(len(env) - 1, i + 1)
    return float(max(env[lo], env[i], env[hi]))


def classify(f, t):
    """(種類, 強さ) を返す。種類は kick / snare / hat / mel。"""
    k = sample(f, "kick", t)
    b = sample(f, "body", t)
    m = sample(f, "mel", t)
    h = sample(f, "hat", t)
    # スネアは低中域と高域が同時に立つ。片方だけならスネアではない
    # 重みは実測調整値。デフォルト(1.0, 1.0, 1.0, 1.0)だとキック/スネア(↓/↑)が
    # 8割前後を占め、メロディ/ハイハット由来の←/→がほぼ死ぬ。
    # verify() のレーン分布検査(各12%以上・50%以下)を通るよう、
    # メロディを上げ・スネアを下げて←/→の出現率を引き上げてある。
    scores = {"kick": k, "snare": min(b, h) * 1.3, "mel": m * 1.4, "hat": h * 1.0}
    kind = max(scores, key=lambda x: scores[x])
    return kind, scores[kind]


def bar_to_idx(bar):
    """小節番号 -> BEAT0 起点の16分インデックス。BAR0 = BEAT0 + SPB なので +4。"""
    return 4 + 16 * bar


def select_times(f, cfg):
    """区間ごとの割当数に従い、強い16分グリッド点を連続性の加点つきで選ぶ。"""
    weights = [mult * (b1 - b0) for b0, b1, mult in SECTIONS]
    total_w = sum(weights)

    chosen = list(CALL_TIMES)  # 固定ギミックを先に確保する
    chosen_sorted = sorted(chosen)

    def fits(t):
        # 全体の最小間隔。既に選んだ点との距離を見る
        # 時刻は小数第4位に丸められるため、丸め後にちょうど閾値と一致する
        # 隣接グリッド点まで誤って弾かないよう、許容を 1e-3 に広げてある
        # (1e-6 だと 0.3846 のような丸め値が gap_all の生の値を僅かに
        # 下回るだけで却下され、実効の最小間隔が設計より粗くなっていた)
        for c in chosen_sorted:
            if abs(c - t) < cfg["gap_all"] - 1e-3:
                return False
            if c > t + 1.0:
                break
        return True

    for (b0, b1, _mult), w in zip(SECTIONS, weights):
        quota = int(round(cfg["target"] * w / total_w))
        # ブレイク区間には固定ギミックの4個が既に入っている
        quota -= sum(1 for t in CALL_TIMES if b0 <= (t - BAR0) / BAR < b1)
        if quota <= 0:
            continue

        # 区間内の候補グリッド点と強度。丸めの扱いは既存どおり
        # (出力時に小数第4位で丸めるので、選定も丸めた値で行う)
        strength = {}
        for i in range(bar_to_idx(b0), bar_to_idx(b1)):
            if i % cfg["step"]:
                continue
            t = round(BEAT0 + i * S16, 4)
            if t <= 0 or t >= BAR0 + LAST_BAR * BAR:
                continue
            _, s = classify(f, t)
            strength[i] = (s, t)

        # 逐次貪欲: 選択済みの隣にいる候補に CONT_BONUS を加点しながら、
        # 最高スコアの点から取っていく。強い音を核にストリームが育つ
        taken_idx: set[int] = set()
        dropped: set[int] = set()  # fits に落ちた点。加点の核にはしない
        taken = 0
        while taken < quota:
            best_i, best_score = None, -1.0
            for i, (s, _t) in strength.items():
                if i in taken_idx or i in dropped:
                    continue
                bonus = CONT_BONUS * (
                    (i - cfg["step"] in taken_idx) + (i + cfg["step"] in taken_idx)
                )
                if s + bonus > best_score:
                    best_i, best_score = i, s + bonus
            if best_i is None:
                break
            _s, t = strength[best_i]
            if not fits(t):
                dropped.add(best_i)
                continue
            taken_idx.add(best_i)
            chosen.append(t)
            chosen_sorted = sorted(chosen)
            taken += 1

    return sorted(chosen)


def assign_lanes(f, times):
    """時間順にレーンを割り当てる。音の種類で固定し、同一レーンの連続と近接を避ける。"""
    import numpy as np

    out = []
    last_lane_t = [-9.0, -9.0, -9.0, -9.0]
    prev_lane = -1
    run = 0
    prev_cent = None

    for t in times:
        forced = next((lane for c, lane in zip(CALL_TIMES, CALL_LANES) if abs(c - t) < 1e-6), None)
        if forced is not None:
            lane = forced
        else:
            kind, _ = classify(f, t)
            if kind == "kick":
                lane = LANE_D
            elif kind == "snare":
                lane = LANE_U
            elif kind == "hat":
                lane = LANE_R if prev_lane == LANE_L else LANE_L
            else:
                c = sample(f, "cent", t)
                lane = LANE_R if (prev_cent is not None and c > prev_cent) else LANE_L
                prev_cent = c

            # 同一レーンが近すぎる、または3連続になるなら最も長く空いているレーンへ
            # (丸め誤差の許容は fits() と同じ理由で 1e-3)
            too_close = t - last_lane_t[lane] < GAP_LANE - 1e-3
            too_many = lane == prev_lane and run >= 2
            if too_close or too_many:
                lane = int(np.argmin(last_lane_t))

        out.append((round(t, 4), lane))
        run = run + 1 if lane == prev_lane else 1
        prev_lane = lane
        last_lane_t[lane] = t

    return out


def bake():
    f = features()
    notes = {}
    for key, cfg in DIFFS.items():
        times = select_times(f, cfg)
        notes[key] = assign_lanes(f, times)
        print(f"  {key}: {len(notes[key])} notes")
    return {"bpm": BPM, "beat0": BEAT0, "songEnd": SONG_END, "notes": notes}, f


def verify(data: dict) -> list[str]:
    """譜面の不変条件を検査し、破れた項目を文字列で返す。空なら合格。"""
    bad: list[str] = []
    notes = data.get("notes", {})

    if set(notes) != set(DIFFS):
        bad.append(f"難易度キーが違う: {sorted(notes)}")
        return bad

    counts = {}
    for key, cfg in DIFFS.items():
        ns = notes[key]
        counts[key] = len(ns)

        target = cfg["target"]
        if not (target * 0.85 <= len(ns) <= target * 1.15):
            bad.append(f"{key}: ノーツ数 {len(ns)} が目標 {target} の±15%を外れている")

        # レーン分布。←/→ が死んだり、↓/↑ だけに偏ったりしていないか
        lane_count = [0, 0, 0, 0]
        for _t, lane in ns:
            if 0 <= lane <= 3:
                lane_count[lane] += 1
        for lane, c in enumerate(lane_count):
            pct = 100 * c / len(ns) if ns else 0
            if not (LANE_MIN_PCT <= pct <= LANE_MAX_PCT):
                bad.append(
                    f"{key}: レーン{lane}の比率 {pct:.1f}% が許容"
                    f"[{LANE_MIN_PCT}, {LANE_MAX_PCT}]% を外れている"
                )

        last_lane = [-9.0] * 4
        prev_t = -9.0
        for t, lane in ns:
            if not (0 <= lane <= 3):
                bad.append(f"{key}: レーンが範囲外 {lane} at {t}")
                break
            if not (0.0 < t < SONG_END):
                bad.append(f"{key}: 時刻が範囲外 {t}")
                break
            if t >= BAR0 + LAST_BAR * BAR:
                bad.append(f"{key}: アウトロにノーツがある {t}")
                break
            if t < prev_t:
                bad.append(f"{key}: 時刻が昇順でない {prev_t} -> {t}")
                break
            # 許容は select_times/assign_lanes の fits()・too_close と揃えて 1e-3
            # (丸め後の値で判定するため。詳細は fits() のコメント参照)
            if t - prev_t < cfg["gap_all"] - 1e-3 and prev_t > 0:
                bad.append(f"{key}: 全体の最小間隔違反 {prev_t} -> {t}")
                break
            if t - last_lane[lane] < GAP_LANE - 1e-3:
                bad.append(f"{key}: 同一レーン({lane})の最小間隔違反 {last_lane[lane]} -> {t}")
                break
            # 固定ギミック以外は16分グリッドに乗っていること
            # (丸め誤差があるので 0.5ms の許容で照合する)
            if not any(abs(t - c) < 5e-4 for c in CALL_TIMES):
                off = abs(((t - BEAT0) / S16) - round((t - BEAT0) / S16)) * S16
                if off > 0.001:
                    bad.append(f"{key}: 16分グリッドから {off*1000:.1f}ms ずれている at {t}")
                    break
            last_lane[lane] = t
            prev_t = t

        # 固定ギミックが歌詞どおりの順で入っていること
        call = [(t, lane) for t, lane in ns if any(abs(t - c) < 5e-4 for c in CALL_TIMES)]
        if [lane for _, lane in call] != CALL_LANES:
            bad.append(f"{key}: 「ひだり みぎ うえ した」のギミックが不正 {call}")

        # 安全網「密度カーブ」: セクション別ノーツ数が SECTIONS の意図した配分から
        # 大きく外れていないこと。select_times の quota と同じ式で期待値を出し、
        # ±30% か 3個の大きい方まで許容する。期待値の出どころが SECTIONS 自身なので
        # 「意図が曲に合っているか」は測れない(theory.md 原則2)
        weights = [mult * (b1 - b0) for b0, b1, mult in SECTIONS]
        total_w = sum(weights)
        for (b0, b1, _mult), w in zip(SECTIONS, weights):
            t0, t1 = BAR0 + b0 * BAR, BAR0 + b1 * BAR
            n = sum(1 for t, _lane in ns if t0 <= t < t1)
            expected = len(ns) * w / total_w
            if abs(n - expected) > max(0.30 * expected, 3):
                bad.append(
                    f"{key}: 小節{b0}-{b1} の密度 {n} が期待 {expected:.1f} から外れている"
                )

    if not (counts.get("easy", 0) < counts.get("normal", 0) < counts.get("hard", 0)):
        bad.append(f"難易度の順にノーツ数が増えていない: {counts}")

    # 安全網「強拍優先」: 拍頭に乗るノーツの比率が難易度順に単調非増加であること
    # (低難易度ほど拍頭に置く)。固定ギミックはグリッド外なので除外する。
    # easy は step=4 で構造的にほぼ100%なので、実質 normal と hard の歯止め
    def beat_rate(ns):
        core = [t for t, _lane in ns if not any(abs(t - c) < 5e-4 for c in CALL_TIMES)]
        on = sum(1 for t in core if round((t - BEAT0) / S16) % 4 == 0)
        return on / max(1, len(core))

    rates = {key: beat_rate(notes[key]) for key in DIFFS if key in notes}
    if len(rates) == len(DIFFS) and not (
        rates["easy"] + 1e-9 >= rates["normal"] and rates["normal"] + 1e-9 >= rates["hard"]
    ):
        shown = {k: round(v, 3) for k, v in rates.items()}
        bad.append(f"拍頭率が難易度順に下がっていない: {shown}")

    return bad


def verify_audio(data: dict, f) -> list[str]:
    """音源解析が要る安全網。bake 時のみ実行する(--verify では走らない)。"""
    bad: list[str] = []
    for key, ns in data["notes"].items():
        core = [t for t, _lane in ns if not any(abs(t - c) < 5e-4 for c in CALL_TIMES)]
        ok = sum(1 for t in core if classify(f, t)[1] >= ONSET_MIN)
        rate = ok / max(1, len(core))
        if rate < ONSET_RATE_MIN:
            bad.append(f"{key}: オンセット整合率 {rate:.3f} が {ONSET_RATE_MIN} を下回る")
    return bad


def main() -> int:
    baked = False
    f = None
    if "--verify" in sys.argv:
        if not OUT.exists():
            print(f"NG: {OUT} が無い", file=sys.stderr)
            return 1
        data = json.loads(OUT.read_text(encoding="utf-8"))
    else:
        data, f = bake()
        baked = True

    bad = verify(data)
    if f is not None:
        bad += verify_audio(data, f)
    for b in bad:
        print(f"NG: {b}", file=sys.stderr)
    if bad:
        if baked:
            print(f"検査に落ちたので {OUT} は更新していない", file=sys.stderr)
        return 1

    # 全検査に合格した場合だけ書き出す
    if baked:
        OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"wrote {OUT}")
    for key in DIFFS:
        ns = data["notes"][key]
        dist = [sum(1 for _t, lane in ns if lane == i) for i in range(4)]
        print(f"OK {key}: {len(ns)} notes  lanes(←↓↑→)={dist}  first={ns[0]}  last={ns[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
