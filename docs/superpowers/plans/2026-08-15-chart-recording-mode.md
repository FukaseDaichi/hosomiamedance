# 譜面録音モード(dev限定) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dev サーバー限定の譜面録音モードを作る。実画面で十字キーを叩いて録音 → `recordings/` に自動保存 → Claude が chart-feel スキルの手順で量子化・3難易度展開して charts.json に書く。

**Architecture:** 録音UIは React.lazy + `import.meta.env.DEV` ガードの別コンポーネント(本番バンドルからチャンクごと消える)。保存は vite.config.ts のインラインプラグイン(`POST /__rec`)。bake-chart.py は `source` フィールドで録音由来の譜面を保護する。

**Tech Stack:** Vite 6 / React 18(クラスコンポーネント)/ TypeScript strict / Python(uv, PEP 723)

**Spec:** `docs/superpowers/specs/2026-08-15-chart-recording-mode-design.md`

## Global Constraints

- base パスは `/hosomiamedance/`。dev は `http://localhost:5173/hosomiamedance/` を開く(`/` は 404)
- `public/` のアセット URL には `import.meta.env.BASE_URL` を前置(ただし `/__rec` は dev サーバー直付けの API なので前置**しない**)
- `<StrictMode>` は追加しない
- Python は `uv run` のみ。`pip` / `python3` 直叩き禁止
- コメントは日本語、周囲の密度に合わせる
- テストフレームワークは無い。検証は `npm run build`(tsc + ビルド)、curl、`uv run scripts/bake-chart.py --verify`、実プレイ
- tsconfig は strict + noUnusedLocals/noUnusedParameters。`vite.config.ts` も型検査対象
- コミットメッセージは既存の流儀(日本語、`feat:`/`fix:`/`docs:` プレフィックス)

---

### Task 1: bake-chart.py — bar0/source の書き出しと recorded 譜面の保護

**Files:**
- Modify: `scripts/bake-chart.py`(bake() 384行付近、verify() 387行、main() 506行)
- Modify: `src/charts.json`(再bakeで再生成される)

**Interfaces:**
- Produces: charts.json の曲メタに `bar0: number` と `source: "baked" | "recorded"` が入る(Task 3 の songs.ts と Task 5 の chart-feel 手順が依存)
- Produces: `verify_recorded(song, data) -> list[str]`(recorded 譜面の健全性検査)

- [ ] **Step 1: bake() の返り値に bar0 と source を足す**

`scripts/bake-chart.py:384` を書き換え:

```python
    return {
        "bpm": song.bpm,
        "beat0": song.beat0,
        "bar0": song.bar0,
        "source": "baked",
        "songEnd": song.song_end,
        "notes": notes,
    }, f
```

- [ ] **Step 2: verify_recorded() を追加し、verify() の先頭でディスパッチする**

`verify()` の直前(387行の前)に追加:

```python
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
```

`verify()` の先頭(`bad: list[str] = []` の前)にディスパッチを足す:

```python
def verify(song: Song, data: dict) -> list[str]:
    """譜面の不変条件を検査し、破れた項目を文字列で返す。空なら合格。"""
    # source の綴りミスは保護(全曲生成のスキップ判定)をすり抜けるので、ここで落とす
    source = data.get("source", "baked")
    if source not in ("baked", "recorded"):
        return [f"{song.id}: source が不正: {source!r}"]
    if source == "recorded":
        return verify_recorded(song, data)
    bad: list[str] = []
    ...(以下既存のまま)
```

- [ ] **Step 3: main() で recorded 曲を保護する**

`main()` の `wanted = args or list(SONGS)`(514行)と existing の読み込み(516-518行)を入れ替え、スキップ/上書き通知を足す。514-518行を次に置き換え:

```python
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
```

- [ ] **Step 4: 全曲を bake し直して bar0/source を反映する**

```bash
npm run bake-chart
```

Expected: 2曲×3難易度の `OK` 行が出て `wrote src/charts.json`。

- [ ] **Step 5: 検査と中身を確認する**

