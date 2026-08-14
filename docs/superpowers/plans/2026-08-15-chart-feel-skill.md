# 譜面改善スキル「chart-feel」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 譜面理論の配置ルールを bake-chart.py の生成ロジック(select_times / assign_lanes)に流し込み、爽快で気持ち良い譜面を生成する。理論リファレンス・安全網検査・改善ループの手順書をスキルとして残す。

**Architecture:** スキル本体(SKILL.md + theory.md)を `.claude/skills/chart-feel/` に置く。理論の主な適用先は生成ロジック: `select_times` に連続性ボーナス(ストリーム形成)、`assign_lanes` に手の動き優先のスコアリング(交互・階段)を入れる。検査3つ(密度カーブ・強拍優先・オンセット整合)はデグレ防止の安全網として `verify()` / `verify_audio()` に追加し、検査合格後のみ charts.json を書き出す。プレイ確認が改善の最終判定。

**Tech Stack:** Python (uv + PEP 723 インラインメタデータ)、librosa(既存依存)、Claude Code プロジェクトスキル

**Spec:** `docs/superpowers/specs/2026-08-15-chart-feel-skill-design.md`

## Global Constraints

- Python の実行は必ず `uv run`。`pip` / `python3` の直叩き禁止(AGENTS.md)
- コメント・ドキュメントは日本語。周囲のコードの密度に合わせる
- `src/charts.json` は生成物。直接編集せず、生成ロジックの変更時は再 bake してコミットする
- bake-chart.py は決定的(乱数なし)。同じコードなら再 bake しても charts.json は変わらない
- BPM / BEAT0 / BAR0 / SECTIONS の区間境界は実測定数。変更しない
- 検査の閾値を緩めて通すのは禁止(閾値を変えるのは理論を見直したときだけ)
- 変更を出す前に `npm run build` を通す(最終タスクで実施)
- `features()` は mp3 解析で数十秒かかる。テストでは1回だけ呼んで使い回す

---

### Task 1: theory.md — 配置ルール中心の理論リファレンス

**Files:**
- Create: `.claude/skills/chart-feel/theory.md`

**Interfaces:**
- Produces: 原則8個(音付け / 密度カーブ / 連続性 / 交互と階段 / 縦連の抑制 / 反復の制御 / 強拍優先 / 休符設計)。Task 2-5 のコードコメントと SKILL.md(Task 6)がこの原則名を参照する。

- [ ] **Step 1: osu! mapping wiki を調査する**

WebFetch で以下を読み、下の草稿の各原則が既存理論の言語化として妥当か確認する。
特に「連続性」「交互と階段」「反復の制御」は生成ロジックの書き換え根拠になるので、
用語や根拠がずれていたら草稿を直す。Web にアクセスできない環境なら草稿をそのまま
採用してよい(草稿は既知の譜面理論に基づく)。

- `https://osu.ppy.sh/wiki/en/Ranking_criteria/osu%21mania`
- `https://osu.ppy.sh/wiki/en/Beatmapping/Mapping_techniques`

このゲームに存在しない概念(ロングノーツ、スライダー、SV、キー音)は取り込まない。

- [ ] **Step 2: theory.md を書く**

以下の草稿を `.claude/skills/chart-feel/theory.md` に書く(Step 1 の調査で修正済みのもの):

