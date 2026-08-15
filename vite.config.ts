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
