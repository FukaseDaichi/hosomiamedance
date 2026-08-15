import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 譜面録音モード(dev限定)の保存口。POST /__rec の JSON を recordings/ に書く。
// configureServer は dev サーバー限定のフックなので、本番ビルドには一切入らない。

/** 録音として保存する形。src/recording.ts の Recording と対応する(型は共有しない。
    vite.config.ts を src 配下に依存させたくないため、ここでも最小限を定義する) */
interface RecPayload {
  song?: unknown
  endT?: unknown
  taps?: unknown
}

/** ボディの上限。無いと巨大なリクエストがそのままディスクに書かれてしまう */
const MAX_BODY_BYTES = 8 * 1024 * 1024 // 8MB

/** Origin ヘッダがループバック以外を指しているか。ヘッダが無い(同一オリジンの
    fetch や curl 等)場合は疑わない */
function isForeignOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const { hostname } = new URL(origin)
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1'
  } catch {
    return true // 解釈できない Origin は素性が確認できないので弾く
  }
}

/** 小数4桁(0.1ms)に丸める。bake-chart.py の round(t, 4) に合わせる */
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** taps を1タップ1行・小数4桁にして書き出す。素の
    JSON.stringify(rec, null, 1) だと1タップ4行・倍精度の桁が並び、hard を
    通しで録ると2,000行超に膨らむ。recordings/ は git 管理してレビューし
    Claude が読む資産なので、それに見合う形に整える */
function formatRecording(rec: RecPayload): string {
  const { taps, endT, ...meta } = rec as Record<string, unknown>
  const head = JSON.stringify({ ...meta, endT: round4(Number(endT)) }, null, 1)
  const tapsArr = taps as [number, number][]
  // head は "{\n ...\n}" で終わるので末尾の "\n}" を落として taps を差し込む
  const body = head.slice(0, -2)
  if (tapsArr.length === 0) return `${body},\n "taps": []\n}\n`
  const tapsLines = tapsArr.map(([t, lane]) => ` [${round4(t)},${lane}]`).join(',\n')
  return `${body},\n "taps": [\n${tapsLines}\n ]\n}\n`
}

function chartRecorder(): Plugin {
  return {
    name: 'chart-recorder',
    configureServer(server) {
      server.middlewares.use('/__rec', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end('POST only')
          return
        }
        // content-type: text/plain 等の simple request はプリフライトされずここまで
        // 届く(Vite の CORS はここより後段)。Origin がループバック以外、または
        // content-type が application/json 以外なら弾く。saveRecording() は常に
        // application/json を送るので正規の経路はこれで壊れない
        const contentType = String(req.headers['content-type'] ?? '')
        if (!/^application\/json(;|$)/i.test(contentType) || isForeignOrigin(req.headers.origin)) {
          res.statusCode = 403
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end('forbidden')
          return
        }
        const chunks: Buffer[] = []
        let bytes = 0
        let tooLarge = false
        req.on('data', (chunk: Buffer) => {
          if (tooLarge) return
          bytes += chunk.length
          if (bytes > MAX_BODY_BYTES) {
            tooLarge = true
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => {
          if (tooLarge) return
          try {
            const rec = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as RecPayload
            const song = String(rec.song ?? '')
            // ファイル名はサーバー側で決める(クライアントに任せるとパストラバーサルの余地が出る)
            if (!/^[a-z0-9]+$/.test(song)) throw new Error(`bad song id: ${song}`)
            const d = new Date()
            const p2 = (n: number) => String(n).padStart(2, '0')
            const stamp =
              `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
              `-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
            // cwd 依存だとサブディレクトリから起動したときにリポジトリ外へ書きかねない
            const dir = path.resolve(server.config.root, 'recordings')
            fs.mkdirSync(dir, { recursive: true })
            // 同秒の保存が重なっても上書きしない
            let file = `${song}-${stamp}.json`
            for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${song}-${stamp}-${i}.json`
            fs.writeFileSync(path.join(dir, file), formatRecording(rec))
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ file: `recordings/${file}` }))
          } catch (err) {
            res.statusCode = 400
            // String(err) は入力の一部(bad song id 等)を含むので content-type を明示する
            res.setHeader('content-type', 'text/plain; charset=utf-8')
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