```markdown
# 譜面理論リファレンス

譜面の「気持ち良さ」を、既存の譜面理論(主に osu! mapping wiki)から
このゲーム(4レーン・1曲・bake-chart.py による自動生成)に適用できる形で蒸留したもの。
各原則は「定義 / このゲームでの意味 / 落とし込み先」で書く。
爽快感を左右する原則(3, 4, 6)は検査ではなく生成ロジックに落とす。

## 1. 音付け (sound relevancy)

- **定義**: すべてのノーツは実際に鳴っている音に対応する。無音や弱い音の上のノーツは
  「叩かされている」感覚を生み、気持ち良さを壊す。
- **このゲームでは**: select_times がオンセット強度で選ぶため大半は守られるが、
  quota が多すぎたり連続性ボーナスが強すぎたりすると弱い点まで拾う。
- **落とし込み**: 検査。bake 時に verify_audio がオンセット整合率(強度 ONSET_MIN
  以上のノーツ比率 ≥ ONSET_RATE_MIN)を見張る。ただし採点に使う classify() は
  ノーツ選定にも使うので、classify() の重みを変えた場合は自己参照になる。

## 2. 密度カーブ (intensity mapping)

- **定義**: ノーツ密度は曲のエネルギーに追従する。サビは濃く、ブレイクは薄く。
- **このゲームでは**: SECTIONS の倍率がカーブの意図。生成結果が意図からずれて
  いないかを見張る。
- **落とし込み**: 検査。verify がセクション別ノーツ数を SECTIONS の配分と照合する。
  照合先が SECTIONS 自身なので、検査が言えるのは「生成が意図どおり」まで。
  「意図が曲に合っている」かはプレイ確認で確かめる。

## 3. 連続性 (flow / streams)

- **定義**: 爽快感の核。盛り上がりでは音符が途切れず連続し、指が流れに乗る。
  強い音だけを点在させると、正確でも「流れ」が生まれない。
- **このゲームでは**: 旧 select_times は強い音の上位N個を取るだけで音符が点在した。
  連続性ボーナス(隣のグリッド点が選択済みなら加点)でストリームを作る。
- **落とし込み**: 生成。select_times の CONT_BONUS。強すぎると音付け(原則1)を
  壊すので、オンセット整合検査が上限を見張る。

## 4. 交互と階段 (alternation & stairs)

- **定義**: 近接するノーツは違うレーンに流す。隣のレーンへ順に流れる「階段」と
  2レーンを行き来する「交互」が、手の動きとして最も気持ち良い。
- **このゲームでは**: 旧 assign_lanes は音の種類でレーンを固定し、衝突時は
  「最も長く空いたレーン」へ逃げていた(手から見るとランダム)。
- **落とし込み**: 生成。assign_lanes のスコアリングで、速い流れ(16分〜8分)では
  隣レーンに加点、それ以外でも交互に加点。音の種類(キック=↓、スネア=↑)は
  加点どまりに格下げし、拍のアクセントとして残す。

## 5. 縦連の抑制 (jacks)

- **定義**: 同レーンの近接連打は指が止まり、流れを壊す。高難易度の意図的な
  ギミック以外では避ける。
- **このゲームでは**: GAP_LANE(同一レーンは8分あける)で既に担保済み。
- **落とし込み**: 生成(assign_lanes の絶対条件)+ 検査(verify の既存項目)。

## 6. 反復の制御 (repetition control)

- **定義**: 同じ音には同じパターンでよいが、同じ往復(トリル)が機械的に長く続くと
  退屈になる。適度に崩す。
- **このゲームでは**: 交互加点だけだと 2 レーンの往復が延々と続きうる。
- **落とし込み**: 生成。assign_lanes で同じ往復が続いたら減点し、別のレーンへ流す。

## 7. 強拍優先 (beat hierarchy)

- **定義**: 低難易度ほど強拍(拍頭)にノーツを置く。裏拍から置くと初心者はリズムの
  取っ掛かりを失う。
- **このゲームでは**: easy は step=4 で構造的に拍頭のみ。normal / hard は選定次第。
- **落とし込み**: 検査。verify が拍頭率の難易度順の単調性(easy ≥ normal ≥ hard)を
  見張る。easy は構造上ほぼ 100% なので、実質 normal と hard の歯止め。

## 8. 休符設計 (rest moments)

- **定義**: 高密度の後には意図的な休みを置く。休符が緩急を作り、次の盛り上がりを
  引き立てる。
- **このゲームでは**: ブレイク区間(小節56-63、倍率0.35)とアウトロ(小節86以降
  ノーツなし)が担う。区間内の局所的な休符はまだ制御していない。
- **落とし込み**: 定性診断(当面)。密度カーブ検査がブレイクの薄さだけ担保する。

## 自動検査で測れないこと

密度検査の期待値は SECTIONS 自身、オンセット検査の採点は選定に使う classify() と
同じ関数。つまり検査は自己参照であり、「壊れていないこと」しか保証しない。
生成の思想やつまみを変えたとき、良くなったかどうかの最終判定はプレイ確認。

## 使い方

- 検査化済みの原則(1, 2, 5, 7)は bake-chart.py が自動で見張る
- 生成に落とした原則(3, 4, 6)はつまみ(CONT_BONUS、assign_lanes のスコア重み)で調整する
- 未検査の原則(8)は charts.json を読んで定性診断する
- 原則を育てたら(追加・修正)、生成に落とせるものは生成へ、検査化できるものは
  verify() / verify_audio() へ
```

