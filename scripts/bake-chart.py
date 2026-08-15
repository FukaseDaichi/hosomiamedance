#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["librosa", "numpy", "soundfile", "audioread"]
# ///
"""収録曲の mp3 から難易度別の譜面 src/charts.json を生成する。

BPM・拍位相・小節線・区間は曲ごとの実測済み定数(SONGS)。曲が変わらない限り
再探索しない。新しい曲を足すときは scripts/analyze-song.py で測って SONGS に
書き写す。生成のあと不変条件を検査し、破れていたら異常終了する。

使い方:
    uv run scripts/bake-chart.py               全曲を生成してから検査
    uv run scripts/bake-chart.py amagoi        その曲だけ生成(他は既存を残す)
    uv run scripts/bake-chart.py --verify      既存の JSON を検査するだけ
"""

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

OUT = Path("src/charts.json")

LANE_L, LANE_D, LANE_U, LANE_R = 0, 1, 2, 3


@dataclass(frozen=True)
class Song:
    """曲ごとの実測定数。BPM / beat0 / bar0 は analyze-song.py の出力を書き写す。"""

    id: str
    src: Path
    bpm: float
    #: 1拍目の時刻
    beat0: float
    #: 1小節目の頭
    bar0: float
    #: ここから先(アウトロ)にはノーツを置かない
    last_bar: int
    #: 曲の終わり。アウトロのフェードを聴かせてから結果画面に行く
    song_end: float
    #: (開始小節, 終了小節(排他), 密度倍率)。曲構成に対応する
    sections: list[tuple[int, int, float]]
    #: 難易度ごとのノーツ数の目標。曲の尺に比例させる(下の注記参照)
    targets: dict[str, int]
    #: 歌詞に合わせてレーンを固定するギミック。無い曲は空でよい
    call_times: list[float] = field(default_factory=list)
    call_lanes: list[int] = field(default_factory=list)

    @property
    def spb(self) -> float:
        return 60.0 / self.bpm

    @property
    def bar(self) -> float:
        return 4 * self.spb

    @property
    def s16(self) -> float:
        return self.spb / 4

    @property
    def playable(self) -> float:
        """ノーツを置ける長さ(秒)。targets を曲の尺に合わせる基準。"""
        return self.bar0 + self.last_bar * self.bar


# targets は「1秒あたりのノーツ数」を曲間で揃えて決める。ホソミアメダンスの
# 160/280/460 を基準にすると easy 1.204 / normal 2.107 / hard 3.461 notes/sec で、
# これに各曲の playable 秒を掛けた値を丸めて置いている。BPM ではなく秒で
# 揃えるのは、指の忙しさが拍ではなく実時間で決まるため
SONGS: dict[str, Song] = {
    "amedance": Song(
        id="amedance",
        src=Path("public/assets/hosomiamedance.mp3"),
        bpm=156.0,
        beat0=0.2292,
        bar0=0.6138,
        last_bar=86,
        song_end=137.0,
        targets={"easy": 160, "normal": 280, "hard": 460},
        sections=[
            (0, 10, 0.45),   # イントロ兼サビ1。キックなし、ウォームアップ
            (10, 17, 1.00),  # ドラムイン
            (17, 24, 1.30),  # 間奏。歌がないぶん手を動かす
            (24, 40, 1.15),  # サビ2回目
            (40, 56, 0.85),  # Aメロ
            (56, 63, 0.35),  # ブレイク。溜め
            (63, 79, 1.35),  # ラスサビ
            (79, 86, 1.00),  # 締め
        ],
        # 「ひだり みぎ うえ した」の発声時刻
        call_times=[92.2413, 93.6112, 94.7606, 95.1670],
        call_lanes=[LANE_L, LANE_R, LANE_U, LANE_D],
    ),
    "amagoi": Song(
        id="amagoi",
        src=Path("public/assets/hosomiamagoidance.mp3"),
        bpm=127.384,
        beat0=0.2940,
        bar0=1.2360,
        last_bar=84,     # 小節84以降は rms 0.07 以下。フェードなので置かない
        song_end=164.0,  # 実尺 167.3 秒。無音で待たせない位置で切る
        targets={"easy": 192, "normal": 336, "hard": 552},
        sections=[
            (0, 6, 0.40),    # イントロ。囁きだけで静か
            (6, 8, 0.75),    # 立ち上がり
            (8, 16, 1.15),   # 最初のサビ
            (16, 24, 0.70),  # Aメロ。音が抜ける
            (24, 40, 1.10),  # サビ
            (40, 46, 1.25),  # 手数が増える区間(ハイハットが細かい)
            (46, 48, 0.55),  # 落ち
            (48, 64, 1.10),  # サビ
            (64, 72, 0.40),  # ブレイク。溜め
            (72, 80, 1.30),  # ラスサビ
            (80, 84, 0.60),  # 締め
        ],
        # 方向を指示する歌詞が無いのでギミックは置かない
    ),
    "kaminari": Song(
        id="kaminari",
        src=Path("public/assets/hosomikaminaridance.mp3"),
        bpm=128.003,
        beat0=0.3240,
        bar0=1.2615,
        last_bar=32,    # 小節32(61.3秒)から rms が 0.25 に落ちるフェード
        song_end=64.0,  # 実尺 64.7 秒
        targets={"easy": 74, "normal": 129, "hard": 212},
        sections=[
            (0, 8, 0.75),    # Aメロ。歌い出しが小節0の頭
            (8, 16, 1.15),   # サビ1
            (16, 21, 1.30),  # ラップ。歌が刻むので手数を出す
            (21, 26, 1.15),  # サビ2
            (26, 32, 0.90),  # アウトロ。歌が終わって伴奏だけ
        ],
        # 方向を指示する歌詞が無いのでギミックは置かない
    ),
}

