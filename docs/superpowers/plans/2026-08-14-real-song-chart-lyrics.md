# 実音源・難易度3種・歌詞表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SUNO で生成した実音源 `ホソミアメダンス.mp3` をゲーム本編の曲に据え、EASY / NORMAL / HARD の 3 難易度の譜面と、歌唱に同期した歌詞表示を実装する。

**Architecture:** 譜面は `scripts/bake-chart.py`（uv / librosa）でオフライン生成し `src/charts.json` にコミットする。ブラウザ側は JSON を読むだけで解析しない。再生は `<audio>` ではなく `decodeAudioData` → `AudioBufferSourceNode` にして、既存の判定時計（`ctx.currentTime - startAt`）をそのまま使う。合成曲エンジンは全廃する。

**Tech Stack:** Vite 6 / React 18（クラスコンポーネント）/ TypeScript 5.7 strict / Three.js / WebAudio / Python は uv + PEP 723（librosa・numpy）

## Global Constraints

- **設計書**: `docs/superpowers/specs/2026-08-14-real-song-chart-lyrics-design.md`。数値はすべてここが正。
- **BPM = 156.000**、**拍位相 BEAT0 = 0.2292 s**、**小節線 BAR0 = 0.6138 s**、**1小節 = 1.538462 s**、**16分 = 0.096154 s**、**総小節数 90**、**曲の終わり SONG_END = 137.0 s**。実測済み。スクリプト内で再探索しない。
- **Python は uv を使う。** `uv run scripts/xxx.py`。`pip` / `python3` の直叩き禁止。依存は PEP 723 のインラインメタデータ（`# /// script`）に書く。
- **`public/` のアセット URL には `import.meta.env.BASE_URL` を前置する。** `/assets/...` と絶対パスで書くと本番だけ 404 になる。
- **`<StrictMode>` は追加しない**（`src/main.tsx`）。二重マウントで WebGL と AudioContext が二重生成される。
- **base パスは `/hosomiamedance/`**。dev / preview でも `http://localhost:5173/hosomiamedance/` を開く。
- **コメントは日本語**、周囲のコードの密度に合わせる。
- TypeScript は `strict` + `noUnusedLocals` + `noUnusedParameters`。未使用の import / 変数 / 引数はビルドエラーになる。
- **このリポジトリにテストフレームワークは無い。導入もしない。** 検証手段は 3 つ:
  1. `uv run scripts/bake-chart.py --verify` — 譜面の不変条件チェック（Task 1 で作る）
  2. `npm run build` — `tsc --noEmit` + 本番ビルド。型エラーはここでしか出ない
  3. ブラウザでの実プレイ。判定・スコア・描画は挙動が繊細なので型が通るだけでは不十分（AGENTS.md）
- コミットは必ずパスを明示して `git add` すること。`git add -A` / `git commit -a` は禁止。
- **`public/assets/ホソミアメダンス.mp3` は git の追跡下にある**（コミット `3f7fbed`）。単なる `mv` では削除がステージされず、リネーム前後の 3.3 MB が両方コミットに入る。**`git mv` を使う。**

---

## File Structure

| パス | 変更 | 責務 |
| --- | --- | --- |
| `public/assets/hosomiamedance.mp3` | リネーム | 音源本体。日本語ファイル名から ASCII へ |
| `scripts/bake-chart.py` | 新規 | 音源解析 → 難易度別譜面の生成と不変条件検査 |
| `src/charts.json` | 新規（生成物） | 焼いた譜面。`[t, lane]` の配列 × 3 難易度 |
| `src/audio.ts` | 大幅改修 | 合成曲エンジンを削除し、mp3 のロード・再生と難易度定義に置き換える。雨音・効果音は据え置き |
| `src/lyrics.ts` | 新規 | 歌詞データ（時刻＋ひらがな原文）と現在行の判定 |
| `src/App.tsx` | 改修 | 選曲画面を難易度 3 枚に、難易度パラメータの適用、終了判定、歌詞行の更新 |
| `src/styles.css` | 追記 | `.lyric` とフェードの keyframes |
| `package.json` | 追記 | `bake-chart` スクリプト |
| `AGENTS.md` / `README.md` | 更新 | 構成表が実態と合わなくなるため |

---

### Task 1: 譜面のベイクと検査

**Files:**
- Rename: `public/assets/ホソミアメダンス.mp3` → `public/assets/hosomiamedance.mp3`
- Create: `scripts/bake-chart.py`
- Create: `src/charts.json`（スクリプトの生成物）
- Modify: `package.json`（`scripts` に 1 行追加）

**Interfaces:**
- Consumes: なし（このタスクが起点）
- Produces: `src/charts.json`。形は
  ```json
  {
    "bpm": 156,
    "beat0": 0.2292,
    "songEnd": 137.0,
    "notes": {
      "easy":   [[2.2933, 1], [3.0625, 3]],
      "normal": [[2.2933, 1]],
      "hard":   [[2.2933, 1]]
    }
  }
  ```
  `notes` の各要素は `[時刻(秒), レーン]`。レーンは `0=← 1=↓ 2=↑ 3=→`。時刻の昇順。

- [ ] **Step 1: 音源をリネームする**

この mp3 は追跡下にあるので `git mv` を使う。ただの `mv` だと削除がステージされず、
Step 9 のコミットにリネーム前後の 3.3 MB が両方入ってしまう。

```bash
git mv "public/assets/ホソミアメダンス.mp3" public/assets/hosomiamedance.mp3
git status --short public/assets
ls -la public/assets/hosomiamedance.mp3
```