- [ ] **Step 3: コミット**

```bash
git add .claude/skills/chart-feel/theory.md
git commit -m "feat: 譜面理論リファレンス theory.md を追加"
```

---

### Task 2: 検査合格後のみ charts.json を書き出す

**Files:**
- Modify: `scripts/bake-chart.py`(`main()`)

**Interfaces:**
- Consumes: 既存の `bake()` / `verify()` / `OUT`
- Produces: 検査に落ちた bake は charts.json を変更しない。Task 3 の `verify_audio()` はまだ存在しないので配線しない(Task 3 で行う)。

- [ ] **Step 1: main() の書き込みを検査の後ろに移す**

現行の `main()` は bake 結果を書いてから検査するため、検査に落ちた bake が最後に
合格した譜面を壊す。次のように変更:

```python
def main() -> int:
    baked = False
    if "--verify" in sys.argv:
        if not OUT.exists():
            print(f"NG: {OUT} が無い", file=sys.stderr)
            return 1
        data = json.loads(OUT.read_text(encoding="utf-8"))
    else:
        data = bake()
        baked = True

    bad = verify(data)
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
```

(以降の OK 表示は既存のまま)

- [ ] **Step 2: 検査に落ちた bake が charts.json を壊さないことを確認**

ノーツ数の目標を一時的に壊して bake を失敗させ、JSON が無傷であることを確かめる:

```bash
cp src/charts.json /private/tmp/charts-before.json
uv run python - <<'EOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
bc.DIFFS["easy"]["target"] = 10  # ノーツ数±15%検査に必ず落ちる値
sys.argv = ["bake-chart.py"]
rc = bc.main()
assert rc == 1, f"落ちるはずが rc={rc}"
print("PASS: bake が検査で失敗した")
EOF
diff -q /private/tmp/charts-before.json src/charts.json && echo "PASS: charts.json は無傷"
```

Expected: `PASS: bake が検査で失敗した` と `PASS: charts.json は無傷` の両方。
`diff` が差分を報告したら Step 1 の修正が効いていない。

- [ ] **Step 3: 正常系の確認とコミット**

```bash
uv run scripts/bake-chart.py
git diff --stat src/charts.json
```

Expected: `wrote src/charts.json` と全難易度 OK。生成ロジックは変えていないので
`git diff --stat` は空。

```bash
git add scripts/bake-chart.py
git commit -m "fix: 検査に合格した場合だけ charts.json を書き出す"
```

---

### Task 3: 安全網検査3つを追加

**Files:**
- Modify: `scripts/bake-chart.py`(定数、`verify()`、`verify_audio()` 新設、`bake()` と `main()` の配線)