# step は 16分いくつおきに置けるか (4=4分, 2=8分, 1=16分)。
# gap_all(全体の最小間隔)は曲の BPM から導く
DIFF_STEPS = {"easy": 4, "normal": 2, "hard": 1}


def gap_all(song: Song, key: str) -> float:
    return {"easy": song.spb, "normal": 2 * song.s16, "hard": song.s16}[key]


def gap_lane(song: Song) -> float:
    """同一レーンは全難易度で8分あける。"""
    return 2 * song.s16


# 連続性ボーナス。隣のグリッド点(その難易度のステップ幅で1つ隣)が選択済みなら
# 強度に加点し、点在よりも連続した流れ(ストリーム)を作る(theory.md 原則3)。
# 上げすぎると弱い音まで拾って音付け(原則1)を壊す。オンセット整合検査が上限の見張り
CONT_BONUS = 0.25

# 区間 quota を按分するサブウィンドウの幅(小節)。連続性ボーナスは
# rich-get-richer に働くため、区間(最長16小節)まるごとで貪欲を回すと
# 強い核の周りのストリームが quota を吸い尽くし、区間後半が長い無音地帯になる。
# 密度検査は区間単位なのでこの穴を見逃す。サブウィンドウごとに quota を配って
# 貪欲を回すことで、ストリームは窓内で育ちつつ穴が開かなくなる。
# 1小節。2小節にすると窓内の偏りが残り、ブレイク以外にも 4.2-4.6 秒の穴が出る
SUBWINDOW_BARS = 1

# オンセット整合検査の閾値。classify の強さがこれ未満のノーツは「音が無い所を
# 叩かせている」とみなす。採点に使う classify はノーツ選定と同じ関数なので、
# この検査は自己参照(theory.md 原則1)。CONT_BONUS の暴走を止める安全網
ONSET_MIN = 0.10
ONSET_RATE_MIN = 0.90

# レーン分布の許容範囲(%)。どのレーンも死なせず、どれか1つに寄せすぎない
LANE_MIN_PCT = 12.0
LANE_MAX_PCT = 50.0


def features(song: Song):
    """帯域別のオンセット強度と、中域のスペクトル重心を返す。"""
    import librosa
    import numpy as np

    y, sr = librosa.load(str(song.src), sr=22050, mono=True)
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


def bar_to_idx(song: Song, bar: int) -> int:
    """小節番号 -> beat0 起点の16分インデックス。"""
    return round((song.bar0 - song.beat0) / song.s16) + 16 * bar


def is_call(song: Song, t: float) -> bool:
    """固定ギミックの時刻か(グリッド照合の除外に使う)。"""
    return any(abs(t - c) < 5e-4 for c in song.call_times)