```bash
uv run scripts/bake-chart.py --verify
uv run python -c "import json; d=json.load(open('src/charts.json')); print({k: (v['bar0'], v['source']) for k,v in d['songs'].items()})"
```

Expected: verify が OK、`amedance` が `(0.6138, 'baked')`、`amagoi` が `(1.236, 'baked')`。

- [ ] **Step 6: verify_recorded の動作確認(使い捨てスクリプト)**

```bash
uv run python - <<'EOF'
import json, sys
sys.path.insert(0, "scripts")
exec(open("scripts/bake-chart.py").read().split('if __name__')[0])
song = SONGS["amagoi"]
data = json.load(open("src/charts.json"))["songs"]["amagoi"]
data["source"] = "recorded"
print("recorded扱いの検査:", verify(song, data) or "OK")
# 壊してみる: 昇順違反
data["notes"]["easy"][0], data["notes"]["easy"][1] = data["notes"]["easy"][1], data["notes"]["easy"][0]
assert verify(song, data), "昇順違反を見逃した"
print("昇順違反を検出: OK")
EOF
```

Expected: 両方 OK(baked 譜面は recorded の健全性条件も満たすはず。もし同レーン8分違反等が出たらそれは既存譜面の実態なので、verify_recorded の閾値ではなく検出内容を確認して判断する)。

- [ ] **Step 7: ビルドが通ることを確認してコミット**

```bash
npm run build
git add scripts/bake-chart.py src/charts.json
git commit -m "feat: charts.json に bar0 と譜面の出自(source)を書き出す

録音由来(recorded)の譜面は全曲 bake で上書きせず、検査も
健全性チェックのみに切り替える。譜面録音モードの土台。"
```

---

### Task 2: Vite dev プラグイン `/__rec` と recordings/

**Files:**
- Modify: `vite.config.ts`
- Create: `recordings/.gitkeep`
- Modify: `package.json` / `package-lock.json`(`@types/node` 追加)

**Interfaces:**
- Produces: dev サーバーの `POST /__rec`。ボディは録音JSON(`song` フィールド必須)。成功時 `{"file": "recordings/<曲ID>-<YYYYMMDD-HHmmss>.json"}` を返す(Task 3 の `saveRecording()` が依存)

- [ ] **Step 1: @types/node を入れる**

vite.config.ts で `node:fs` / `node:path` を import するため(tsconfig が vite.config.ts を型検査する):

```bash
npm i -D @types/node
```

- [ ] **Step 2: vite.config.ts にプラグインを書く**

