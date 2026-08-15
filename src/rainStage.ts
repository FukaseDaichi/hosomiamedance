import * as THREE from 'three'

export const ANIMS = ['IDLE', 'LEFT_STEP', 'RIGHT_STEP', 'JUMP', 'DOWN', 'SPECIAL_A', 'SPECIAL_B', 'SPECIAL_C'] as const
export type AnimName = (typeof ANIMS)[number]
export type Direction = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
export type SpecialTier = 'A' | 'B' | 'C'

const FRAMES = 16
const SPRITE_ASPECT = 270 / 480
/** 1 フレームに GPU へ上げるテクスチャの枚数 */
const WARM_PER_FRAME = 4

function radialTex(inner: string, outer: string, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, inner)
  grad.addColorStop(1, outer)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function heartTex(color: string): THREE.CanvasTexture {
  const s = 96
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.translate(s / 2, s / 2)
  g.scale(s / 34, s / 34)
  g.beginPath()
  g.moveTo(0, 11)
  g.bezierCurveTo(-14, 0, -13, -12, -6, -12)
  g.bezierCurveTo(-2, -12, 0, -9, 0, -6)
  g.bezierCurveTo(0, -9, 2, -12, 6, -12)
  g.bezierCurveTo(13, -12, 14, 0, 0, 11)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function skyTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 512
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0, '#3b3266')
  grad.addColorStop(0.5, '#584a8e')
  grad.addColorStop(0.78, '#8a6ea8')
  grad.addColorStop(1, '#c98aa9')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 512)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface AnimState {
  name: AnimName
  fps: number
  loop: boolean
  frame: number
  /** 次のコマまでの経過秒 */
  acc: number
}

interface Ripple {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  age: number
  life: number
  max: number
  op: number
}

interface Heart {
  sprite: THREE.Sprite
  age: number
  life: number
  vx: number
  vy: number
  vr: number
}

interface Bokeh {
  sprite: THREE.Sprite
  ph: number
  sp: number
}

/**
 * 雨のステージを描く Three.js シーン。
 * コンテナ要素を渡すと canvas を差し込み、自分でリサイズと描画ループを回す。
 */
export class RainStage {
  /** IDLE のテクスチャが揃ったら解決する。タイトル表示の待ち合わせに使う。 */
  readonly ready: Promise<void>
  /** 全アニメが揃い GPU にも載ったら解決する。ゲーム開始の待ち合わせに使う。 */
  readonly warm: Promise<void>

  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly resizeObserver: ResizeObserver

  private readonly charGroup: THREE.Group
  private readonly charMat: THREE.MeshBasicMaterial
  private readonly mirrorMat: THREE.MeshBasicMaterial

  private readonly rainMat: THREE.LineBasicMaterial
  private readonly rain: THREE.LineSegments
  private readonly dropPos: Float32Array
  private readonly dropVel: Float32Array
  private readonly nDrops = 900

  private readonly ripples: Ripple[] = []
  private readonly hearts: Heart[] = []
  private readonly bokeh: Bokeh[] = []

  private readonly textures: Partial<Record<AnimName, THREE.Texture[]>> = {}
  private anim: AnimState = { name: 'IDLE', fps: 13, loop: true, frame: 0, acc: 0 }

  /** GPU へ上げ終えていないテクスチャ。pumpWarm が少しずつ捌く */
  private warmQueue: THREE.Texture[] = []
  private warmResolve: (() => void) | null = null
  private warmPumping = false
  private warmed = false

  private bpm = 0
  private dancing = false
  private beatPh = 0
  private rainLevel = 1.2

  private lastTime = 0
  private elapsed = 0
  private disposed = false

  constructor(container: HTMLElement) {
    this.container = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
    container.appendChild(this.renderer.domElement)

    const sc = (this.scene = new THREE.Scene())
    sc.background = skyTex()
    sc.fog = new THREE.Fog(0x4b3f78, 9, 26)
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 60)
    this.camera.position.set(0, 1.75, 7.6)
    this.camera.lookAt(0, 1.25, 0)