期待: `git status` が `R  public/assets/...mp3 -> public/assets/hosomiamedance.mp3` を1行だけ出すこと。
`3327928` バイトのファイルが存在すること。

- [ ] **Step 2: 「ひだり みぎ うえ した」4語の発声時刻を検出する**

固定ギミックに使う 4 点を確定させる。ASR では「左右」が 1 トークンに結合してしまい `みぎ` の時刻が取れていない。この区間（小節 56–62）はキックが抜けているので、中域のオンセットはほぼボーカルのみになる。

一時スクリプトを作って実行する（コミットしない）:

```python
# /// script
# requires-python = ">=3.11"
# dependencies = ["librosa", "numpy", "soundfile", "audioread"]
# ///
"""91.5-96.5 秒の中域オンセットを列挙し、「ひだり みぎ うえ した」の4点を探す。"""

import librosa
import numpy as np

y, sr = librosa.load("public/assets/hosomiamedance.mp3", sr=22050, mono=True)
hop = 256
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
band = (freqs >= 300) & (freqs < 3000)
env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S[band], ref=np.max), sr=sr, hop_length=hop)
onsets = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop, units="time", backtrack=True)
sel = [t for t in onsets if 91.5 <= t <= 96.5]
for t in sel:
    i = int(t * sr / hop)
    print(f"{t:7.3f}s  strength={env[min(i, len(env)-1)]:6.2f}")
```

Run: `uv run /tmp/find-call.py`（scratchpad でよい）

期待: 91.5〜96.5 秒に複数のオンセットが並ぶ。ASR の実測（`ひだり ≈ 92.26` / `うえ ≈ 94.64` / `した ≈ 95.16`）に最も近い 4 点を、時間順に `ひだり / みぎ / うえ / した` として選ぶ。`みぎ` は 92.26 と 94.64 のあいだで最も強いもの。

選んだ 4 点を控える。Step 3 の `CALL_TIMES` に入れる。

- [ ] **Step 3: 不変条件チェッカーを先に書く（まだ生成器は書かない）**

Create `scripts/bake-chart.py`。まず検査部だけを書き、`--verify` で `src/charts.json` を読んで検査する。ファイルがまだ無いので失敗するのが正しい。

```python
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
CALL_TIMES = [92.26, 93.45, 94.64, 95.16]
CALL_LANES = [LANE_L, LANE_R, LANE_U, LANE_D]

DIFFS = {
    # step は 16分いくつおきに置けるか (4=4分, 2=8分, 1=16分)
    "easy":   {"step": 4, "target": 160, "gap_all": SPB},
    "normal": {"step": 2, "target": 280, "gap_all": 2 * S16},
    "hard":   {"step": 1, "target": 460, "gap_all": S16},
}
GAP_LANE = 2 * S16        # 同一レーンは全難易度で8分あける


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
            if t - prev_t < cfg["gap_all"] - 1e-6 and prev_t > 0:
                bad.append(f"{key}: 全体の最小間隔違反 {prev_t} -> {t}")
                break
            if t - last_lane[lane] < GAP_LANE - 1e-6:
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

    if not (counts.get("easy", 0) < counts.get("normal", 0) < counts.get("hard", 0)):
        bad.append(f"難易度の順にノーツ数が増えていない: {counts}")

    return bad


def main() -> int:
    if "--verify" in sys.argv:
        if not OUT.exists():
            print(f"NG: {OUT} が無い", file=sys.stderr)
            return 1
        data = json.loads(OUT.read_text(encoding="utf-8"))
    else:
        data = bake()
        OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"wrote {OUT}")

    bad = verify(data)
    for b in bad:
        print(f"NG: {b}", file=sys.stderr)
    if bad:
        return 1
    for key in DIFFS:
        ns = data["notes"][key]
        dist = [sum(1 for _t, lane in ns if lane == i) for i in range(4)]
        print(f"OK {key}: {len(ns)} notes  lanes(←↓↑→)={dist}  first={ns[0]}  last={ns[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: チェッカーが落ちることを確認する**

Run: `uv run scripts/bake-chart.py --verify`

期待: FAIL。`NG: src/charts.json が無い` と出て終了コード 1。

- [ ] **Step 5: 生成器 `bake()` を実装する**

`scripts/bake-chart.py` の `verify` の**前**に以下を挿入する（`main` からは後方参照で問題ない）。

librosa と numpy を関数の中で import しているのは意図的。`--verify` だけを走らせるときに
重いライブラリの読み込みを避けるため。PEP 723 の依存には両方とも宣言済み。

```python
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
    scores = {"kick": k, "snare": min(b, h) * 1.2, "mel": m, "hat": h * 0.6}
    kind = max(scores, key=lambda x: scores[x])
    return kind, scores[kind]


def bar_to_idx(bar):
    """小節番号 -> BEAT0 起点の16分インデックス。BAR0 = BEAT0 + SPB なので +4。"""
    return 4 + 16 * bar


