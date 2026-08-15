import { Component, createRef, lazy, Suspense, type CSSProperties, type ReactNode } from 'react'
import * as HAudio from './audio'
import { drawArrow } from './laneDraw'
import { lineAt, splitLyricSegments } from './lyrics'
import { RainStage, type Direction, type SpecialTier } from './rainStage'
import { SONGS, chart } from './songs'

// ---- 歌詞のキネティック・タイポグラフィ ----
// 行ごとの位置・角度・サイズを曲IDと行番号から決定的に決める。
// 乱数を使わないので、同じ曲は毎回同じ演出になる。

function hash32(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // FNV-1a は末尾1文字の違いが上位バイトにほとんど伝わらない。
  // murmur3 の最終撹拌を通して、隣り合う行でも全バイトが散るようにする
  h ^= h >>> 16
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = Math.imul(h, 3266489909)
  h ^= h >>> 16
  return h >>> 0
}

function lyricStyle(songId: string, idx: number): CSSProperties {
  const h = hash32(`${songId}:${idx}`)
  const r = (n: number) => ((h >>> n) & 0xff) / 255 // 0..1 を8bitずつ取り出す
  const lx = r(0) * 0.45 // 横位置。レーンを除いた幅に対する割合
  return {
    // ノーツレーンは実質 右370px(right30px+width340px)。ここでは安全側に
    // 右440px+左余白34px=474pxを除いており、レーンより約70px広く避けている
    left: `calc(34px + (100% - 474px) * ${lx.toFixed(3)})`,
    maxWidth: `calc((100% - 474px) * ${(1 - lx).toFixed(3)})`,
    // 連続する行が同じ帯に来ないよう、偶数行/奇数行で帯を分ける。単一行なら
    // 帯間の8%ギャップで重ならないが、2行に折り返す行は帯を超えることがあり
    // (実測: amedanceのidx19→20で約32px重なる)、その残留衝突は許容している。
    // 下限10%は狭い画面(高さ~600px)で.hintと重ならないための底上げ。2行に
    // 折り返す高さ~180pxの行は、高さ800px未満の画面で.hudに軽く重なりうる。
    bottom: `${(10 + (idx % 2) * 28 + r(8) * 20).toFixed(1)}%`,
    fontSize: `${Math.round(28 + r(16) * 24)}px`,
    ['--rot' as string]: `${((r(24) - 0.5) * 14).toFixed(1)}deg`,
  }
}

/** 歌詞1行をセグメントの span 列にする。空白は揺らさずそのまま出す */
function renderLyricLine(text: string): ReactNode[] {
  return splitLyricSegments(text).map((seg, i) =>
    seg.text.trim() === '' ? (
      <span key={i}>{seg.text}</span>
    ) : (
      <span
        key={i}
        className={seg.kw ? 'lyric-seg lyric-kw' : 'lyric-seg'}
        style={{ ['--i' as string]: i }}
      >
        {seg.text}
      </span>
    )
  )
}

// 録音モードは dev 限定。本番では import.meta.env.DEV が false 定数になり、
// この分岐ごと dead code elimination でチャンクが消える
const RecordMode = import.meta.env.DEV ? lazy(() => import('./RecordMode')) : null

type Phase = 'loading' | 'title' | 'song' | 'select' | 'game' | 'result' | 'record'

/** タイトルロゴ。public/ 配下なので BASE_URL を前置する */
const LOGO_URL = `${import.meta.env.BASE_URL}assets/logo.webp`

/** 曲えらびの入れ替えアニメの尺。リズムゲームなので長いと選曲がもたつく */
const FLIP_MS = 220
const FLIP_EASE = 'cubic-bezier(0.22, 0.9, 0.28, 1)'

/** DOM が書き換わる直前に測った、曲えらびのカードの位置と送った向き */
interface FlipSnapshot {
  first: Map<string, DOMRect>
  /** 1 = つぎへ, -1 = まえへ, 0 = 飛び先を直接クリック */
  dir: -1 | 0 | 1
}

/** 0 = 未処理, 1 = 叩いた, 2 = 見逃した */
type NoteState = 0 | 1 | 2

interface PlayNote {
  t: number
  lane: number
  state: NoteState
}

interface HitEffect {
  lane: number
  t0: number
  color: string
}