全体を次に置き換え:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 譜面録音モード(dev限定)の保存口。POST /__rec の JSON を recordings/ に書く。
// configureServer は dev サーバー限定のフックなので、本番ビルドには一切入らない。
function chartRecorder(): Plugin {
  return {
    name: 'chart-recorder',
    configureServer(server) {
      server.middlewares.use('/__rec', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        const chunks: Uint8Array[] = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          try {
            const rec = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { song?: unknown }
            const song = String(rec.song ?? '')
            // ファイル名はサーバー側で決める(クライアントに任せるとパストラバーサルの余地が出る)
            if (!/^[a-z0-9]+$/.test(song)) throw new Error(`bad song id: ${song}`)
            const d = new Date()
            const p2 = (n: number) => String(n).padStart(2, '0')
            const stamp =
              `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
              `-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
            const dir = path.resolve('recordings')
            fs.mkdirSync(dir, { recursive: true })
            // 同秒の保存が重なっても上書きしない
            let file = `${song}-${stamp}.json`
            for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${song}-${stamp}-${i}.json`
            fs.writeFileSync(path.join(dir, file), JSON.stringify(rec, null, 1) + '\n')
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ file: `recordings/${file}` }))
          } catch (err) {
            res.statusCode = 400
            res.end(String(err))
          }
        })
      })
    },
  }
}

// GitHub Pages のプロジェクトページ配信のため、リポジトリ名をベースパスに置く。
// https://fukasedaichi.github.io/hosomiamedance/
export default defineConfig({
  base: '/hosomiamedance/',
  plugins: [react(), chartRecorder()],
  build: {
    // three が大きいため既定の 500kB 警告は現実的でない
    chunkSizeWarningLimit: 1000,
  },
})
```

- [ ] **Step 3: recordings/ を作る**

```bash
mkdir -p recordings && touch recordings/.gitkeep
```

- [ ] **Step 4: dev サーバーを立てて curl で確認する**

dev サーバーをバックグラウンドで起動(Bash の run_in_background、またはユーザーが既に立てているならそれを使う):

```bash
npm run dev
```

別コマンドで:

```bash
curl -s -X POST http://localhost:5173/__rec -H 'content-type: application/json' \
  -d '{"song":"amagoi","recordedAt":"t","bpm":127.384,"beat0":0.294,"aborted":false,"endT":10,"taps":[[1.0,0]]}'
ls recordings/
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5173/__rec -d '{"song":"../evil"}'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/__rec
```

Expected: 1本目が `{"file":"recordings/amagoi-....json"}` を返しファイルができる。2本目 400、3本目(GET)405。

- [ ] **Step 5: 確認で作ったゴミ録音を消し、ビルドを確認してコミット**

```bash
rm recordings/amagoi-*.json
npm run build
git add vite.config.ts recordings/.gitkeep package.json package-lock.json
git commit -m "feat: dev サーバーに録音の保存口 POST /__rec を生やす"
```

---

### Task 3: songs.ts の拍情報公開・recording.ts・laneDraw.ts

**Files:**
- Modify: `src/songs.ts`(Song に beat0/bar0)
- Create: `src/recording.ts`(録音の型と保存)
- Create: `src/laneDraw.ts`(drawArrow を App.tsx から移設)
- Modify: `src/App.tsx`(drawArrow の import 差し替えのみ)

**Interfaces:**
- Consumes: charts.json の `bar0`(Task 1)、`POST /__rec`(Task 2)
- Produces: `Song.beat0: number` / `Song.bar0: number`
- Produces: `interface Recording { song: string; recordedAt: string; bpm: number; beat0: number; aborted: boolean; endT: number; taps: [number, number][] }`
- Produces: `saveRecording(rec: Recording): Promise<string>`(保存先の相対パスを返す)
- Produces: `drawArrow(g, x, y, r, ang, color, alpha, filled)`(App.tsx:91 と同一シグネチャ)

- [ ] **Step 1: songs.ts に beat0/bar0 を足す**

`Song` インターフェイスの `bpm: number` の下に追加:

```ts
  /** 1拍目の時刻(秒)。録音モードの拍線描画に使う */
  beat0: number
  /** 1小節目の頭(秒) */
  bar0: number
```

`SONGS` の map に追加:

```ts
  beat0: chartData.songs[m.id].beat0,
  bar0: chartData.songs[m.id].bar0,
```

- [ ] **Step 2: src/recording.ts を作る**

```ts
// 譜面録音モード(dev限定)のデータ形式と保存。
// 保存先は vite.config.ts の chartRecorder プラグイン(POST /__rec)。

export interface Recording {
  song: string
  recordedAt: string
  /** 再現・検証用に charts.json から転記 */
  bpm: number
  beat0: number
  /** Esc で途中終了したら true */
  aborted: boolean
  /** 録音が有効な範囲の終わり(秒)。中断時は中断時刻 */
  endT: number
  /** [耳の時計での秒, レーン 0..3] 昇順 */
  taps: [number, number][]
}

/** dev サーバーに録音を保存し、書かれたファイルの相対パスを返す。 */
export async function saveRecording(rec: Recording): Promise<string> {
  // dev サーバー直付けの API なので BASE_URL は前置しない。
  // 保存に失敗しても録音画面に閉じ込めないよう、待つのは5秒まで
  const res = await fetch('/__rec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rec),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`録音の保存に失敗しました (status ${res.status})`)
  const body = (await res.json()) as { file?: unknown }
  if (typeof body.file !== 'string') throw new Error('保存先の応答が不正です')
  return body.file
}
```

- [ ] **Step 3: src/laneDraw.ts を作り、App.tsx の drawArrow を移設する**

`src/laneDraw.ts` を新規作成。App.tsx:90-137 の `drawArrow` 関数(コメント含む)をそのまま移して `export function drawArrow(...)` にする。ファイル頭のコメント:

```ts
// レーン描画の共有部品。通常プレイ(App)と録音モード(RecordMode)の両方が使う。
```

App.tsx からは 90-137 行の関数定義を削除し、import に `import { drawArrow } from './laneDraw'` を足す。

- [ ] **Step 4: ビルド確認してコミット**

```bash
npm run build
git add src/songs.ts src/recording.ts src/laneDraw.ts src/App.tsx
git commit -m "feat: 録音モードの土台(拍情報の公開・録音の型と保存・矢印描画の共有化)"
```

---

### Task 4: RecordMode.tsx と App.tsx への組み込み

**Files:**
- Create: `src/RecordMode.tsx`
- Modify: `src/App.tsx`(phase 追加、入口カード、lazy import)
- Modify: `src/styles.css`(`.song-list` — 4枚目のカードで溢れないよう折り返し可能に)

**Interfaces:**
- Consumes: `Song`(beat0/bar0 込み)、`RainStage`、`HAudio.time()/startSong()/stop()/sfx()`、`saveRecording()`、`drawArrow()`
- Produces: `<RecordMode song stage noteSpeed onExit />`(default export。onExit は選択画面に出す通知文字列を受け取る)

- [ ] **Step 1: src/RecordMode.tsx を書く**

```tsx
import { Component, createRef } from 'react'
import * as HAudio from './audio'
import { drawArrow } from './laneDraw'
import { saveRecording, type Recording } from './recording'
import type { Direction, RainStage } from './rainStage'
import type { Song } from './songs'

// 譜面録音モード(dev限定)。まっさらなレーンに拍線を流し、十字キーの
// 入力時刻を録って recordings/ に保存する。判定・スコアは無い。
// App からは React.lazy + import.meta.env.DEV ガードで読まれるので、
// このファイルは本番バンドルに入らない。

const LANE_KEYS: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 }
const LANE_DIRS: Direction[] = ['LEFT', 'DOWN', 'UP', 'RIGHT']
const LANE_COLORS = ['#ff8fbf', '#ffd06e', '#7fe3b3', '#a99bff']
const LANE_ANGLES = [-Math.PI / 2, Math.PI, 0, Math.PI / 2]
/** 録音対象は hard 相当なので落下速度も hard に合わせる(値の二重持ちを避ける) */
const NOTE_SPEED = HAudio.DIFFICULTIES.find((d) => d.id === 'hard')!.noteSpeed

interface Props {
  song: Song
  stage: RainStage | null
  /** AppProps.noteSpeed と同じ倍率 */
  noteSpeed: number
  /** 終了時に呼ぶ。notice は難易度選択画面に出す通知 */
  onExit: (notice: string) => void
}

export default class RecordMode extends Component<Props> {
  private readonly canvasRef = createRef<HTMLCanvasElement>()
  private rafId = 0
  private taps: [number, number][] = []
  private flash = [0, 0, 0, 0]
  /** finish の二重実行ガード(曲終わりと Esc が重なる等) */
  private done = false

  componentDidMount() {
    window.addEventListener('keydown', this.onKey)
    const { song, stage } = this.props
    HAudio.sfx('start')
    HAudio.startSong(song.url)
    stage?.setBPM(song.bpm)
    stage?.setDancing(true)
    this.rafId = requestAnimationFrame(this.loop)
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this.onKey)
    cancelAnimationFrame(this.rafId)
  }

  private onKey = (e: KeyboardEvent) => {
    // 押しっぱなしの OS キーリピートを録音に混ぜない
    if (e.repeat) return
    if (e.key === 'Escape') {
      void this.finish(true)
    } else if (e.key in LANE_KEYS) {
      this.tap(LANE_KEYS[e.key])
    }
  }

  private tap(lane: number) {
    const t = HAudio.time()
    // 助走(曲頭より前)と曲の外は録らない
    if (t < 0 || t > this.props.song.songEnd) return
    this.taps.push([t, lane])
    this.flash[lane] = performance.now()
    this.stageMove(lane)
    HAudio.sfx('select')
  }

  private stageMove(lane: number) {
    this.props.stage?.move(LANE_DIRS[lane])
  }

  private async finish(aborted: boolean) {
    if (this.done) return
    this.done = true
    const { song } = this.props
    // stop() すると time() が -99 になるので先に読む
    const endT = aborted ? Math.max(0, HAudio.time()) : song.songEnd
    HAudio.stop()
    this.props.stage?.setDancing(false)
    const rec: Recording = {
      song: song.id,
      recordedAt: new Date().toISOString(),
      bpm: song.bpm,
      beat0: song.beat0,
      aborted,
      endT,
      taps: this.taps,
    }
    try {
      const file = await saveRecording(rec)
      this.props.onExit(`ほぞんしたよ → ${file}(${this.taps.length} タップ)`)
    } catch (err) {
      // dev サーバーが無い等。コンソールに丸ごと出して救済する
      console.error('録音の保存に失敗しました', err)
      console.log(JSON.stringify(rec))
      this.props.onExit('ほぞんに しっぱい… コンソールに JSON を出したよ')
    }
  }

  private loop = () => {
    // 保存待ちの間(finish 後)は描画も終了判定もしない
    if (this.done) return
    this.rafId = requestAnimationFrame(this.loop)
    const t = HAudio.time()
    if (t > this.props.song.songEnd) {
      void this.finish(false)
      return
    }
    this.draw(t)
  }

  private draw(t: number) {
    const cv = this.canvasRef.current
    if (!cv) return
    const dpr = Math.min(devicePixelRatio, 2)
    const cw = cv.clientWidth
    const ch = cv.clientHeight
    if (cv.width !== cw * dpr || cv.height !== ch * dpr) {
      cv.width = cw * dpr
      cv.height = ch * dpr
    }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, cw, ch)

    const { song } = this.props
    const laneW = cw / 4
    const recY = 104
    const r = Math.min(laneW * 0.3, 34)
    const speed = NOTE_SPEED * this.props.noteSpeed
    const spb = 60 / song.bpm
    const bar = spb * 4

    // レーンの縦線と判定ライン(App.drawLanes と同じ見た目)
    for (let i = 1; i < 4; i++) {
      g.strokeStyle = 'rgba(255,255,255,0.07)'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(i * laneW, 0)
      g.lineTo(i * laneW, ch)
      g.stroke()
    }
    g.strokeStyle = 'rgba(255,255,255,0.22)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(10, recY)
    g.lineTo(cw - 10, recY)
    g.stroke()

    // 画面に映る時刻範囲(y = recY + (bt - t) * speed の逆算)
    const tMin = t - (recY + 60) / speed
    const tMax = t + (ch - recY + 60) / speed

    // 拍線(細)。ノーツの代わりに流れてくる
    const k0 = Math.max(0, Math.ceil((tMin - song.beat0) / spb))
    const k1 = Math.floor((tMax - song.beat0) / spb)
    g.strokeStyle = 'rgba(255,255,255,0.10)'
    g.lineWidth = 1.5
    for (let k = k0; k <= k1; k++) {
      const y = recY + (song.beat0 + k * spb - t) * speed
      g.beginPath()
      g.moveTo(10, y)
      g.lineTo(cw - 10, y)
      g.stroke()
    }

    // 小節頭(太)+小節番号。番号は bake-chart.py の sections と同じ0始まり
    const m0 = Math.max(0, Math.ceil((tMin - song.bar0) / bar))
    const m1 = Math.floor((tMax - song.bar0) / bar)
    for (let m = m0; m <= m1; m++) {
      const y = recY + (song.bar0 + m * bar - t) * speed
      g.strokeStyle = 'rgba(255,255,255,0.30)'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(10, y)
      g.lineTo(cw - 10, y)
      g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.5)'
      g.font = '12px sans-serif'
      g.fillText(String(m), 14, y - 6)
    }

    // 受け皿の矢印とタップのフラッシュ
    const now = performance.now()
    for (let l = 0; l < 4; l++) {
      const x = laneW * (l + 0.5)
      const fl = Math.max(0, 1 - (now - this.flash[l]) / 240)
      if (fl > 0) {
        g.fillStyle = `rgba(255,255,255,${0.25 * fl})`
        g.beginPath()
        g.arc(x, recY, r * 1.7, 0, 7)
        g.fill()
        drawArrow(g, x, recY, r, LANE_ANGLES[l], LANE_COLORS[l], fl, true)
      }
      drawArrow(g, x, recY, r, LANE_ANGLES[l], 'rgba(255,255,255,0.55)', 0.5, false)
    }

    // HUD はキャンバスに直描き(毎フレーム setState しない)
    const barNow = Math.floor((t - song.bar0) / bar)
    g.fillStyle = 'rgba(255,255,255,0.75)'
    g.font = '13px sans-serif'
    g.fillText(`小節 ${Math.max(0, barNow)} ・ ${this.taps.length} タップ ・ ${Math.max(0, t).toFixed(1)}s`, 14, 20)
  }

  render() {
    return (
      <div className="screen">
        <div className="lane-panel">
          <canvas className="lane-canvas" ref={this.canvasRef} />
        </div>
        <div className="hud">
          <div className="song-chip">🎙 ろくおんちゅう ♪ {this.props.song.title}</div>
        </div>
        <div className="hint">←↓↑→ で ろくおん ・ Esc で そこまで ほぞん</div>
      </div>
    )
  }
}
```

- [ ] **Step 2: App.tsx に組み込む**

import 部(1-5行付近)に追加:

```tsx
import { Component, createRef, lazy, Suspense } from 'react'
```

```tsx
// 録音モードは dev 限定。本番では import.meta.env.DEV が false 定数になり、
// この分岐ごと dead code elimination でチャンクが消える
const RecordMode = import.meta.env.DEV ? lazy(() => import('./RecordMode')) : null
```

`Phase` 型(7行)に `'record'` を追加:

```tsx
type Phase = 'loading' | 'title' | 'song' | 'select' | 'game' | 'result' | 'record'
```

`AppState` に通知を追加(`lyricOutKey` の下):

```tsx
  /** 録音モードの保存結果。難易度選択画面に出す */
  recNotice: string | null
```

初期 state に `recNotice: null` を追加。

`startGame` の下に録音開始を追加(準備待ちは startGame と同じ理由):

```tsx
  /** 録音モードへ。dev 限定(入口が DEV ガード下にしかない) */
  private async startRecord() {
    HAudio.wake()
    const song = SONGS[this.state.songIdx]
    if (!HAudio.isSongReady(song.url) || !(this.stage?.isWarm ?? true)) {
      this.setState({ phase: 'loading' })
      try {
        await Promise.all([HAudio.loadSong(song.url), this.stage?.warm])
      } catch (err) {
        console.error('録音の準備に失敗しました', err)
        this.setState({ phase: 'select' })
        return
      }
    }
    this.setState({ phase: 'record', recNotice: null })
  }
```

`onKey` の `p === 'select'` 分岐に追加(既存の 1-3 の後ろ):

```tsx
      else if (import.meta.env.DEV && e.key === '0') void this.startRecord()
```

render の game 画面ブロックの後ろに追加:

```tsx
        {RecordMode && s.phase === 'record' && (
          <Suspense fallback={null}>
            <RecordMode
              song={song}
              stage={this.stage}
              noteSpeed={this.props.noteSpeed ?? 1}
              onExit={(notice) => this.setState({ phase: 'select', recNotice: notice })}
            />
          </Suspense>
        )}
```

select 画面の `song-list` の中、難易度カードの後ろに dev 限定カードを追加:

```tsx
              {import.meta.env.DEV && (
                <button type="button" className="song-card" onClick={() => void this.startRecord()}>
                  <div className="song-key">キー 0</div>
                  <div className="song-name">🎙 譜面をつくる</div>
                  <div className="song-desc">じぶんで たたいて ろくおん(dev)</div>
                </button>
              )}
```

select 画面の `select-note` の下に通知表示を追加:

```tsx
            {s.recNotice && <div className="select-note">{s.recNotice}</div>}
```

`src/styles.css` の `.song-list`(394行)を折り返し可能にする(dev の録音カードで
4枚になると現状の横一列 240px×4 では溢れる):

```css
.song-list {
  display: flex;
  gap: 26px;
  /* dev 限定の録音カードで4枚になっても溢れないように折り返す */
  flex-wrap: wrap;
  justify-content: center;
}
```

- [ ] **Step 3: ビルドと本番バンドル混入チェック**

```bash
npm run build
grep -rl '__rec' dist/ ; grep -rl '譜面をつくる' dist/ ; grep -rl 'ろくおんちゅう' dist/
```

Expected: build 成功。grep は3つとも**ヒットなし**(RecordMode チャンク自体が dist に無い)。ヒットしたら DEV ガードの書き方を疑う(`import.meta.env.DEV ? lazy(...) : null` が定数畳み込みされているか)。

- [ ] **Step 4: ブラウザで一周確認する**

preview_start(launch.json の dev 設定、無ければ作る)で `http://localhost:5173/hosomiamedance/` を開き:

1. タイトル → 曲えらび → 難易度選択に「🎙 譜面をつくる」カードが出る
2. カードを押す(またはキー 0)→ 雨ステージ+レーンに拍線が流れ、キャラが踊る
3. 十字キーを何回か叩く → フラッシュ+ティック音、HUD のタップ数が増える
4. Esc → 「ほぞんしたよ → recordings/...」が難易度選択に出る
5. `recordings/` に JSON ができていて `taps` が昇順、`aborted: true`
6. read_console_messages でエラーが無いこと

確認で作ったテスト録音は `rm recordings/<file>` で消す。

- [ ] **Step 5: コミット**

```bash
git add src/RecordMode.tsx src/App.tsx src/styles.css
git commit -m "feat: 譜面録音モードを追加(dev限定)

難易度選択の「譜面をつくる」から、拍線だけのレーンで十字キーを
1発録りして recordings/ に保存する。本番バンドルには入らない。"
```

---

### Task 5: chart-feel スキルに「録音→譜面」手順を追記

**Files:**
- Modify: `.claude/skills/chart-feel/SKILL.md`

**Interfaces:**
- Consumes: 録音JSON(Task 3 の Recording 形式)、charts.json の `source` フィールド(Task 1)

- [ ] **Step 1: SKILL.md の「前提」を改訂し、録音→譜面の手順を追記する**

「前提」の1つ目の箇条書きを次に置き換え:

```markdown
- 譜面には出自がある(charts.json の `source`)。`baked` の曲は生成物なので
  charts.json を直接編集せず `scripts/bake-chart.py` を直す。`recorded` の曲は
  下の「録音→譜面」の手順で Claude が charts.json を書く(手順を通さない
  手編集はしない)
```

ファイル末尾(「理論を育てる」の後)に追記:

```markdown
## 録音→譜面(recorded フロー)

dev 限定の録音モード(難易度選択の「🎙 譜面をつくる」)で録った
`recordings/<曲ID>-<日時>.json` を、その曲の3難易度の譜面に変換する。
録音は hard 相当の理想グルーヴを人間が叩いたもの。**録音のリズムの骨格を
最大限尊重する**のがこのフローの目的で、自動生成の意図(sections の密度
カーブ等)には従わなくてよい。

1. **読む**: 録音 JSON と、bake-chart.py の `SONGS` にあるその曲の実測定数
   (bpm / beat0 / bar0 / last_bar)。`aborted: true` の録音は `endT` までが
   有効範囲。それ以降の譜面をどうするか(既存を残す・自動生成で埋める・
   録り足しを待つ)はユーザーに確認する
2. **系統誤差を引く**: 人間の入力は一様に遅れる傾向がある。全タップについて
   最寄りの16分グリッド(beat0 + k*spb/4)からのずれを出し、その**中央値**を
   全タップから引く
3. **量子化**: 補正後の各タップを最寄りの16分グリッドに乗せる。丸めは
   bake-chart.py と同じ精度(秒の小数4桁、`round(t, 4)`)で行う
4. **掃除**: 同グリッド同レーンの重複は1つに。全体 < 16分、同一レーン < 8分の
   間隔違反は、前後の文脈(ストリームの流れ)を見てどちらかを間引くか隣の
   グリッドに逃がす。曲頭(bar0 より前)とアウトロ(last_bar 以降)のタップは捨てる
5. **hard 確定**: 掃除後のタップ列がそのまま hard
6. **normal/easy 展開**: 小節ごとのリズムパターン(骨格)を保ったまま間引く。
   目安は既存の notes/sec 基準(easy 1.204 / normal 2.107 /秒)だが、録音の
   実密度との整合を優先してよい。theory.md の原則(強拍優先・流れの連続性)を
   間引きの判断に使う
7. **書く**: `src/charts.json` のその曲の `notes` を書き換え、`"source": "recorded"`
   にする。bpm / beat0 / bar0 / songEnd は変えない
8. **検査**: `uv run scripts/bake-chart.py --verify`。recorded の曲は健全性
   チェック(叩ける・範囲内・グリッド上)だけがかかる
9. **プレイ確認(必須)**: 通常の手順6と同じ。録音者本人に「自分の録音の
   気持ち良さが残っているか」を確認してもらう

自動生成に戻したくなったら `uv run scripts/bake-chart.py <曲ID>`(明示指定で
recorded を上書きする)。
```

- [ ] **Step 2: コミット**

```bash
git add .claude/skills/chart-feel/SKILL.md
git commit -m "docs: chart-feel に録音→譜面(recorded)の変換手順を追記"
```

---

### Task 6: AGENTS.md の改訂と総仕上げ

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: ここまでの全タスクの成果(記述が実装と一致していること)

- [ ] **Step 1: AGENTS.md を改訂する**

構成表の `src/charts.json` 行を差し替え:

```markdown
| `src/charts.json` | 焼いた/録音由来の譜面。`source` が出自。**直接編集しない**(baked は bake-chart.py、recorded は chart-feel の録音→譜面フローで書く) |
```

構成表に追加(`src/charts.json` の下):

```markdown
| `src/RecordMode.tsx` | 譜面録音モード(dev限定)。本番バンドルには入らない |
| `src/recording.ts` | 録音の型と保存(POST /__rec) |
| `recordings/` | 録音の生データ。譜面の出自として git 管理する |
```

「規約」の chart-feel の箇条書きを差し替え:

```markdown
- 譜面の診断・改善は chart-feel スキル(`.claude/skills/chart-feel/`)を使う。
  録音(dev限定の「譜面をつくる」)から譜面を作る手順も同スキルにある。
  安全網は `bake-chart.py` の自動検査(recorded の曲は健全性チェックのみ)、
  改善の最終判定はプレイ確認。譜面 JSON は必ずどちらかのフローを通して書く
```

「踏みやすい落とし穴」に追記:

```markdown
- **録音由来(source=recorded)の譜面は bake-chart.py の全曲生成でスキップされる**。
  自動生成に戻すときは曲IDを明示指定する(`uv run scripts/bake-chart.py amagoi`)。
```

- [ ] **Step 2: 総合検証**

```bash
npm run build
uv run scripts/bake-chart.py --verify
grep -rl '__rec' dist/ || echo '本番バンドルに録音モードは無い: OK'
```

Expected: すべて OK。

- [ ] **Step 3: コミット**

```bash
git add AGENTS.md
git commit -m "docs: 譜面録音モードと recorded 譜面の規約を AGENTS.md に反映"
```

---

## 最終確認(ユーザーと)

- 実際に1曲録音してもらい、Claude が chart-feel の録音→譜面フローで変換、
  プレイして「自分のグルーヴが残っているか」を確認してもらう(スペックの
  検証項目。コード変更ではないので実装タスクにはしない)
