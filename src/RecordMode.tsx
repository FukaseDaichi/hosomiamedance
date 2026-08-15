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
      this.props.onExit('ほぞんに しっぱい… コンソールに JSON をだしたよ')
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
    g.fillText(`しょうせつ ${Math.max(0, barNow)} ・ ${this.taps.length} タップ ・ ${Math.max(0, t).toFixed(1)}s`, 14, 20)
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