def select_times(f, cfg):
    """区間ごとの割当数に従って、強い16分グリッド点から順に時刻を選ぶ。"""
    weights = [mult * (b1 - b0) for b0, b1, mult in SECTIONS]
    total_w = sum(weights)

    chosen = list(CALL_TIMES)  # 固定ギミックを先に確保する
    chosen_sorted = sorted(chosen)

    def fits(t):
        # 全体の最小間隔。既に選んだ点との距離を見る
        for c in chosen_sorted:
            if abs(c - t) < cfg["gap_all"] - 1e-6:
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

        i0, i1 = bar_to_idx(b0), bar_to_idx(b1)
        cands = []
        for i in range(i0, i1):
            if i % cfg["step"]:
                continue
            t = BEAT0 + i * S16
            if t <= 0 or t >= BAR0 + LAST_BAR * BAR:
                continue
            _, strength = classify(f, t)
            cands.append((strength, t))
        cands.sort(reverse=True)

        taken = 0
        for _s, t in cands:
            if taken >= quota:
                break
            if not fits(t):
                continue
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
            too_close = t - last_lane_t[lane] < GAP_LANE - 1e-6
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
    return {"bpm": BPM, "beat0": BEAT0, "songEnd": SONG_END, "notes": notes}
```

- [ ] **Step 6: 生成して検査を通す**

Run: `uv run scripts/bake-chart.py`

期待: `wrote src/charts.json` のあと `OK easy: ... / OK normal: ... / OK hard: ...` が出て終了コード 0。

落ちた場合の対処:
- 「ノーツ数が±15%を外れている」→ `DIFFS` の `target` ではなく、間隔制約で置けていない。`SECTIONS` の倍率が高すぎる区間があるので、その区間の倍率を下げて全体を均す
- 「同一レーンの最小間隔違反」→ `assign_lanes` の逃がし先が塞がっている。4 レーンすべてが `GAP_LANE` 以内なら物理的に置けないので、その難易度の `gap_all` を広げる
- 「ギミックが不正」→ `CALL_TIMES` の 4 点が `gap_all` より近接している。Step 2 の検出をやり直す

- [ ] **Step 7: レーンの偏りを確認する**

Step 6 の出力に含まれるレーン分布を読む。読み直したいだけなら再生成せずに:

Run: `uv run scripts/bake-chart.py --verify`

期待: 3 難易度とも 4 レーンにばらけていること。1 レーンだけ極端に多い（全体の 50% 超）場合は
`classify` の重みがおかしい。`scores` の `snare` の 1.2、`hat` の 0.6 を調整して Step 6 からやり直す。

↓（キック）が多くなるのは設計どおりなので、3 割程度なら問題ない。

- [ ] **Step 8: package.json にスクリプトを追加する**

`package.json` の `scripts` に 1 行足す:

```json
    "bake-chart": "uv run scripts/bake-chart.py",
```

`bake-sprites` の隣に置く。

- [ ] **Step 9: コミット**

リネームは Step 1 の `git mv` で既にステージ済み（削除＋追加の両方）。残りを足してコミットする。

```bash
git add scripts/bake-chart.py src/charts.json package.json
git status --short
git commit -m "feat: 実音源から難易度別の譜面を生成するベイクスクリプトを追加"
```

`git status --short` に日本語名の mp3 が `D`（未ステージの削除）として残っていないことを確認する。
残っていたら Step 1 で `git mv` ではなく `mv` を使っている。`git rm --cached` で削除をステージする。

---

### Task 2: 実音源の再生と難易度 3 種

**Files:**
- Modify: `src/audio.ts`（合成曲エンジンを削除し、mp3 再生と難易度定義に置き換え）
- Modify: `src/App.tsx`（選曲画面・難易度パラメータ・終了判定・ロード待ち）

**Interfaces:**
- Consumes: `src/charts.json`（Task 1）
- Produces: `src/audio.ts` から
  ```ts
  export type DifficultyId = 'easy' | 'normal' | 'hard'
  export interface Difficulty {
    id: DifficultyId
    name: string
    desc: string
    hearts: number
    noteSpeed: number   // px/s
    perfWindow: number  // 秒
    goodWindow: number  // 秒
  }
  export interface ChartNote { t: number; lane: number }
  export const BPM: number
  export const SONG_TITLE: string
  export const SONG_END: number
  export const DIFFICULTIES: Difficulty[]
  export function chart(id: DifficultyId): ChartNote[]
  export function prefetchSong(): void
  export function loadSong(): Promise<void>
  export function isSongReady(): boolean
  export function startSong(): void
  export function stop(): void
  export function time(): number
  export function sfx(name: SfxName): void
  export function wake(): void
  export function setRain(v: number): void
  ```

- [ ] **Step 1: audio.ts から合成曲エンジンを削除する**

`src/audio.ts` の以下をすべて削除する:

- `mulberry32`
- `PENTA_MAJ` / `PENTA_MIN`
- `SongDef` / `NoteEvent` / `Song` の型
- `SONG_DEFS`
- `buildEvents`
- `SONGS`
- `pluck` / `kick` / `hat` / `bass`
- `SongState` の中身と `startSong` の先読みスケジューラ
- `chart(idx: number)`

残すのは: 冒頭のコメント、`Engine` インターフェース、`engine` 変数、`ensureEngine`、`mtof`、`stop`、`time`、`SfxName`、`sfx`、`wake`、`setRain`。

`mtof` は `sfx` が使っていないので、`noUnusedLocals` に引っかかる。**`mtof` も削除する。**

ファイル冒頭のコメントを次に差し替える:

```ts
// ホソミアメダンス — WebAudio engine: 曲(mp3)の再生 + 雨音 + 効果音
//
// 曲は SUNO で作った実音源を decodeAudioData して AudioBufferSourceNode で鳴らす。
// <audio> を使わないのは、判定の時計 ctx.currentTime と同じ基準で秒を取るため。
// 譜面は scripts/bake-chart.py が焼いた charts.json を読むだけで、ここでは解析しない。
```

- [ ] **Step 2: 難易度定義と譜面の読み出しを足す**

`src/audio.ts` の `Engine` インターフェースの**前**に追加する:

```ts
import chartData from './charts.json'