    sc.add(new THREE.AmbientLight(0x9a90c8, 1.5))
    const key = new THREE.DirectionalLight(0xfff0e0, 1.1)
    key.position.set(2, 6, 4)
    sc.add(key)
    const pink = new THREE.PointLight(0xff9ecb, 14, 12)
    pink.position.set(-2.4, 2.6, 1.5)
    sc.add(pink)
    const blue = new THREE.PointLight(0x6fb7ff, 10, 14)
    blue.position.set(3, 3, -3)
    sc.add(blue)

    // ground (wet asphalt)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 40),
      new THREE.MeshStandardMaterial({ color: 0x272044, roughness: 0.5, metalness: 0.25 }),
    )
    ground.rotation.x = -Math.PI / 2
    sc.add(ground)

    // puddles
    const pudMat = new THREE.MeshBasicMaterial({ color: 0x7d6fb5, transparent: true, opacity: 0.55, depthWrite: false })
    const pudSpots: [number, number, number, number][] = [
      [0, 0.4, 2.6, 1.5],
      [-3.4, 1.5, 1.4, 0.8],
      [3.6, 0.8, 1.6, 0.9],
      [-2.2, -2.5, 1.8, 1.0],
      [2.6, -3, 1.5, 0.8],
      [0.5, -5, 2.2, 1.2],
    ]
    for (const [x, z, sx, sz] of pudSpots) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(1, 40), pudMat)
      p.rotation.x = -Math.PI / 2
      p.position.set(x, 0.005, z)
      p.scale.set(sx, sz, 1)
      p.renderOrder = 1
      sc.add(p)
      const sheen = new THREE.Mesh(
        new THREE.CircleGeometry(1, 40),
        new THREE.MeshBasicMaterial({
          map: radialTex('rgba(255,236,248,0.35)', 'rgba(255,236,248,0)'),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      sheen.rotation.x = -Math.PI / 2
      sheen.position.set(x - sx * 0.2, 0.006, z + sz * 0.2)
      sheen.scale.set(sx * 0.8, sz * 0.8, 1)
      sheen.renderOrder = 2
      sc.add(sheen)
    }

    // bokeh lights in background
    const bokehCols = ['rgba(255,158,203,0.8)', 'rgba(140,190,255,0.8)', 'rgba(200,170,255,0.8)', 'rgba(255,215,160,0.8)']
    for (let i = 0; i < 9; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: radialTex(bokehCols[i % 4], 'rgba(0,0,0,0)'),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.55,
        }),
      )
      const s = 0.8 + Math.random() * 1.8
      sprite.scale.set(s, s, 1)
      sprite.position.set((Math.random() - 0.5) * 16, 0.8 + Math.random() * 3.4, -5 - Math.random() * 8)
      sc.add(sprite)
      this.bokeh.push({ sprite, ph: Math.random() * 9, sp: 0.2 + Math.random() * 0.4 })
    }

    // rain — 1本の雨粒を 2 頂点の線分で表す
    this.dropPos = new Float32Array(this.nDrops * 6)
    this.dropVel = new Float32Array(this.nDrops)
    for (let i = 0; i < this.nDrops; i++) this.resetDrop(i, true)
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3))
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xbdd2ff, transparent: true, opacity: 0.42 })
    this.rain = new THREE.LineSegments(rg, this.rainMat)
    sc.add(this.rain)

    // ripple pool
    const ripGeo = new THREE.RingGeometry(0.86, 1, 42)
    for (let i = 0; i < 46; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xdbe6ff, transparent: true, opacity: 0, depthWrite: false })
      const mesh = new THREE.Mesh(ripGeo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0.012
      mesh.renderOrder = 4
      mesh.visible = false
      sc.add(mesh)
      this.ripples.push({ mesh, mat, age: 1, life: 1, max: 1, op: 0.5 })
    }

    // hearts pool
    const hTexs = [heartTex('#ff7eb3'), heartTex('#ffb3d1'), heartTex('#ffd47e')]
    for (let i = 0; i < 16; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: hTexs[i % 3], transparent: true, opacity: 0, depthWrite: false }),
      )
      sprite.visible = false
      sc.add(sprite)
      this.hearts.push({ sprite, age: 1, life: 1, vx: 0, vy: 0, vr: 0 })
    }

    // character
    const W = 3.9
    const H = W * SPRITE_ASPECT
    this.charGroup = new THREE.Group()
    this.charGroup.position.set(-1.35, 0, 0)
    this.charMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.charMat)
    plane.position.y = H / 2 - H * 0.085
    plane.renderOrder = 5
    this.charGroup.add(plane)
    sc.add(this.charGroup)
    // 水たまりへの映り込み: 上下反転した板を地面下に置き、常に手前へ描く
    this.mirrorMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.26,
      depthTest: false,
      depthWrite: false,
      color: 0xb0c4ff,
    })
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.mirrorMat)
    mirror.scale.y = -1
    mirror.position.y = -(H / 2 - H * 0.085)
    mirror.renderOrder = 3
    this.charGroup.add(mirror)

    document.addEventListener('visibilitychange', this.onVisibility)
    this.ready = this.loadAnim('IDLE')
    void this.ready.then(() => this.applyFrame())
    this.warm = this.loadRest()
    // ゲームを始めないまま失敗した場合に unhandled rejection にしない。
    // ここで握っても startGame 側の await は従来どおり reject される
    void this.warm.catch(() => {})

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.renderer.setAnimationLoop(() => this.tick())
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.renderer.domElement.remove()
    this.renderer.dispose()
    document.removeEventListener('visibilitychange', this.onVisibility)
    // renderer を捨てた以上キューはもう捌けない。待っている側を置き去りにしない
    this.warmQueue = []
    this.warmResolve?.()
    this.warmResolve = null
  }

  private loadTexture(url: string): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace
          resolve(t)
        },
        undefined,
        () => reject(new Error(`failed to load sprite: ${url}`)),
      )
    })
  }

  private async loadAnim(a: AnimName) {
    const frames = await Promise.all(
      Array.from({ length: FRAMES }, (_, f) =>
        this.loadTexture(`${import.meta.env.BASE_URL}assets/hosomi/${a}_${String(f).padStart(2, '0')}.webp`),
      ),
    )
    this.textures[a] = frames
    this.warmQueue.push(...frames)
    this.schedulePump()
  }

  /**
   * 読み終わったテクスチャを GPU に上げる。表示中は 1 フレームぶんずつ刻む。
   * 128 枚まとめて上げるとそこで一度大きく止まるため。
   * 隠れている間は描画していないので刻む理由がなく、その場で全部上げる。
   * タブが隠れると rAF は止まり、setTimeout も 1 秒に絞られるので、
   * 刻んだままだとキューが捌けず warm が解決しなくなる
   */
  private pumpWarm = () => {
    this.warmPumping = false
    if (this.disposed) return
    const n = document.hidden ? this.warmQueue.length : WARM_PER_FRAME
    for (let i = 0; i < n && this.warmQueue.length; i++) {
      this.renderer.initTexture(this.warmQueue.shift()!)
    }
    if (this.warmQueue.length) {
      this.schedulePump()
      return
    }
    const done = this.warmResolve
    this.warmResolve = null
    done?.()
  }

  private schedulePump() {
    if (this.warmPumping || this.disposed || !this.warmQueue.length) return
    if (document.hidden) {
      this.pumpWarm()
      return
    }
    this.warmPumping = true
    requestAnimationFrame(this.pumpWarm)
  }

  /** 表示中に隠れると rAF ごと止まる。取り残したぶんをその場で上げ切る */
  private onVisibility = () => {
    if (document.hidden) this.pumpWarm()
    else this.schedulePump()
  }

  /**
   * タイトルに要らない 7 アニメを読み、全 128 枚を GPU に載せ終えるまで待つ。
   * 読んだだけでは GPU にはまだ無く、そのコマが初めて画面に出るときに
   * アップロードが走ってフレームが飛ぶ。ゲーム中にそれを起こさないため、
   * ここが解決するまで startGame は待つ。
   */
  private async loadRest(): Promise<void> {
    await this.ready
    await Promise.all(ANIMS.filter((a) => a !== 'IDLE').map((a) => this.loadAnim(a)))
    if (this.warmQueue.length) await new Promise<void>((res) => (this.warmResolve = res))
    this.warmed = true
  }

  /** 全アニメが GPU に載り終えているか。開始をゲートするので同期で見たい */
  get isWarm(): boolean {
    return this.warmed
  }

  private applyFrame() {
    const set = this.textures[this.anim.name]
    if (!set || !set[this.anim.frame]) return
    this.charMat.map = set[this.anim.frame]
    this.charMat.needsUpdate = true
    this.mirrorMat.map = set[this.anim.frame]
    this.mirrorMat.needsUpdate = true
  }

  play(name: AnimName, opts: { fps?: number; loop?: boolean } = {}) {
    if (!this.textures[name]) return
    this.anim = { name, fps: opts.fps ?? 24, loop: !!opts.loop, frame: 0, acc: 0 }
    this.applyFrame()
  }

  idle() {
    this.play('IDLE', { fps: 13, loop: true })
  }

  move(dir: Direction) {
    const map: Record<Direction, AnimName> = { LEFT: 'LEFT_STEP', RIGHT: 'RIGHT_STEP', UP: 'JUMP', DOWN: 'DOWN' }
    // スペシャル中は終わりかけを除いて割り込ませない
    if (this.anim.name.startsWith('SPECIAL') && this.anim.frame < 14) return
    this.play(map[dir], { fps: 26 })
    this.splash(0.7 + Math.random() * 0.3)
  }

  special(tier: SpecialTier) {
    this.play(`SPECIAL_${tier}` as AnimName, { fps: 22 })
    this.burstHearts(tier === 'A' ? 7 : tier === 'B' ? 10 : 14)
    this.splash(1.6)
    this.splash(2.4)
    if (tier === 'C') setTimeout(() => this.splash(3.2), 260)
  }

  splash(scale = 1) {
    this.spawnRipple(this.charGroup.position.x + (Math.random() - 0.5) * 0.5, 0.6, scale, 0.85)
  }

  setBPM(b: number) {
    this.bpm = b
  }

  setDancing(d: boolean) {
    this.dancing = d
    if (!d) this.idle()
  }

  setRain(v: number) {
    this.rainLevel = v
    this.rainMat.opacity = 0.12 + v * 0.25
  }

  private resetDrop(i: number, randomY: boolean) {
    // キャラ(z=0)より奥だけに降らせ、手前を横切らないようにする
    const x = (Math.random() - 0.5) * 24
    const z = -7 + Math.random() * 5.2
    const y = randomY ? Math.random() * 10 : 8 + Math.random() * 2
    const len = 0.22 + Math.random() * 0.22
    const o = i * 6
    this.dropPos[o] = x
    this.dropPos[o + 1] = y
    this.dropPos[o + 2] = z
    this.dropPos[o + 3] = x + 0.04
    this.dropPos[o + 4] = y + len
    this.dropPos[o + 5] = z
    this.dropVel[i] = 7.5 + Math.random() * 4
  }

  private spawnRipple(x: number, z: number, scale = 1, op = 0.5) {
    const r = this.ripples.find((v) => !v.mesh.visible)
    if (!r) return
    r.mesh.visible = true
    r.mesh.position.x = x
    r.mesh.position.z = z
    r.age = 0
    r.life = 0.9 + scale * 0.25
    r.max = 0.5 + scale * 0.9
    r.op = op
  }

  private burstHearts(n: number) {
    let c = 0
    for (const h of this.hearts) {
      if (h.sprite.visible) continue
      h.sprite.visible = true
      h.sprite.position.set(this.charGroup.position.x + (Math.random() - 0.5) * 1.6, 1 + Math.random() * 1.2, 0.6)
      const s = 0.3 + Math.random() * 0.3
      h.sprite.scale.set(s, s, 1)
      h.age = 0
      h.life = 1.1 + Math.random() * 0.5
      h.vx = (Math.random() - 0.5) * 1.6
      h.vy = 1.6 + Math.random() * 1.4
      h.vr = (Math.random() - 0.5) * 4
      if (++c >= n) break
    }
  }

  private resize() {
    const w = this.container.clientWidth || 800
    const h = this.container.clientHeight || 450
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private tick() {
    const now = performance.now() / 1000
    const dt = this.lastTime ? Math.min(now - this.lastTime, 0.05) : 0
    this.lastTime = now
    this.elapsed += dt
    const t = this.elapsed

    // sprite animation
    const a = this.anim
    a.acc += dt
    const step = 1 / a.fps
    while (a.acc >= step) {
      a.acc -= step
      a.frame++
      if (a.frame >= FRAMES) {
        if (a.loop) a.frame = 0
        else {
          this.idle()
          break
        }
      }
      this.applyFrame()
    }

    // beat bob
    if (this.dancing && this.bpm) {
      this.beatPh += ((dt * this.bpm) / 60) * Math.PI * 2
      const b = Math.abs(Math.sin(this.beatPh / 2))
      this.charGroup.scale.y = 1 - 0.035 * b
      this.charGroup.scale.x = 1 + 0.02 * b
    } else {
      this.charGroup.scale.set(1, 1, 1)
    }

    // rain — rainLevel に応じて使う粒の数を変え、余りは画面外へ退避させる
    const active = Math.floor(this.nDrops * Math.min(this.rainLevel / 2, 1))
    for (let i = 0; i < this.nDrops; i++) {
      const o = i * 6
      if (i >= active) {
        if (this.dropPos[o + 1] < 20) {
          this.dropPos[o + 1] = 40
          this.dropPos[o + 4] = 40
        }
        continue
      }
      const fall = this.dropVel[i] * dt
      this.dropPos[o + 1] -= fall
      this.dropPos[o + 4] -= fall
      this.dropPos[o] += dt * 0.35
      this.dropPos[o + 3] += dt * 0.35
      if (this.dropPos[o + 1] <= 0) {
        if (Math.random() < 0.06) {
          this.spawnRipple(this.dropPos[o], this.dropPos[o + 2], 0.25 + Math.random() * 0.3, 0.4)
        }
        this.resetDrop(i, false)
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true

    // random ambient ripples
    if (Math.random() < dt * (2 + this.rainLevel * 4)) {
      this.spawnRipple((Math.random() - 0.5) * 12, -5 + Math.random() * 9, 0.2 + Math.random() * 0.5, 0.35)
    }

    for (const r of this.ripples) {
      if (!r.mesh.visible) continue
      r.age += dt
      const p = r.age / r.life
      if (p >= 1) {
        r.mesh.visible = false
        continue
      }
      const s = 0.06 + p * r.max
      r.mesh.scale.set(s, s, 1)
      r.mat.opacity = (1 - p) * (1 - p) * r.op
    }

    for (const h of this.hearts) {
      if (!h.sprite.visible) continue
      h.age += dt
      const p = h.age / h.life
      if (p >= 1) {
        h.sprite.visible = false
        h.sprite.material.opacity = 0
        continue
      }
      h.vy -= dt * 1.4
      h.sprite.position.x += h.vx * dt
      h.sprite.position.y += h.vy * dt
      h.sprite.material.rotation += h.vr * dt
      h.sprite.material.opacity = p < 0.15 ? p / 0.15 : 1 - Math.max(0, (p - 0.6) / 0.4)
    }

    for (const b of this.bokeh) {
      b.sprite.position.y += Math.sin(t * b.sp + b.ph) * dt * 0.12
      b.sprite.material.opacity = 0.4 + 0.2 * Math.sin(t * 0.7 + b.ph)
    }

    this.renderer.render(this.scene, this.camera)
  }
}
