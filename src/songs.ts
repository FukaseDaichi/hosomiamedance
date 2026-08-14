// 収録曲の定義。曲を足すときはここと scripts/bake-chart.py の SONGS を揃える。
//
// BPM・曲の終わりは焼いた譜面(charts.json)から読む。譜面は音源の実測時刻に
// 強く依存するので、値の出どころを二重に持たない。

import chartData from './charts.json'
import { AMAGOI_LYRICS, AMEDANCE_LYRICS, type LyricLine } from './lyrics'

export type SongId = 'amedance' | 'amagoi'
export type DifficultyId = 'easy' | 'normal' | 'hard'

export interface ChartNote {
  /** 曲頭からの秒数 */
  t: number
  lane: number
}

export interface Song {
  id: SongId
  title: string
  /** 選曲画面に出す一行紹介 */
  desc: string
  /** mp3 の URL。public/ 配下なので BASE_URL を前置する */
  url: string
  bpm: number
  /** 曲の終わり(秒)。アウトロのフェードを聴かせてから結果画面に行く */
  songEnd: number
  lyrics: LyricLine[]
}

const META: { id: SongId; title: string; desc: string; file: string; lyrics: LyricLine[] }[] = [
  {
    id: 'amedance',
    title: 'ホソミアメダンス',
    desc: 'あめのひは みずたまりで ダンス!',
    file: 'hosomiamedance.mp3',
    lyrics: AMEDANCE_LYRICS,
  },
  {
    id: 'amagoi',
    title: 'ホソミアマゴイダンス',
    desc: 'やんでいく あめに おねがい',
    file: 'hosomiamagoidance.mp3',
    lyrics: AMAGOI_LYRICS,
  },
]

export const SONGS: Song[] = META.map((m) => ({
  id: m.id,
  title: m.title,
  desc: m.desc,
  url: `${import.meta.env.BASE_URL}assets/${m.file}`,
  bpm: chartData.songs[m.id].bpm,
  songEnd: chartData.songs[m.id].songEnd,
  lyrics: m.lyrics,
}))

/** 焼いた譜面を秒単位のノーツ列として返す。 */
export function chart(songId: SongId, diffId: DifficultyId): ChartNote[] {
  return chartData.songs[songId].notes[diffId].map((n) => ({ t: n[0], lane: n[1] }))
}
