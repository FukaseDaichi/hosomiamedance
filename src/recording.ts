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