**Interfaces:**
- Consumes: 既存の `SECTIONS` / `BAR0` / `BAR` / `BEAT0` / `S16` / `CALL_TIMES` / `classify(f, t)`、Task 2 の `main()` 構造
- Produces: `verify()` が密度カーブ・強拍優先の違反を報告。`verify_audio(data: dict, f) -> list[str]` が bake 時のみオンセット整合を検査。`bake()` の戻り値が `(data, f)` に変わる。Task 4-5 の生成変更はこの3検査を通過する義務を負う。

- [ ] **Step 1: 検査が発火することを確認する失敗テストを書く**

まだ実装していないので、3つとも「違反が報告されない」ことで失敗するはず:

```bash
uv run python - <<'EOF'
import importlib.util, json
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
data = json.loads(open("src/charts.json").read())

# 1) 密度カーブ: ラスサビ(小節63-79)のノーツを全部消す
d1 = json.loads(json.dumps(data))
t0, t1 = bc.BAR0 + 63 * bc.BAR, bc.BAR0 + 79 * bc.BAR
d1["notes"]["hard"] = [(t, l) for t, l in d1["notes"]["hard"] if not (t0 <= t < t1)]
assert any("密度" in b for b in bc.verify(d1)), "密度違反が検出されない"

# 2) 強拍優先: easy と hard を入れ替えて拍頭率の単調性を壊す
d2 = json.loads(json.dumps(data))
d2["notes"]["easy"], d2["notes"]["hard"] = d2["notes"]["hard"], d2["notes"]["easy"]
assert any("拍頭率" in b for b in bc.verify(d2)), "拍頭率違反が検出されない"

print("PASS: 密度カーブ・強拍優先の検査が発火した")
EOF
```

- [ ] **Step 2: テストを実行して失敗を確認**

Expected: `AssertionError: 密度違反が検出されない`
(ノーツ数±15%検査には引っかかるかもしれないが「密度」を含む違反は出ない)

- [ ] **Step 3: verify() に密度カーブ検査と強拍優先検査を実装**

`verify()` の難易度ごとのループ内(ノーツ走査ループの後)に密度カーブ検査を追加:

```python
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
```

`verify()` 末尾の難易度間検査(ノーツ数の単調性の隣)に強拍優先検査を追加し、
既存の `return bad` をこのブロックの後ろに移す:

```python
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
```

- [ ] **Step 4: verify_audio() を実装して bake に配線**

`GAP_LANE` の近くに定数を追加:

```python
# オンセット整合検査の閾値。classify の強さがこれ未満のノーツは「音が無い所を
# 叩かせている」とみなす。採点に使う classify はノーツ選定と同じ関数なので、
# この検査は自己参照(theory.md 原則1)。CONT_BONUS の暴走を止める安全網
ONSET_MIN = 0.10
ONSET_RATE_MIN = 0.90
```

`verify()` の直後に新設:

```python
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
```

`bake()` の末尾を `return {...}, f` に変え、`main()` を配線(Task 2 の構造の上に):

```python
    f = None
    if "--verify" in sys.argv:
        ...(Task 2 のまま)...
    else:
        data, f = bake()
        baked = True

    bad = verify(data)
    if f is not None:
        bad += verify_audio(data, f)
```

- [ ] **Step 5: 発火テストと現行譜面のパスを確認**

Step 1 のテストを再実行。Expected: `PASS: 密度カーブ・強拍優先の検査が発火した`

オンセット検査の発火と実測値も確認(features() に数十秒かかる):

```bash
uv run python - <<'EOF'
import importlib.util, json
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
f = bc.features()
data = json.loads(open("src/charts.json").read())
bc.ONSET_RATE_MIN = 1.01  # どんな譜面でも満たせない値
assert any("オンセット整合率" in b for b in bc.verify_audio(data, f)), "発火しない"
print("PASS: オンセット整合検査が発火した")
bc.ONSET_RATE_MIN = 0.90
print("実測:", bc.verify_audio(data, f) or "全難易度 0.90 以上")
EOF
```

最後に現行譜面で全検査を通す:

```bash
uv run scripts/bake-chart.py --verify && uv run scripts/bake-chart.py
```

Expected: 両方とも全難易度 OK、`git diff --stat src/charts.json` は空。
現行譜面が新検査に落ちた場合: 閾値は緩めず、落ちた検査と値を記録して先に進む
(Task 4-5 の生成変更で解消を図り、Task 7 の改善ループで最終的に全部通す)。
その場合、落ちている間は bake が charts.json を更新しないので、Task 4-5 の
検証は `select_times` / `assign_lanes` を直接呼ぶテストで行う。

- [ ] **Step 6: コミット**

```bash
git add scripts/bake-chart.py
git commit -m "feat: 安全網検査(密度カーブ・強拍優先・オンセット整合)を追加"
```

---

### Task 4: select_times に連続性を入れる(ストリーム形成)

**Files:**
- Modify: `scripts/bake-chart.py`(`CONT_BONUS` 定数追加、`select_times()` 書き換え)

**Interfaces:**
- Consumes: 既存の `classify(f, t)` / `bar_to_idx()` / `SECTIONS` / `CALL_TIMES` / `DIFFS`
- Produces: `select_times(f, cfg) -> list[float]`(シグネチャ不変)。モジュール定数 `CONT_BONUS`(SKILL.md がつまみとして参照)。

- [ ] **Step 1: 連続性の失敗テストを書く**

「CONT_BONUS を効かせると、ラスサビ(小節63-79)の hard で隣接グリッド率が上がる」
ことを確かめる比較テスト。実装前は select_times が CONT_BONUS を参照しないため、
値を変えても結果が同じになり assert で失敗する:

```bash
uv run python - <<'EOF'
import importlib.util
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
f = bc.features()

def continuity(times):
    """ラスサビ内で、次のノーツが16分1個ぶん隣にいる割合(ストリーム度)。"""
    t0, t1 = bc.BAR0 + 63 * bc.BAR, bc.BAR0 + 79 * bc.BAR
    ts = [t for t in times if t0 <= t < t1]
    if len(ts) < 2:
        return 0.0
    close = sum(1 for a, b in zip(ts, ts[1:]) if b - a < bc.S16 * 1.5)
    return close / (len(ts) - 1)

bc.CONT_BONUS = 0.0
base = continuity(bc.select_times(f, bc.DIFFS["hard"]))
bc.CONT_BONUS = 0.35
cont = continuity(bc.select_times(f, bc.DIFFS["hard"]))
print(f"ボーナスなし: {base:.3f}  あり: {cont:.3f}")
assert cont > base, "連続性ボーナスが効いていない"
print("PASS: ストリーム形成が確認できた")
EOF
```

- [ ] **Step 2: テストを実行して失敗を確認**

Expected: 実装前は `CONT_BONUS` を書き換えても `select_times` が参照しないため
`ボーナスなし` と `あり` が同値になり、`AssertionError: 連続性ボーナスが効いていない`。

- [ ] **Step 3: select_times を書き換える**

`GAP_LANE` の近くに定数を追加:

```python
# 連続性ボーナス。隣のグリッド点(その難易度のステップ幅で1つ隣)が選択済みなら
# 強度に加点し、点在よりも連続した流れ(ストリーム)を作る(theory.md 原則3)。
# 上げすぎると弱い音まで拾って音付け(原則1)を壊す。オンセット整合検査が上限の見張り
CONT_BONUS = 0.35
```

`select_times()` を書き換え(quota 配分・fits・グリッドの走査は既存のまま、
選択を「強度降順の一括ソート」から「連続性加点つきの逐次貪欲」に変える):

```python
def select_times(f, cfg):
    """区間ごとの割当数に従い、強い16分グリッド点を連続性の加点つきで選ぶ。"""
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
```

- [ ] **Step 4: テストを実行してパスを確認**

