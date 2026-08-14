# 譜面改善スキル「chart-feel」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 譜面理論を蒸留した理論リファレンスと、それをメトリクス化した自動検査、改善ループの手順書からなるプロジェクト専用スキル chart-feel を作る。

**Architecture:** スキル本体(SKILL.md + theory.md)を `.claude/skills/chart-feel/` に置き、理論由来の検査3つを既存の `scripts/bake-chart.py` の検査フローに追加する。JSON 単体で判定できる検査は `verify()`(bake と --verify の両方で実行)、音源解析が要る検査は新関数 `verify_audio()`(bake 時のみ実行)に入れる。新規スクリプトは作らない。

**Tech Stack:** Python (uv + PEP 723 インラインメタデータ)、librosa(既存依存)、Claude Code プロジェクトスキル

**Spec:** `docs/superpowers/specs/2026-08-15-chart-feel-skill-design.md`

## Global Constraints

- Python の実行は必ず `uv run`。`pip` / `python3` の直叩き禁止(AGENTS.md)
- コメント・ドキュメントは日本語。周囲のコードの密度に合わせる
- `src/charts.json` と `public/assets/hosomi/` は生成物。直接編集しない
- bake-chart.py は決定的(乱数なし)なので、同じコードなら再 bake しても charts.json は変わらない
- 変更を出す前に `npm run build` を通す(最終タスクで実施。TS を触らないので形式的な確認)
- BPM / BEAT0 / BAR0 / SECTIONS などの実測定数は変更しない

---

### Task 1: theory.md — 譜面理論の調査と蒸留

**Files:**
- Create: `.claude/skills/chart-feel/theory.md`

**Interfaces:**
- Produces: 原則6個(音付け / 密度カーブ / 休符設計 / 反復と変化 / 強拍優先 / 難易度の一貫性)。Task 2-4 の検査コードのコメントと SKILL.md(Task 5)がこの原則名を参照する。原則名は変えてよいが、変えたら後続タスクでも揃えること。

- [ ] **Step 1: osu! mapping wiki を調査する**

WebFetch で以下を読み、下の草稿の各原則が既存理論の言語化として妥当か確認する。用語や根拠がずれていたら草稿を直す。Web にアクセスできない環境なら草稿をそのまま採用してよい(草稿は既知の譜面理論に基づいて書かれている)。

- `https://osu.ppy.sh/wiki/en/Ranking_criteria/osu%21mania`
- `https://osu.ppy.sh/wiki/en/Beatmapping/Mapping_techniques`

このゲームに存在しない概念(ロングノーツ、スライダー、SV/変拍速、キー音)は取り込まない。

- [ ] **Step 2: theory.md を書く**

以下の草稿を `.claude/skills/chart-feel/theory.md` に書く(Step 1 の調査結果で修正済みのもの):