def select_times(song: Song, f, key: str):
    """区間ごとの割当数に従い、強い16分グリッド点を連続性の加点つきで選ぶ。"""
    step = DIFF_STEPS[key]
    target = song.targets[key]
    gap = gap_all(song, key)

    weights = [mult * (b1 - b0) for b0, b1, mult in song.sections]
    total_w = sum(weights)

    chosen = list(song.call_times)  # 固定ギミックを先に確保する
    chosen_sorted = sorted(chosen)

    def fits(t):
        # 全体の最小間隔。既に選んだ点との距離を見る
        # 時刻は小数第4位に丸められるため、丸め後にちょうど閾値と一致する
        # 隣接グリッド点まで誤って弾かないよう、許容を 1e-3 に広げてある
        # (1e-6 だと 0.3846 のような丸め値が gap_all の生の値を僅かに
        # 下回るだけで却下され、実効の最小間隔が設計より粗くなっていた)
        for c in chosen_sorted:
            if abs(c - t) < gap - 1e-3:
                return False
            if c > t + 1.0:
                break
        return True

    for (b0, b1, _mult), w in zip(song.sections, weights):
        quota = int(round(target * w / total_w))
        # ギミックが入る区間には既にその数だけノーツがある
        quota -= sum(1 for t in song.call_times if b0 <= (t - song.bar0) / song.bar < b1)
        if quota <= 0:
            continue

        # 区間内の候補グリッド点と強度。丸めの扱いは既存どおり
        # (出力時に小数第4位で丸めるので、選定も丸めた値で行う)
        strength = {}
        for i in range(bar_to_idx(song, b0), bar_to_idx(song, b1)):
            if i % step:
                continue
            t = round(song.beat0 + i * song.s16, 4)
            if t <= 0 or t >= song.bar0 + song.last_bar * song.bar:
                continue
            _, s = classify(f, t)
            strength[i] = (s, t)

        # 区間をサブウィンドウに割り、quota を小節数で按分する。
        # 端数は largest remainder 法で配り、合計が quota と一致するようにする
        windows = [(w0, min(w0 + SUBWINDOW_BARS, b1))
                   for w0 in range(b0, b1, SUBWINDOW_BARS)]
        bars = [w1 - w0 for w0, w1 in windows]
        raw = [quota * n / sum(bars) for n in bars]
        sub_quota = [int(x) for x in raw]
        rest = quota - sum(sub_quota)
        for j in sorted(range(len(raw)), key=lambda j: raw[j] - sub_quota[j], reverse=True)[:rest]:
            sub_quota[j] += 1

        # 逐次貪欲: 選択済みの隣にいる候補に CONT_BONUS を加点しながら、
        # 最高スコアの点から取っていく。強い音を核にストリームが育つ。
        # 候補はサブウィンドウ内に限るが taken_idx は区間を通して持ち回るので、
        # 窓境界をまたいだストリームもそのまま伸びる
        taken_idx: set[int] = set()
        carry = 0  # 窓が埋まりきらず余った分は次の窓へ送る
        for (w0, w1), q in zip(windows, sub_quota):
            lo, hi = bar_to_idx(song, w0), bar_to_idx(song, w1)
            dropped: set[int] = set()  # fits に落ちた点。加点の核にはしない
            want = q + carry
            taken = 0
            while taken < want:
                best_i, best_score = None, -1.0
                for i, (s, _t) in strength.items():
                    if not (lo <= i < hi) or i in taken_idx or i in dropped:
                        continue
                    bonus = CONT_BONUS * (
                        (i - step in taken_idx) + (i + step in taken_idx)
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
            carry = want - taken

    return sorted(chosen)


def assign_lanes(song: Song, f, times):
    """時間順にレーンを割り当てる。手の動き(交互・階段)を最優先し、音の種類は加点で反映する。"""
    out = []
    last_lane_t = [-9.0, -9.0, -9.0, -9.0]
    prev_lane = -1
    prev_prev = -1
    trill = 0      # 同じ2レーンの往復(A-B-A...)が何個続いたか
    prev_t = -9.0
    lane_gap = gap_lane(song)

    for t in times:
        forced = next(
            (lane for c, lane in zip(song.call_times, song.call_lanes) if abs(c - t) < 1e-6),
            None,
        )
        if forced is not None:
            lane = forced
        else:
            kind, _ = classify(f, t)
            fav = {"kick": LANE_D, "snare": LANE_U}.get(kind)
            gap = t - prev_t
            best_lane, best_score = None, None
            for cand in range(4):
                # 同一レーンの最小間隔は絶対条件
                if t - last_lane_t[cand] < lane_gap - 1e-6:
                    continue
                score = 0.0
                if cand == prev_lane:
                    score -= 3.0   # 縦連は強く避ける(theory.md 原則5)
                if prev_lane >= 0 and gap < 2 * song.s16 + 1e-6:
                    if abs(cand - prev_lane) == 1:
                        score += 1.5   # 速い流れでは隣のレーンへ = 階段(原則4)
                elif cand != prev_lane:
                    score += 0.5   # 遅い流れでも交互を好む(原則4)
                if cand == prev_prev and trill >= 3:
                    score -= 1.0   # 同じ往復を長く続けない(原則6)
                if fav is not None and cand == fav:
                    score += 0.8   # 音の種類は加点どまり(キック=↓、スネア=↑)
                score += 0.05 * min(t - last_lane_t[cand], 4.0)  # 4レーンをまんべんなく
                if best_score is None or score > best_score:
                    best_lane, best_score = cand, score
            # 全候補が間隔制約で塞がることは通常ない(GAP_LANE 窓内のノーツは最大2個)が、
            # 万一のときは最も長く空いているレーンへ
            lane = best_lane if best_lane is not None else max(range(4), key=lambda x: t - last_lane_t[x])

        trill = trill + 1 if lane == prev_prev else 0
        prev_prev = prev_lane
        prev_lane = lane
        prev_t = t
        last_lane_t[lane] = t
        out.append((round(t, 4), lane))

    return out


def bake(song: Song):
    f = features(song)
    notes = {}
    for key in DIFF_STEPS:
        times = select_times(song, f, key)
        notes[key] = assign_lanes(song, f, times)
        print(f"  {song.id}/{key}: {len(notes[key])} notes")
    return {
        "bpm": song.bpm,
        "beat0": song.beat0,
        "bar0": song.bar0,
        "source": "baked",
        "songEnd": song.song_end,
        "notes": notes,
    }, f


def verify_recorded(song: Song, data: dict) -> list[str]:
    """録音由来(Claude 整形)の譜面の健全性検査。

    人間のグルーヴを尊重するため「生成の意図どおりか」系の検査
    (ノーツ数目標・レーン分布・密度カーブ・拍頭率)はかけない。
    壊れていないこと(叩ける・範囲内・グリッドに乗っている)だけを見る。
    """
    bad: list[str] = []
    notes = data.get("notes", {})
    if set(notes) != set(DIFF_STEPS):
        return [f"{song.id}: 難易度キーが違う: {sorted(notes)}"]

    # メタは実測定数と一致していること(変換時に書き換えてはいけない)
    for name, want in [
        ("bpm", song.bpm), ("beat0", song.beat0), ("bar0", song.bar0), ("songEnd", song.song_end),
    ]:
        if data.get(name) != want:
            bad.append(f"{song.id}: {name} が実測定数と違う: {data.get(name)} != {want}")

    counts = {}
    for key in DIFF_STEPS:
        ns = notes[key]
        counts[key] = len(ns)
        last_lane = [-9.0] * 4
        prev_t = -9.0
        for t, lane in ns:
            if not (0 <= lane <= 3):
                bad.append(f"{song.id}/{key}: レーンが範囲外 {lane} at {t}")
                break
            if not (0.0 < t < song.song_end):
                bad.append(f"{song.id}/{key}: 時刻が範囲外 {t}")
                break
            if t < song.bar0 - 1e-3:
                bad.append(f"{song.id}/{key}: 1小節目より前にノーツがある {t}")
                break
            if t >= song.bar0 + song.last_bar * song.bar:
                bad.append(f"{song.id}/{key}: アウトロにノーツがある {t}")
                break
            if t < prev_t:
                bad.append(f"{song.id}/{key}: 時刻が昇順でない {prev_t} -> {t}")
                break
            # 物理的に叩ける下限だけ守る: 全体は16分、同一レーンは8分
            if prev_t > 0 and t - prev_t < song.s16 - 1e-3:
                bad.append(f"{song.id}/{key}: 全体の最小間隔違反 {prev_t} -> {t}")
                break
            if t - last_lane[lane] < 2 * song.s16 - 1e-3:
                bad.append(f"{song.id}/{key}: 同一レーン({lane})の最小間隔違反 {last_lane[lane]} -> {t}")
                break
            # 量子化済みであること(固定ギミック相当だけ免除)
            if not is_call(song, t):
                off = abs(((t - song.beat0) / song.s16) - round((t - song.beat0) / song.s16)) * song.s16
                if off > 0.001:
                    bad.append(f"{song.id}/{key}: 16分グリッドから {off*1000:.1f}ms ずれている at {t}")
                    break
            last_lane[lane] = t
            prev_t = t

    if counts["hard"] == 0:
        bad.append(f"{song.id}: hard が空。録音の変換に失敗している")
    if not (counts["easy"] <= counts["normal"] <= counts["hard"]):
        bad.append(f"{song.id}: 難易度の順にノーツ数が増えていない: {counts}")
    return bad


def verify(song: Song, data: dict) -> list[str]:
    """譜面の不変条件を検査し、破れた項目を文字列で返す。空なら合格。"""
    # source の綴りミスは保護(全曲生成のスキップ判定)をすり抜けるので、ここで落とす
    source = data.get("source", "baked")
    if source not in ("baked", "recorded"):
        return [f"{song.id}: source が不正: {source!r}"]
    if source == "recorded":
        return verify_recorded(song, data)
    bad: list[str] = []
    notes = data.get("notes", {})
    lane_gap = gap_lane(song)

    if set(notes) != set(DIFF_STEPS):
        bad.append(f"{song.id}: 難易度キーが違う: {sorted(notes)}")
        return bad

    counts = {}
    for key in DIFF_STEPS:
        ns = notes[key]
        counts[key] = len(ns)
        gap = gap_all(song, key)

        target = song.targets[key]
        if not (target * 0.85 <= len(ns) <= target * 1.15):
            bad.append(f"{song.id}/{key}: ノーツ数 {len(ns)} が目標 {target} の±15%を外れている")

        # レーン分布。←/→ が死んだり、↓/↑ だけに偏ったりしていないか
        lane_count = [0, 0, 0, 0]
        for _t, lane in ns:
            if 0 <= lane <= 3:
                lane_count[lane] += 1
        for lane, c in enumerate(lane_count):
            pct = 100 * c / len(ns) if ns else 0
            if not (LANE_MIN_PCT <= pct <= LANE_MAX_PCT):
                bad.append(
                    f"{song.id}/{key}: レーン{lane}の比率 {pct:.1f}% が許容"
                    f"[{LANE_MIN_PCT}, {LANE_MAX_PCT}]% を外れている"
                )

        last_lane = [-9.0] * 4
        prev_t = -9.0
        for t, lane in ns:
            if not (0 <= lane <= 3):
                bad.append(f"{song.id}/{key}: レーンが範囲外 {lane} at {t}")
                break
            if not (0.0 < t < song.song_end):
                bad.append(f"{song.id}/{key}: 時刻が範囲外 {t}")
                break
            if t >= song.bar0 + song.last_bar * song.bar:
                bad.append(f"{song.id}/{key}: アウトロにノーツがある {t}")
                break
            if t < prev_t:
                bad.append(f"{song.id}/{key}: 時刻が昇順でない {prev_t} -> {t}")
                break
            # 許容は select_times/assign_lanes の fits()・too_close と揃えて 1e-3
            # (丸め後の値で判定するため。詳細は fits() のコメント参照)
            if t - prev_t < gap - 1e-3 and prev_t > 0:
                bad.append(f"{song.id}/{key}: 全体の最小間隔違反 {prev_t} -> {t}")
                break
            if t - last_lane[lane] < lane_gap - 1e-3:
                bad.append(f"{song.id}/{key}: 同一レーン({lane})の最小間隔違反 {last_lane[lane]} -> {t}")
                break
            # 固定ギミック以外は16分グリッドに乗っていること
            # (丸め誤差があるので 0.5ms の許容で照合する)
            if not is_call(song, t):
                off = abs(((t - song.beat0) / song.s16) - round((t - song.beat0) / song.s16)) * song.s16
                if off > 0.001:
                    bad.append(f"{song.id}/{key}: 16分グリッドから {off*1000:.1f}ms ずれている at {t}")
                    break
            last_lane[lane] = t
            prev_t = t

        # 固定ギミックが歌詞どおりの順で入っていること
        call = [(t, lane) for t, lane in ns if is_call(song, t)]
        if [lane for _, lane in call] != list(song.call_lanes):
            bad.append(f"{song.id}/{key}: 固定ギミックが不正 {call}")

        # 安全網「密度カーブ」: セクション別ノーツ数が sections の意図した配分から
        # 大きく外れていないこと。select_times の quota と同じ式で期待値を出し、
        # ±30% か 3個の大きい方まで許容する。期待値の出どころが sections 自身なので
        # 「意図が曲に合っているか」は測れない(theory.md 原則2)
        weights = [mult * (b1 - b0) for b0, b1, mult in song.sections]
        total_w = sum(weights)
        for (b0, b1, _mult), w in zip(song.sections, weights):
            t0, t1 = song.bar0 + b0 * song.bar, song.bar0 + b1 * song.bar
            n = sum(1 for t, _lane in ns if t0 <= t < t1)
            expected = len(ns) * w / total_w
            if abs(n - expected) > max(0.30 * expected, 3):
                bad.append(
                    f"{song.id}/{key}: 小節{b0}-{b1} の密度 {n} が期待 {expected:.1f} から外れている"
                )

    if not (counts.get("easy", 0) < counts.get("normal", 0) < counts.get("hard", 0)):
        bad.append(f"{song.id}: 難易度の順にノーツ数が増えていない: {counts}")

    # 安全網「強拍優先」: 拍頭に乗るノーツの比率が難易度順に単調非増加であること
    # (低難易度ほど拍頭に置く)。固定ギミックはグリッド外なので除外する。
    # easy は step=4 で構造的にほぼ100%なので、実質 normal と hard の歯止め
    def beat_rate(ns):
        core = [t for t, _lane in ns if not is_call(song, t)]
        on = sum(1 for t in core if round((t - song.beat0) / song.s16) % 4 == 0)
        return on / max(1, len(core))

    rates = {key: beat_rate(notes[key]) for key in DIFF_STEPS if key in notes}
    if len(rates) == len(DIFF_STEPS) and not (
        rates["easy"] + 1e-9 >= rates["normal"] and rates["normal"] + 1e-9 >= rates["hard"]
    ):
        shown = {k: round(v, 3) for k, v in rates.items()}
        bad.append(f"{song.id}: 拍頭率が難易度順に下がっていない: {shown}")

    return bad


def verify_audio(song: Song, data: dict, f) -> list[str]:
    """音源解析が要る安全網。bake 時のみ実行する(--verify では走らない)。"""
    bad: list[str] = []
    for key, ns in data["notes"].items():
        core = [t for t, _lane in ns if not is_call(song, t)]
        ok = sum(1 for t in core if classify(f, t)[1] >= ONSET_MIN)
        rate = ok / max(1, len(core))
        if rate < ONSET_RATE_MIN:
            bad.append(f"{song.id}/{key}: オンセット整合率 {rate:.3f} が {ONSET_RATE_MIN} を下回る")
    return bad


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    verify_only = "--verify" in sys.argv

    unknown = [a for a in args if a not in SONGS]
    if unknown:
        print(f"NG: 知らない曲 {unknown}。選べるのは {sorted(SONGS)}", file=sys.stderr)
        return 1

    existing: dict = {}
    if OUT.exists():
        existing = json.loads(OUT.read_text(encoding="utf-8")).get("songs", {})

    wanted = args or list(SONGS)
    if not verify_only:
        if not args:
            # 全曲生成では録音由来の譜面を黙って潰さない。戻すには曲IDを明示する
            recorded = [sid for sid in wanted if existing.get(sid, {}).get("source") == "recorded"]
            if recorded:
                print(
                    f"skip: {recorded} は録音由来(source=recorded)。"
                    "自動生成に戻すには曲IDを明示指定する",
                    file=sys.stderr,
                )
                wanted = [sid for sid in wanted if sid not in recorded]
        else:
            for sid in wanted:
                if existing.get(sid, {}).get("source") == "recorded":
                    print(f"note: {sid} は録音由来だが明示指定なので自動生成で上書きする", file=sys.stderr)

    bad: list[str] = []
    baked: dict[str, dict] = {}
    if verify_only:
        if not existing:
            print(f"NG: {OUT} が無い", file=sys.stderr)
            return 1
        for sid in wanted:
            if sid not in existing:
                bad.append(f"{sid}: JSON に譜面が無い")
                continue
            bad += verify(SONGS[sid], existing[sid])
        data = {"songs": existing}
    else:
        for sid in wanted:
            song = SONGS[sid]
            chart, f = bake(song)
            baked[sid] = chart
            bad += verify(song, chart)
            bad += verify_audio(song, chart, f)
        data = {"songs": {**existing, **baked}}

    for b in bad:
        print(f"NG: {b}", file=sys.stderr)
    if bad:
        if not verify_only:
            print(f"検査に落ちたので {OUT} は更新していない", file=sys.stderr)
        return 1

    # 全検査に合格した場合だけ書き出す
    if not verify_only:
        OUT.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        print(f"wrote {OUT}")
    for sid in wanted:
        for key in DIFF_STEPS:
            ns = data["songs"][sid]["notes"][key]
            dist = [sum(1 for _t, lane in ns if lane == i) for i in range(4)]
            print(f"OK {sid}/{key}: {len(ns)} notes  lanes(←↓↑→)={dist}  first={ns[0]}  last={ns[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
