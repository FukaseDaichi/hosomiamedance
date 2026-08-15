import { Component, createRef } from 'react'
import * as HAudio from './audio'
import { drawArrow } from './laneDraw'
import { lineAt } from './lyrics'
import { RainStage, type Direction, type SpecialTier } from './rainStage'
import { SONGS, chart } from './songs'

type Phase = 'loading' | 'title' | 'song' | 'select' | 'game' | 'result'

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
}

const LANE_KEYS: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 }
const LANE_DIRS: Direction[] = ['LEFT', 'DOWN', 'UP', 'RIGHT']
const LANE_COLORS = ['#ff8fbf', '#ffd06e', '#7fe3b3', '#a99bff']
const LANE_ANGLES = [-Math.PI / 2, Math.PI, 0, Math.PI / 2]

const RANKS: { min: number; letter: string; phrase: string }[] = [
  { min: 0.97, letter: 'SSS', phrase: 'でんせつの ダンサー!' },
  { min: 0.92, letter: 'SS', phrase: 'かんぺき すぎる!' },
  { min: 0.85, letter: 'S', phrase: 'すごい リズムかん!' },
  { min: 0.72, letter: 'A', phrase: 'いいかんじ!' },
  { min: 0.55, letter: 'B', phrase: 'そのちょうし!' },
  { min: -1, letter: 'C', phrase: 'また いっしょに おどろうね' },
]

const SPECIAL_NAMES: Record<SpecialTier, string> = {
  A: 'くるくるアンブレラ',
  B: 'ぴょんぴょんウェーブ',
  C: 'アメダンスフィーバー',
}

export default class App extends Component<AppProps, AppState> {
  state: AppState = {
    phase: 'loading',
    songIdx: 0,
    diffIdx: 0,
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
  }

  private readonly stageHostRef = createRef<HTMLDivElement>()
  private readonly laneCanvasRef = createRef<HTMLCanvasElement>()
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
    if (this.stageHostRef.current) {
      this.stage = new RainStage(this.stageHostRef.current)
      void this.stage.ready.then(() => this.setState({ phase: 'title' }))
    }
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('pointerdown', this.onPointerDown)
    this.rafId = requestAnimationFrame(this.loop)
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
    this.setState({ phase: 'song' })
  }

  private pickSong = (idx: number) => {
    HAudio.sfx('select')
    // 難易度を選んでいる間にデコードまで済ませておく。押されたあとなので
    // AudioContext を作ってよい。ここで失敗しても画面は動かさず、
    // 取り直しとエラー表示は startGame に任せる
    void HAudio.loadSong(SONGS[idx].url).catch(() => {})
    this.setState({ phase: 'select', songIdx: idx })
  }

  private backToSongSelect = () => this.setState({ phase: 'song' })

  private backToSelect = () => this.setState({ phase: 'select' })

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
      this.stage.setBPM(song.bpm)
      this.stage.setDancing(true)
    }
    this.setState({
      phase: 'game',
      diffIdx,
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

  private finish() {
    HAudio.stop()
    this.stage?.setDancing(false)
    const max = this.chart.length * 100
    const pct = max ? this.state.score / max : 0
    const r = RANKS.find((x) => pct >= x.min) ?? RANKS[RANKS.length - 1]
    this.setState({ phase: 'result', rank: { letter: r.letter, phrase: r.phrase } })
  }

  private onKey = (e: KeyboardEvent) => {
    const p = this.state.phase
    if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault()
    if (p === 'title' && (e.key === ' ' || e.key === 'Enter')) {
      this.toSongSelect()
    } else if (p === 'song') {
      const i = Number(e.key) - 1
      if (i >= 0 && i < SONGS.length) this.pickSong(i)
    } else if (p === 'select') {
      if (e.key === 'Escape') this.setState({ phase: 'song' })
      else if (['1', '2', '3'].includes(e.key)) void this.startGame(Number(e.key) - 1)
    } else if (p === 'game') {
      if (e.key === 'Escape') {
        HAudio.stop()
        this.stage?.setDancing(false)
        this.setState({ phase: 'select' })
      } else if (e.key in LANE_KEYS) {
        this.hitLane(LANE_KEYS[e.key])
      }
    } else if (p === 'result') {
      if (e.key === 'Enter') void this.startGame(this.state.diffIdx)
      else if (e.key === 'Escape') this.setState({ phase: 'select' })
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

    return (
      <div className="stage">
        <div className="rain-host" ref={this.stageHostRef} />
        <div className="vignette" />

        {s.phase === 'game' && (
          <div className="screen">
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

            {s.judge && (
              <div key={s.judgeKey} className="judge" style={{ color: s.judge.color }}>
                {s.judge.text}
              </div>
            )}

            {s.special && (
              <div key={s.specialKey} className="special-banner">
                スペシャル♥ {s.special.name}
              </div>
            )}

            {s.lyricOut >= 0 && (
              <div key={`out-${s.lyricOutKey}`} className="lyric lyric--out">
                {song.lyrics[s.lyricOut].text}
              </div>
            )}
            {s.lyricIdx >= 0 && (
              <div key={s.lyricIdx} className="lyric">
                {song.lyrics[s.lyricIdx].text}
              </div>
            )}

            <div className="hint">←↓↑→ で おどる ・ Esc で やめる</div>
          </div>
        )}

        {s.phase === 'title' && (
          <div className="screen screen--center title-screen">
            <div className="title-block">
              <div className="title-text">
                ホソミ
                <br />
                アメダンス
              </div>
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
            <div className="song-list">
              {SONGS.map((x, i) => (
                <button
                  type="button"
                  key={x.id}
                  className="song-card song-card--track"
                  onClick={() => this.pickSong(i)}
                >
                  <div className="song-key">キー {i + 1}</div>
                  <div className="song-name">{x.title}</div>
                  <div className="song-desc">{x.desc}</div>
                  <div className="song-meta">
                    <span className="song-bpm">BPM {Math.round(x.bpm)}</span>
                    <span className="song-hearts">{Math.round(x.songEnd / 60)}ふん くらい</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="select-note">カードをクリック か 数字キー(1・2)で けってい</div>
          </div>
        )}

        {s.phase === 'select' && (
          <div className="screen screen--center select-screen">
            <div className="select-heading">むずかしさを えらぼう</div>
            <div className="select-song-name">♪ {song.title}</div>
            <div className="song-list">
              {HAudio.DIFFICULTIES.map((d, i) => (
                <button type="button" key={d.id} className="song-card" onClick={() => void this.startGame(i)}>
                  <div className="song-key">キー {i + 1}</div>
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
            </div>
            <div className="select-note">
              カードをクリック か 数字キー(1・2・3)で けってい ・ Esc で きょくえらび
            </div>
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
            <div className="loading-text">じゅんびちゅう…</div>
            <div className="loading-sub">ホソミが かさを さしています</div>
          </div>
        )}
      </div>
    )
  }
}