```markdown
# 譜面理論リファレンス

譜面の「気持ち良さ」を、既存の譜面理論(主に osu! mapping wiki)から
このゲーム(4レーン・1曲・bake-chart.py による自動生成)に適用できる形で蒸留したもの。
各原則は「定義 / このゲームでの意味 / 検査」の3行で書く。

## 1. 音付け (sound relevancy)

- **定義**: すべてのノーツは実際に鳴っている音に対応する。無音や弱い音の上のノーツは
  「叩かされている」感覚を生み、気持ち良さを壊す。
- **このゲームでは**: select_times がオンセット強度の降順で選ぶため大半は守られるが、
  区間の割当数(quota)が多すぎると弱い点まで拾ってしまう。
- **検査**: 可。bake 時に verify_audio がオンセット整合率(強度 ONSET_MIN 以上の
  ノーツ比率 ≥ ONSET_RATE_MIN)を検査する。

## 2. 密度カーブ (intensity mapping)

- **定義**: ノーツ密度は曲のエネルギーに追従する。サビは濃く、ブレイクは薄く。
  密度と曲の盛り上がりが食い違うと「曲を叩いている感」が失われる。
- **このゲームでは**: SECTIONS の倍率がカーブの意図。生成結果が意図からずれていないかが問題。
- **検査**: 可。verify がセクション別ノーツ数を SECTIONS の配分と照合する。

## 3. 休符設計 (rest moments)

- **定義**: 高密度の後には意図的な休みを置く。休符は緩急を作り、次の盛り上がりを
  引き立てる。詰めっぱなしの譜面は単調で疲れる。
- **このゲームでは**: ブレイク区間(小節56-63、倍率0.35)とアウトロ(小節86以降ノーツなし)が
  これに当たる。区間内の局所的な休符はまだ制御していない。
- **検査**: 部分的に可。密度カーブ検査がブレイクの薄さを担保する。局所休符は定性診断で見る。

## 4. 反復と変化 (repetition control)

- **定義**: 同じ音には同じパターン、違う音には違うパターン。ただし機械的な繰り返しが
  長く続くと退屈になる。一貫性と変化のバランスを取る。
- **このゲームでは**: assign_lanes が音の種類でレーンを固定(キック=↓、スネア=↑)しつつ
  3連続を避けている。フレーズ単位のパターン反復はまだ制御していない。
- **検査**: 未。レーン列の n-gram 反復検査を将来追加できる。当面は定性診断で見る。

## 5. 強拍優先 (beat hierarchy)

- **定義**: 低難易度ほど強拍(拍頭)にノーツを置く。裏拍や16分から先に置くと、
  初心者はリズムの取っ掛かりを失う。難易度が上がるにつれて弱拍が増えるのが自然。
- **このゲームでは**: easy は step=4(4分のみ)で構造的に拍頭だが、normal / hard は
  オンセット強度だけで選ぶので裏拍に偏りうる。
- **検査**: 可。verify が拍頭率(拍頭に乗るノーツの比率)の難易度順の単調性を検査する。

## 6. 難易度の一貫性 (difficulty spread)

- **定義**: 低難易度は高難易度の骨格であるべき。同じ箇所では同じ音を叩き、
  難易度間で「同じ曲を遊んでいる」感覚を保つ。
- **このゲームでは**: 全難易度が同じオンセット強度から選ぶため強い音は自然に共有されるが、
  保証はない。ノーツ数の単調増加は既存検査で担保済み。
- **検査**: 部分的に可。既存のノーツ数単調性検査 + 定性診断(easy のノーツが
  hard にも(ほぼ)存在するか)で見る。

## 使い方

- 検査化済みの原則(1, 2, 5)は bake-chart.py が自動で見張る
- 未検査の原則(3, 4, 6 の定性部分)は、譜面を変更したら charts.json を読んで
  この定義に照らして診断する
- 原則を育てたら(追加・修正)、検査化できるものは verify() / verify_audio() に落とす
```

- [ ] **Step 3: コミット**

```bash
git add .claude/skills/chart-feel/theory.md
git commit -m "feat: 譜面理論リファレンス theory.md を追加"
```

---

### Task 2: 密度カーブ検査を verify() に追加

**Files:**
- Modify: `scripts/bake-chart.py`(`verify()` 内、難易度ごとのループ)

**Interfaces:**
- Consumes: 既存の `SECTIONS` / `BAR0` / `BAR` 定数、`verify(data) -> list[str]`
- Produces: verify() が密度カーブ違反を「`{key}: 小節{b0}-{b1} の密度...`」形式で報告する。Task 6 の総合確認がこの検査のパスに依存する。

- [ ] **Step 1: 検査が発火することを確認する失敗テストを書く**

まだ実装していないので、このテストは「違反が報告されない」ことで失敗するはず:

```bash
uv run python - <<'EOF'
import importlib.util, json
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)

data = json.loads(open("src/charts.json").read())
# ラスサビ(小節63-79、倍率1.35)のノーツを全部消して密度カーブを壊す
t0, t1 = bc.BAR0 + 63 * bc.BAR, bc.BAR0 + 79 * bc.BAR
data["notes"]["hard"] = [(t, l) for t, l in data["notes"]["hard"] if not (t0 <= t < t1)]
bad = bc.verify(data)
assert any("密度" in b for b in bad), f"密度違反が検出されない: {bad}"
print("PASS: 密度カーブ検査が発火した")
EOF
```

- [ ] **Step 2: テストを実行して失敗を確認**

Expected: `AssertionError: 密度違反が検出されない: [...]`
(ノーツ数±15%検査には引っかかるかもしれないが、「密度」を含む違反は出ない)

