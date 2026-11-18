import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  type Object3D,
  type Texture,
} from 'three'

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HEALTH,
  INPUTS,
  OUTPUTS,
  VIAS,
  pointAlong,
  polylineLength,
  tracePoints,
  type ChipSpec,
} from './circuitLayout'

/** The three.js board on the intro page. Everything here runs only in a browser with WebGL;
 * the page shows the flat SVG board until this has loaded, and instead of it if it fails. */

const SCALE = 1 / 40 // layout units to scene units
const toX = (x: number) => (x - BOARD_WIDTH / 2) * SCALE
const toZ = (y: number) => (y - BOARD_HEIGHT / 2) * SCALE
const TRACE_TILE =
  'M0 40h70l20 20h60l20-20h70M200 0v100l-20 20v20l20 20v80M0 190h50l20-20h46M120 0v11M120 240v-25l15-15h21M30 100h40l20 20v30'

export interface BoardSceneOptions {
  reducedMotion: boolean
  onHover: (chip: ChipSpec | null) => void
  onSelect: (chip: ChipSpec) => void
}

export interface BoardScene {
  dispose: () => void
}

interface Palette {
  board: Color
  boardPattern: string
  chip: Color
  gold: Color
  goldBright: Color
  trace: Color
  label: string
  labelMuted: string
}

function channel(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '0 0 0'
}
function cssColor(name: string): Color {
  const [r, g, b] = channel(name).split(/\s+/).map(Number)
  return new Color(r / 255, g / 255, b / 255)
}

function readPalette(): Palette {
  const light = document.documentElement.getAttribute('data-theme') === 'light'
  return {
    // Light theme: a classic green solder-mask board, which stands out on the cream page.
    board: light ? new Color(0x2f6a4c) : cssColor('--slate-900'),
    boardPattern: light ? 'rgb(86,150,116)' : `rgb(${channel('--slate-700').split(/\s+/).join(',')})`,
    chip: new Color(light ? 0x15241c : 0x060d0a),
    gold: cssColor('--indigo-500'),
    goldBright: cssColor(light ? '--indigo-500' : '--indigo-300'),
    trace: light ? cssColor('--indigo-500') : cssColor('--indigo-700'),
    label: '#E8F2EC',
    labelMuted: '#7FA593',
  }
}

