import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages のプロジェクトページ配信のため、リポジトリ名をベースパスに置く。
// https://fukasedaichi.github.io/hosomiamedance/
export default defineConfig({
  base: '/hosomiamedance/',
  plugins: [react()],
  build: {
    // three が大きいため既定の 500kB 警告は現実的でない
    chunkSizeWarningLimit: 1000,
  },
})