- [ ] **Step 3: verify() に密度カーブ検査を実装**

`verify()` の難易度ごとのループ内(`for key, cfg in DIFFS.items():` の中、ノーツ走査ループの後)に追加:

```python
        # 理論検査「密度カーブ」: セクション別ノーツ数が SECTIONS の意図した
        # 配分から大きく外れていないこと。select_times の quota と同じ式で
        # 期待値を出し、±30% か 3個の大きい方まで許容する
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
```

- [ ] **Step 4: テストを実行してパスを確認**

Step 1 のコマンドを再実行。Expected: `PASS: 密度カーブ検査が発火した`

- [ ] **Step 5: 現行譜面が検査を通ることを確認**

```bash
uv run scripts/bake-chart.py --verify
```

Expected: 全難易度 OK。もし現行譜面が密度検査に落ちたら、それは実際の理論違反なので
**許容幅は広げず**、落ちたセクションと difficulty を記録して Task 6 の改善ループで直す
(select_times の quota 充足が fits() の棄却で崩れているのが典型原因)。
その場合このタスクは「検査が正しく落ちている」状態でコミットしてよい。

- [ ] **Step 6: コミット**

```bash
git add scripts/bake-chart.py
git commit -m "feat: 密度カーブ検査を verify に追加"
```

---

### Task 3: 強拍優先検査を verify() に追加

**Files:**
- Modify: `scripts/bake-chart.py`(`verify()` 末尾、難易度間ノーツ数検査の隣)

**Interfaces:**
- Consumes: 既存の `BEAT0` / `S16` / `CALL_TIMES` / `DIFFS` 定数
- Produces: verify() が「拍頭率が難易度順に下がっていない」違反を報告する

- [ ] **Step 1: 失敗テストを書く**

easy(全ノーツ拍頭)と hard(16分あり)を入れ替えれば拍頭率の単調性が壊れるはず:

```bash
uv run python - <<'EOF'
import importlib.util, json
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)

data = json.loads(open("src/charts.json").read())
data["notes"]["easy"], data["notes"]["hard"] = data["notes"]["hard"], data["notes"]["easy"]
bad = bc.verify(data)
assert any("拍頭率" in b for b in bad), f"拍頭率違反が検出されない: {bad}"
print("PASS: 強拍優先検査が発火した")
EOF
```

- [ ] **Step 2: テストを実行して失敗を確認**

Expected: `AssertionError: 拍頭率違反が検出されない: [...]`
(ノーツ数の単調性違反は出るが「拍頭率」を含む違反は出ない)

- [ ] **Step 3: verify() に強拍優先検査を実装**

`verify()` 末尾の難易度間検査(`if not (counts.get("easy", ...)` の直前か直後)に追加:

```python
    # 理論検査「強拍優先」: 拍頭に乗るノーツの比率が難易度順に単調非増加である
    # こと(低難易度ほど拍頭に置く)。固定ギミックはグリッド外なので除外する
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
```

(既存の `return bad` をこのブロックの末尾に移す)

- [ ] **Step 4: テストを実行してパスを確認**

Step 1 のコマンドを再実行。Expected: `PASS: 強拍優先検査が発火した`

- [ ] **Step 5: 現行譜面が検査を通ることを確認**

```bash
uv run scripts/bake-chart.py --verify
```

Expected: 全難易度 OK。落ちた場合の扱いは Task 2 Step 5 と同じ
(閾値は緩めず、Task 6 の改善ループで生成側を直す)。

- [ ] **Step 6: コミット**

```bash
git add scripts/bake-chart.py
git commit -m "feat: 強拍優先検査を verify に追加"
```

---

### Task 4: オンセット整合検査を bake 時に追加

**Files:**
- Modify: `scripts/bake-chart.py`(定数追加、`verify_audio()` 新設、`bake()` と `main()` の変更)

**Interfaces:**
- Consumes: 既存の `classify(f, t)` / `features()` / `CALL_TIMES`
- Produces: `verify_audio(data: dict, f) -> list[str]`(音源が要る検査。bake 時のみ実行)。`bake()` の戻り値が `(data, f)` のタプルに変わる。

- [ ] **Step 1: 定数と verify_audio() を実装**

