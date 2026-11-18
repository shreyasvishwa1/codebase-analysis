import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  EdgesGeometry,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import type { Building, BuildingTone, City } from '../utils/codeCity'

/** The code city drawn with three.js. Runs only in a browser with WebGL; the page shows a
 * message instead when that is missing or this fails. */

export interface CitySceneOptions {
  reducedMotion: boolean
  onHover: (building: Building | null, at: { x: number; y: number }) => void
  onSelect: (building: Building) => void
}

export interface CityScene {
  dispose: () => void
}

/** How many districts get a name label (the largest first), so small ones don't clutter. */
export const LABELLED_DISTRICTS = 8
/** Districts smaller than this stay unlabelled (their names would crowd the bigger ones). */
export const LABEL_MIN_FILES = 4

function channels(name: string): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const [r, g, b] = (value || '128 128 128').split(/\s+/).map(Number)
  return [r, g, b]
}
const css = (name: string) => {
  const [r, g, b] = channels(name)
  return new Color(r / 255, g / 255, b / 255)
}

function palette() {
  const light = document.documentElement.getAttribute('data-theme') === 'light'
  return {
    ground: light ? new Color(0x2f6a4c) : css('--slate-950'),
    plate: light ? new Color(0x3c7a5a) : css('--slate-900'),
    grid: light ? new Color(0x56966f) : css('--slate-800'),
    edge: css('--indigo-500'),
    tones: {
      good: css('--emerald-500'),
      moderate: css('--amber-500'),
      poor: css('--red-500'),
      unknown: css('--slate-500'),
    } satisfies Record<BuildingTone, Color>,
    highlight: css('--indigo-300'),
    beacon: css('--red-400'),
    label: light ? '#F2F8F4' : '#E1EEE6',
  }
}

function labelSprite(text: string, color: string, height: number): Sprite {
  const canvas = document.createElement('canvas')
  const fontSize = 48
  const context = canvas.getContext('2d')!
  const font = `600 ${fontSize}px "IBM Plex Mono", ui-monospace, Consolas, monospace`
  context.font = font
  const label = text.length > 28 ? `…${text.slice(-27)}` : text
  canvas.width = Math.ceil(context.measureText(label).width) + 24
  canvas.height = fontSize + 20
  context.font = font
  context.fillStyle = 'rgba(7,21,16,0.72)'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = color
  context.textBaseline = 'middle'
  context.fillText(label, 12, canvas.height / 2 + 2)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  // Drawn over the buildings, so a tall building never hides a district's name.
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthWrite: false, depthTest: false, transparent: true }))
  sprite.renderOrder = 10
  sprite.scale.set((canvas.width / canvas.height) * height, height, 1)
  return sprite
}

