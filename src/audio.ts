// ホソミアメダンス — WebAudio engine: kawaii loop songs + rain ambience + SFX
//
// 曲は音源ファイルを持たず、五音音階から擬似乱数で旋律を組み立ててその場で合成する。
// seed が固定なので同じ曲は毎回まったく同じ譜面・旋律になる。

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PENTA_MAJ = [0, 2, 4, 7, 9]
const PENTA_MIN = [0, 3, 5, 7, 10]

interface SongDef {
  id: number
  name: string
  desc: string
  bpm: number
  bars: number
  /** 譜面を刻む単位(拍)。1 なら4分、0.5 なら8分 */
  grid: number
  /** ノーツの出現確率 */
  density: number
  /** ルート音の MIDI ノート番号 */
  root: number
  scale: number[]
  seed: number
  hearts: number
  /** 8分音符 8 個 = 1 小節ぶんのドラムパターン */
  kick: number[]
  hat: number[]
}

interface NoteEvent {
  beat: number
  midi: number
  lane: number
}

export interface Song extends SongDef {
  events: NoteEvent[]
}

export interface ChartNote {
  /** 曲頭からの秒数 */
  t: number
  lane: number
}

export type SfxName = 'perfect' | 'good' | 'miss' | 'special' | 'select' | 'start'

const SONG_DEFS: SongDef[] = [
  { id: 0, name: 'あめあがりマーチ', desc: 'のんびりステップ', bpm: 96, bars: 20, grid: 1, density: 0.62, root: 72, scale: PENTA_MAJ, seed: 11, hearts: 1, kick: [1, 0, 1, 0, 1, 0, 1, 0], hat: [0, 1, 0, 1, 0, 1, 0, 1] },
  { id: 1, name: 'みずたまりポップ', desc: 'はずむエイトビート', bpm: 114, bars: 22, grid: 0.5, density: 0.5, root: 74, scale: PENTA_MAJ, seed: 27, hearts: 2, kick: [1, 0, 0, 0, 1, 0, 0, 1], hat: [1, 1, 1, 1, 1, 1, 1, 1] },
  { id: 2, name: 'かみなりビート', desc: 'ぜんりょくダンス!', bpm: 132, bars: 24, grid: 0.5, density: 0.66, root: 69, scale: PENTA_MIN, seed: 42, hearts: 3, kick: [1, 0, 1, 0, 1, 0, 1, 1], hat: [1, 1, 1, 1, 1, 1, 1, 1] },
]

/** 曲定義から旋律とノーツ配置を決定的に生成する。 */
function buildEvents(s: SongDef): NoteEvent[] {
  const rng = mulberry32(s.seed)
  const ev: NoteEvent[] = []
  let deg = 2
  let prevLane = -1
  let lastBeat = -9
  const startBar = 2
  const endBar = s.bars - 1
  for (let bar = startBar; bar < endBar; bar++) {
    for (let b = 0; b < 4; b += s.grid) {
      const beat = bar * 4 + b
      if (beat - lastBeat < s.grid) continue
      const onBeat = b % 1 === 0
      const p = s.density * (onBeat ? 1.25 : 0.75)
      if (rng() > p) continue
      deg += Math.floor(rng() * 5) - 2
      deg = Math.max(0, Math.min(9, deg))
      const oct = Math.floor(deg / 5)
      const st = s.scale[deg % 5]
      let lane = deg % 4
      // 同じレーンが続くと単調なので大半はずらす
      if (lane === prevLane && rng() < 0.6) lane = (lane + 1 + Math.floor(rng() * 2)) % 4
      prevLane = lane
      ev.push({ beat, midi: s.root + st + oct * 12, lane })
      lastBeat = beat
    }
  }
  return ev
}

export const SONGS: Song[] = SONG_DEFS.map((def) => ({ ...def, events: buildEvents(def) }))

interface Engine {
  ctx: AudioContext
  master: GainNode
  delaySend: GainNode
  rainGain: GainNode
}

interface SongState {
  song: Song
  spb: number
  startAt: number
  step: number
  totalSteps: number
  evIdx: number
  timer: number
}

let engine: Engine | null = null
let songState: SongState | null = null

function ensureEngine(): Engine {
  if (engine) return engine
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) throw new Error('WebAudio is not supported in this browser')
  const ctx = new Ctor()

  const master = ctx.createGain()
  master.gain.value = 0.8
  master.connect(ctx.destination)

  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.28
  const fb = ctx.createGain()
  fb.gain.value = 0.3
  const wet = ctx.createGain()
  wet.gain.value = 0.35
  const delaySend = ctx.createGain()
  delaySend.connect(delay)
  delay.connect(fb)
  fb.connect(delay)
  delay.connect(wet)
  wet.connect(master)

  // 雨音: ホワイトノイズをループしローパスで丸める
  const len = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1100
  lp.Q.value = 0.4
  const rainGain = ctx.createGain()
  rainGain.gain.value = 0.045
  src.connect(lp)
  lp.connect(rainGain)
  rainGain.connect(master)
  src.start()

  engine = { ctx, master, delaySend, rainGain }
  return engine
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

function pluck(e: Engine, time: number, midi: number, vol = 0.32) {
  const { ctx } = e
  const f = mtof(midi)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, time)
  g.gain.linearRampToValueAtTime(vol, time + 0.012)
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.45)
  const o1 = ctx.createOscillator()
  o1.type = 'triangle'
  o1.frequency.value = f
  const o2 = ctx.createOscillator()
  o2.type = 'sine'
  o2.frequency.value = f * 2
  const g2 = ctx.createGain()
  g2.gain.value = 0.35
  const lpf = ctx.createBiquadFilter()
  lpf.type = 'lowpass'
  lpf.frequency.value = 3200
  o1.connect(lpf)
  o2.connect(g2)
  g2.connect(lpf)
  lpf.connect(g)
  g.connect(e.master)
  g.connect(e.delaySend)
  o1.start(time)
  o2.start(time)
  o1.stop(time + 0.5)
  o2.stop(time + 0.5)
}