`GAP_LANE` の近くに定数を追加:

```python
# オンセット整合検査の閾値。classify の強さがこれ未満のノーツは「音が無い所を
# 叩かせている」とみなす。ONSET_RATE_MIN は許容率(bake 実測に対して余裕を持たせた値)
ONSET_MIN = 0.10
ONSET_RATE_MIN = 0.90
```

`verify()` の直後に新設:

```python
def verify_audio(data: dict, f) -> list[str]:
    """音源解析が要る理論検査。bake 時のみ実行する(--verify では走らない)。"""
    bad: list[str] = []
    for key, ns in data["notes"].items():
        core = [t for t, _lane in ns if not any(abs(t - c) < 5e-4 for c in CALL_TIMES)]
        ok = sum(1 for t in core if classify(f, t)[1] >= ONSET_MIN)
        rate = ok / max(1, len(core))
        if rate < ONSET_RATE_MIN:
            bad.append(f"{key}: オンセット整合率 {rate:.3f} が {ONSET_RATE_MIN} を下回る")
    return bad
```

- [ ] **Step 2: bake() と main() を配線する**

`bake()` の末尾を変更(f を返す):

```python
    return {"bpm": BPM, "beat0": BEAT0, "songEnd": SONG_END, "notes": notes}, f
```

`main()` の分岐を変更:

```python
def main() -> int:
    f = None
    if "--verify" in sys.argv:
        if not OUT.exists():
            print(f"NG: {OUT} が無い", file=sys.stderr)
            return 1
        data = json.loads(OUT.read_text(encoding="utf-8"))
    else:
        data, f = bake()
        OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"wrote {OUT}")

    bad = verify(data)
    if f is not None:
        bad += verify_audio(data, f)
    for b in bad:
        print(f"NG: {b}", file=sys.stderr)
    if bad:
        return 1
```

(以降の OK 表示は既存のまま)

- [ ] **Step 3: 検査が発火することを確認する**

閾値を一時的に不可能な値に差し替えて、現行譜面で違反が出ることを確かめる
(features() の実行に数十秒かかる):

```bash
uv run python - <<'EOF'
import importlib.util, json
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)

f = bc.features()
data = json.loads(open("src/charts.json").read())
bc.ONSET_RATE_MIN = 1.01  # どんな譜面でも満たせない値
bad = bc.verify_audio(data, f)
assert any("オンセット整合率" in b for b in bad), f"発火しない: {bad}"
print("PASS: オンセット整合検査が発火した")

# 本来の閾値での実測値も出しておく(Step 4 の判断材料)
bc.ONSET_RATE_MIN = 0.90
print("実測:", bc.verify_audio(data, f) or "全難易度 0.90 以上")
EOF
```

Expected: `PASS: オンセット整合検査が発火した` と実測結果の表示。

- [ ] **Step 4: フル bake で検査を通す**

```bash
uv run scripts/bake-chart.py
```

Expected: `wrote src/charts.json` と全難易度 OK。bake は決定的なので charts.json は
変わらないはず(`git diff --stat src/charts.json` が空)。

Step 3 の実測で 0.90 を下回る難易度があった場合: それは quota が音の密度に対して
過剰という理論違反なので、**閾値は下げず**、違反として記録して Task 6 の改善ループで
生成側(SECTIONS の倍率か DIFFS の target)を直す。

- [ ] **Step 5: コミット**

```bash
git add scripts/bake-chart.py
git commit -m "feat: オンセット整合検査を bake 時に追加"
```

---

### Task 5: SKILL.md — 改善ループの手順書

**Files:**
- Create: `.claude/skills/chart-feel/SKILL.md`

**Interfaces:**
- Consumes: theory.md の原則名(Task 1)、bake-chart.py の検査(Task 2-4)

- [ ] **Step 1: SKILL.md を書く**