interface Judge {
  text: string
  color: string
}

interface Rank {
  letter: string
  phrase: string
}

export interface AppProps {
  /** ノーツの落下速度倍率 */
  noteSpeed?: number
  /** 判定を甘くする */
  easyJudge?: boolean
  /** 雨の量 (0〜2) */
  rainLevel?: number
}

interface AppState {
  phase: Phase
  /** SONGS の添字 */
  songIdx: number
  /** DIFFICULTIES の添字 */
  diffIdx: number
  /** 曲えらび / むずかしさえらびで十字キーが乗っているカードの添字 */
  cursor: number
  score: number
  combo: number
  maxCombo: number
  perfect: number
  good: number
  miss: number
  judge: Judge | null
  /** 判定表示のアニメーションを鳴らし直すための再マウント用キー */
  judgeKey: number
  special: { name: string } | null
  specialKey: number
  nextMilestone: number
  rank: Rank | null
  /** 表示中の歌詞の行番号。-1 なら非表示 */
  lyricIdx: number
  /** フェードアウト中の歌詞の行番号。-1 ならなし */
  lyricOut: number
  /** フェードアウトのアニメーションを鳴らし直すための再マウント用キー */
  lyricOutKey: number
  /** 録音モードの保存結果。難易度選択画面に出す */
  recNotice: string | null
}

const LANE_KEYS: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 }
const LANE_DIRS: Direction[] = ['LEFT', 'DOWN', 'UP', 'RIGHT']
const LANE_COLORS = ['#ff8fbf', '#ffd06e', '#7fe3b3', '#a99bff']
const LANE_ANGLES = [-Math.PI / 2, Math.PI, 0, Math.PI / 2]

// dance: リザルトでホソミが踊り続けるごほうびランク
const RANKS: { min: number; letter: string; phrase: string; dance?: boolean }[] = [
  { min: 0.97, letter: 'SSS', phrase: 'でんせつの ダンサー!', dance: true },
  { min: 0.92, letter: 'SS', phrase: 'かんぺき すぎる!', dance: true },
  { min: 0.85, letter: 'S', phrase: 'すごい リズムかん!', dance: true },
  { min: 0.72, letter: 'A', phrase: 'いいかんじ!' },
  { min: 0.55, letter: 'B', phrase: 'そのちょうし!' },
  { min: -1, letter: 'C', phrase: 'また いっしょに おどろうね' },
]

const SPECIAL_NAMES: Record<SpecialTier, string> = {
  A: 'くるくるアンブレラ',
  B: 'ぴょんぴょんウェーブ',
  C: 'アメダンスフィーバー',
}

export default class App extends Component<AppProps, AppState, FlipSnapshot | null> {
  state: AppState = {
    phase: 'loading',
    songIdx: 0,
    diffIdx: 0,
    cursor: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    judge: null,
    judgeKey: 0,
    special: null,
    specialKey: 0,
    nextMilestone: 10,
    rank: null,
    lyricIdx: -1,
    lyricOut: -1,
    lyricOutKey: 0,
    recNotice: null,
  }

  private readonly stageHostRef = createRef<HTMLDivElement>()
  private readonly laneCanvasRef = createRef<HTMLCanvasElement>()
  /** 選択画面でカーソルが乗っているカード。見えない位置に行ったとき送るのに使う */
  private readonly cursorCardRef = createRef<HTMLButtonElement>()
  /** 曲えらびのカード置き場。入れ替えアニメで中のカードを引くのに使う */
  private readonly pickerRef = createRef<HTMLDivElement>()
  private stage: RainStage | null = null

  private chart: PlayNote[] = []
  private effects: HitEffect[] = []
  private flash = [0, 0, 0, 0]
  private lastMissPop = 0
  private endAt = 0
  private rafId = 0
  private lastRain: number | null = null

  componentDidMount() {
    // タイトルの次に選ばれる可能性が最も高い1曲目だけ先読みしておく
    HAudio.prefetchSong(SONGS[0].url)
    // カバーは選曲画面を開いた瞬間に4枚とも要る。空のカードが並ぶ間を作らない
    for (const s of SONGS) new Image().src = s.cover
    if (this.stageHostRef.current) {
      this.stage = new RainStage(this.stageHostRef.current)
      void this.stage.ready.then(() => this.setState({ phase: 'title' }))
    }
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('pointerdown', this.onPointerDown)
    this.rafId = requestAnimationFrame(this.loop)
  }