function kick(e: Engine, time: number) {
  const o = e.ctx.createOscillator()
  const g = e.ctx.createGain()
  o.frequency.setValueAtTime(150, time)
  o.frequency.exponentialRampToValueAtTime(44, time + 0.11)
  g.gain.setValueAtTime(0.5, time)
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.16)
  o.connect(g)
  g.connect(e.master)
  o.start(time)
  o.stop(time + 0.18)
}

function hat(e: Engine, time: number, vol = 0.07) {
  const { ctx } = e
  const len = ctx.sampleRate * 0.05
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const s = ctx.createBufferSource()
  s.buffer = buf
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 6500
  const g = ctx.createGain()
  g.gain.value = vol
  s.connect(hp)
  hp.connect(g)
  g.connect(e.master)
  s.start(time)
}

function bass(e: Engine, time: number, midi: number) {
  const o = e.ctx.createOscillator()
  const g = e.ctx.createGain()
  o.type = 'sine'
  o.frequency.value = mtof(midi - 24)
  g.gain.setValueAtTime(0.22, time)
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.22)
  o.connect(g)
  g.connect(e.master)
  o.start(time)
  o.stop(time + 0.25)
}

/** 曲を先頭から再生する。0.9 秒の助走を置いてから鳴り始める。 */
export function startSong(idx: number) {
  const e = ensureEngine()
  if (e.ctx.state === 'suspended') void e.ctx.resume()
  stop()
  const s = SONGS[idx]
  const spb = 60 / s.bpm
  const startAt = e.ctx.currentTime + 0.9
  const st: SongState = { song: s, spb, startAt, step: 0, totalSteps: s.bars * 8, evIdx: 0, timer: 0 }
  songState = st
  // 先読みスケジューラ: 40ms ごとに 180ms 先までのノートを予約する
  st.timer = window.setInterval(() => {
    if (songState !== st) return
    const horizon = e.ctx.currentTime + 0.18
    while (st.step < st.totalSteps) {
      const tBeat = st.step * 0.5
      const time = st.startAt + tBeat * spb
      if (time > horizon) break
      const e8 = st.step % 8
      if (s.kick[e8]) kick(e, time)
      if (s.hat[e8]) hat(e, time, e8 % 2 ? 0.05 : 0.085)
      if (e8 === 2 || e8 === 6) bass(e, time, s.root)
      while (st.evIdx < s.events.length && s.events[st.evIdx].beat <= tBeat + 0.001) {
        const ev = s.events[st.evIdx]
        if (Math.abs(ev.beat - tBeat) < 0.26) pluck(e, st.startAt + ev.beat * spb, ev.midi)
        st.evIdx++
      }
      st.step++
    }
    if (st.step >= st.totalSteps) window.clearInterval(st.timer)
  }, 40)
  return { spb, duration: s.bars * 4 * spb }
}

export function stop() {
  if (songState) {
    window.clearInterval(songState.timer)
    songState = null
  }
}

/** 曲頭を 0 とした現在位置(秒)。未再生なら -99。 */
export function time(): number {
  if (!songState || !engine) return -99
  return engine.ctx.currentTime - songState.startAt
}

/** 曲の譜面を秒単位のノーツ列として返す。 */
export function chart(idx: number): ChartNote[] {
  const s = SONGS[idx]
  const spb = 60 / s.bpm
  return s.events.map((e) => ({ t: e.beat * spb, lane: e.lane }))
}

export function sfx(name: SfxName) {
  const e = ensureEngine()
  if (e.ctx.state === 'suspended') void e.ctx.resume()
  const t = e.ctx.currentTime
  const ding = (f: number, at: number, vol: number, dur: number) => {
    const o = e.ctx.createOscillator()
    const g = e.ctx.createGain()
    o.type = 'sine'
    o.frequency.value = f
    g.gain.setValueAtTime(vol, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + dur)
    o.connect(g)
    g.connect(e.master)
    o.start(at)
    o.stop(at + dur + 0.02)
  }
  if (name === 'perfect') {
    ding(1318, t, 0.16, 0.18)
    ding(1760, t + 0.05, 0.12, 0.22)
  } else if (name === 'good') {
    ding(988, t, 0.13, 0.16)
  } else if (name === 'miss') {
    const o = e.ctx.createOscillator()
    const g = e.ctx.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(220, t)
    o.frequency.exponentialRampToValueAtTime(110, t + 0.12)
    g.gain.setValueAtTime(0.1, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    o.connect(g)
    g.connect(e.master)
    o.start(t)
    o.stop(t + 0.16)
  } else if (name === 'special') {
    ;[1046, 1318, 1568, 2093, 2637].forEach((f, i) => ding(f, t + i * 0.06, 0.14, 0.3))
  } else if (name === 'select') {
    ding(880, t, 0.1, 0.1)
  } else if (name === 'start') {
    ;[659, 880, 1318].forEach((f, i) => ding(f, t + i * 0.09, 0.13, 0.22))
  }
}

/** ブラウザの自動再生制限を解除する。ユーザー操作の中から呼ぶこと。 */
export function wake() {
  const e = ensureEngine()
  if (e.ctx.state === 'suspended') void e.ctx.resume()
}

export function setRain(v: number) {
  if (engine) engine.rainGain.gain.value = 0.02 + v * 0.022
}