export type DifficultyId = 'easy' | 'normal' | 'hard'

export interface Difficulty {
  id: DifficultyId
  name: string
  desc: string
  hearts: number
  /** ノーツの落下速度 (px/s) */
  noteSpeed: number
  /** 「ぴったり」の判定窓(秒) */
  perfWindow: number
  /** 「いいね」の判定窓(秒) */
  goodWindow: number
}

export interface ChartNote {
  /** 曲頭からの秒数 */
  t: number
  lane: number
}

export const BPM = 156
export const SONG_TITLE = 'ホソミアメダンス'
/** 曲の終わり(秒)。アウトロのフェードを聴かせてから結果画面に行く。 */
export const SONG_END = 137.0

const SONG_URL = `${import.meta.env.BASE_URL}assets/hosomiamedance.mp3`

export const DIFFICULTIES: Difficulty[] = [
  { id: 'easy', name: 'EASY', desc: 'はじめての アメダンス', hearts: 1, noteSpeed: 260, perfWindow: 0.09, goodWindow: 0.19 },
  { id: 'normal', name: 'NORMAL', desc: 'ノリノリで おどろう', hearts: 2, noteSpeed: 320, perfWindow: 0.07, goodWindow: 0.15 },
  { id: 'hard', name: 'HARD', desc: 'ぜんりょく アメダンス!', hearts: 3, noteSpeed: 400, perfWindow: 0.055, goodWindow: 0.12 },
]

/** 焼いた譜面を秒単位のノーツ列として返す。 */
export function chart(id: DifficultyId): ChartNote[] {
  return chartData.notes[id].map((n) => ({ t: n[0], lane: n[1] }))
}
```

`import.meta.env.BASE_URL` は末尾に `/` を含む（`/hosomiamedance/`）ので、`assets/...` を `/` 無しで繋ぐ。

- [ ] **Step 3: mp3 のロードと再生を実装する**

`SongState` インターフェースとモジュール変数の宣言ブロックをまるごと差し替え、
`startSong` / `stop` / `time` を置き換える。

元のファイルの

```ts
interface SongState { ... }   // song, spb, startAt, step, totalSteps, evIdx, timer を持つやつ

let engine: Engine | null = null
let songState: SongState | null = null
```

を次で置き換える（`let engine` を二重に宣言しないよう、元の行は必ず消すこと）:

```ts
interface SongState {
  src: AudioBufferSourceNode
  startAt: number
}

let engine: Engine | null = null
let songState: SongState | null = null
let songBuffer: AudioBuffer | null = null
let songBytes: Promise<ArrayBuffer> | null = null
```

`ensureEngine` の後ろに:

```ts
/** mp3 の取得だけ先に始める。AudioContext は要らないので起動直後に呼べる。 */
export function prefetchSong() {
  if (!songBytes) songBytes = fetch(SONG_URL).then((r) => r.arrayBuffer())
}

/** mp3 をデコードして再生できる状態にする。ユーザー操作のあとに呼ぶこと。 */
export async function loadSong(): Promise<void> {
  if (songBuffer) return
  prefetchSong()
  const e = ensureEngine()
  const bytes = await songBytes!
  // decodeAudioData は渡した ArrayBuffer を detach するので、コピーを渡す
  songBuffer = await e.ctx.decodeAudioData(bytes.slice(0))
}

export function isSongReady(): boolean {
  return songBuffer !== null
}

/** 曲を先頭から再生する。0.9 秒の助走を置いてから鳴り始める。 */
export function startSong() {
  const e = ensureEngine()
  if (e.ctx.state === 'suspended') void e.ctx.resume()
  if (!songBuffer) throw new Error('song is not loaded')
  stop()
  const src = e.ctx.createBufferSource()
  src.buffer = songBuffer
  src.connect(e.master)
  const startAt = e.ctx.currentTime + 0.9
  src.start(startAt)
  songState = { src, startAt }
}

export function stop() {
  if (songState) {
    // 停止済みの source を stop すると例外になる
    try {
      songState.src.stop()
    } catch {
      // すでに終わっている
    }
    songState.src.disconnect()
    songState = null
  }
}