  /**
   * 曲えらびのカードが動く前の位置を測る。DOM が書き換わる直前のここでしか取れない。
   * 測るのは変形込みの「いま見えている位置」なので、連打で前のアニメが残っていても
   * そこから続けて動かせる。
   */
  getSnapshotBeforeUpdate(_prevProps: AppProps, prev: AppState): FlipSnapshot | null {
    const cursor = this.state.cursor
    if (prev.phase !== 'song' || this.state.phase !== 'song' || prev.cursor === cursor) return null

    const first = new Map<string, DOMRect>()
    for (const el of this.songCards()) {
      first.set(el.dataset.song ?? '', el.getBoundingClientRect())
      el.getAnimations().forEach((a) => a.cancel())
    }
    const n = SONGS.length
    const dir = (cursor - prev.cursor + n) % n === 1 ? 1 : (prev.cursor - cursor + n) % n === 1 ? -1 : 0
    return { first, dir }
  }

  componentDidUpdate(_prevProps: AppProps, prev: AppState, snap?: FlipSnapshot | null) {
    // カードは狭い画面で折り返して縦に伸びる。2段目に回ったカーソルも見えるようにする
    if (prev.cursor !== this.state.cursor || prev.phase !== this.state.phase) {
      this.cursorCardRef.current?.scrollIntoView({ block: 'nearest' })
    }
    if (snap) this.playFlip(snap)
  }

  /** 曲えらびに並んでいるカード(ヒーローとレール) */
  private songCards() {
    return [...(this.pickerRef.current?.querySelectorAll<HTMLElement>('[data-song]') ?? [])]
  }