Step 1 のコマンドを再実行。Expected: `あり` が `なし` を上回り
`PASS: ストリーム形成が確認できた`。

- [ ] **Step 5: 再 bake して安全網検査を通す**

```bash
uv run scripts/bake-chart.py
```

Expected: 全難易度 OK。オンセット整合検査(音付け)に落ちた場合は CONT_BONUS を
下げて再試行する(0.35 → 0.25 → 0.15 の順。0.15 でも落ちるなら値を記録して
Task 7 の改善ループへ持ち越す)。密度カーブ検査に落ちた場合は逐次貪欲の
quota 充足が崩れているので、fits の棄却が偏っていないか dropped の中身を調べる。

- [ ] **Step 6: 再生成した譜面ごとコミット**

```bash
git add scripts/bake-chart.py src/charts.json
git commit -m "feat: select_times に連続性ボーナスを入れてストリームを形成"
```

---

### Task 5: assign_lanes を手の動き優先に書き換える

**Files:**
- Modify: `scripts/bake-chart.py`(`assign_lanes()` 書き換え)

**Interfaces:**
- Consumes: 既存の `classify(f, t)` / `GAP_LANE` / `CALL_TIMES` / `CALL_LANES` / `S16`、Task 4 で確定した `select_times` の出力
- Produces: `assign_lanes(f, times) -> list[tuple[float, int]]`(シグネチャ不変)。スコア重みは関数内リテラル(SKILL.md がつまみとして参照)。

- [ ] **Step 1: 現状の「流れ」を実測する**

書き換え前の隣接レーン率(近接ペアのうち隣のレーンに流れている割合)を測って記録する:

```bash
uv run python - <<'EOF'
import importlib.util, json
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
data = json.loads(open("src/charts.json").read())
for key in ("normal", "hard"):
    ns = data["notes"][key]
    pairs = [(a, b) for a, b in zip(ns, ns[1:]) if b[0] - a[0] < 2 * bc.S16 + 1e-6]
    adj = sum(1 for a, b in pairs if abs(a[1] - b[1]) == 1)
    print(f"{key}: 近接ペア {len(pairs)} 件中 隣接レーン率 {adj / max(1, len(pairs)):.3f}")
EOF
```

出力された normal / hard の隣接レーン率を Step 4 のテストの `BEFORE` に書き写す。

- [ ] **Step 2: assign_lanes を書き換える**

「音の種類でレーンを固定 + 衝突時は最長空きレーンへ退避」から、
「候補レーンをスコアリングして最良を選ぶ」方式へ:

```python
def assign_lanes(f, times):
    """時間順にレーンを割り当てる。手の動き(交互・階段)を最優先し、音の種類は加点で反映する。"""
    out = []
    last_lane_t = [-9.0, -9.0, -9.0, -9.0]
    prev_lane = -1
    prev_prev = -1
    trill = 0      # 同じ2レーンの往復(A-B-A...)が何個続いたか
    prev_t = -9.0

    for t in times:
        forced = next((lane for c, lane in zip(CALL_TIMES, CALL_LANES) if abs(c - t) < 1e-6), None)
        if forced is not None:
            lane = forced
        else:
            kind, _ = classify(f, t)
            fav = {"kick": LANE_D, "snare": LANE_U}.get(kind)
            gap = t - prev_t
            best_lane, best_score = None, None
            for cand in range(4):
                # 同一レーンの最小間隔は絶対条件
                if t - last_lane_t[cand] < GAP_LANE - 1e-6:
                    continue
                score = 0.0
                if cand == prev_lane:
                    score -= 3.0   # 縦連は強く避ける(theory.md 原則5)
                if prev_lane >= 0 and gap < 2 * S16 + 1e-6:
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
```

関数先頭の `import numpy as np` は不要になるので削除する。

- [ ] **Step 3: 再 bake して安全網検査を通す**

```bash
uv run scripts/bake-chart.py
```