/** 曲頭を 0 とした現在位置(秒)。未再生なら -99。 */
export function time(): number {
  if (!songState || !engine) return -99
  return engine.ctx.currentTime - songState.startAt
}
```

- [ ] **Step 4: App.tsx を新しい API に繋ぎ変える**

`src/App.tsx` を次のように変える。

1. `state` に `songIdx` はそのまま残す（`DIFFICULTIES` のインデックスとして使う）。

2. `componentDidMount` の先頭に mp3 の先読みを足す:

```ts
  componentDidMount() {
    HAudio.prefetchSong()
    if (this.stageHostRef.current) {
```

3. `windows()` を難易度から引くよう差し替える:

```ts
  /** 判定窓(秒)。easyJudge で広がる。 */
  private windows() {
    const d = HAudio.DIFFICULTIES[this.state.songIdx]
    const k = (this.props.easyJudge ?? false) ? 1.5 : 1
    return { perf: d.perfWindow * k, good: d.goodWindow * k }
  }
```

4. `startGame` を async にしてロード待ちを入れる。`replay` も追従させる:

```ts
  private replay = () => void this.startGame(this.state.songIdx)

  private async startGame(idx: number) {
    HAudio.wake()
    if (!HAudio.isSongReady()) {
      this.setState({ phase: 'loading' })
      await HAudio.loadSong()
    }
    HAudio.sfx('start')
    const diff = HAudio.DIFFICULTIES[idx]
    this.chart = HAudio.chart(diff.id).map((n) => ({ t: n.t, lane: n.lane, state: 0 as NoteState }))
    this.endAt = HAudio.SONG_END
    this.effects = []
    this.flash = [0, 0, 0, 0]
    HAudio.startSong()
    if (this.stage) {
      this.stage.setBPM(HAudio.BPM)
      this.stage.setDancing(true)
    }
    this.setState({
      phase: 'game',
      songIdx: idx,
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfect: 0,
      good: 0,
      miss: 0,
      judge: null,
      special: null,
      nextMilestone: 10,
    })
  }
```

Task 3 でここに `lyricIdx: -1,` を足す。**Task 2 の時点では書かない**（`AppState` にまだ無い）。

5. `onKey` の 2 箇所の `startGame` 呼び出しを `void` で包む（Promise を捨てる）:

```ts
    } else if (p === 'select' && ['1', '2', '3'].includes(e.key)) {
      void this.startGame(Number(e.key) - 1)
```

```ts
    } else if (p === 'result') {
      if (e.key === 'Enter') void this.startGame(this.state.songIdx)
```

6. `drawLanes` の速度を難易度から引く:

```ts
    const diff = HAudio.DIFFICULTIES[this.state.songIdx]
    const speed = diff.noteSpeed * (this.props.noteSpeed ?? 1)
```

（元の `const speed = 300 * (this.props.noteSpeed ?? 1)` を置き換える）

7. `render` の曲名と選曲画面を差し替える。

冒頭の

```ts
    const s = this.state
    const songName = HAudio.SONGS[s.songIdx]?.name ?? ''
```

を次に差し替える（`songName` は消す。残すと `noUnusedLocals` で落ちる）:

```ts
    const s = this.state
    const diff = HAudio.DIFFICULTIES[s.songIdx]
```

`song-chip` を:

```tsx
              <div className="song-chip">♪ {HAudio.SONG_TITLE} — {diff.name}</div>
```

選曲画面の `song-list` を:

```tsx
            <div className="song-list">
              {HAudio.DIFFICULTIES.map((d, i) => (
                <button type="button" key={d.id} className="song-card" onClick={() => void this.startGame(i)}>
                  <div className="song-key">キー {i + 1}</div>
                  <div className="song-name">{d.name}</div>
                  <div className="song-desc">{d.desc}</div>
                  <div className="song-meta">
                    <span className="song-bpm">BPM {HAudio.BPM}</span>
                    <span className="song-hearts">
                      {'♥'.repeat(d.hearts) + '♡'.repeat(3 - d.hearts)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
```

`select-heading` の文言を `きょくを えらぼう` から `むずかしさを えらぼう` に変える。

- [ ] **Step 5: 型チェックとビルドを通す**

Run: `npm run build`

期待: PASS。エラーが出る場合は `noUnusedLocals` による未使用変数（削除し忘れた `mtof` など）か、`songName` 変数の消し忘れ。

- [ ] **Step 6: ブラウザで実際に遊んで確認する**

Run: `npm run dev` して `http://localhost:5173/hosomiamedance/` を開く。

確認すること:
1. タイトル → 「はじめる」→ 難易度 3 枚が出る
2. EASY を選んで曲が鳴り、ノーツが降ってくる
3. **ノーツが音とずれていない。** キックの位置で↓が判定ラインに来る
4. 137 秒まで再生され、アウトロのフェードのあとに結果画面へ行く
5. NORMAL / HARD も同様。HARD が明らかに密度が高い
6. 初回プレイでロードが数秒かかる場合、「じゅんびちゅう…」が出て固まって見えないこと

ずれている場合は `startSong` の助走 0.9 秒と `time()` の基準を疑う。譜面全体が一定量ずれているなら `chart()` の返り値に定数オフセットを足して調整し、その値を設計書の「未確定」節に記録する。

- [ ] **Step 7: コミット**

```bash
git add src/audio.ts src/App.tsx
git commit -m "feat: 実音源の再生に差し替え、難易度3種を実装"
```

---

### Task 3: 歌詞表示

**Files:**
- Create: `src/lyrics.ts`
- Modify: `src/App.tsx`（`AppState` に `lyricIdx`、`loop` での更新、`render` での表示）
- Modify: `src/styles.css`（`.lyric` と keyframes）

**Interfaces:**
- Consumes: `HAudio.time()`（Task 2）
- Produces:
  ```ts
  export interface LyricLine { t: number; end?: number; text: string }
  export const LYRICS: LyricLine[]
  /** 時刻 t に表示すべき行のインデックス。表示しないときは -1。 */
  export function lineAt(t: number): number
  ```

- [ ] **Step 1: 歌詞データを書く**

Create `src/lyrics.ts`:

```ts
// 歌詞と、その行が歌われ始める時刻(秒)。
//
// 時刻は音源を Whisper large-v3 に通して得た単語タイムスタンプの実測値。
// 表示するテキストは ASR の結果(漢字混じり)ではなく、SUNO に渡した原詞の
// ひらがな表記をそのまま使う。ゲーム内の表記をひらがなで統一するため。

export interface LyricLine {
  /** 歌い始めの秒数 */
  t: number
  /**
   * 歌い終わりの秒数。次の行まで間が空く行にだけ入れる。
   * 省略した行は次の行が始まるまで出しっぱなしになる。最終行には必ず入れること。
   */
  end?: number
  text: string
}

/** 歌い終わってから余韻で残す秒数。 */
const TAIL = 0.3

export const LYRICS: LyricLine[] = [
  { t: 0.0, text: 'あめ… あめ… ふるね' },
  { t: 2.28, text: 'みずたまり ぱしゃん' },
  { t: 5.24, text: 'つまさきで アメダンス' },
  { t: 8.48, text: 'かさを くるり まわせば' },
  { t: 12.18, text: 'せかいが きらきら する' },
  { t: 15.26, text: 'ひとりでも へいきだよ' },
  { t: 18.78, text: 'リズムが てを ひいてる' },
  { t: 21.06, text: 'きょうだけの ステップ' },
  { t: 24.24, end: 26.64, text: 'ららら アメダンス' }, // このあと間奏
  { t: 37.94, text: 'みずたまり ぱしゃん' },
  { t: 40.72, text: 'つまさきで アメダンス' },
  { t: 43.98, text: 'かさを くるり まわせば' },
  { t: 47.66, text: 'せかいが きらきら する' },
  { t: 50.84, text: 'ひとりでも へいきだよ' },
  { t: 54.14, text: 'リズムが てを ひいてる' },
  { t: 56.44, text: 'きょうだけの ステップ' },
  { t: 59.48, text: 'ららら アメダンス' },
  { t: 62.0, text: 'かさの ほねを つたう しずく' },
  { t: 64.66, text: 'バスていの あかり ぽつん' },
  { t: 67.6, text: 'かえりみち だれも いない' },
  { t: 70.72, text: 'だから すこし はねてみる' },
  { t: 73.76, text: 'くつの さきで とん とん とん' },
  { t: 76.68, text: 'みずが はねて わらってる' },
  { t: 79.5, text: 'そらは まだ ないてるけど' },
  { t: 82.82, text: 'きょうの わたしは だいじょうぶ' },
  { t: 86.6, text: 'かみなりが ひかる まえに' },
  { t: 89.56, text: 'いきを ひとつ すって' },
  { t: 92.26, text: 'ひだり みぎ うえ した' },
  { t: 95.76, text: 'みずたまり ぱしゃん' },
  { t: 99.3, text: 'つまさきで アメダンス' },
  { t: 102.28, text: 'かさを くるり まわせば' },
  { t: 106.18, text: 'せかいが きらきら する' },
  { t: 109.18, text: 'あめのなかで おどる子' },
  { t: 112.24, text: 'くもの うえまで とどけ' },
  { t: 114.88, text: 'ずぶぬれでも わらってる' },
  { t: 117.88, end: 120.66, text: 'ららら アメダンス' }, // このあと2.3秒空く
  { t: 122.96, text: 'とまらない アメダンス' },
  { t: 126.62, text: 'ららら… ららら…' },
  { t: 128.8, end: 132.9, text: 'あした はれても おどろうね' }, // 最終行
]

/** 時刻 t に表示すべき行のインデックス。表示しないときは -1。 */
export function lineAt(t: number): number {
  if (t < 0) return -1
  // 行数が40なので線形走査で足りる
  let idx = -1
  for (let i = 0; i < LYRICS.length; i++) {
    if (LYRICS[i].t > t) break
    idx = i
  }
  if (idx < 0) return -1
  const line = LYRICS[idx]
  const next = idx + 1 < LYRICS.length ? LYRICS[idx + 1].t : Infinity
  const until = Math.min(next, line.end === undefined ? Infinity : line.end + TAIL)
  return t < until ? idx : -1
}
```

`end` を入れたのは、次の行まで間が空く 3 行だけ。時刻はすべて ASR のセグメント終了時刻の実測値。

- 24.24「ららら アメダンス」→ 26.64 で歌い終わり、そこから 11 秒の間奏
- 117.88「ららら アメダンス」→ 120.66 で歌い終わり、2.3 秒空く
- 128.80「あした はれても おどろうね」→ 132.90 で歌い終わり、以降アウトロのフェードのみ

固定の上限秒（「N 秒経ったら消す」）ではなく歌い終わりを持たせているのは、行ごとに歌う長さが
2.5〜4 秒とばらつくため。上限秒だと、短い行は消えるのが遅れ、長い行は歌い終わる前に消える。

- [ ] **Step 2: 期待どおりの行が返るか確かめる**

リポジトリ直下に確認用の一時ファイルを作って実行し、確認できたら消す。

Create `check-lyrics.ts`（リポジトリ直下。`src/` の外に置くのは `tsconfig.json` の
`include` に入れず型チェックの対象にしないため）:

```ts
import { LYRICS, lineAt } from './src/lyrics.ts'

const cases: [number, string][] = [
  [-1, '再生前'],
  [0.5, 'あめ'],
  [3.0, 'みずたまり'],
  [26.0, '歌い終わる直前'],
  [27.5, '間奏の頭(空)'],
  [30.0, '間奏(空)'],
  [93.0, 'ひだり みぎ うえ した'],
  [109.5, 'あめのなかで おどる子'],
  [133.0, '最終行の余韻'],
  [134.0, 'アウトロ(空)'],
]

for (const [t, label] of cases) {
  const i = lineAt(t)
  console.log(t, label, '->', i < 0 ? '(なし)' : LYRICS[i].text)
}
```

Run: `npx --yes tsx check-lyrics.ts`

期待:
```
-1 再生前 -> (なし)
0.5 あめ -> あめ… あめ… ふるね
3 みずたまり -> みずたまり ぱしゃん
26 歌い終わる直前 -> ららら アメダンス
27.5 間奏の頭(空) -> (なし)
30 間奏(空) -> (なし)
93 ひだり みぎ うえ した -> ひだり みぎ うえ した
109.5 あめのなかで おどる子 -> あめのなかで おどる子
133 最終行の余韻 -> あした はれても おどろうね
134 アウトロ(空) -> (なし)
```

外れる行があれば `lineAt` の `until` の計算か、`end` を入れた 3 行の値を見直す。

確認できたら一時ファイルを消す:

```bash
rm check-lyrics.ts
```

- [ ] **Step 3: App.tsx に歌詞の状態を足す**

`src/App.tsx`:

1. import に追加:

```ts
import { LYRICS, lineAt } from './lyrics'
```

2. `AppState` に追加:

```ts
  /** 表示中の歌詞の行番号。-1 なら非表示 */
  lyricIdx: number
  /** フェードアウト中の歌詞の行番号。-1 ならなし */
  lyricOut: number
  /** フェードアウトのアニメーションを鳴らし直すための再マウント用キー */
  lyricOutKey: number
```

3. `state` の初期値に追加:

```ts
    lyricIdx: -1,
    lyricOut: -1,
    lyricOutKey: 0,
```

4. Task 2 Step 4 で保留した `startGame` の `setState` に追加:

```ts
      lyricIdx: -1,
      lyricOut: -1,
```

5. `loop()` の `const t = HAudio.time()` の直後に追加:

```ts
    // 毎フレーム setState すると重いので、行が変わったときだけ更新する
    const li = lineAt(t)
    if (li !== this.state.lyricIdx) {
      const prev = this.state.lyricIdx
      this.setState({
        lyricIdx: li,
        // 出ていた行があればフェードアウトさせる。key を進めて鳴らし直す
        lyricOut: prev >= 0 ? prev : this.state.lyricOut,
        lyricOutKey: prev >= 0 ? this.state.lyricOutKey + 1 : this.state.lyricOutKey,
      })
    }
```

6. `render` の `game` フェーズ、`hint` の直前に追加:

```tsx
            {s.lyricOut >= 0 && (
              <div key={`out-${s.lyricOutKey}`} className="lyric lyric--out">
                {LYRICS[s.lyricOut].text}
              </div>
            )}
            {s.lyricIdx >= 0 && (
              <div key={s.lyricIdx} className="lyric">
                {LYRICS[s.lyricIdx].text}
              </div>
            )}
```

2 つの `.lyric` は同じ座標に絶対配置されるので、前の行が薄れながら次の行が濃くなる
本当のクロスフェードになる。`key` を変えることで要素が作り直され、CSS アニメーションが
鳴り直す。判定表示（`judgeKey`）と同じ手口。

フェードアウト側は消さずに置きっぱなしでよい。`animation-fill-mode: both` で終端の
`opacity: 0` が保持されるため、アニメーションが終われば見えなくなる。タイマーで
アンマウントする必要はない。

- [ ] **Step 4: スタイルを足す**

`src/styles.css` の `.hint` の**直前**に追加:

```css
.lyric {
  position: absolute;
  left: 34px;
  bottom: 58px;
  /* レーンパネル(右 30px + 幅 340px)に被らない幅に収める */
  max-width: calc(100% - 440px);
  font-size: 30px;
  line-height: 1.3;
  color: #ffeccb;
  text-shadow:
    0 3px 0 rgba(90, 40, 80, 0.5),
    0 0 24px rgba(255, 200, 230, 0.35);
  animation: lyricIn 0.25s ease-out both;
}

/* 前の行。同じ座標に重なって薄れていく */
.lyric--out {
  animation: lyricOut 0.25s ease-in both;
}
```

`@keyframes blinky` の後ろに追加:

```css
@keyframes lyricIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes lyricOut {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-6px);
  }
}
```

- [ ] **Step 5: 型チェックとビルドを通す**

Run: `npm run build`

期待: PASS。

- [ ] **Step 6: ブラウザで歌詞の同期を確認する**

Run: `npm run dev` して `http://localhost:5173/hosomiamedance/` を開き、NORMAL で通しプレイする。

確認すること:
1. 歌い出しと歌詞の表示が合っている（遅れて見えない）
2. **行が切り替わるとき、前の行が薄れながら次の行が濃くなる**（前の行が瞬間的に消えない）
3. 間奏（約 27〜38 秒）で歌詞が消えている
4. 86.8〜97.5 秒のブレイクで「ひだり みぎ うえ した」が出て、**←→↑↓ のノーツが歌詞どおりの順に降ってくる**
5. 109 秒に「あめのなかで おどる子」が出る
6. 134 秒の時点で歌詞が消えている
7. 歌詞がレーンパネルやコンボ表示に重なっていない

歌詞が一律に早い／遅い場合は `lyrics.ts` の全 `t` に定数を足すのではなく、まず `startSong` の助走とノーツのずれ（Task 2 Step 6）を先に確認する。ノーツが合っていて歌詞だけずれるなら、`LYRICS` の該当行の `t` を個別に直す。

- [ ] **Step 7: コミット**

```bash
git add src/lyrics.ts src/App.tsx src/styles.css
git commit -m "feat: 歌唱に同期した歌詞表示を追加"
```

---

### Task 4: 試遊による調整とドキュメント更新

**Files:**
- Modify: `src/audio.ts`（`DIFFICULTIES` の数値、必要なら雨音の基準値）
- Modify: `scripts/bake-chart.py`（`DIFFS` の `target`、`SECTIONS` の倍率）
- Modify: `src/charts.json`（再生成）
- Modify: `AGENTS.md` / `README.md`

**Interfaces:**
- Consumes: Task 1〜3 の成果すべて
- Produces: なし（最終調整）

- [ ] **Step 1: 3 難易度を通しでプレイする**

Run: `npm run dev` して `http://localhost:5173/hosomiamedance/` で EASY / NORMAL / HARD をそれぞれ最後まで遊ぶ。

記録すること:
- 各難易度のスコアとランク。EASY で A 以上、HARD で B 前後に落ち着くのが目安
- ノーツが多すぎる／少なすぎる区間（時刻でメモする）
- 落下速度が速すぎる／遅すぎるか
- 判定が厳しすぎる／甘すぎるか

- [ ] **Step 2: 譜面の密度を直す**

Step 1 で「この区間が薄い／濃い」と感じた箇所を `scripts/bake-chart.py` の `SECTIONS` の倍率で直す。区間の境界は小節番号なので、時刻から `(t - 0.6138) / 1.538462` で小節番号を出す。

全体のノーツ数を変えるなら `DIFFS` の `target` を動かす。`verify` の許容は目標の ±15% なので、`target` を変えたら検査も追従する。

Run: `uv run scripts/bake-chart.py`

期待: `OK easy / OK normal / OK hard`。

直したら Step 1 に戻って遊び直す。納得いくまで繰り返す。

- [ ] **Step 3: 落下速度と判定窓を直す**

`src/audio.ts` の `DIFFICULTIES` の `noteSpeed` / `perfWindow` / `goodWindow` を調整する。

Run: `npm run build` して再度プレイ。

- [ ] **Step 4: 曲の雨音とゲームの雨音のバランスを見る**

曲自体に雨の環境音が入っている。ゲーム側の雨音（`setRain`）と重なって濁る場合、`src/audio.ts` の `setRain` の基準値を下げる:

```ts
export function setRain(v: number) {
  if (engine) engine.rainGain.gain.value = 0.02 + v * 0.022
}
```

の `0.02` と `0.022` を小さくする。濁っていなければ触らない。

- [ ] **Step 5: AGENTS.md を更新する**

`AGENTS.md` の以下を実態に合わせる:

1. コマンド表に 1 行足す:

| `npm run bake-chart` | `hosomiamedance.mp3` から譜面 `src/charts.json` を再生成 |

2. 構成表の `src/audio.ts` の説明を差し替える:

| `src/audio.ts` | mp3 の再生、雨音・効果音の合成、難易度定義 |

3. 構成表に 3 行足す:

| `src/lyrics.ts` | 歌詞と発声時刻 |
| `src/charts.json` | 焼いた譜面。**生成物なので直接編集しない** |
| `scripts/bake-chart.py` | 音源解析 → 譜面の生成パイプライン |

4. 「踏みやすい落とし穴」に 1 項目足す:

- **曲の BPM・拍位相・小節線は実測済みの定数**（`scripts/bake-chart.py` の `BPM` / `BEAT0` / `BAR0`）。
  BPM 156.000、1小節目 0.6138 秒、全 90 小節。曲を差し替えない限り再測定しない。
  譜面が音とずれたときに真っ先に疑うのはここではなく、`startSong` の助走と `time()` の基準。

**注意:** `AGENTS.md` は sprite 移行の作業で既に変更されている。**既存の変更を消さないこと。** 追記のみ行う。

- [ ] **Step 6: README.md を更新する**

`README.md` の以下を直す:

1. 冒頭の説明「曲・効果音は音源ファイルを持たず、すべて WebAudio でその場で合成している」は**もう正しくない**。次に差し替える:

```
矢印キー(←↓↑→)でノーツを叩き、コンボを繋いでスペシャル演出を出す。曲は「ホソミアメダンス」1曲で、
EASY / NORMAL / HARD の3難易度。譜面は音源を解析して事前に焼いてある。効果音と雨音は WebAudio 合成。
背景は Three.js の 3D シーン。
```

2. コマンド表に `npm run bake-chart` を足す。

3. 構成表に `src/lyrics.ts` / `src/charts.json` / `scripts/bake-chart.py` を足す。

- [ ] **Step 7: 最終確認**

Run:

```bash
uv run scripts/bake-chart.py --verify
npm run build
```

期待: 両方とも終了コード 0。

そのうえで `npm run preview` で `http://localhost:4173/hosomiamedance/` を開き、**本番ビルドで** 3 難易度を 1 回ずつ通しプレイする。dev では出ない `BASE_URL` 由来の 404 はここでしか出ない。

- [ ] **Step 8: コミット**

```bash
git add src/audio.ts scripts/bake-chart.py src/charts.json AGENTS.md README.md
git commit -m "tune: 試遊にもとづく難易度調整とドキュメント更新"
```

---

## 完了の定義

- `uv run scripts/bake-chart.py --verify` が通る
- `npm run build` が通る
- `npm run preview` の本番ビルドで EASY / NORMAL / HARD を通しプレイでき、ノーツが音と合っている
- ブレイクで「ひだり みぎ うえ した」の ←→↑↓ が歌詞どおりに降ってくる
- 歌詞が歌唱に同期し、間奏とアウトロでは消えている
- 合成 3 曲への参照がコードに残っていない
- sprite 移行の未コミット変更に手が入っていない