  /**
   * 曲の入れ替えを FLIP でつなぐ。動かす前後の位置の差を transform で埋めてから
   * 元に戻すので、レールのサムネがそのままヒーローに育つように見える。
   * 背後で雨シーンが回っているため、動かすのは transform と opacity だけ。
   */
  private playFlip(snap: FlipSnapshot) {
    const picker = this.pickerRef.current
    if (!picker || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let moved = false
    for (const el of this.songCards()) {
      const f = snap.first.get(el.dataset.song ?? '')
      const l = el.getBoundingClientRect()
      // レールを畳んでいる幅では、動く前の位置を持たないカードが出る
      if (!f || !f.width || !l.width) continue
      const dx = f.left - l.left
      const dy = f.top - l.top
      const scale = f.width / l.width
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) continue
      moved = true
      // transform-origin は左上に固定する。中心のままだと上の差分の計算が合わない
      el.animate(
        [
          { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        { duration: FLIP_MS, easing: FLIP_EASE },
      )
    }

    const hero = picker.querySelector<HTMLElement>('.song-hero')
    // レールが無い幅ではヒーローが動かないので、送った向きから滑り込ませる
    if (!moved && hero && snap.dir) {
      hero.animate([{ transform: `translateX(${snap.dir * 40}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: FLIP_MS,
        easing: FLIP_EASE,
      })
    }
    // 着地の瞬間に縁を一度強く光らせる
    hero?.animate(
      [
        { boxShadow: '0 0 0 5px rgba(255, 143, 196, 0.22), 0 0 34px rgba(255, 130, 190, 0.5)' },
        { boxShadow: '0 0 0 11px rgba(255, 143, 196, 0.45), 0 0 58px rgba(255, 130, 190, 0.85)', offset: 0.4 },
        { boxShadow: '0 0 0 5px rgba(255, 143, 196, 0.22), 0 0 34px rgba(255, 130, 190, 0.5)' },
      ],
      { duration: 420, easing: 'ease-out' },
    )
    // 絵が着いてから文字を読ませる。バッジは少し遅れて跳ねる
    picker
      .querySelector('.song-hero-info')
      ?.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
        duration: 260,
        delay: 80,
        easing: 'ease-out',
        fill: 'backwards',
      })
    picker
      .querySelector('.song-badge')
      ?.animate(
        [{ transform: 'scale(0.4)' }, { transform: 'scale(1.14)', offset: 0.6 }, { transform: 'scale(1)' }],
        { duration: 320, delay: 60, easing: 'ease-out', fill: 'backwards' },
      )
    // 押した側の矢印を沈ませて、手応えを返す
    if (snap.dir) {
      picker
        .querySelector(snap.dir > 0 ? '.song-arrow--next' : '.song-arrow--prev')
        ?.animate([{ transform: 'scale(0.8)' }, { transform: 'none' }], { duration: 200, easing: 'ease-out' })
    }
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('pointerdown', this.onPointerDown)
    cancelAnimationFrame(this.rafId)
    HAudio.stop()
    this.stage?.dispose()
    this.stage = null
  }

  /** 判定窓(秒)。easyJudge で広がる。 */
  private windows() {
    const d = HAudio.DIFFICULTIES[this.state.diffIdx]
    const k = (this.props.easyJudge ?? false) ? 1.5 : 1
    return { perf: d.perfWindow * k, good: d.goodWindow * k }
  }

  private onPointerDown = () => HAudio.wake()

  private toSongSelect = () => {
    HAudio.wake()
    HAudio.sfx('select')
    HAudio.stop()
    this.stage?.setDancing(false)
    this.setState({ phase: 'song', cursor: this.state.songIdx })
  }

  /** 曲えらびのカーソルを移す(まだ決定はしない) */
  private focusSong = (idx: number) => {
    HAudio.sfx('select')
    this.setState({ cursor: idx })
  }

  /** 左右の矢印。端は反対側に回る */
  private stepSong = (d: number) => this.focusSong((this.state.cursor + SONGS.length + d) % SONGS.length)

  private pickSong = (idx: number) => {
    HAudio.sfx('select')
    // 難易度を選んでいる間にデコードまで済ませておく。押されたあとなので
    // AudioContext を作ってよい。ここで失敗しても画面は動かさず、
    // 取り直しとエラー表示は startGame に任せる
    void HAudio.loadSong(SONGS[idx].url).catch(() => {})
    // カーソルは前回遊んだ難易度に乗せる
    this.setState({ phase: 'select', songIdx: idx, cursor: this.state.diffIdx, recNotice: null })
  }

  // リザルトのごほうびダンスはここで止める(難易度選択・曲選択に持ち越さない)
  private backToSongSelect = () => {
    this.stage?.setDancing(false)
    this.setState({ phase: 'song', cursor: this.state.songIdx, recNotice: null })
  }

  private backToSelect = () => {
    this.stage?.setDancing(false)
    this.setState({ phase: 'select', cursor: this.state.diffIdx })
  }

  private replay = () => void this.startGame(this.state.diffIdx)

  private async startGame(diffIdx: number) {
    HAudio.wake()
    const song = SONGS[this.state.songIdx]
    // 曲のデコードとスプライトの GPU アップロードが済むまで始めない。
    // 未完のまま始めると、初出コマのアップロードでフレームが飛んでノーツが
    // 音とズレて見え、まだ読めていないコンボ演出は play() に捨てられる
    if (!HAudio.isSongReady(song.url) || !(this.stage?.isWarm ?? true)) {
      this.setState({ phase: 'loading' })
      try {
        await Promise.all([HAudio.loadSong(song.url), this.stage?.warm])
      } catch (err) {
        // 取得やデコードに失敗。ローディング画面に閉じ込めず難易度選択へ戻す
        console.error('ゲームの準備に失敗しました', err)
        this.setState({ phase: 'select' })
        return
      }
    }
    HAudio.sfx('start')
    const diff = HAudio.DIFFICULTIES[diffIdx]
    this.chart = chart(song.id, diff.id).map((n) => ({ t: n.t, lane: n.lane, state: 0 as NoteState }))
    this.endAt = song.songEnd
    this.effects = []
    this.flash = [0, 0, 0, 0]
    HAudio.startSong(song.url)
    if (this.stage) {
      // リザルトのごほうびダンス(SPECIAL ループ)が残っていると move() を弾くので戻す
      this.stage.idle()
      this.stage.setBPM(song.bpm)
      this.stage.setDancing(true)
    }
    this.setState({
      phase: 'game',
      diffIdx,
      // クリックで始めたときもカーソルを追従させる。Esc やリザルトから
      // 難易度えらびに戻ったとき、遊んだカードに乗っていてほしい
      cursor: diffIdx,
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfect: 0,
      good: 0,
      miss: 0,
      judge: null,
      special: null,
      nextMilestone: 10,
      lyricIdx: -1,
      lyricOut: -1,
    })
  }

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
    this.setState({ phase: 'record', cursor: HAudio.DIFFICULTIES.length, recNotice: null })
  }

  private finish() {
    HAudio.stop()
    const max = this.chart.length * 100
    const pct = max ? this.state.score / max : 0
    const r = RANKS.find((x) => pct >= x.min) ?? RANKS[RANKS.length - 1]
    if (r.dance) this.stage?.victoryDance()
    else this.stage?.setDancing(false)
    this.setState({ phase: 'result', rank: { letter: r.letter, phrase: r.phrase } })
  }

  /** 難易度えらびに並ぶカードの枚数。dev では末尾に録音カードが付く */
  private get diffCardCount() {
    return HAudio.DIFFICULTIES.length + (import.meta.env.DEV ? 1 : 0)
  }

  /**
   * 十字キーでカーソルを動かす。カードは横並びだが狭い画面で折り返すので、
   * 上下も前後として扱う1次元のリングにしている。動かしたら true。
   */
  private moveCursor(key: string, count: number) {
    const d = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : key === 'ArrowRight' || key === 'ArrowDown' ? 1 : 0
    if (!d) return false
    HAudio.sfx('select')
    this.setState({ cursor: (this.state.cursor + count + d) % count })
    return true
  }

  private onKey = (e: KeyboardEvent) => {
    const p = this.state.phase
    if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault()
    // 選択画面の Enter は自前で処理する。クリックで <button> にフォーカスが
    // 残っていると、ブラウザが Enter で click を撃ち直して二重に決定してしまう
    if ((p === 'song' || p === 'select') && e.key === 'Enter') e.preventDefault()
    const decide = e.key === 'Enter' || e.key === ' '
    if (p === 'title' && decide) {
      this.toSongSelect()
    } else if (p === 'song') {
      if (decide) this.pickSong(this.state.cursor)
      else this.moveCursor(e.key, SONGS.length)
    } else if (p === 'select') {
      if (e.key === 'Escape') this.setState({ phase: 'song', cursor: this.state.songIdx })
      else if (decide) {
        const i = this.state.cursor
        if (i < HAudio.DIFFICULTIES.length) void this.startGame(i)
        else void this.startRecord()
      } else this.moveCursor(e.key, this.diffCardCount)
    } else if (p === 'game') {
      if (e.key === 'Escape') {
        HAudio.stop()
        this.stage?.setDancing(false)
        this.setState({ phase: 'select' })
      } else if (e.key in LANE_KEYS) {
        this.hitLane(LANE_KEYS[e.key])
      }
    } else if (p === 'result') {
      if (e.key === 'Enter') this.replay()
      else if (e.key === 'Escape') this.backToSelect()
    }
  }

  private hitLane(lane: number) {
    const t = HAudio.time()
    const w = this.windows()
    this.stage?.move(LANE_DIRS[lane])

    // 判定窓内でいちばん近いノーツを拾う
    let best: PlayNote | null = null
    let bestDt = 9
    for (const n of this.chart) {
      if (n.state !== 0 || n.lane !== lane) continue
      const dt = Math.abs(n.t - t)
      if (dt <= w.good && dt < bestDt) {
        best = n
        bestDt = dt
      }
      if (n.t - t > 1) break
    }

    this.flash[lane] = performance.now()
    if (!best) return
    best.state = 1

    const perfect = bestDt <= w.perf
    HAudio.sfx(perfect ? 'perfect' : 'good')
    this.effects.push({ lane, t0: performance.now(), color: perfect ? '#ffd47e' : '#9be8c4' })

    const combo = this.state.combo + 1
    const st: Partial<AppState> = {
      score: this.state.score + (perfect ? 100 : 60),
      combo,
      maxCombo: Math.max(this.state.maxCombo, combo),
      perfect: this.state.perfect + (perfect ? 1 : 0),
      good: this.state.good + (perfect ? 0 : 1),
      judge: perfect ? { text: 'ぴったり!', color: '#ffd47e' } : { text: 'いいね!', color: '#9be8c4' },
      judgeKey: this.state.judgeKey + 1,
    }

    if (combo === this.state.nextMilestone) {
      const tier: SpecialTier = combo >= 50 ? 'C' : combo >= 25 ? 'B' : 'A'
      this.stage?.special(tier)
      HAudio.sfx('special')
      st.special = { name: SPECIAL_NAMES[tier] }
      st.specialKey = this.state.specialKey + 1
      st.nextMilestone = combo < 25 ? 25 : combo < 50 ? 50 : combo + 25
    }

    this.setState(st as AppState)
  }

  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop)

    const rain = this.props.rainLevel ?? 1.2
    if (this.stage && this.lastRain !== rain) {
      this.lastRain = rain
      this.stage.setRain(rain)
      HAudio.setRain(rain)
    }
    if (this.state.phase !== 'game') return

    const t = HAudio.time()

    // 毎フレーム setState すると重いので、行が変わったときだけ更新する
    const li = lineAt(SONGS[this.state.songIdx].lyrics, t)
    if (li !== this.state.lyricIdx) {
      const prev = this.state.lyricIdx
      this.setState({
        lyricIdx: li,
        // 出ていた行があればフェードアウトさせる。key を進めて鳴らし直す
        lyricOut: prev >= 0 ? prev : this.state.lyricOut,
        lyricOutKey: prev >= 0 ? this.state.lyricOutKey + 1 : this.state.lyricOutKey,
      })
    }

    const w = this.windows()
    let missed = 0
    for (const n of this.chart) {
      if (n.state === 0 && t - n.t > w.good) {
        n.state = 2
        missed++
      }
      if (n.t - t > 3) break
    }
    if (missed) {
      const now = performance.now()
      const st: Partial<AppState> = { miss: this.state.miss + missed, combo: 0, nextMilestone: 10 }
      // 連続ミスで判定表示が瞬かないよう間引く
      if (now - this.lastMissPop > 250) {
        st.judge = { text: 'あれれ…', color: '#a9b1dc' }
        st.judgeKey = this.state.judgeKey + 1
        this.lastMissPop = now
      }
      this.setState(st as AppState)
    }

    if (t > this.endAt) {
      this.finish()
      return
    }
    this.drawLanes(t)
  }

  private drawLanes(t: number) {
    const cv = this.laneCanvasRef.current
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

    const laneW = cw / 4
    const recY = 104
    const r = Math.min(laneW * 0.3, 34)
    const diff = HAudio.DIFFICULTIES[this.state.diffIdx]
    const speed = diff.noteSpeed * (this.props.noteSpeed ?? 1)

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

    const now = performance.now()
    for (let l = 0; l < 4; l++) {
      const x = laneW * (l + 0.5)
      const fl = Math.max(0, 1 - (now - this.flash[l]) / 240)
      if (fl > 0) {
        g.fillStyle = `rgba(255,255,255,${0.25 * fl})`
        g.beginPath()
        g.arc(x, recY, r * 1.7, 0, 7)
        g.fill()
      }
      drawArrow(g, x, recY, r, LANE_ANGLES[l], 'rgba(255,255,255,0.55)', 0.5, false)
    }

    for (const n of this.chart) {
      if (n.state !== 0) continue
      const y = recY + (n.t - t) * speed
      if (y < -60) continue
      if (y > ch + 60) break
      drawArrow(g, laneW * (n.lane + 0.5), y, r, LANE_ANGLES[n.lane], LANE_COLORS[n.lane], 1, true)
    }

    this.effects = this.effects.filter((e) => now - e.t0 < 320)
    for (const e of this.effects) {
      const p = (now - e.t0) / 320
      const x = laneW * (e.lane + 0.5)
      g.strokeStyle = e.color
      g.globalAlpha = 1 - p
      g.lineWidth = 5 * (1 - p)
      g.beginPath()
      g.arc(x, recY, r * (1 + p * 1.6), 0, 7)
      g.stroke()
      g.globalAlpha = 1
    }
  }

  render() {
    const s = this.state
    const diff = HAudio.DIFFICULTIES[s.diffIdx]
    const song = SONGS[s.songIdx]
    // 曲えらびで大きく出している曲。決定するまでは songIdx ではなくカーソルを見る
    const cur = SONGS[s.cursor % SONGS.length]

    return (
      <div className="stage">
        <div className="rain-host" ref={this.stageHostRef} />
        <div className="vignette" />

        {s.phase === 'game' && (
          <div className="screen" style={{ ['--beat' as string]: `${(60 / song.bpm).toFixed(4)}s` }}>
            <div className="lane-panel">
              <canvas className="lane-canvas" ref={this.laneCanvasRef} />
            </div>
            <div className="hud">
              <div className="score-box">
                <div className="score-label">スコア</div>
                <div className="score-value">{s.score}</div>
              </div>
              <div className="song-chip">♪ {song.title} — {diff.name}</div>
            </div>

            {s.combo >= 2 && (
              <div className="combo">
                <div className="combo-num">{s.combo}</div>
                <div className="combo-label">コンボ!</div>
                <div className="combo-next">つぎのスペシャル {s.nextMilestone}</div>
              </div>
            )}

            {/* judge/special と key の数値空間が重なると React が "duplicate key" を
                警告してしまう(judgeKey・lyricIdx はどちらも 0 から増える別カウンタ)ので
                用途ごとに接頭辞を付けて名前空間を分ける */}
            {s.judge && (
              <div key={`judge-${s.judgeKey}`} className="judge" style={{ color: s.judge.color }}>
                {s.judge.text}
              </div>
            )}

            {s.special && (
              <div key={`special-${s.specialKey}`} className="special-banner">
                スペシャル♥ {s.special.name}
              </div>
            )}

            {s.lyricOut >= 0 && (
              <div
                key={`out-${s.lyricOutKey}`}
                className="lyric lyric--out"
                style={lyricStyle(song.id, s.lyricOut)}
              >
                {renderLyricLine(song.lyrics[s.lyricOut].text)}
              </div>
            )}
            {s.lyricIdx >= 0 && (
              <div key={`lyric-${s.lyricIdx}`} className="lyric" style={lyricStyle(song.id, s.lyricIdx)}>
                {renderLyricLine(song.lyrics[s.lyricIdx].text)}
              </div>
            )}

            <div className="hint">←↓↑→ で おどる ・ Esc で やめる</div>
          </div>
        )}

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

        {s.phase === 'title' && (
          <div className="screen screen--center title-screen">
            <div className="title-block">
              <img className="title-logo" src={LOGO_URL} alt="ホソミアメダンス" />
              <div className="title-sub">あめのひは みずたまりで ダンス!</div>
            </div>
            <button type="button" className="btn btn--lg" onClick={this.toSongSelect}>
              はじめる
            </button>
            <div className="title-note">スペースキーでも スタートできるよ</div>
          </div>
        )}

        {s.phase === 'song' && (
          <div className="screen screen--center select-screen">
            <div className="select-heading">きょくを えらぼう</div>
            <div className="select-sub">← → で えらぶ</div>
            <div className="song-picker" ref={this.pickerRef}>
              <button
                type="button"
                className="song-arrow song-arrow--prev"
                aria-label="まえの きょく"
                onClick={() => this.stepSong(-1)}
              />
              {/* 曲名はカバーに焼き込んであるので、テキストの曲名は alt に持たせる */}
              <button type="button" className="song-hero" data-song={cur.id} onClick={() => this.pickSong(s.cursor)}>
                <span className="song-badge">
                  <span>
                    えらん
                    <br />
                    でるよ
                  </span>
                </span>
                <img className="song-hero-cover" src={cur.cover} alt={cur.title} />
                <span className="song-hero-info">
                  <span>{cur.desc}</span>
                  <span>BPM {Math.round(cur.bpm)}</span>
                  <span className="song-hero-len">{Math.round(cur.songEnd / 60)}ふん くらい</span>
                </span>
              </button>
              <button
                type="button"
                className="song-arrow song-arrow--next"
                aria-label="つぎの きょく"
                onClick={() => this.stepSong(1)}
              />
              {/* 選んでいない曲を、カーソルの次から順に並べる */}
              <div className="song-rail">
                {SONGS.slice(1).map((_, k) => {
                  const i = (s.cursor + 1 + k) % SONGS.length
                  return (
                    <button
                      type="button"
                      key={SONGS[i].id}
                      className="song-thumb"
                      data-song={SONGS[i].id}
                      onClick={() => this.focusSong(i)}
                    >
                      <img src={SONGS[i].cover} alt={SONGS[i].title} />
                    </button>
                  )
                })}
              </div>
            </div>
            {/* 「十字」はいろは餅にグリフが無く空白で出るので、かなで書く */}
            <div className="select-note">やじるしキーで えらんで エンターで けってい</div>
          </div>
        )}

        {s.phase === 'select' && (
          <div className="screen screen--center select-screen">
            <div className="select-heading">むずかしさを えらぼう</div>
            <div className="select-song-name">♪ {song.title}</div>
            <div className="song-list">
              {HAudio.DIFFICULTIES.map((d, i) => (
                <button
                  type="button"
                  key={d.id}
                  ref={s.cursor === i ? this.cursorCardRef : null}
                  className={`song-card${s.cursor === i ? ' song-card--on' : ''}`}
                  onClick={() => void this.startGame(i)}
                >
                  <div className="song-key">えらんでるよ</div>
                  <div className="song-name">{d.name}</div>
                  <div className="song-desc">{d.desc}</div>
                  <div className="song-meta">
                    <span className="song-bpm">BPM {Math.round(song.bpm)}</span>
                    <span className="song-hearts">
                      {'♥'.repeat(d.hearts) + '♡'.repeat(3 - d.hearts)}
                    </span>
                  </div>
                </button>
              ))}
              {import.meta.env.DEV && (
                <button
                  type="button"
                  ref={s.cursor === HAudio.DIFFICULTIES.length ? this.cursorCardRef : null}
                  className={`song-card${s.cursor === HAudio.DIFFICULTIES.length ? ' song-card--on' : ''}`}
                  onClick={() => void this.startRecord()}
                >
                  <div className="song-key">えらんでるよ</div>
                  <div className="song-name">🎙 ふめんを つくる</div>
                  <div className="song-desc">じぶんで たたいて ろくおん(dev)</div>
                </button>
              )}
            </div>
            <div className="select-note">
              やじるしキーで えらんで エンターで けってい ・ Esc で きょくえらび
            </div>
            {s.recNotice && <div className="select-note">{s.recNotice}</div>}
            <button type="button" className="btn btn--sm btn--ghost" onClick={this.backToSongSelect}>
              きょくを えらびなおす
            </button>
          </div>
        )}

        {s.phase === 'result' && (
          <div className="screen result-screen">
            <div className="result-card">
              <div className="result-heading">けっか はっぴょう!</div>
              <div className="result-rank">{s.rank?.letter ?? ''}</div>
              <div className="result-phrase">{s.rank?.phrase ?? ''}</div>
              <div className="result-score">
                {s.score} <span className="result-score-unit">てん</span>
              </div>
              <div className="stat-list">
                <div className="stat-row">
                  <span style={{ color: '#e9a13c' }}>ぴったり</span>
                  <span>{s.perfect}</span>
                </div>
                <div className="stat-row">
                  <span style={{ color: '#3cb37e' }}>いいね</span>
                  <span>{s.good}</span>
                </div>
                <div className="stat-row">
                  <span style={{ color: '#8a90b8' }}>あれれ</span>
                  <span>{s.miss}</span>
                </div>
                <div className="stat-row">
                  <span style={{ color: '#e2609a' }}>さいだいコンボ</span>
                  <span>{s.maxCombo}</span>
                </div>
              </div>
              <div className="result-buttons">
                <button type="button" className="btn btn--sm" onClick={this.replay}>
                  もういちど
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={this.backToSelect}>
                  むずかしさを かえる
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={this.backToSongSelect}>
                  きょくを えらぶ
                </button>
              </div>
            </div>
          </div>
        )}

        {s.phase === 'loading' && (
          <div className="screen screen--center loading-screen">
            <img className="loading-logo" src={LOGO_URL} alt="ホソミアメダンス" />
            <div className="loading-text">じゅんびちゅう…</div>
            <div className="loading-sub">ホソミが かさを さしています</div>
          </div>
        )}
      </div>
    )
  }
}
