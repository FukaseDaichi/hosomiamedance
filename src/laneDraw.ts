// レーン描画の共有部品。通常プレイ(App)と録音モード(RecordMode)の両方が使う。

/** 判定ラインの矢印を描く。filled=false なら受け皿側の細い輪郭。 */
export function drawArrow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  ang: number,
  color: string,
  alpha: number,
  filled: boolean,
) {
  g.save()
  g.translate(x, y)
  g.rotate(ang)
  g.globalAlpha = alpha
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const path = () => {
    g.beginPath()
    g.moveTo(-r * 0.8, r * 0.35)
    g.lineTo(0, -r * 0.5)
    g.lineTo(r * 0.8, r * 0.35)
  }
  if (filled) {
    // 影 → 本体 → ハイライト の三度塗りで立体感を出す
    g.strokeStyle = 'rgba(30,22,60,0.45)'
    g.lineWidth = r * 0.95
    g.save()
    g.translate(0, 3)
    path()
    g.stroke()
    g.restore()
    g.strokeStyle = color
    g.lineWidth = r * 0.85
    path()
    g.stroke()
    g.strokeStyle = 'rgba(255,255,255,0.85)'
    g.lineWidth = r * 0.3
    path()
    g.stroke()
  } else {
    g.strokeStyle = color
    g.lineWidth = r * 0.4
    path()
    g.stroke()
  }
  g.restore()
}
