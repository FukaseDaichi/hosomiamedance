import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// StrictMode は付けない: 開発時の二重マウントで WebGL コンテキストと
// AudioContext が二つ生成され、スプライト 128 枚も二度読みされてしまうため。
const container = document.getElementById('root')
if (!container) throw new Error('#root not found')
createRoot(container).render(<App />)