Expected: 全難易度 OK。レーンは verify のレーン範囲・同一レーン間隔・固定ギミック
検査の対象なので、ここが通れば構造は壊れていない。

- [ ] **Step 4: 流れが改善したことを確認する**

`BEFORE` に Step 1 で記録した実測値を入れて実行:

```bash
uv run python - <<'EOF'
import importlib.util, json
spec = importlib.util.spec_from_file_location("bc", "scripts/bake-chart.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
BEFORE = {"normal": 0.0, "hard": 0.0}  # ← Step 1 の実測値に書き換える
data = json.loads(open("src/charts.json").read())
for key in ("normal", "hard"):
    ns = data["notes"][key]
    pairs = [(a, b) for a, b in zip(ns, ns[1:]) if b[0] - a[0] < 2 * bc.S16 + 1e-6]
    adj = sum(1 for a, b in pairs if abs(a[1] - b[1]) == 1)
    rate = adj / max(1, len(pairs))
    print(f"{key}: 隣接レーン率 {rate:.3f} (書き換え前 {BEFORE[key]:.3f})")
    assert rate > BEFORE[key], f"{key} の流れが改善していない"
print("PASS: 隣接レーン率が改善した")
EOF
```

Expected: 両難易度で改善。改善しない場合は階段の加点(1.5)と音種の加点(0.8)の
バランスを疑う(音種加点が勝ちすぎるとキック連打が全部↓に吸われて流れが死ぬ)。

- [ ] **Step 5: 再生成した譜面ごとコミット**

```bash
git add scripts/bake-chart.py src/charts.json
git commit -m "feat: assign_lanes を手の動き優先(交互・階段)に書き換え"
```

---

### Task 6: SKILL.md — 改善ループの手順書

**Files:**
- Create: `.claude/skills/chart-feel/SKILL.md`

**Interfaces:**
- Consumes: theory.md の原則名(Task 1)、生成のつまみ(Task 4-5)、安全網検査(Task 3)

- [ ] **Step 1: SKILL.md を書く**

```markdown
---
name: chart-feel
description: 譜面(src/charts.json)を譜面理論に照らして診断・改善するとき、譜面が気持ち良くない・単調・音とずれている等の相談を受けたとき、bake-chart.py の生成パラメータを調整するときに使う
---

# chart-feel — 譜面の診断と改善

譜面の「気持ち良さ」を theory.md の原則に照らして診断し、bake-chart.py を
修正して改善するループを回す。安全網は bake-chart.py の自動検査、
**改善の最終判定はプレイ確認**。

## 前提

- 譜面は生成物。`src/charts.json` を直接編集せず、必ず `scripts/bake-chart.py` を直す
- BPM / BEAT0 / BAR0 / SECTIONS の区間境界は実測定数。触らない
- 自動検査は自己参照(theory.md「自動検査で測れないこと」)。検査が保証するのは
  「壊れていないこと」だけで、良くなったかどうかは測れない

## 手順

1. `uv run scripts/bake-chart.py --verify` で現状診断(JSON 検査のみ、数秒)
2. charts.json を theory.md の原則に照らして定性診断する。診断は
   「原則名 + 場所(小節) + 何が悪いか」の形で書き出す
3. 直すべき点を bake-chart.py のつまみに翻訳する:
   - 流れが点在して単調 → `CONT_BONUS`(連続性。上げるとストリームが育つ)
   - レーンの動きが気持ち悪い → `assign_lanes` のスコア重み
     (階段 1.5 / 交互 0.5 / 縦連 -3.0 / トリル抑制 -1.0 / 音種 0.8)
   - 密度の意図 → `SECTIONS` の倍率(区間境界は曲構成なので動かさない)
   - 難易度ごとの物量 → `DIFFS` の `target` / `step` / `gap_all`
   - 音の拾い方 → `classify` の重み(変えるとオンセット検査が自己参照になる点に注意)
4. `uv run scripts/bake-chart.py` で再 bake(音源解析込み、数十秒)。
   検査に落ちたら 3 に戻る。**検査の閾値を緩めて通すのは禁止**
   (閾値を変えるのは theory.md の原則自体を見直したときだけ)
5. パスしたら変更前後の差分を報告する:
   - どのつまみを何のために動かしたか
   - 難易度ごとのノーツ数とレーン分布の変化(bake の OK 行を前後で比較)
   - 診断で挙げた違反が解消したか
6. **プレイ確認(必須)**: `npm run dev` を案内し、変えた区間を名指しして
   確認点を具体的に伝える(例:「小節63-79 のラスサビで16分の流れが
   気持ち良いか、詰まりすぎていないか」)。開くのは
   `http://localhost:5173/hosomiamedance/`(`/` だけだと 404)。
   ユーザーの体感が改善の最終判定。悪くなったと言われたら 3 に戻る