export async function createCityScene(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  city: City,
  options: CitySceneOptions,
): Promise<CityScene> {
  await document.fonts?.ready
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = SRGBColorSpace

  const scene = new Scene()
  const size = city.size
  const camera = new PerspectiveCamera(40, 1, 0.1, size * 12 + 100)
  camera.position.set(size * 0.55, size * 0.78, size * 0.78)

  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 0, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = 1.32
  controls.minDistance = Math.max(4, size * 0.25)
  controls.maxDistance = size * 2.6 + 10
  controls.autoRotate = !options.reducedMotion
  controls.autoRotateSpeed = 0.55
  const stopTour = () => {
    controls.autoRotate = false
  }
  controls.addEventListener('start', stopTour)

  const disposables: { dispose: () => void }[] = [renderer, controls]
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item)
    return item
  }
  let colors = palette()

  scene.add(new AmbientLight(0xffffff, 0.45))
  scene.add(new HemisphereLight(0xfff3d6, 0x0b2017, 0.6))
  const sun = new DirectionalLight(0xffffff, 1.4)
  sun.position.set(size * 0.6, size * 1.2, size * 0.4)
  scene.add(sun)

  // Ground: the board, with a faint grid of traces.
  const groundMaterial = keep(new MeshStandardMaterial({ color: colors.ground, roughness: 0.85 }))
  const ground = new Mesh(keep(new PlaneGeometry(size * 1.6 + 8, size * 1.6 + 8)), groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.02
  scene.add(ground)

  // Districts: raised plates with gold edges, the largest named.
  const plateMaterial = keep(new MeshStandardMaterial({ color: colors.plate, roughness: 0.7 }))
  const edgeMaterial = keep(new LineBasicMaterial({ color: colors.edge, transparent: true, opacity: 0.75 }))
  const labels: Sprite[] = []
  city.districts.forEach((district, index) => {
    const geometry = keep(new BoxGeometry(district.width, 0.12, district.depth))
    const plate = new Mesh(geometry, plateMaterial)
    plate.position.set(district.x, 0.06, district.z)
    scene.add(plate)
    const edges = new LineSegments(keep(new EdgesGeometry(geometry)), edgeMaterial)
    edges.position.copy(plate.position)
    scene.add(edges)
    if (index < LABELLED_DISTRICTS && district.files >= LABEL_MIN_FILES) {
      // Labels grow with the city so they stay readable from the default view.
      const label = labelSprite(district.id, colors.label, Math.max(0.5, size * 0.026))
      keep(label.material)
      keep(label.material.map!)
      label.position.set(district.x, 0.4 + Math.max(0.5, size * 0.026) / 2, district.z + district.depth / 2 + 0.3)
      scene.add(label)
      labels.push(label)
    }
  })

  // Buildings: one instanced mesh, coloured by maintainability.
  const boxGeometry = keep(new BoxGeometry(1, 1, 1))
  boxGeometry.translate(0, 0.5, 0) // grow up from the ground
  const buildingMaterial = keep(new MeshStandardMaterial({ roughness: 0.5, metalness: 0.15 }))
  const buildings = new InstancedMesh(boxGeometry, buildingMaterial, Math.max(1, city.buildings.length))
  buildings.count = city.buildings.length
  scene.add(buildings)
  const dummy = new Object3D()
  const toneColor = (building: Building) => colors.tones[building.tone]
  city.buildings.forEach((building, index) => buildings.setColorAt(index, toneColor(building)))
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true

  // Beacons: a red light on every building with high-complexity code.
  const beaconBuildings = city.buildings.map((building, index) => ({ building, index })).filter(({ building }) => building.beacon)
  const beaconMaterial = keep(new MeshBasicMaterial({ color: colors.beacon }))
  const beacons = new InstancedMesh(keep(new SphereGeometry(0.24, 12, 12)), beaconMaterial, Math.max(1, beaconBuildings.length))
  beacons.count = beaconBuildings.length
  scene.add(beacons)

  const begin = performance.now()
  const growFor = (index: number, t: number) => {
    if (options.reducedMotion) return 1
    const start = 0.15 + (index / Math.max(1, city.buildings.length)) * 1.1
    const p = Math.min(1, Math.max(0, (t - start) / 0.55))
    return 1 - (1 - p) ** 3
  }
  let grown = false
  const placeBuildings = (t: number) => {
    let done = true
    city.buildings.forEach((building, index) => {
      const grow = growFor(index, t)
      if (grow < 1) done = false
      dummy.position.set(building.x, 0.12, building.z)
      dummy.scale.set(0.86, Math.max(0.001, building.height * grow), 0.86)
      dummy.updateMatrix()
      buildings.setMatrixAt(index, dummy.matrix)
    })
    buildings.instanceMatrix.needsUpdate = true
    return done
  }
  const beaconMatrix = new Matrix4()
  const placeBeacons = (t: number) => {
    const pulse = options.reducedMotion ? 1 : 0.8 + Math.sin(t * 4) * 0.35
    beaconBuildings.forEach(({ building, index }, i) => {
      const grow = growFor(index, t)
      beaconMatrix.makeScale(pulse, pulse, pulse)
      beaconMatrix.setPosition(building.x, 0.12 + building.height * grow + 0.28, building.z)
      beacons.setMatrixAt(i, beaconMatrix)
    })
    beacons.instanceMatrix.needsUpdate = true
  }

  // Hover and click.
  const raycaster = new Raycaster()
  const pointer = new Vector2(2, 2)
  let screen = { x: 0, y: 0 }
  let hovered = -1
  let down = { x: 0, y: 0 }
  const onMove = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect()
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1)
    screen = { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const onLeave = () => pointer.set(2, 2)
  const onDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY }
  }
  const onUp = (event: PointerEvent) => {
    const moved = Math.abs(event.clientX - down.x) + Math.abs(event.clientY - down.y)
    if (moved < 6 && hovered >= 0) options.onSelect(city.buildings[hovered])
  }
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)

  const setHovered = (index: number) => {
    if (index === hovered) return
    if (hovered >= 0) buildings.setColorAt(hovered, toneColor(city.buildings[hovered]))
    hovered = index
    if (hovered >= 0) buildings.setColorAt(hovered, colors.highlight)
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true
    canvas.style.cursor = hovered >= 0 ? 'pointer' : 'grab'
    options.onHover(hovered >= 0 ? city.buildings[hovered] : null, screen)
  }

  // Size and theme.
  const resize = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const sizeObserver = new ResizeObserver(resize)
  sizeObserver.observe(host)
  resize()
  const onTheme = () => {
    colors = palette()
    groundMaterial.color.copy(colors.ground)
    plateMaterial.color.copy(colors.plate)
    edgeMaterial.color.copy(colors.edge)
    beaconMaterial.color.copy(colors.beacon)
    city.buildings.forEach((building, index) =>
      buildings.setColorAt(index, index === hovered ? colors.highlight : toneColor(building)),
    )
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true
  }
  window.addEventListener('cba-theme-change', onTheme)

  // Render while visible.
  let visible = true
  let frame = 0
  let running = false
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    start()
  })
  visibility.observe(host)
  const onVisibility = () => start()
  document.addEventListener('visibilitychange', onVisibility)

  function tick(now: number) {
    running = false
    const t = (now - begin) / 1000
    if (!grown) grown = placeBuildings(t)
    placeBeacons(t)
    controls.update()
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(buildings, false)[0]
    setHovered(hit?.instanceId ?? -1)
    if (hovered >= 0) options.onHover(city.buildings[hovered], screen)
    renderer.render(scene, camera)
    start()
  }
  function start() {
    if (running || !visible || document.hidden) return
    running = true
    frame = requestAnimationFrame(tick)
  }
  canvas.style.cursor = 'grab'
  start()

  return {
    dispose() {
      cancelAnimationFrame(frame)
      running = true // no further frames
      sizeObserver.disconnect()
      visibility.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('cba-theme-change', onTheme)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      controls.removeEventListener('start', stopTour)
      buildings.dispose()
      beacons.dispose()
      for (const item of disposables) item.dispose()
    },
  }
}
