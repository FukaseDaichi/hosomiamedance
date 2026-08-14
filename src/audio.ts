// ホソミアメダンス — WebAudio engine: 曲(mp3)の再生 + 雨音 + 効果音
//
// 曲は SUNO で作った実音源を decodeAudioData して AudioBufferSourceNode で鳴らす。
// <audio> を使わないのは、判定の時計 ctx.currentTime と同じ基準で秒を取るため。
// 譜面は scripts/bake-chart.py が焼いた charts.json を読むだけで、ここでは解析しない。

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

export type SfxName = 'perfect' | 'good' | 'miss' | 'special' | 'select' | 'start'

interface Engine {
  ctx: AudioContext
  master: GainNode
  delaySend: GainNode
  rainGain: GainNode
}

interface SongState {
  src: AudioBufferSourceNode
  startAt: number
}

let engine: Engine | null = null
let songState: SongState | null = null
let songBuffer: AudioBuffer | null = null
let songBytes: Promise<ArrayBuffer> | null = null
/** loadSong の同時呼び出しをまとめて 1 回の取得・デコードにするためのキャッシュ */
let songLoadPromise: Promise<void> | null = null

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

/** mp3 の取得だけ先に始める。AudioContext は要らないので起動直後に呼べる。 */
export function prefetchSong() {
  if (!songBytes) {
    songBytes = fetch(SONG_URL).then((r) => {
      // ステータスを見ずに進むと、404 の HTML 本文を decodeAudioData に渡して
      // 意味の分からない EncodingError になる。ここで原因を語らせる
      if (!r.ok) throw new Error(`曲の取得に失敗しました: ${SONG_URL} (status ${r.status})`)
      return r.arrayBuffer()
    })
  }
}

/**
 * mp3 をデコードして再生できる状態にする。ユーザー操作のあとに呼ぶこと。
 * 取得やデコードに失敗した場合はキャッシュを捨て、次回の呼び出しで再取得できるようにする。
 * 呼び出しが重なった場合は同じ Promise を返し、decodeAudioData の並行実行を避ける。
 */
export function loadSong(): Promise<void> {
  if (songBuffer) return Promise.resolve()
  if (!songLoadPromise) {
    songLoadPromise = (async () => {
      try {
        prefetchSong()
        const e = ensureEngine()
        const bytes = await songBytes!
        // decodeAudioData は渡した ArrayBuffer を detach するので、コピーを渡す
        songBuffer = await e.ctx.decodeAudioData(bytes.slice(0))
        // デコードに使い終わった生の ArrayBuffer(3.3MB)を保持し続けない。
        // 再取得が要る場合は prefetchSong() が面倒を見る
        songBytes = null
      } catch (err) {
        // 失敗したキャッシュ(fetch の Promise)を捨てて、次回呼び出しで再取得させる
        songBytes = null
        throw err
      } finally {
        songLoadPromise = null
      }
    })()
  }
  return songLoadPromise
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