```markdown
---
name: chart-feel
description: 譜面(src/charts.json)を譜面理論に照らして診断・改善するとき、譜面が気持ち良くない・単調・音とずれている等の相談を受けたとき、bake-chart.py の生成パラメータを調整するときに使う
---

# chart-feel — 譜面の診断と改善

譜面の「気持ち良さ」を theory.md の原則に照らして診断し、bake-chart.py を
修正して改善するループを回す。合格基準は bake-chart.py の自動検査。
人間のプレイ確認は必須としない。

## 前提

- 譜面は生成物。`src/charts.json` を直接編集せず、必ず `scripts/bake-chart.py` を直す
- BPM / BEAT0 / BAR0 は実測定数。触らない
- 検査化済みの原則(音付け・密度カーブ・強拍優先)は bake が自動で見張る。
  未検査の原則(休符設計・反復と変化・難易度の一貫性)は自分で JSON を読んで診断する

## 手順

1. `uv run scripts/bake-chart.py --verify` で現状診断(JSON 検査のみ、数秒)
2. 違反ゼロでも charts.json を theory.md の未検査原則に照らして定性診断する。
   診断は「原則名 + 場所(小節) + 何が悪いか」の形で書き出す
3. 直すべき点を bake-chart.py の変更に翻訳する。主なつまみ:
   - 密度の意図: `SECTIONS` の倍率(区間の境界は曲構成なので原則動かさない)
   - 難易度ごとの物量: `DIFFS` の `target` / `step` / `gap_all`
   - レーンの癖: `assign_lanes` のルール
   - 音の拾い方: `classify` の重み
4. `uv run scripts/bake-chart.py` で再 bake(音源解析込み、数十秒)。
   検査に落ちたら 3 に戻る。**検査の閾値を緩めて通すのは禁止**
   (閾値を変えるのは theory.md の原則自体を見直したときだけ)
5. パスしたら変更前後の差分を報告する:
   - `git diff scripts/bake-chart.py` の要約(どのつまみを何のために動かしたか)
   - 難易度ごとのノーツ数とレーン分布の変化(bake の OK 行を前後で比較)
   - 診断で挙げた違反が解消したか

## 理論を育てる

改善中に新しい「気持ち良さのルール」を言語化できたら:

1. theory.md に原則として追記する(定義 / このゲームでの意味 / 検査、の3行)
2. 検査化できるなら bake-chart.py に落とす。JSON だけで判定できるなら `verify()`、
   音源解析が要るなら `verify_audio()` に追加する
```

- [ ] **Step 2: スキルが読み込める形式か確認**

```bash
head -5 .claude/skills/chart-feel/SKILL.md
```

Expected: `---` で始まる frontmatter に `name: chart-feel` と `description:` がある。

- [ ] **Step 3: コミット**

```bash
git add .claude/skills/chart-feel/SKILL.md
git commit -m "feat: 譜面改善スキル chart-feel の手順書を追加"
```

---

### Task 6: AGENTS.md 更新と総合確認

**Files:**
- Modify: `AGENTS.md`(規約セクション)

**Interfaces:**
- Consumes: Task 1-5 の全成果物

- [ ] **Step 1: AGENTS.md の規約を書き換える**

削除する行:

```markdown
- ゲームロジック（判定・スコア・描画）は挙動が繊細なので、リファクタ時は
  ブラウザで実際に遊んで確認する。型が通るだけでは不十分。
```

同じ場所に追加する行:

```markdown
- 譜面の診断・改善は chart-feel スキル（`.claude/skills/chart-feel/`）を使う。
  合格基準は `bake-chart.py` の自動検査。譜面 JSON を直接編集しない。
```

- [ ] **Step 2: 改善ループを一周して動作確認する**

SKILL.md の手順 1-2 を実際に実行する(スキルが機能する証明):

```bash
uv run scripts/bake-chart.py --verify
```

Expected: 全難易度 OK(Task 2-4 で違反が記録されている場合はここで手順 3-4 も回し、
生成側を直して全検査を通す。これが本スキルの初仕事になる)。

続けて charts.json を読み、theory.md の未検査原則(休符設計・反復と変化・難易度の
一貫性)で定性診断を1回行い、結果(違反なし、または今後の改善候補リスト)を
最終報告に含める。

- [ ] **Step 3: ビルド確認**

```bash
npm run build
```

Expected: 型エラーなしで完了(TS は触っていないので形式的な確認)。

- [ ] **Step 4: コミット**

```bash
git add AGENTS.md
git commit -m "docs: プレイ確認の規約を chart-feel スキル運用に置き換え"
```