/** A canvas texture with the faint board traces printed on it. */
function boardTexture(palette: Palette): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1560
  canvas.height = 1035
  const context = canvas.getContext('2d')!
  context.strokeStyle = palette.boardPattern
  context.globalAlpha = 0.55
  context.lineWidth = 2
  const tile = new Path2D(TRACE_TILE)
  for (let x = 0; x < canvas.width; x += 240) {
    for (let y = 0; y < canvas.height; y += 240) {
      context.save()
      context.translate(x, y)
      context.stroke(tile)
      context.restore()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** The printing on top of a chip: its name and its reference designator. */
function labelTexture(chip: ChipSpec, palette: Palette, center: boolean): CanvasTexture {
  const ratio = chip.width / chip.height
  const canvas = document.createElement('canvas')
  canvas.height = center ? 512 : 128
  canvas.width = Math.round(canvas.height * ratio)
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgba(0,0,0,0)'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const mono = '"IBM Plex Mono", ui-monospace, Consolas, monospace'
  if (center) {
    context.fillStyle = `#${palette.goldBright.getHexString()}`
    context.font = `600 ${canvas.height * 0.16}px ${mono}`
    context.textAlign = 'center'
    context.fillText('HEALTH', canvas.width / 2, canvas.height * 0.5)
    context.fillStyle = palette.labelMuted
    context.font = `500 ${canvas.height * 0.08}px ${mono}`
    context.fillText('SCORE 0-100', canvas.width / 2, canvas.height * 0.66)
  } else {
    context.fillStyle = palette.label
    context.font = `600 ${canvas.height * 0.3}px ${mono}`
    context.fillText(chip.label, canvas.height * 0.3, canvas.height * 0.6)
  }
  context.fillStyle = palette.labelMuted
  context.font = `500 ${canvas.height * (center ? 0.07 : 0.2)}px ${mono}`
  context.textAlign = 'right'
  context.fillText(chip.ref, canvas.width - canvas.height * 0.12, canvas.height * 0.9)
  // Pin-1 dot.
  context.beginPath()
  context.arc(canvas.height * 0.16, canvas.height * 0.18, canvas.height * (center ? 0.025 : 0.06), 0, Math.PI * 2)
  context.fill()
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** A soft round glow for the current pulses. */
function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,240,200,1)')
  gradient.addColorStop(0.25, 'rgba(240,190,90,0.7)')
  gradient.addColorStop(1, 'rgba(240,190,90,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return new CanvasTexture(canvas)
}

const easeOutBack = (t: number) => {
  const c = 1.4
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2
}

export async function createBoardScene(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  options: BoardSceneOptions,
): Promise<BoardScene> {
  // Chip labels use the page font; wait for it so the printing is right first time.
  await document.fonts?.ready

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = SRGBColorSpace

  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 1, 0.1, 100)

  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  let palette = readPalette()
  const rig = new Group() // tilted by the pointer and drags
  scene.add(rig)

  // Lights: soft fill, a key light for the chip edges, and a gold glow from the health chip.
  scene.add(new AmbientLight(0xffffff, 0.42))
  const key = new DirectionalLight(0xffffff, 1.15)
  key.position.set(-4, 10, 6)
  scene.add(key)
  const glow = new PointLight(palette.gold, 4, 7, 1.8)
  glow.position.set(toX(HEALTH.x + HEALTH.width / 2), 2.4, toZ(HEALTH.y + HEALTH.height / 2) + 1.2)
  rig.add(glow)

  // The board.
  const boardMaterial = track(new MeshStandardMaterial({ color: palette.board, roughness: 0.75, metalness: 0.08 }))
  const patternTexture = track(boardTexture(palette))
  const patternMaterial = track(new MeshBasicMaterial({ map: patternTexture, transparent: true, depthWrite: false }))
  const boardWidth = (BOARD_WIDTH + 20) * SCALE
  const boardDepth = (BOARD_HEIGHT + 20) * SCALE
  const board = new Mesh(track(new BoxGeometry(boardWidth, 0.22, boardDepth)), boardMaterial)
  board.position.y = -0.11
  rig.add(board)
  const pattern = new Mesh(track(new PlaneGeometry(boardWidth, boardDepth)), patternMaterial)
  pattern.rotation.x = -Math.PI / 2
  pattern.position.y = 0.002
  rig.add(pattern)

  const goldMaterial = track(new MeshStandardMaterial({ color: palette.gold, metalness: 0.85, roughness: 0.3 }))
  const traceMaterial = track(
    new MeshStandardMaterial({ color: palette.trace, metalness: 0.7, roughness: 0.35, transparent: true, opacity: options.reducedMotion ? 1 : 0 }),
  )
  const darkMaterial = track(new MeshBasicMaterial({ color: palette.board }))

  // Mounting holes in the corners.
  const holeGeometry = track(new CylinderGeometry(0.16, 0.16, 0.03, 24))
  const holeInner = track(new CylinderGeometry(0.09, 0.09, 0.035, 16))
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const ring = new Mesh(holeGeometry, goldMaterial)
    ring.position.set(sx * (boardWidth / 2 - 0.3), 0.01, sz * (boardDepth / 2 - 0.3))
    const hole = new Mesh(holeInner, darkMaterial)
    hole.position.copy(ring.position)
    hole.position.y = 0.015
    rig.add(ring, hole)
  }

  // Traces: flat copper strips along each path, with a pad at every bend.
  const allChips = [...INPUTS, ...OUTPUTS]
  const paths = allChips.map((chip) => tracePoints(chip.trace!))
  const padGeometry = track(new CylinderGeometry(0.045, 0.045, 0.02, 12))
  for (const points of paths) {
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1]
      const [bx, by] = points[i]
      const length = Math.hypot(bx - ax, by - ay) * SCALE
      const strip = new Mesh(track(new BoxGeometry(length, 0.018, 0.075)), traceMaterial)
      strip.position.set(toX((ax + bx) / 2), 0.01, toZ((ay + by) / 2))
      strip.rotation.y = -Math.atan2(by - ay, bx - ax)
      rig.add(strip)
      const pad = new Mesh(padGeometry, traceMaterial)
      pad.position.set(toX(bx), 0.01, toZ(by))
      rig.add(pad)
    }
  }
  const viaGeometry = track(new CylinderGeometry(0.1, 0.1, 0.03, 20))
  for (const [x, y] of VIAS) {
    const via = new Mesh(viaGeometry, goldMaterial)
    via.position.set(toX(x), 0.016, toZ(y))
    const hole = new Mesh(holeInner, darkMaterial)
    hole.scale.setScalar(0.5)
    hole.position.set(toX(x), 0.02, toZ(y))
    rig.add(via, hole)
  }

  // Chips: a body, gold pins and a printed top. Each sits in a group that drops in on boot
  // and lifts when hovered.
  const chipMaterial = track(new MeshStandardMaterial({ color: palette.chip, roughness: 0.45, metalness: 0.2 }))
  const pinGeometry = track(new BoxGeometry(0.06, 0.06, 0.22))
  const chips: { spec: ChipSpec; group: Group; body: Mesh; lift: number; delay: number }[] = []
  ;[...INPUTS, HEALTH, ...OUTPUTS].forEach((spec, index) => {
    const center = spec === HEALTH
    const width = spec.width * SCALE
    const depth = spec.height * SCALE
    const height = center ? 0.42 : 0.3
    const group = new Group()
    group.position.set(toX(spec.x + spec.width / 2), 0, toZ(spec.y + spec.height / 2))
    const body = new Mesh(track(new BoxGeometry(width, height, depth)), chipMaterial)
    body.position.y = height / 2 + 0.03
    body.userData.chip = spec
    group.add(body)
    const top = new Mesh(
      track(new PlaneGeometry(width * 0.96, depth * 0.92)),
      track(new MeshBasicMaterial({ map: track(labelTexture(spec, palette, center)), transparent: true })),
    )
    top.rotation.x = -Math.PI / 2
    top.position.y = height + 0.032
    group.add(top)
    const pins = Math.max(3, Math.round(spec.width / 22))
    for (let p = 0; p < pins; p += 1) {
      const x = -width / 2 + (width * (p + 0.5)) / pins
      for (const side of [-1, 1]) {
        const pin = new Mesh(pinGeometry, goldMaterial)
        pin.position.set(x, 0.06, side * (depth / 2 + 0.08))
        group.add(pin)
      }
    }
    if (center) {
      const rim = new Mesh(
        track(new BoxGeometry(width + 0.08, 0.04, depth + 0.08)),
        track(new MeshBasicMaterial({ color: palette.gold })),
      )
      rim.position.y = 0.02
      group.add(rim)
    }
    rig.add(group)
    chips.push({ spec, group, body, lift: 0, delay: center ? 0.15 : 0.3 + index * 0.09 })
  })

  // Current: a bright bead with a glow on every trace, flowing toward (and out of) the health chip.
  const beadGeometry = track(new SphereGeometry(0.055, 12, 12))
  const beadMaterial = track(new MeshBasicMaterial({ color: palette.goldBright }))
  const glowMap = track(glowTexture()) as Texture
  const spriteMaterial = track(new SpriteMaterial({ map: glowMap, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }))
  const pulses = paths.flatMap((points, index) =>
    [0, 0.5].map((offset) => {
      const bead = new Mesh(beadGeometry, beadMaterial)
      const halo = new Sprite(spriteMaterial)
      halo.scale.setScalar(0.3)
      bead.add(halo)
      bead.visible = false
      rig.add(bead)
      return { bead, points, length: polylineLength(points), offset: offset + index * 0.13 }
    }),
  )

  // Pointer: tilt toward it, drag to turn the board, hover and click chips.
  const pointer = new Vector2(0, 0)
  const ndc = new Vector2(2, 2)
  const raycaster = new Raycaster()
  let dragging = false
  let dragStart = { x: 0, yaw: 0, pitch: 0, y: 0 }
  let yaw = 0
  let pitch = 0
  let moved = 0
  let hovered: (typeof chips)[number] | null = null

  const onPointerMove = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect()
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, ((event.clientY - box.top) / box.height) * 2 - 1)
    ndc.set(pointer.x, -pointer.y)
    if (dragging) {
      moved += Math.abs(event.movementX) + Math.abs(event.movementY)
      yaw = Math.max(-0.9, Math.min(0.9, dragStart.yaw + ((event.clientX - dragStart.x) / box.width) * 2.2))
      pitch = Math.max(-0.35, Math.min(0.5, dragStart.pitch + ((event.clientY - dragStart.y) / box.height) * 1.2))
    }
  }
  const onPointerDown = (event: PointerEvent) => {
    dragging = true
    moved = 0
    dragStart = { x: event.clientX, y: event.clientY, yaw, pitch }
    try {
      canvas.setPointerCapture(event.pointerId) // keep turning while dragged outside the canvas
    } catch {
      // A pointer the browser no longer tracks: the drag still works inside the canvas.
    }
  }
  const onPointerUp = (event: PointerEvent) => {
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    if (moved < 6 && hovered) options.onSelect(hovered.spec)
  }
  const onPointerLeave = () => {
    pointer.set(0, 0)
    ndc.set(2, 2)
  }
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)

  // Size follows the host element.
  const resize = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // Narrow screens: step back so the whole board stays in view.
    const distance = Math.max(1, 1.5 / camera.aspect)
    camera.position.set(0, 15.8 * distance, 13.2 * distance)
    camera.lookAt(0, -0.9, -0.5)
    camera.updateProjectionMatrix()
  }
  const sizeObserver = new ResizeObserver(resize)
  sizeObserver.observe(host)
  resize()

  // Theme changes recolour the materials.
  const onTheme = () => {
    palette = readPalette()
    boardMaterial.color.copy(palette.board)
    darkMaterial.color.copy(palette.board)
    chipMaterial.color.copy(palette.chip)
    goldMaterial.color.copy(palette.gold)
    traceMaterial.color.copy(palette.trace)
    beadMaterial.color.copy(palette.goldBright)
    glow.color.copy(palette.gold)
    const next = boardTexture(palette)
    patternMaterial.map?.dispose()
    patternMaterial.map = next
    patternMaterial.needsUpdate = true
    disposables.push(next)
  }
  window.addEventListener('cba-theme-change', onTheme)

  // Render only while visible.
  let visible = true
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) start()
  })
  visibility.observe(host)
  const onVisibility = () => {
    if (!document.hidden) start()
  }
  document.addEventListener('visibilitychange', onVisibility)

  const begin = performance.now()
  let frame = 0
  let running = false
  let last = begin

  function tick(now: number) {
    running = false
    const t = (now - begin) / 1000
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const motion = !options.reducedMotion

    // Boot: chips drop onto the board, then the copper appears, then the current flows.
    let settled = true
    for (const chip of chips) {
      const progress = motion ? Math.min(1, Math.max(0, (t - chip.delay) / 0.55)) : 1
      if (progress < 1) settled = false
      const drop = (1 - easeOutBack(progress)) * 2.4
      chip.group.visible = progress > 0
      const target = hovered === chip ? 0.32 : 0
      chip.lift += (target - chip.lift) * Math.min(1, dt * 12)
      chip.group.position.y = drop + chip.lift
    }
    traceMaterial.opacity = motion ? Math.min(1, Math.max(0, (t - 1.0) / 0.5)) : 1
    const flowing = !motion || t > 1.4
    for (const pulse of pulses) {
      pulse.bead.visible = flowing
      if (!flowing) continue
      const phase = motion ? (((t - 1.4) * 0.32 + pulse.offset) % 1) : pulse.offset % 1
      const [x, y] = pointAlong(pulse.points, phase * pulse.length)
      pulse.bead.position.set(toX(x), 0.07, toZ(y))
    }
    glow.intensity = motion ? 4 + Math.sin(t * 2.2) * 1.4 : 4

    // Pointer tilt, drag turn and a slow idle sway, eased.
    const sway = motion ? Math.sin(t * 0.35) * 0.06 : 0
    const targetYaw = yaw + (dragging ? 0 : pointer.x * 0.16) + sway
    const targetPitch = pitch + (dragging ? 0 : pointer.y * 0.08)
    if (!dragging) {
      yaw *= 1 - Math.min(1, dt * 0.8)
      pitch *= 1 - Math.min(1, dt * 0.8)
    }
    rig.rotation.y += (targetYaw - rig.rotation.y) * Math.min(1, dt * 5)
    rig.rotation.x += (targetPitch - rig.rotation.x) * Math.min(1, dt * 5)

    // Hover: the chip under the pointer lifts and is named below the board.
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObjects(chips.map((chip) => chip.body as Object3D), false)[0]
    const next = hit ? chips.find((chip) => chip.body === hit.object) ?? null : null
    if (next !== hovered) {
      hovered = next
      canvas.style.cursor = hovered ? 'pointer' : 'grab'
      options.onHover(hovered?.spec ?? null)
    }

    renderer.render(scene, camera)
    const busy = motion || !settled || Math.abs(targetYaw - rig.rotation.y) > 0.001 || hovered !== null
    if (busy) start()
  }

  function start() {
    if (running || !visible || document.hidden) return
    running = true
    frame = requestAnimationFrame(tick)
  }
  canvas.style.cursor = 'grab'
  canvas.addEventListener('pointermove', start)
  start()

  return {
    dispose() {
      cancelAnimationFrame(frame)
      running = true // stop any further frames
      sizeObserver.disconnect()
      visibility.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('cba-theme-change', onTheme)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointermove', start)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      for (const item of disposables) item.dispose()
      renderer.dispose()
    },
  }
}