## 理論を育てる

改善中に新しい「気持ち良さのルール」を言語化できたら:

1. theory.md に原則として追記する(定義 / このゲームでの意味 / 落とし込み先)
2. 生成に落とせるなら select_times / assign_lanes へ、検査化できるなら
   verify()(JSON だけで判定可)/ verify_audio()(音源解析が必要)へ
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

### Task 7: AGENTS.md 更新と総合確認

**Files:**
- Modify: `AGENTS.md`(規約セクション)

**Interfaces:**
- Consumes: Task 1-6 の全成果物

- [ ] **Step 1: AGENTS.md の規約に追記する**

既存の行(**判定・スコア・描画のプレイ確認は残す**。bake-chart.py の検査では
判定タイミングも Canvas 描画も観測できないため):

```markdown
- ゲームロジック（判定・スコア・描画）は挙動が繊細なので、リファクタ時は
  ブラウザで実際に遊んで確認する。型が通るだけでは不十分。
```

その直後に追加する行:

```markdown
- 譜面の診断・改善は chart-feel スキル（`.claude/skills/chart-feel/`）を使う。
  安全網は `bake-chart.py` の自動検査（生成の意図どおりかしか見ていない）、
  改善の最終判定はプレイ確認。譜面 JSON を直接編集しない。
```

- [ ] **Step 2: 改善ループを一周して動作確認する**

SKILL.md の手順 1-2 を実際に実行する(スキルが機能する証明):

```bash
uv run scripts/bake-chart.py --verify
```

Expected: 全難易度 OK(Task 3-5 で持ち越した違反がある場合はここで手順 3-4 も回し、
生成側を直して全検査を通す)。

続けて charts.json を読み、theory.md の原則(特に未検査の休符設計と、生成に
落とした連続性・交互と階段)で定性診断を1回行い、結果(違反なし、または今後の
改善候補リスト)を最終報告に含める。

- [ ] **Step 3: ビルド確認**

```bash
npm run build
```

Expected: 型エラーなしで完了(TS は触っていないので形式的な確認)。

- [ ] **Step 4: プレイ確認を依頼する**

生成ロジックを書き換えたので SKILL.md 手順 6 のプレイ確認は必須。dev サーバーを
起動して `http://localhost:5173/hosomiamedance/` を開き、ユーザーに確認点を伝える:

- hard のラスサビ(小節63-79、約 97〜122 秒)で 16 分の流れ(ストリーム)が
  気持ち良いか、詰まりすぎていないか
- normal / hard でレーンの動きが交互・階段に流れるか、ランダムに飛ぶ感じが
  消えたか
- easy が単調すぎないか(構造上 4 分のみなので大きくは変わらないはず)

体感が悪化していたらコミットは保留し、SKILL.md 手順 3 に戻ってつまみを調整する。

- [ ] **Step 5: コミット**

```bash
git add AGENTS.md
git commit -m "docs: chart-feel スキルの運用を規約に追記"
```
