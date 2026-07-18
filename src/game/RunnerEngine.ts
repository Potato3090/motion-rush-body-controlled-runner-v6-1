import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { GameSnapshot, GameStatus, RunnerAction, RunnerLane } from './types'
import {
  JUMP_CLEARANCE_HEIGHT,
  LANDING_TOTAL_DURATION,
  TAKEOFF_POSE_DURATION,
  createGroundedJumpMotion,
  getJumpPhase,
  getLandingCompression,
  stepJumpMotion,
  tryStartJump,
  type JumpPhase,
} from './jumpMotion'
import {
  areRoofHeightsCompatible,
  getRouteSurfaceHeight,
  isSafelyAboveTrainRoof,
  resolveSurfaceTransition,
  ROUTE_RAMP_LENGTH,
  ROUTE_ROOF_HEIGHT,
  type SurfaceTransitionInput,
  type SurfaceTransitionKind,
  type SurfaceTransitionResult,
} from './runnerRouteModel'

type HazardKind = 'block' | 'jump' | 'slide'

interface Hazard {
  group: THREE.Group
  visual: THREE.Mesh
  kind: HazardKind
  lane: number
  hit: boolean
  variant: number
}

interface Coin {
  mesh: THREE.Group
  lane: number
  collected: boolean
  baseY: number
  route?: RoofRoute
  localZ?: number
}

interface RoofRoute {
  group: THREE.Group
  lane: number
  theme: number
}

interface CoinBurst {
  group: THREE.Group
  velocities: THREE.Vector3[]
  age: number
}

interface ElevatedTransferSupport {
  active: boolean
  sourceLane: RunnerLane
  destinationLane: RunnerLane
  sourceSurface: number
  destinationSurface: number
  intermediateSurface: number
  startedDistance: number
}

interface RunnerEngineOptions {
  onSnapshot: (snapshot: GameSnapshot) => void
  onCrash: (snapshot: GameSnapshot) => void
  onCoin: () => void
}

const LANES = [-3.15, 0, 3.15]
const TRACK_LENGTH = 18
const TRACK_SEGMENTS = 18
const PLAYER_Z = 5.5
const START_SPEED = 19
const MAX_SPEED = 35
const TRAIN_ROOF_HEIGHT = ROUTE_ROOF_HEIGHT
const OBSTACLE_TRAIN_ROOF_HEIGHT = 3
const OBSTACLE_TRAIN_LENGTH = 6.1
const RAMP_LENGTH = ROUTE_RAMP_LENGTH
const ROUTE_UP_FRONT = 19
const ROUTE_UP_BACK = ROUTE_UP_FRONT - RAMP_LENGTH
const ROUTE_ROOF_BACK = -19
const ROUTE_DOWN_BACK = ROUTE_ROOF_BACK - RAMP_LENGTH
const CAMERA_GROUND_Y = 7.45
const CAMERA_Z = 14.15
const CAMERA_LOOK_Z = -16.5
const OVERHEAD_WIRE_HEIGHT = 11.55
const OVERHEAD_GANTRY_HEIGHT = 11.85
const BRIDGE_DECK_HEIGHT = 13.65
const ELEVATED_TRANSFER_MAX_DISTANCE = 12

const palette = {
  ink: 0x132543,
  purple: 0x6c48e8,
  violet: 0xa886ff,
  cyan: 0x22d3c5,
  blue: 0x168fea,
  sky: 0x63caff,
  yellow: 0xffcc35,
  coral: 0xff625c,
  orange: 0xff8a3d,
  cream: 0xfff5da,
  road: 0x5f6170,
  ballast: 0x9b917f,
  rail: 0xd7d9df,
  sleeper: 0x5a4439,
  grass: 0x55b86a,
}

const trainThemes = [
  { primary: 0xffc928, secondary: 0x168fea, trim: 0xf8fbff },
  { primary: 0x744dde, secondary: 0xf7f3ff, trim: 0x24cfbf },
  { primary: 0xff873b, secondary: 0x10a99f, trim: 0xfff2d8 },
  { primary: 0xe84c4f, secondary: 0xfff0cf, trim: 0x2454a6 },
] as const

interface ColoredGeometryPart {
  geometry: THREE.BufferGeometry
  color: number
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

const identityPosition: [number, number, number] = [0, 0, 0]
const identityRotation: [number, number, number] = [0, 0, 0]
const identityScale: [number, number, number] = [1, 1, 1]

function mergeColoredParts(parts: ColoredGeometryPart[]) {
  const transformed = parts.map((part) => {
    let geometry = part.geometry
    if (geometry.index) {
      const indexedGeometry = geometry
      geometry = indexedGeometry.toNonIndexed()
      indexedGeometry.dispose()
    }
    const position = new THREE.Vector3(...(part.position ?? identityPosition))
    const rotation = new THREE.Euler(...(part.rotation ?? identityRotation))
    const scale = new THREE.Vector3(...(part.scale ?? identityScale))
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromEuler(rotation),
      scale,
    ))
    const color = new THREE.Color(part.color)
    const colors = new Float32Array(geometry.attributes.position.count * 3)
    for (let index = 0; index < colors.length; index += 3) {
      colors[index] = color.r
      colors[index + 1] = color.g
      colors[index + 2] = color.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geometry
  })
  const merged = mergeGeometries(transformed, false)
  transformed.forEach((geometry) => geometry.dispose())
  if (!merged) throw new Error('Unable to merge Motion Rush geometry')
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function material(color: number, roughness = 0.72, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function mesh(
  geometry: THREE.BufferGeometry,
  color: number,
  roughness?: number,
  metalness?: number,
) {
  const item = new THREE.Mesh(geometry, material(color, roughness, metalness))
  item.castShadow = false
  item.receiveShadow = false
  return item
}

function flatMaterial(color: number, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    side: THREE.DoubleSide,
  })
}

function createBoltShape(scale = 1) {
  const shape = new THREE.Shape()
  shape.moveTo(-0.12 * scale, 0.52 * scale)
  shape.lineTo(0.25 * scale, 0.52 * scale)
  shape.lineTo(0.04 * scale, 0.1 * scale)
  shape.lineTo(0.34 * scale, 0.1 * scale)
  shape.lineTo(-0.26 * scale, -0.58 * scale)
  shape.lineTo(-0.08 * scale, -0.12 * scale)
  shape.lineTo(-0.35 * scale, -0.12 * scale)
  shape.closePath()
  return shape
}

export class RunnerEngine {
  private readonly container: HTMLElement
  private readonly options: RunnerEngineOptions
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500)
  private readonly clock = new THREE.Clock()
  private readonly cityMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.1,
  })
  private readonly trainGeometryCache = new Map<string, THREE.BufferGeometry>()
  private readonly hazardGeometryCache = new Map<string, THREE.BufferGeometry>()
  private readonly trackZs = new Float32Array(TRACK_SEGMENTS)
  private trackInstances?: THREE.InstancedMesh
  private overheadInstances?: THREE.InstancedMesh
  private coinInstances?: THREE.InstancedMesh
  private readonly instanceTransform = new THREE.Object3D()
  private readonly scenery: THREE.Group[] = []
  private readonly hazards: Hazard[] = []
  private readonly coins: Coin[] = []
  private readonly roofRoutes: RoofRoute[] = []
  private readonly coinBursts: CoinBurst[] = []
  private readonly player = new THREE.Group()
  private playerShadow?: THREE.Mesh
  private landingRing?: THREE.Mesh
  private readonly playerParts: {
    leftArm?: THREE.Object3D
    rightArm?: THREE.Object3D
    leftLeg?: THREE.Object3D
    rightLeg?: THREE.Object3D
    torso?: THREE.Object3D
    leftShoe?: THREE.Object3D
    rightShoe?: THREE.Object3D
  } = {}

  private animationFrame = 0
  private status: GameStatus = 'menu'
  private laneIndex: RunnerLane = 1
  private targetX = 0
  private jumpMotion = createGroundedJumpMotion()
  private landingElapsed = LANDING_TOTAL_DURATION
  private fallbackSlideTimer = 0
  private cameraCrouching = false
  private manualCrouching = false
  private elapsed = 0
  private distance = 0
  private coinCount = 0
  private score = 0
  private speed = START_SPEED
  private snapshotTimer = 0
  private destroyed = false
  private lastHazardLane = 1
  private lastHazardKind: HazardKind = 'jump'
  private supportLaneIndex: RunnerLane = 1
  private surfaceTransitionKind: SurfaceTransitionKind = 'same-lane'
  private readonly surfaceTransitionInput: SurfaceTransitionInput = {
    sourceLane: 1,
    destinationLane: 1,
    sourceSurface: 0,
    destinationSurface: 0,
    progress: 1,
  }
  private readonly surfaceTransitionResult: SurfaceTransitionResult = {
    height: 0,
    kind: 'same-lane',
    destinationSupported: true,
  }
  private readonly elevatedTransfer: ElevatedTransferSupport = {
    active: false,
    sourceLane: 1,
    destinationLane: 1,
    sourceSurface: 0,
    destinationSurface: 0,
    intermediateSurface: 0,
    startedDistance: 0,
  }
  private surfaceHeight = 0
  private previousSurfaceHeight = 0
  private cameraLookHeight = 1.9
  private cameraLookX = 0
  private burstCursor = 0
  private landingEffectAge = 1
  private readonly profiling = new URLSearchParams(window.location.search).has('profile')
  private readonly roofTestMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('roofTest')
  private profileElapsed = 0
  private profileStateElapsed = 0
  private profileFrames = 0
  private readonly profileFrameTimes: number[] = []

  constructor(container: HTMLElement, options: RunnerEngineOptions) {
    this.container = container
    this.options = options
    const mobileViewport = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) <= 768
    const highDensityMobile = mobileViewport && window.devicePixelRatio > 1.4
    this.renderer = new THREE.WebGLRenderer({
      antialias: !highDensityMobile,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobileViewport ? 1.25 : 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.18
    this.renderer.domElement.setAttribute('aria-label', 'Motion Rush game world')
    this.renderer.domElement.setAttribute('role', 'img')
    this.container.appendChild(this.renderer.domElement)

    this.createScene()
    this.resize()
    window.addEventListener('resize', this.resize)
    this.clock.start()
    this.animate()
  }

  setStatus(status: GameStatus) {
    this.status = status
    if (status === 'menu') {
      this.cameraCrouching = false
      this.manualCrouching = false
      this.fallbackSlideTimer = 0
      this.surfaceHeight = 0
      this.previousSurfaceHeight = 0
      this.cameraLookHeight = 1.9
      this.cameraLookX = 0
      this.supportLaneIndex = 1
      this.surfaceTransitionKind = 'same-lane'
      this.elevatedTransfer.active = false
      this.camera.position.x = 0
      this.camera.position.y = CAMERA_GROUND_Y
      this.camera.position.z = CAMERA_Z
      this.camera.lookAt(0, this.cameraLookHeight, CAMERA_LOOK_Z)
    }
    if (status === 'playing') this.clock.getDelta()
  }

  start() {
    this.distance = 0
    this.coinCount = 0
    this.score = 0
    this.speed = START_SPEED
    this.elapsed = 0
    this.laneIndex = 1
    this.targetX = 0
    this.supportLaneIndex = 1
    this.surfaceTransitionKind = 'same-lane'
    this.elevatedTransfer.active = false
    this.jumpMotion = createGroundedJumpMotion()
    this.landingElapsed = LANDING_TOTAL_DURATION
    this.fallbackSlideTimer = 0
    this.cameraCrouching = false
    this.manualCrouching = false
    this.player.position.set(0, 0, PLAYER_Z)
    this.player.scale.set(1, 1, 1)
    this.player.rotation.set(0, 0, 0)
    this.surfaceHeight = 0
    this.previousSurfaceHeight = 0
    this.cameraLookHeight = 1.9
    this.cameraLookX = 0
    this.camera.position.set(0, CAMERA_GROUND_Y, CAMERA_Z)
    this.camera.lookAt(0, this.cameraLookHeight, CAMERA_LOOK_Z)
    this.landingEffectAge = 1
    this.resetWorldObjects()
    this.emitSnapshot()
  }

  action(action: RunnerAction) {
    if (this.status !== 'playing') return

    if (action === 'left') {
      this.setLaneTarget(Math.max(0, this.laneIndex - 1) as RunnerLane)
      return
    }
    if (action === 'right') {
      this.setLaneTarget(Math.min(2, this.laneIndex + 1) as RunnerLane)
      return
    }
    if (action === 'jump' && !this.isCrouching()) {
      const jumpRequest = tryStartJump(this.jumpMotion)
      this.jumpMotion = jumpRequest.state
      if (jumpRequest.started) this.landingElapsed = LANDING_TOTAL_DURATION
      return
    }
    if (action === 'slide' && !this.jumpMotion.airborne) {
      this.fallbackSlideTimer = 0.72
    }
  }

  /** Camera input sets an absolute destination and may replace it mid-transition. */
  setTargetLane(lane: RunnerLane) {
    if (this.status !== 'playing' && this.status !== 'countdown') return
    this.setLaneTarget(lane)
  }

  private setLaneTarget(lane: RunnerLane) {
    if (lane === this.laneIndex) return
    const sourceLane = this.supportLaneIndex
    const actualSourceSurface = this.getSupportSurfaceAtWorldZ(sourceLane, PLAYER_Z)
    const sourceSurface = Math.max(
      actualSourceSurface,
      this.elevatedTransfer.active ? this.surfaceHeight : 0,
    )
    const destinationSurface = this.getSupportSurfaceAtWorldZ(lane, PLAYER_Z)
    const intermediateSurface = Math.abs(sourceLane - lane) === 2
      ? this.getSupportSurfaceAtWorldZ(1, PLAYER_Z)
      : 0
    const adjacentRoof = Math.abs(sourceLane - lane) === 1 &&
      areRoofHeightsCompatible(sourceSurface, destinationSurface)
    const supportedTwoLanePath = Math.abs(sourceLane - lane) === 2 &&
      areRoofHeightsCompatible(sourceSurface, intermediateSurface) &&
      areRoofHeightsCompatible(intermediateSurface, destinationSurface)

    this.elevatedTransfer.active = adjacentRoof || supportedTwoLanePath
    if (this.elevatedTransfer.active) {
      this.elevatedTransfer.sourceLane = sourceLane
      this.elevatedTransfer.destinationLane = lane
      this.elevatedTransfer.sourceSurface = sourceSurface
      this.elevatedTransfer.destinationSurface = destinationSurface
      this.elevatedTransfer.intermediateSurface = intermediateSurface
      this.elevatedTransfer.startedDistance = this.distance
      if (this.profiling) {
        this.renderer.domElement.dataset.lastElevatedTransfer =
          `${sourceLane}->${lane}@${this.distance.toFixed(2)}`
      }
    }
    this.laneIndex = lane
    this.targetX = LANES[lane]
  }

  /** Camera crouching is a held state. There is intentionally no timeout. */
  setCameraCrouching(crouching: boolean) {
    if (this.status !== 'playing' && this.status !== 'countdown') return
    this.cameraCrouching = crouching
  }

  /** Pointer/keyboard hold support; swipe-down still uses the timed fallback. */
  setManualCrouching(crouching: boolean) {
    if (this.status !== 'playing') {
      this.manualCrouching = false
      return
    }
    this.manualCrouching = crouching
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.animationFrame)
    window.removeEventListener('resize', this.resize)
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose())
        else object.material.dispose()
      }
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private createScene() {
    this.scene.background = new THREE.Color(palette.sky)
    this.scene.fog = new THREE.Fog(0xb4e8ff, 92, 300)

    const hemisphere = new THREE.HemisphereLight(0xeafaff, 0x6c7764, 2.75)
    this.scene.add(hemisphere)

    const sun = new THREE.DirectionalLight(0xfff0c5, 3.35)
    sun.position.set(-16, 24, 18)
    sun.castShadow = true
    sun.shadow.mapSize.set(512, 512)
    sun.shadow.camera.left = -10
    sun.shadow.camera.right = 10
    sun.shadow.camera.top = 16
    sun.shadow.camera.bottom = -5
    sun.shadow.camera.near = 2
    sun.shadow.camera.far = 48
    sun.shadow.bias = -0.00018
    this.scene.add(sun)

    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(6.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false }),
    )
    sunDisc.position.set(-24, 22, -150)
    this.scene.add(sunDisc)

    this.createSkyline()

    this.camera.position.set(0, CAMERA_GROUND_Y, CAMERA_Z)
    this.camera.lookAt(0, 1.9, CAMERA_LOOK_Z)

    this.createTrackSystem()
    for (let i = 0; i < 24; i += 1) this.createScenery(i)

    const firstRoute = this.createRoofRoute(1, 0)
    const secondRoute = this.createRoofRoute(0, 2)
    this.roofRoutes.push(firstRoute, secondRoute)
    this.scene.add(firstRoute.group, secondRoute.group)

    this.createPlayer()

    for (let i = 0; i < 14; i += 1) {
      const hazard = this.createHazard(i % 3 === 0 ? 'block' : i % 3 === 1 ? 'jump' : 'slide')
      this.hazards.push(hazard)
      this.scene.add(hazard.group)
    }

    for (let i = 0; i < 46; i += 1) {
      const coin = this.createCoin()
      this.coins.push(coin)
    }
    this.createCoinInstances()

    this.createEffects()

    this.resetWorldObjects()
  }

  private createSkyline() {
    const cloudMaterial = flatMaterial(0xffffff, 0.78)
    const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), cloudMaterial, 28)
    const cloudTransform = new THREE.Object3D()
    let cloudIndex = 0
    for (let i = 0; i < 7; i += 1) {
      for (let puff = 0; puff < 4; puff += 1) {
        const radius = 1.2 + (puff % 2) * 0.45
        const side = i % 2 ? 1 : -1
        const cloudRotation = i % 2 ? -0.16 : 0.14
        const localX = (puff - 1.5) * 1.25
        const localZ = -Math.sin(cloudRotation) * localX
        cloudTransform.position.set(
          side * (10 + i * 2.8) + Math.cos(cloudRotation) * localX,
          13 + (i % 3) * 2.1 + (puff % 2) * 0.42,
          -65 - i * 22 + localZ,
        )
        cloudTransform.scale.set(radius, radius * 0.56, radius)
        cloudTransform.updateMatrix()
        clouds.setMatrixAt(cloudIndex, cloudTransform.matrix)
        cloudIndex += 1
      }
    }
    clouds.frustumCulled = false
    this.scene.add(clouds)

    const skylineParts: ColoredGeometryPart[] = []
    const skylineColors = [0x6f94bd, 0x7aa5bd, 0x7395ad, 0x84a6c6]
    for (let i = 0; i < 22; i += 1) {
      const side = i % 2 ? 1 : -1
      const height = 9 + ((i * 7) % 16)
      skylineParts.push({
        geometry: new THREE.BoxGeometry(4 + (i % 4), height, 5),
        color: skylineColors[i % skylineColors.length],
        position: [side * (14 + (i % 7) * 5), height / 2 - 0.5, -135 - (i % 5) * 18],
      })
    }

    skylineParts.push(
      {
        geometry: new THREE.TorusGeometry(6.4, 0.38, 8, 24, Math.PI),
        color: 0x376f91,
        position: [0, 0.6, -205],
      },
      {
        geometry: new THREE.BoxGeometry(0.78, 6.7, 1.0),
        color: 0x376f91,
        position: [-6.4, 3.4, -205],
      },
      {
        geometry: new THREE.BoxGeometry(0.78, 6.7, 1.0),
        color: 0x376f91,
        position: [6.4, 3.4, -205],
      },
    )
    const skyline = new THREE.Mesh(mergeColoredParts(skylineParts), this.cityMaterial)
    skyline.castShadow = false
    skyline.receiveShadow = false
    this.scene.add(skyline)
  }

  private createTrainVisual(themeIndex: number, length: number, roofRoute: boolean) {
    const geometry = this.getTrainGeometry(themeIndex, length, roofRoute)
    const train = new THREE.Mesh(geometry, this.cityMaterial)
    train.castShadow = true
    train.receiveShadow = true
    return train
  }

  private getTrainGeometry(themeIndex: number, length: number, roofRoute: boolean) {
    const cacheKey = `${themeIndex % trainThemes.length}:${length.toFixed(2)}:${roofRoute ? 'roof' : 'obstacle'}`
    let geometry = this.trainGeometryCache.get(cacheKey)
    if (!geometry) {
      geometry = this.createTrainGeometry(themeIndex, length, roofRoute)
      this.trainGeometryCache.set(cacheKey, geometry)
    }
    return geometry
  }

  private createTrainGeometry(themeIndex: number, length: number, roofRoute: boolean) {
    const theme = trainThemes[themeIndex % trainThemes.length]
    const bodyHeight = roofRoute ? 2.25 : 2.75
    const parts: ColoredGeometryPart[] = [
      {
        geometry: new THREE.BoxGeometry(2.72, bodyHeight, length),
        color: theme.primary,
        position: [0, bodyHeight / 2 + 0.12, 0],
      },
      {
        geometry: new THREE.BoxGeometry(2.78, 0.42, length + 0.05),
        color: theme.secondary,
        position: [0, 0.49, 0],
      },
      {
        geometry: new THREE.BoxGeometry(2.8, 0.2, length - 0.18),
        color: theme.trim,
        position: [0, roofRoute ? TRAIN_ROOF_HEIGHT - 0.1 : bodyHeight + 0.15, 0],
      },
      {
        geometry: new THREE.BoxGeometry(2.34, 0.1, length - 0.5),
        color: 0x287599,
        position: [0, roofRoute ? TRAIN_ROOF_HEIGHT + 0.025 : bodyHeight + 0.275, 0],
      },
      {
        geometry: new THREE.BoxGeometry(2.84, 0.22, length - 0.25),
        color: 0x26384c,
        position: [0, 0.2, 0],
      },
    ]

    const windowY = roofRoute ? 1.58 : 1.9
    const windowCount = Math.max(2, Math.min(7, Math.floor(length / 3.8)))
    const windowSpacing = (length - 2.1) / windowCount
    for (let i = 0; i < windowCount; i += 1) {
      const z = -length / 2 + 1.1 + windowSpacing * (i + 0.5)
      for (const side of [-1, 1]) {
        parts.push({
          geometry: new THREE.BoxGeometry(0.055, 0.72, Math.min(1.65, windowSpacing * 0.66)),
          color: 0x174b70,
          position: [side * 1.385, windowY, z],
        })
      }
    }

    const doorZs = length > 12 ? [-length * 0.28, length * 0.28] : [0]
    for (const z of doorZs) {
      for (const side of [-1, 1]) {
        parts.push(
          {
            geometry: new THREE.BoxGeometry(0.06, 1.38, 1.04),
            color: theme.secondary,
            position: [side * 1.405, 1.23, z],
          },
          {
            geometry: new THREE.BoxGeometry(0.065, 0.48, 0.58),
            color: 0xbeeaff,
            position: [side * 1.442, 1.58, z],
          },
        )
      }
    }

    for (const z of [-length * 0.31, length * 0.31]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.31, 0.31, 2.42, 8),
        color: 0x26303c,
        position: [0, 0.25, z],
        rotation: [0, 0, Math.PI / 2],
      })
    }

    for (const z of [-length * 0.27, length * 0.27]) {
      parts.push({
        geometry: new THREE.BoxGeometry(1.42, 0.075, 0.72),
        color: theme.trim,
        position: [0, roofRoute ? TRAIN_ROOF_HEIGHT + 0.1 : bodyHeight + 0.35, z],
      })
    }

    parts.push(
      {
        geometry: new THREE.BoxGeometry(2.5, roofRoute ? 1.75 : 2.2, 0.16),
        color: theme.secondary,
        position: [0, roofRoute ? 1.32 : 1.56, length / 2 + 0.09],
      },
      {
        geometry: new THREE.BoxGeometry(1.78, roofRoute ? 0.62 : 0.82, 0.1),
        color: 0x153e63,
        position: [0, roofRoute ? 1.66 : 2.0, length / 2 + 0.19],
      },
      {
        geometry: new THREE.BoxGeometry(2.76, 0.3, 0.24),
        color: theme.trim,
        position: [0, 0.48, length / 2 + 0.2],
      },
      {
        geometry: new THREE.BoxGeometry(2.18, 0.18, 0.16),
        color: palette.ink,
        position: [0, 0.2, length / 2 + 0.25],
      },
      {
        geometry: new THREE.BoxGeometry(1.1, 0.16, 0.12),
        color: theme.trim,
        position: [0, roofRoute ? 2.08 : 2.62, length / 2 + 0.24],
      },
    )
    for (const x of [-0.82, 0.82]) {
      parts.push({
        geometry: new THREE.SphereGeometry(0.16, 8, 6),
        color: 0xfff2a8,
        position: [x, 0.94, length / 2 + 0.23],
      })
    }
    return mergeColoredParts(parts)
  }

  private createRamp(centerZ: number, descending: boolean) {
    const ramp = new THREE.Group()
    const slope = new THREE.Group()
    const angle = Math.atan(TRAIN_ROOF_HEIGHT / RAMP_LENGTH) * (descending ? -1 : 1)
    const slopeLength = Math.hypot(RAMP_LENGTH, TRAIN_ROOF_HEIGHT)
    const deckThickness = 0.2
    slope.position.set(0, TRAIN_ROOF_HEIGHT / 2 - Math.cos(angle) * deckThickness / 2, centerZ)
    slope.rotation.x = angle
    const slopeParts: ColoredGeometryPart[] = [{
      geometry: new THREE.BoxGeometry(2.78, deckThickness, slopeLength),
      color: 0x167eea,
    }, {
      geometry: new THREE.BoxGeometry(1.42, 0.025, slopeLength - 0.12),
      color: 0x24d7df,
      position: [0, 0.112, 0],
    }]
    for (const side of [-1, 1]) {
      slopeParts.push({
        geometry: new THREE.BoxGeometry(0.14, 0.25, slopeLength + 0.08),
        color: palette.cream,
        position: [side * 1.34, 0.18, 0],
      })
    }

    const arrowShape = new THREE.Shape()
    arrowShape.moveTo(0, 0.72)
    arrowShape.lineTo(0.62, 0.08)
    arrowShape.lineTo(0.27, 0.08)
    arrowShape.lineTo(0.27, -0.68)
    arrowShape.lineTo(-0.27, -0.68)
    arrowShape.lineTo(-0.27, 0.08)
    arrowShape.lineTo(-0.62, 0.08)
    arrowShape.closePath()
    for (const z of [-RAMP_LENGTH * 0.25, RAMP_LENGTH * 0.25]) {
      slopeParts.push({
        geometry: new THREE.ShapeGeometry(arrowShape),
        color: palette.cream,
        position: [0, 0.112, z],
        rotation: [-Math.PI / 2, 0, descending ? Math.PI : 0],
      })
    }
    const slopeMesh = new THREE.Mesh(mergeColoredParts(slopeParts), this.cityMaterial)
    slopeMesh.receiveShadow = true
    slope.add(slopeMesh)
    ramp.add(slope)

    const supportParts: ColoredGeometryPart[] = []
    for (const side of [-1, 1]) {
      supportParts.push({
        geometry: new THREE.BoxGeometry(0.14, TRAIN_ROOF_HEIGHT, 0.14),
        color: 0x315e81,
        position: [
          side * 1.1,
          TRAIN_ROOF_HEIGHT / 2,
          centerZ + (descending ? RAMP_LENGTH * 0.42 : -RAMP_LENGTH * 0.42),
        ],
      })
    }
    const supportMesh = new THREE.Mesh(mergeColoredParts(supportParts), this.cityMaterial)
    supportMesh.receiveShadow = true
    ramp.add(supportMesh)
    return ramp
  }

  private createRoofRoute(lane: number, theme: number): RoofRoute {
    const group = new THREE.Group()
    const train = this.createTrainVisual(theme, ROUTE_UP_BACK - ROUTE_ROOF_BACK, true)
    train.position.z = (ROUTE_UP_BACK + ROUTE_ROOF_BACK) / 2
    group.add(train)
    group.add(
      this.createRamp((ROUTE_UP_FRONT + ROUTE_UP_BACK) / 2, false),
      this.createRamp((ROUTE_ROOF_BACK + ROUTE_DOWN_BACK) / 2, true),
    )

    group.position.x = LANES[lane]
    return { group, lane, theme }
  }

  private createCoin(): Coin {
    return { mesh: new THREE.Group(), lane: 1, collected: false, baseY: 1.1 }
  }

  private createCoinInstances() {
    const geometry = mergeColoredParts([
      {
        geometry: new THREE.CylinderGeometry(0.4, 0.4, 0.12, 14),
        color: palette.yellow,
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.98, 0.98, 0.98],
      },
      {
        geometry: new THREE.TorusGeometry(0.4, 0.055, 6, 14),
        color: 0xffe779,
        scale: [0.98, 0.98, 0.98],
      },
      {
        geometry: new THREE.ShapeGeometry(createBoltShape(0.45)),
        color: 0xfff6bb,
        position: [0, 0, 0.075],
        scale: [0.98, 0.98, 0.98],
      },
      {
        geometry: new THREE.ShapeGeometry(createBoltShape(0.45)),
        color: 0xfff6bb,
        position: [0, 0, -0.075],
        rotation: [0, Math.PI, 0],
        scale: [0.98, 0.98, 0.98],
      },
    ])
    const instances = new THREE.InstancedMesh(geometry, this.cityMaterial, this.coins.length)
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    instances.castShadow = false
    instances.receiveShadow = false
    instances.frustumCulled = false
    this.coinInstances = instances
    this.scene.add(instances)
  }

  private syncCoinInstances() {
    const instances = this.coinInstances
    if (!instances) return
    for (let index = 0; index < this.coins.length; index += 1) {
      const coin = this.coins[index]
      this.instanceTransform.position.copy(coin.mesh.position)
      this.instanceTransform.rotation.copy(coin.mesh.rotation)
      const inActiveRange = coin.mesh.position.z > -175 && coin.mesh.position.z < 22
      this.instanceTransform.scale.setScalar(!coin.collected && coin.mesh.visible && inActiveRange ? 1 : 0)
      this.instanceTransform.updateMatrix()
      instances.setMatrixAt(index, this.instanceTransform.matrix)
    }
    instances.instanceMatrix.needsUpdate = true
  }

  private createEffects() {
    const ringMaterial = flatMaterial(0xc9fbff, 0)
    ringMaterial.depthWrite = false
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.76, 24), ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    this.landingRing = ring
    this.scene.add(ring)

    const sparkleGeometry = new THREE.OctahedronGeometry(0.11, 0)
    for (let burstIndex = 0; burstIndex < 4; burstIndex += 1) {
      const group = new THREE.Group()
      const burstMaterial = new THREE.MeshBasicMaterial({ color: 0xffe36c, transparent: true, opacity: 0 })
      const velocities: THREE.Vector3[] = []
      for (let i = 0; i < 5; i += 1) {
        const sparkle = new THREE.Mesh(sparkleGeometry, burstMaterial)
        group.add(sparkle)
        velocities.push(new THREE.Vector3())
      }
      group.visible = false
      this.coinBursts.push({ group, velocities, age: 1 })
      this.scene.add(group)
    }
  }

  private createTrackSystem() {
    const trackParts: ColoredGeometryPart[] = [{
      geometry: new THREE.BoxGeometry(12.2, 0.5, TRACK_LENGTH),
      color: palette.ballast,
      position: [0, -0.34, 0],
    }]

    for (let lane = 0; lane < LANES.length; lane += 1) {
      trackParts.push({
        geometry: new THREE.BoxGeometry(2.8, 0.11, TRACK_LENGTH - 0.06),
        color: lane === 1 ? 0x77747a : 0x838087,
        position: [LANES[lane], -0.055, 0],
      })
      for (const offset of [-0.72, 0.72]) {
        trackParts.push(
          {
            geometry: new THREE.BoxGeometry(0.2, 0.055, TRACK_LENGTH),
            color: 0x484b51,
            position: [LANES[lane] + offset, 0.035, 0],
          },
          {
            geometry: new THREE.BoxGeometry(0.11, 0.14, TRACK_LENGTH),
            color: palette.rail,
            position: [LANES[lane] + offset, 0.13, 0],
          },
        )
      }
      for (let z = -8; z <= 8; z += 1.82) {
        trackParts.push({
          geometry: new THREE.BoxGeometry(2.72, 0.105, 0.28),
          color: palette.sleeper,
          position: [LANES[lane], 0.025, z],
        })
      }
      for (let z = -7.1; z <= 7.1; z += 3.64) {
        for (const offset of [-0.72, 0.72]) {
          trackParts.push({
            geometry: new THREE.BoxGeometry(0.31, 0.12, 0.38),
            color: palette.yellow,
            position: [LANES[lane] + offset, 0.105, z],
          })
        }
      }
    }

    for (const side of [-1, 1]) {
      trackParts.push(
        {
          geometry: new THREE.BoxGeometry(2.05, 0.62, TRACK_LENGTH),
          color: 0xd8c8a8,
          position: [side * 7.0, 0.04, 0],
        },
        {
          geometry: new THREE.BoxGeometry(2.06, 0.11, TRACK_LENGTH),
          color: 0xf5e6c8,
          position: [side * 7.0, 0.405, 0],
        },
        {
          geometry: new THREE.BoxGeometry(0.24, 0.045, TRACK_LENGTH),
          color: palette.yellow,
          position: [side * 6.02, 0.485, 0],
        },
        {
          geometry: new THREE.BoxGeometry(0.18, 0.7, TRACK_LENGTH),
          color: side < 0 ? palette.blue : palette.coral,
          position: [side * 5.95, 0.05, 0],
        },
      )
      for (let z = -7.4; z <= 7.4; z += 3.1) {
        trackParts.push({
          geometry: new THREE.BoxGeometry(0.44, 0.045, 1.28),
          color: z % 2 > 0 ? palette.cream : palette.yellow,
          position: [side * 6.01, 0.52, z],
        })
      }
    }
    for (const x of [LANES[0], LANES[2]]) {
      trackParts.push({
        geometry: new THREE.BoxGeometry(0.018, 0.018, TRACK_LENGTH),
        color: 0x8da8b3,
        position: [x, OVERHEAD_WIRE_HEIGHT, 0],
      })
    }

    const overheadParts: ColoredGeometryPart[] = []
    for (const side of [-1, 1]) {
      overheadParts.push({
        geometry: new THREE.CylinderGeometry(0.11, 0.18, 12.1, 8),
        color: 0x52758a,
        position: [side * 5.72, 6.02, -7.4],
      })
    }
    overheadParts.push({
      geometry: new THREE.BoxGeometry(11.65, 0.17, 0.2),
      color: 0x52758a,
      position: [0, OVERHEAD_GANTRY_HEIGHT, -7.4],
    })
    for (const x of [LANES[0], LANES[2]]) {
      overheadParts.push({
        geometry: new THREE.BoxGeometry(0.055, 0.62, 0.055),
        color: 0x52758a,
        position: [x, OVERHEAD_GANTRY_HEIGHT - 0.4, -7.4],
      })
    }

    const tracks = new THREE.InstancedMesh(mergeColoredParts(trackParts), this.cityMaterial, TRACK_SEGMENTS)
    tracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    tracks.receiveShadow = true
    tracks.frustumCulled = false
    this.trackInstances = tracks
    const overheadCount = Math.floor((TRACK_SEGMENTS + 1) / 3)
    const overhead = new THREE.InstancedMesh(mergeColoredParts(overheadParts), this.cityMaterial, overheadCount)
    overhead.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    overhead.frustumCulled = false
    this.overheadInstances = overhead
    for (let index = 0; index < TRACK_SEGMENTS; index += 1) {
      this.trackZs[index] = -index * TRACK_LENGTH + 9
    }
    this.syncTrackInstances()
    this.scene.add(tracks, overhead)
  }

  private syncTrackInstances() {
    if (!this.trackInstances || !this.overheadInstances) return
    let overheadIndex = 0
    for (let index = 0; index < TRACK_SEGMENTS; index += 1) {
      this.instanceTransform.position.set(0, 0, this.trackZs[index])
      this.instanceTransform.rotation.set(0, 0, 0)
      this.instanceTransform.scale.set(1, 1, 1)
      this.instanceTransform.updateMatrix()
      this.trackInstances.setMatrixAt(index, this.instanceTransform.matrix)
      if (index % 3 === 1) {
        this.overheadInstances.setMatrixAt(overheadIndex, this.instanceTransform.matrix)
        overheadIndex += 1
      }
    }
    this.trackInstances.instanceMatrix.needsUpdate = true
    this.overheadInstances.instanceMatrix.needsUpdate = true
  }

  private createScenery(index: number) {
    const group = new THREE.Group()
    const side = index % 2 === 0 ? -1 : 1
    const height = 5.5 + ((index * 5) % 8)
    const width = 4 + ((index * 3) % 4)
    const buildingColors = [0xff725f, 0x32bfc2, 0xffc84d, 0x5979e6, 0x9e5ce5, 0x45b96c]
    const buildingX = side * (10.5 + (index % 3) * 1.5)
    const parts: ColoredGeometryPart[] = [
      {
        geometry: new THREE.BoxGeometry(width, height, 5.8),
        color: buildingColors[index % buildingColors.length],
        position: [buildingX, height / 2 + 0.3, 0],
      },
      {
        geometry: new THREE.BoxGeometry(width + 0.35, 0.32, 6.15),
        color: index % 2 ? palette.coral : palette.yellow,
        position: [buildingX, height + 0.48, 0],
      },
      {
        geometry: new THREE.BoxGeometry(width + 0.16, 1.05, 6.02),
        color: index % 2 ? 0x24558a : 0x5f3aa7,
        position: [buildingX, 0.83, 0],
      },
      {
        geometry: new THREE.BoxGeometry(0.16, height - 0.8, 6.04),
        color: index % 3 === 0 ? palette.cream : palette.yellow,
        position: [buildingX - side * (width * 0.28), height / 2 + 0.7, 0],
      },
      {
        geometry: new THREE.BoxGeometry(Math.max(1.3, width * 0.42), 0.38, 2.1),
        color: 0x2c5f82,
        position: [buildingX, height + 0.82, 0.7],
      },
    ]

    const windowColor = index % 3 === 0 ? 0xe9fbff : 0x254d74
    for (let y = 1.7; y < height - 0.45; y += 1.55) {
      for (const z of [-1.55, 0, 1.55]) {
        parts.push({
          geometry: new THREE.BoxGeometry(0.045, 0.78, 0.62),
          color: windowColor,
          position: [buildingX - side * (width / 2 + 0.025), y, z],
        })
      }
    }
    parts.push({
      geometry: new THREE.BoxGeometry(1.5, 0.16, 2.8),
      color: index % 2 ? palette.cyan : palette.cream,
      position: [buildingX - side * (width / 2 + 0.7), 2.0, 0],
      rotation: [0, 0, side * 0.08],
    })
    parts.push(
      {
        geometry: new THREE.BoxGeometry(0.08, 1.05, 2.35),
        color: index % 2 ? palette.yellow : palette.cyan,
        position: [buildingX - side * (width / 2 + 0.06), 0.95, 0],
      },
      {
        geometry: new THREE.BoxGeometry(0.1, 0.72, 1.62),
        color: palette.cream,
        position: [buildingX - side * (width / 2 + 0.08), 1.95, -2.05],
      },
    )

    const fenceColor = index % 2 ? 0x3d7185 : 0x4e6684
    for (const z of [-3.9, 0, 3.9]) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.11, 1.25, 0.11),
        color: fenceColor,
        position: [side * 8.15, 1.0, z],
      })
    }
    for (const y of [0.65, 1.28]) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.09, 0.09, 7.8),
        color: fenceColor,
        position: [side * 8.15, y, 0],
      })
    }

    if (index % 3 !== 1) {
      parts.push(
        {
          geometry: new THREE.CylinderGeometry(0.18, 0.25, 2.15, 7),
          color: 0x8a5738,
          position: [side * 8.9, 1.45, 2.6],
        },
        {
          geometry: new THREE.IcosahedronGeometry(1.2, 0),
          color: index % 2 ? 0x43b967 : 0x66c75d,
          position: [side * 8.9, 3.25, 2.6],
        },
        {
          geometry: new THREE.IcosahedronGeometry(0.72, 0),
          color: index % 4 === 0 ? 0xff70a5 : 0x8dde6e,
          position: [side * 8.55, 3.65, 2.35],
        },
      )
    }

    parts.push(
      {
        geometry: new THREE.BoxGeometry(1.15, 0.48, 1.15),
        color: index % 2 ? palette.cyan : palette.coral,
        position: [side * 6.9, 0.72, 2.7],
      },
      {
        geometry: new THREE.IcosahedronGeometry(0.72, 0),
        color: index % 3 ? 0x55c764 : 0xff75a8,
        position: [side * 6.9, 1.52, 2.7],
      },
    )

    parts.push(
      {
        geometry: new THREE.CylinderGeometry(0.07, 0.1, 4.2, 7),
        color: 0x31576e,
        position: [side * 7.15, 2.55, -3.4],
      },
      {
        geometry: new THREE.BoxGeometry(0.9, 0.09, 0.09),
        color: 0x31576e,
        position: [side * 6.75, 4.58, -3.4],
      },
      {
        geometry: new THREE.SphereGeometry(0.2, 8, 6),
        color: 0xffed9d,
        position: [side * 6.35, 4.38, -3.4],
      },
      {
        geometry: new THREE.BoxGeometry(0.06, 1.3, 0.9),
        color: index % 2 ? palette.purple : palette.orange,
        position: [side * 7.0, 3.35, -3.38],
      },
    )

    if (index % 8 === 5) {
      const bridgeColor = index % 16 === 5 ? 0x3e76a3 : 0xe96855
      for (const bridgeSide of [-1, 1]) {
        parts.push({
          geometry: new THREE.BoxGeometry(0.7, BRIDGE_DECK_HEIGHT, 0.75),
          color: bridgeColor,
          position: [bridgeSide * 7.9, BRIDGE_DECK_HEIGHT / 2, 0],
        })
      }
      parts.push(
        {
          geometry: new THREE.BoxGeometry(16.4, 0.76, 1.1),
          color: bridgeColor,
          position: [0, BRIDGE_DECK_HEIGHT, 0],
        },
        {
          geometry: new THREE.BoxGeometry(5.2, 0.52, 0.12),
          color: palette.cream,
          position: [0, BRIDGE_DECK_HEIGHT, 0.61],
        },
      )
      for (const x of [-1.5, 0, 1.5]) {
        parts.push({
          geometry: new THREE.ShapeGeometry(createBoltShape(0.24)),
          color: x === 0 ? palette.coral : palette.blue,
          position: [x, BRIDGE_DECK_HEIGHT, 0.685],
        })
      }
    }

    const visual = new THREE.Mesh(mergeColoredParts(parts), this.cityMaterial)
    visual.castShadow = false
    visual.receiveShadow = false
    group.add(visual)
    group.position.set(0, 0, -index * 13.5)
    this.scenery.push(group)
    this.scene.add(group)
  }

  private createPlayer() {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 24),
      new THREE.MeshBasicMaterial({ color: 0x0d0920, transparent: true, opacity: 0.34, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, 0.05, PLAYER_Z)
    this.playerShadow = shadow
    this.scene.add(shadow)

    const torso = mesh(new THREE.CapsuleGeometry(0.62, 0.88, 5, 10), palette.coral)
    torso.position.y = 2.25
    torso.scale.z = 0.7
    this.playerParts.torso = torso
    this.player.add(torso)

    const shirtStripe = mesh(new THREE.BoxGeometry(1.2, 0.2, 0.75), palette.cream)
    shirtStripe.position.set(0, 2.28, 0.38)
    this.player.add(shirtStripe)

    const head = mesh(new THREE.SphereGeometry(0.52, 16, 12), 0xb96b45)
    head.position.y = 3.55
    this.player.add(head)

    const hair = mesh(new THREE.SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), palette.ink)
    hair.position.y = 3.72
    this.player.add(hair)

    const cap = mesh(new THREE.BoxGeometry(1.1, 0.16, 0.72), palette.yellow)
    cap.position.set(0, 4.01, 0)
    cap.rotation.x = -0.1
    const brim = mesh(new THREE.BoxGeometry(0.78, 0.1, 0.5), palette.yellow)
    brim.position.set(0, 3.91, -0.48)
    this.player.add(cap, brim)

    const backpack = mesh(new THREE.BoxGeometry(0.9, 1.15, 0.48), palette.purple)
    backpack.position.set(0, 2.32, 0.52)
    const backpackPatch = new THREE.Mesh(new THREE.ShapeGeometry(createBoltShape(0.28)), flatMaterial(palette.yellow))
    backpackPatch.position.set(0, 2.32, 0.77)
    this.player.add(backpack, backpackPatch)

    const limbGeometry = new THREE.CapsuleGeometry(0.17, 0.86, 4, 8)
    const leftArm = mesh(limbGeometry, 0xb96b45)
    leftArm.position.set(-0.79, 2.25, 0)
    leftArm.rotation.z = -0.18
    const rightArm = leftArm.clone()
    rightArm.position.x = 0.79
    rightArm.rotation.z = 0.18
    this.playerParts.leftArm = leftArm
    this.playerParts.rightArm = rightArm
    this.player.add(leftArm, rightArm)

    const legGeometry = new THREE.CapsuleGeometry(0.21, 0.95, 4, 8)
    const leftLeg = mesh(legGeometry, palette.ink)
    leftLeg.position.set(-0.34, 0.75, 0)
    const rightLeg = leftLeg.clone()
    rightLeg.position.x = 0.34
    this.playerParts.leftLeg = leftLeg
    this.playerParts.rightLeg = rightLeg
    this.player.add(leftLeg, rightLeg)

    const shoeGeometry = new THREE.BoxGeometry(0.55, 0.27, 0.82)
    const leftShoe = mesh(shoeGeometry, palette.cyan)
    leftShoe.position.set(-0.34, 0.18, -0.18)
    const rightShoe = leftShoe.clone()
    rightShoe.position.x = 0.34
    this.playerParts.leftShoe = leftShoe
    this.playerParts.rightShoe = rightShoe
    this.player.add(leftShoe, rightShoe)

    this.player.position.set(0, 0, PLAYER_Z)
    this.player.rotation.y = Math.PI
    this.player.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true
    })
    this.scene.add(this.player)
  }

  private createHazard(kind: HazardKind): Hazard {
    const group = new THREE.Group()
    const visual = new THREE.Mesh(this.getHazardGeometry(kind, 0), this.cityMaterial)
    visual.castShadow = true
    visual.receiveShadow = true
    group.add(visual)
    return { group, visual, kind, lane: 1, hit: false, variant: 0 }
  }

  private getHazardGeometry(kind: HazardKind, variant: number) {
    if (kind === 'block') return this.getTrainGeometry(variant, OBSTACLE_TRAIN_LENGTH, false)
    const cacheKey = kind
    const cached = this.hazardGeometryCache.get(cacheKey)
    if (cached) return cached
    const parts: ColoredGeometryPart[] = []
    if (kind === 'jump') {
      parts.push({
        geometry: new THREE.BoxGeometry(2.72, 0.78, 0.54),
        color: palette.coral,
        position: [0, 0.78, 0],
      })
      for (const x of [-0.92, -0.31, 0.31, 0.92]) {
        parts.push({
          geometry: new THREE.BoxGeometry(0.24, 0.82, 0.58),
          color: palette.cream,
          position: [x, 0.79, 0],
          rotation: [0, 0, -0.28],
        })
      }
      parts.push({
        geometry: new THREE.BoxGeometry(3, 0.16, 0.98),
        color: 0x24354b,
        position: [0, 0.08, 0],
      })
      for (const x of [-1.12, 1.12]) {
        parts.push(
          {
            geometry: new THREE.BoxGeometry(0.17, 1.36, 0.18),
            color: 0x344f62,
            position: [x, 0.68, -0.12],
          },
          {
            geometry: new THREE.SphereGeometry(0.16, 8, 6),
            color: 0xff3b45,
            position: [x, 1.48, 0.04],
          },
        )
      }
    } else {
      parts.push(
        {
          geometry: new THREE.BoxGeometry(0.2, 3.05, 0.24),
          color: 0x315e7a,
          position: [-1.25, 1.52, 0],
        },
        {
          geometry: new THREE.BoxGeometry(0.2, 3.05, 0.24),
          color: 0x315e7a,
          position: [1.25, 1.52, 0],
        },
        {
          geometry: new THREE.BoxGeometry(2.82, 0.88, 0.52),
          color: palette.cream,
          position: [0, 2.45, 0],
        },
        {
          geometry: new THREE.BoxGeometry(2.4, 0.56, 0.08),
          color: palette.blue,
          position: [0, 2.46, 0.31],
        },
      )
      for (const x of [-0.72, 0, 0.72]) {
        parts.push({
          geometry: new THREE.ShapeGeometry(createBoltShape(0.22)),
          color: palette.cream,
          position: [x, 2.45, 0.36],
        })
      }
      parts.push({
        geometry: new THREE.BoxGeometry(2.35, 0.1, 0.13),
        color: palette.coral,
        position: [0, 1.86, 0],
      })
    }
    const geometry = mergeColoredParts(parts)
    this.hazardGeometryCache.set(cacheKey, geometry)
    return geometry
  }

  private getRouteSurfaceAtLocalZ(localZ: number) {
    return getRouteSurfaceHeight(
      localZ,
      ROUTE_UP_FRONT,
      ROUTE_UP_BACK,
      ROUTE_ROOF_BACK,
      ROUTE_DOWN_BACK,
      TRAIN_ROOF_HEIGHT,
    )
  }

  private getRouteSurfaceAtWorldZ(lane: number, worldZ: number) {
    let height = 0
    for (const route of this.roofRoutes) {
      if (route.lane !== lane) continue
      height = Math.max(height, this.getRouteSurfaceAtLocalZ(worldZ - route.group.position.z))
    }
    return height
  }

  private getObstacleTrainRoofAtWorldZ(lane: number, worldZ: number) {
    for (const hazard of this.hazards) {
      if (hazard.kind !== 'block' || hazard.lane !== lane) continue
      if (Math.abs(hazard.group.position.z - worldZ) <= OBSTACLE_TRAIN_LENGTH / 2 + 0.04) {
        return OBSTACLE_TRAIN_ROOF_HEIGHT
      }
    }
    return 0
  }

  private getSupportSurfaceAtWorldZ(lane: number, worldZ: number) {
    return Math.max(
      this.getRouteSurfaceAtWorldZ(lane, worldZ),
      this.getObstacleTrainRoofAtWorldZ(lane, worldZ),
    )
  }

  private routeOccupies(lane: number, worldZ: number, margin = 2.5) {
    return this.roofRoutes.some((route) => {
      if (route.lane !== lane) return false
      const localZ = worldZ - route.group.position.z
      return localZ <= ROUTE_UP_FRONT + margin && localZ >= ROUTE_DOWN_BACK - margin
    })
  }

  private findOpenLane(preferredLane: number, worldZ: number) {
    for (let offset = 0; offset < 3; offset += 1) {
      const lane = (preferredLane + offset) % 3
      if (!this.routeOccupies(lane, worldZ, 5)) return lane
    }
    return preferredLane
  }

  private findCoinLane(preferredLane: number, worldZ: number) {
    for (let offset = 0; offset < 3; offset += 1) {
      const lane = (preferredLane + offset) % 3
      const overlapsHazard = this.hazards.some((hazard) => (
        hazard.lane === lane &&
        Math.abs(hazard.group.position.z - worldZ) < (hazard.kind === 'block' ? 4.8 : 2.5)
      ))
      if (!overlapsHazard) return lane
    }
    return preferredLane
  }

  private placeRoofRoute(route: RoofRoute, lane: number, z: number) {
    route.lane = lane
    route.group.position.set(LANES[lane], 0, z)
  }

  private resetWorldObjects() {
    this.placeRoofRoute(this.roofRoutes[0], 1, this.roofTestMode ? -34 : -82)
    this.placeRoofRoute(this.roofRoutes[1], this.roofTestMode ? 2 : 0, this.roofTestMode ? -34 : -232)

    let hazardZ = this.roofTestMode ? -190 : -36
    this.hazards.forEach((hazard, index) => {
      hazardZ -= 22 + (index % 3) * 4
      const kind: HazardKind = index % 3 === 0 ? 'jump' : index % 3 === 1 ? 'block' : 'slide'
      const lane = this.findOpenLane((index * 2 + 1) % 3, hazardZ)
      this.updateHazard(hazard, kind, lane, hazardZ, (index + lane) % trainThemes.length)
    })
    if (this.roofTestMode) {
      const shortTransferTrain = this.hazards.find((hazard) => hazard.kind === 'block')
      if (shortTransferTrain) this.updateHazard(shortTransferTrain, 'block', 0, -34, 3)
    }

    const routeCoinZs = [18.1, 16.4, 14.4, 10, 5, 0, -5, -10, -15, -18.2, -20.8, -22.8]
    const routeCoinCount = routeCoinZs.length * this.roofRoutes.length
    let groundCoinZ = -20
    this.coins.forEach((coin, index) => {
      coin.route = undefined
      coin.localZ = undefined
      if (index < routeCoinCount) {
        const route = this.roofRoutes[Math.floor(index / routeCoinZs.length)]
        const localZ = routeCoinZs[index % routeCoinZs.length]
        const roofArc = localZ < -3 && localZ > -14
          ? Math.sin(((localZ + 14) / 11) * Math.PI) * 1.45
          : 0
        coin.route = route
        coin.localZ = localZ
        coin.lane = route.lane
        coin.baseY = this.getRouteSurfaceAtLocalZ(localZ) + 1.12 + Math.max(0, roofArc)
        coin.mesh.position.set(LANES[route.lane], coin.baseY, route.group.position.z + localZ)
        coin.collected = false
        coin.mesh.visible = true
        return
      }

      const groundIndex = index - routeCoinCount
      if (groundIndex % 6 === 0) groundCoinZ -= 11.5
      const z = groundCoinZ - (groundIndex % 6) * 2.15
      const lane = this.findCoinLane(Math.floor(groundIndex / 6) % 3, z)
      coin.lane = lane
      coin.collected = false
      coin.mesh.visible = true
      coin.baseY = this.getRouteSurfaceAtWorldZ(lane, z) + 1.08 + (groundIndex % 6 === 3 ? 0.62 : 0)
      coin.mesh.position.set(LANES[lane], coin.baseY, z)
      coin.mesh.rotation.y = 0
    })
    this.syncCoinInstances()
  }

  private updateHazard(hazard: Hazard, kind: HazardKind, lane: number, z: number, variant: number) {
    if (hazard.kind !== kind || hazard.variant !== variant) {
      hazard.visual.geometry = this.getHazardGeometry(kind, variant)
    }
    hazard.kind = kind
    hazard.lane = lane
    hazard.variant = variant
    hazard.hit = false
    hazard.group.position.set(LANES[lane], 0, z)
    hazard.group.rotation.y = 0
    this.lastHazardLane = lane
    this.lastHazardKind = kind
  }

  private recycleHazard(hazard: Hazard) {
    const farthestZ = Math.min(...this.hazards.map((item) => item.group.position.z))
    const roll = Math.random()
    let kind: HazardKind = roll < 0.36 ? 'jump' : roll < 0.68 ? 'slide' : 'block'
    if (kind === this.lastHazardKind && Math.random() < 0.54) {
      kind = kind === 'jump' ? 'slide' : kind === 'slide' ? 'block' : 'jump'
    }
    let lane = Math.floor(Math.random() * 3)
    if (lane === this.lastHazardLane && Math.random() < 0.55) lane = (lane + 1 + Math.floor(Math.random() * 2)) % 3
    const spacing = 23 + Math.random() * 14 + (this.speed > 28 ? 4 : 0)
    const z = farthestZ - spacing
    lane = this.findOpenLane(lane, z)
    const variant = (Math.floor(this.distance / 90) + lane + Math.floor(Math.random() * 3)) % trainThemes.length
    this.updateHazard(hazard, kind, lane, z, variant)
  }

  private recycleCoin(coin: Coin) {
    const groundCoins = this.coins.filter((item) => !item.route)
    const farthestZ = Math.min(...groundCoins.map((item) => item.mesh.position.z))
    const preferredLane = Math.floor(Math.random() * 3)
    const z = farthestZ - 2.25
    const lane = this.findCoinLane(preferredLane, z)
    coin.lane = lane
    coin.collected = false
    coin.mesh.visible = true
    coin.baseY = this.getRouteSurfaceAtWorldZ(lane, z) + (Math.random() < 0.22 ? 2.2 : 1.08)
    coin.mesh.position.set(LANES[lane], coin.baseY, z)
  }

  private recycleRoofRoute(route: RoofRoute) {
    const otherRoutes = this.roofRoutes.filter((item) => item !== route)
    const farthestZ = Math.min(...otherRoutes.map((item) => item.group.position.z))
    let z = farthestZ - 148 - Math.random() * 26
    let bestLane = 0
    let bestScore = Number.POSITIVE_INFINITY
    for (let attempt = 0; attempt < 4; attempt += 1) {
      bestScore = Number.POSITIVE_INFINITY
      for (let lane = 0; lane < 3; lane += 1) {
        let score = this.hazards.filter((hazard) => (
          hazard.lane === lane &&
          hazard.group.position.z < z + ROUTE_UP_FRONT + 7 &&
          hazard.group.position.z > z + ROUTE_DOWN_BACK - 7
        )).length
        if (otherRoutes.some((other) => (
          other.lane === lane && Math.abs(other.group.position.z - z) < 70
        ))) score += 4
        if (score < bestScore) {
          bestScore = score
          bestLane = lane
        }
      }
      if (bestScore === 0) break
      z -= 28
    }
    this.placeRoofRoute(route, bestLane, z)
    this.coins.forEach((coin) => {
      if (coin.route !== route || coin.localZ === undefined) return
      coin.lane = bestLane
      coin.collected = false
      coin.mesh.visible = true
      coin.mesh.position.set(LANES[bestLane], coin.baseY, z + coin.localZ)
    })
  }

  private triggerCoinBurst(position: THREE.Vector3) {
    const burst = this.coinBursts[this.burstCursor % this.coinBursts.length]
    this.burstCursor += 1
    burst.age = 0
    burst.group.visible = true
    burst.group.position.copy(position)
    burst.group.children.forEach((child, index) => {
      child.position.set(0, 0, 0)
      child.scale.setScalar(1)
      const angle = (index / burst.group.children.length) * Math.PI * 2
      const speed = 1.7 + (index % 3) * 0.35
      burst.velocities[index].set(Math.cos(angle) * speed, 1.2 + (index % 2) * 0.9, Math.sin(angle) * speed * 0.48)
    })
  }

  private triggerLandingEffect() {
    if (!this.landingRing) return
    this.landingEffectAge = 0
    this.landingRing.visible = true
    this.landingRing.position.set(this.player.position.x, this.surfaceHeight + 0.07, PLAYER_Z)
    this.landingRing.scale.setScalar(0.8)
  }

  private updateEffects(delta: number) {
    if (this.landingRing?.visible) {
      this.landingEffectAge += delta
      const progress = Math.min(1, this.landingEffectAge / 0.42)
      this.landingRing.scale.setScalar(0.8 + progress * 2.5)
      const ringMaterial = this.landingRing.material
      if (ringMaterial instanceof THREE.MeshBasicMaterial) ringMaterial.opacity = (1 - progress) * 0.46
      if (progress >= 1) this.landingRing.visible = false
    }

    this.coinBursts.forEach((burst) => {
      if (!burst.group.visible) return
      burst.age += delta
      const progress = Math.min(1, burst.age / 0.46)
      burst.group.children.forEach((child, index) => {
        const velocity = burst.velocities[index]
        child.position.addScaledVector(velocity, delta)
        velocity.y -= delta * 4.2
        child.rotation.x += delta * 8
        child.rotation.y += delta * 6
        child.scale.setScalar(Math.max(0.15, 1 - progress * 0.72))
      })
      const burstMaterial = (burst.group.children[0] as THREE.Mesh).material
      if (burstMaterial instanceof THREE.MeshBasicMaterial) burstMaterial.opacity = (1 - progress) * 0.95
      if (progress >= 1) burst.group.visible = false
    })
  }

  private animate = () => {
    if (this.destroyed) return
    this.animationFrame = requestAnimationFrame(this.animate)
    const rawDelta = this.clock.getDelta()
    const delta = Math.min(rawDelta, 0.05)

    if (this.status === 'playing') this.updateGame(delta)
    else this.updateIdle(delta)

    this.renderer.render(this.scene, this.camera)
    if (this.profiling) this.updateProfile(rawDelta)
  }

  private updateProfile(rawDelta: number) {
    this.profileElapsed += rawDelta
    this.profileStateElapsed += rawDelta
    this.profileFrames += 1
    this.profileFrameTimes.push(rawDelta * 1000)
    const canvas = this.renderer.domElement
    if (this.profileStateElapsed >= 0.1) {
      canvas.dataset.motionState = JSON.stringify({
        lane: this.laneIndex,
        supportLane: this.supportLaneIndex,
        surfaceHeight: this.surfaceHeight,
        surfaceTransition: this.surfaceTransitionKind,
        jumpHeight: this.jumpMotion.height,
        crouching: this.isCrouching(),
        status: this.status,
        distance: this.distance,
        elevatedTransfer: this.elevatedTransfer.active,
      })
      this.profileStateElapsed = 0
    }
    if (this.profileElapsed < 4) return

    const sortedFrameTimes = [...this.profileFrameTimes].sort((a, b) => a - b)
    const percentile = (ratio: number) => sortedFrameTimes[
      Math.min(sortedFrameTimes.length - 1, Math.floor(sortedFrameTimes.length * ratio))
    ] ?? 0
    let sceneObjects = 0
    this.scene.traverse(() => { sceneObjects += 1 })
    canvas.dataset.profile = JSON.stringify({
      fps: this.profileFrames / this.profileElapsed,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: sortedFrameTimes[sortedFrameTimes.length - 1] ?? 0,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      sceneObjects,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      pixelRatio: this.renderer.getPixelRatio(),
      lane: this.laneIndex,
      supportLane: this.supportLaneIndex,
      surfaceHeight: this.surfaceHeight,
      surfaceTransition: this.surfaceTransitionKind,
      status: this.status,
      distance: this.distance,
      rampLength: RAMP_LENGTH,
      rampAngleDegrees: THREE.MathUtils.radToDeg(Math.atan(TRAIN_ROOF_HEIGHT / RAMP_LENGTH)),
      cameraY: this.camera.position.y,
      cameraZ: this.camera.position.z,
      overheadHeight: OVERHEAD_GANTRY_HEIGHT,
      elevatedTransfer: this.elevatedTransfer.active,
      trainHazards: this.hazards
        .filter((hazard) => hazard.kind === 'block')
        .map((hazard) => ({ lane: hazard.lane, z: hazard.group.position.z })),
      routePositions: this.roofRoutes.map((route) => ({ lane: route.lane, z: route.group.position.z })),
    })
    this.profileElapsed = 0
    this.profileFrames = 0
    this.profileFrameTimes.length = 0
  }

  private updateGame(delta: number) {
    this.elapsed += delta
    this.speed = Math.min(MAX_SPEED, START_SPEED + this.distance / 235)
    const travel = this.speed * delta
    this.distance += travel
    this.score = Math.floor(this.distance * 4.5) + this.coinCount * 25

    this.updateWorld(travel, delta)
    this.updatePlayer(delta)
    this.checkCollisions()

    this.snapshotTimer += delta
    if (this.snapshotTimer > 0.09) {
      this.snapshotTimer = 0
      this.emitSnapshot()
    }
  }

  private updateIdle(delta: number) {
    this.elapsed += delta * 0.42
    const stride = Math.sin(this.elapsed * 4.2) * 0.08
    this.player.position.y = Math.max(0, stride)
    const poseBlend = 1 - Math.exp(-delta * 18)
    this.player.scale.x = THREE.MathUtils.lerp(this.player.scale.x, 1, poseBlend)
    this.player.scale.y = THREE.MathUtils.lerp(this.player.scale.y, 1, poseBlend)
    this.player.scale.z = THREE.MathUtils.lerp(this.player.scale.z, 1, poseBlend)
    this.player.rotation.x = THREE.MathUtils.lerp(this.player.rotation.x, 0, poseBlend)
    this.animateLimbs(this.elapsed * 4.2, 0.22)
    this.updatePlayerShadow(0, 0)
    this.coins.forEach((coin) => {
      coin.mesh.rotation.y += delta * 2.1
      coin.mesh.rotation.z = Math.sin(this.elapsed * 2 + coin.mesh.position.z) * 0.12
    })
    this.syncCoinInstances()
  }

  private updateWorld(travel: number, delta: number) {
    const totalTrackLength = TRACK_LENGTH * TRACK_SEGMENTS
    for (let index = 0; index < this.trackZs.length; index += 1) {
      this.trackZs[index] += travel
      if (this.trackZs[index] > 18) this.trackZs[index] -= totalTrackLength
    }
    this.syncTrackInstances()

    this.scenery.forEach((item) => {
      item.position.z += travel * 0.92
      if (item.position.z > 34) item.position.z -= this.scenery.length * 13.5
      item.visible = item.position.z > -178 && item.position.z < 42
    })

    this.roofRoutes.forEach((route) => {
      route.group.position.z += travel
      if (route.group.position.z > PLAYER_Z - ROUTE_DOWN_BACK + 7) this.recycleRoofRoute(route)
      route.group.visible = route.group.position.z + ROUTE_UP_FRONT > -185 &&
        route.group.position.z + ROUTE_DOWN_BACK < 32
    })

    this.hazards.forEach((hazard) => {
      hazard.group.position.z += travel
      if (hazard.group.position.z > 15) this.recycleHazard(hazard)
      hazard.group.visible = hazard.group.position.z > -175 && hazard.group.position.z < 22
    })

    this.coins.forEach((coin) => {
      if (coin.route && coin.localZ !== undefined) {
        coin.lane = coin.route.lane
        coin.mesh.position.x = LANES[coin.route.lane]
        coin.mesh.position.z = coin.route.group.position.z + coin.localZ
      } else {
        coin.mesh.position.z += travel
      }
      coin.mesh.rotation.y += delta * 5.6
      coin.mesh.rotation.z = Math.sin(this.elapsed * 2.2 + coin.mesh.position.z) * 0.08
      coin.mesh.position.y = coin.baseY + Math.sin(this.elapsed * 5.5 + coin.mesh.position.z * 0.16) * 0.08
      if (!coin.route && coin.mesh.position.z > 13) this.recycleCoin(coin)
    })
    this.syncCoinInstances()

    this.updateEffects(delta)
  }

  private updatePlayer(delta: number) {
    const xDelta = this.targetX - this.player.position.x
    this.player.position.x += xDelta * Math.min(1, delta * 17.5)
    this.player.rotation.z = THREE.MathUtils.lerp(this.player.rotation.z, -xDelta * 0.07, Math.min(1, delta * 18))

    this.previousSurfaceHeight = this.surfaceHeight
    const sourceLane = this.supportLaneIndex
    let sourceSurface = this.getSupportSurfaceAtWorldZ(sourceLane, PLAYER_Z)
    const destinationRouteSurface = this.getRouteSurfaceAtWorldZ(this.laneIndex, PLAYER_Z)
    const destinationTrainSurface = this.getObstacleTrainRoofAtWorldZ(this.laneIndex, PLAYER_Z)
    let destinationSurface = Math.max(destinationRouteSurface, destinationTrainSurface)
    let intermediateSurface = Math.abs(sourceLane - this.laneIndex) === 2
      ? this.getSupportSurfaceAtWorldZ(1, PLAYER_Z)
      : 0
    const transferIsCurrent = this.elevatedTransfer.active &&
      this.elevatedTransfer.sourceLane === sourceLane &&
      this.elevatedTransfer.destinationLane === this.laneIndex &&
      this.distance - this.elevatedTransfer.startedDistance <= ELEVATED_TRANSFER_MAX_DISTANCE
    if (transferIsCurrent) {
      sourceSurface = Math.max(sourceSurface, this.elevatedTransfer.sourceSurface)
      destinationSurface = Math.max(destinationSurface, this.elevatedTransfer.destinationSurface)
      intermediateSurface = Math.max(intermediateSurface, this.elevatedTransfer.intermediateSurface)
    } else if (this.elevatedTransfer.active) {
      this.elevatedTransfer.active = false
    }
    const transitionDistance = Math.abs(LANES[this.laneIndex] - LANES[sourceLane])
    const transitionProgress = transitionDistance < 0.01
      ? 1
      : 1 - Math.abs(LANES[this.laneIndex] - this.player.position.x) / transitionDistance
    const transitionInput = this.surfaceTransitionInput
    transitionInput.sourceLane = sourceLane
    transitionInput.destinationLane = this.laneIndex
    transitionInput.sourceSurface = sourceSurface
    transitionInput.destinationSurface = destinationSurface
    transitionInput.intermediateSurface = Math.abs(sourceLane - this.laneIndex) === 2
      ? intermediateSurface
      : undefined
    transitionInput.progress = transitionProgress
    const transition = resolveSurfaceTransition(transitionInput, this.surfaceTransitionResult)
    if (
      sourceLane === this.laneIndex &&
      destinationTrainSurface > 0 &&
      destinationRouteSurface <= 0 &&
      this.previousSurfaceHeight < destinationTrainSurface - 0.4
    ) {
      transition.height = this.previousSurfaceHeight
      transition.kind = 'unsupported'
      transition.destinationSupported = false
    }
    this.surfaceTransitionKind = transition.kind
    if (transition.kind === 'same-lane' && destinationSurface <= 0 && this.surfaceHeight >= 0.035) {
      this.surfaceHeight = THREE.MathUtils.lerp(this.surfaceHeight, 0, 1 - Math.exp(-delta * 8.5))
      if (this.surfaceHeight < 0.018) this.surfaceHeight = 0
    } else {
      this.surfaceHeight = Math.max(0, transition.height)
    }
    if (
      Math.abs(this.player.position.x - LANES[this.laneIndex]) < 0.18 &&
      transition.destinationSupported
    ) {
      this.supportLaneIndex = this.laneIndex
      if (transferIsCurrent) this.elevatedTransfer.active = false
    }
    if (this.previousSurfaceHeight < TRAIN_ROOF_HEIGHT - 0.08 && this.surfaceHeight >= TRAIN_ROOF_HEIGHT - 0.02) {
      this.triggerLandingEffect()
    }

    const jumpStep = stepJumpMotion(this.jumpMotion, delta)
    this.jumpMotion = jumpStep.state
    if (jumpStep.landed) {
      this.landingElapsed = 0
      this.triggerLandingEffect()
    }
    else if (!this.jumpMotion.airborne) {
      this.landingElapsed = Math.min(LANDING_TOTAL_DURATION, this.landingElapsed + delta)
    }

    this.fallbackSlideTimer = Math.max(0, this.fallbackSlideTimer - delta)
    const sliding = this.isCrouching() && !this.jumpMotion.airborne
    const jumpPhase = getJumpPhase(this.jumpMotion)
    const landingCompression = getLandingCompression(this.landingElapsed)
    const takeoffProgress = jumpPhase === 'takeoff'
      ? Math.min(1, this.jumpMotion.elapsed / TAKEOFF_POSE_DURATION)
      : 1
    const takeoffCompression = jumpPhase === 'takeoff'
      ? Math.sin(takeoffProgress * Math.PI) * 0.075
      : 0
    const targetScaleY = sliding
      ? 0.48
      : 1 - takeoffCompression - landingCompression * 0.14
    const targetScaleXZ = 1 + takeoffCompression * 0.45 + landingCompression * 0.055
    const scaleBlend = 1 - Math.exp(-delta * 28)
    this.player.scale.y = THREE.MathUtils.lerp(this.player.scale.y, targetScaleY, scaleBlend)
    this.player.scale.x = THREE.MathUtils.lerp(this.player.scale.x, targetScaleXZ, scaleBlend)
    this.player.scale.z = THREE.MathUtils.lerp(this.player.scale.z, targetScaleXZ, scaleBlend)
    const motionRecovered =
      !sliding &&
      !this.jumpMotion.airborne &&
      this.landingElapsed >= LANDING_TOTAL_DURATION
    if (motionRecovered) this.player.scale.set(1, 1, 1)

    this.player.position.y = this.surfaceHeight + this.jumpMotion.height
    const airbornePitch = jumpPhase === 'takeoff'
      ? -0.1
      : jumpPhase === 'rising'
        ? -0.055
        : jumpPhase === 'falling'
          ? 0.065
          : 0
    const targetPitch = sliding ? -0.18 : airbornePitch + landingCompression * 0.055
    this.player.rotation.x = THREE.MathUtils.lerp(
      this.player.rotation.x,
      targetPitch,
      1 - Math.exp(-delta * 20),
    )
    if (motionRecovered) this.player.rotation.x = 0

    if (this.jumpMotion.airborne) this.animateAirbornePose(jumpPhase)
    else if (landingCompression > 0) this.animateLandingPose(landingCompression)
    else this.animateLimbs(this.elapsed * (9.5 + this.speed * 0.08), sliding ? 0.18 : 0.72)
    this.updatePlayerShadow(this.jumpMotion.height, landingCompression)

    const targetCameraY = CAMERA_GROUND_Y + this.surfaceHeight * 0.68
    const targetCameraX = this.player.position.x * 0.72
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCameraX, 1 - Math.exp(-delta * 7))
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCameraY, 1 - Math.exp(-delta * 5.5))
    const targetLookHeight = 1.9 + this.surfaceHeight * 0.56
    this.cameraLookHeight = THREE.MathUtils.lerp(this.cameraLookHeight, targetLookHeight, 1 - Math.exp(-delta * 6))
    this.cameraLookX = THREE.MathUtils.lerp(this.cameraLookX, this.player.position.x * 0.44, 1 - Math.exp(-delta * 7))
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, CAMERA_Z, 1 - Math.exp(-delta * 4))
    this.camera.lookAt(this.cameraLookX, this.cameraLookHeight, CAMERA_LOOK_Z)
  }

  private animateLimbs(phase: number, amount: number) {
    const swing = Math.sin(phase) * amount
    if (this.playerParts.leftArm) {
      this.playerParts.leftArm.position.y = 2.25
      this.playerParts.leftArm.rotation.x = swing
    }
    if (this.playerParts.rightArm) {
      this.playerParts.rightArm.position.y = 2.25
      this.playerParts.rightArm.rotation.x = -swing
    }
    if (this.playerParts.leftLeg) {
      this.playerParts.leftLeg.position.y = 0.75
      this.playerParts.leftLeg.rotation.x = -swing * 0.85
    }
    if (this.playerParts.rightLeg) {
      this.playerParts.rightLeg.position.y = 0.75
      this.playerParts.rightLeg.rotation.x = swing * 0.85
    }
    if (this.playerParts.leftShoe) {
      this.playerParts.leftShoe.position.y = 0.18 + Math.max(0, swing) * 0.11
      this.playerParts.leftShoe.position.z = -0.18 + swing * 0.34
      this.playerParts.leftShoe.rotation.x = -swing * 0.22
    }
    if (this.playerParts.rightShoe) {
      this.playerParts.rightShoe.position.y = 0.18 + Math.max(0, -swing) * 0.11
      this.playerParts.rightShoe.position.z = -0.18 - swing * 0.34
      this.playerParts.rightShoe.rotation.x = swing * 0.22
    }
    if (this.playerParts.torso) {
      this.playerParts.torso.rotation.x = 0
      this.playerParts.torso.rotation.y = Math.sin(phase) * 0.045
    }
  }

  private animateAirbornePose(phase: JumpPhase) {
    const ascentAmount = phase === 'takeoff' ? 0.35 : phase === 'rising' ? 1 : phase === 'apex' ? 0.9 : 0.35
    const tuckAmount = phase === 'takeoff' ? 0.25 : phase === 'rising' ? 0.82 : phase === 'apex' ? 1 : 0.42
    const falling = phase === 'falling'

    if (this.playerParts.leftArm) {
      this.playerParts.leftArm.position.y = 2.25 + ascentAmount * 0.1
      this.playerParts.leftArm.rotation.x = falling ? 0.22 : -0.95 * ascentAmount
    }
    if (this.playerParts.rightArm) {
      this.playerParts.rightArm.position.y = 2.25 + ascentAmount * 0.1
      this.playerParts.rightArm.rotation.x = falling ? 0.08 : -0.78 * ascentAmount
    }
    if (this.playerParts.leftLeg) {
      this.playerParts.leftLeg.position.y = 0.75 + tuckAmount * 0.18
      this.playerParts.leftLeg.rotation.x = falling ? -0.2 : 0.62 * tuckAmount
    }
    if (this.playerParts.rightLeg) {
      this.playerParts.rightLeg.position.y = 0.75 + tuckAmount * 0.14
      this.playerParts.rightLeg.rotation.x = falling ? 0.32 : -0.48 * tuckAmount
    }
    if (this.playerParts.leftShoe) {
      this.playerParts.leftShoe.position.y = 0.18 + tuckAmount * 0.18
      this.playerParts.leftShoe.position.z = -0.18 + tuckAmount * 0.3
      this.playerParts.leftShoe.rotation.x = -0.35 * tuckAmount
    }
    if (this.playerParts.rightShoe) {
      this.playerParts.rightShoe.position.y = 0.18 + tuckAmount * 0.12
      this.playerParts.rightShoe.position.z = -0.18 - tuckAmount * 0.24
      this.playerParts.rightShoe.rotation.x = 0.26 * tuckAmount
    }
    if (this.playerParts.torso) {
      this.playerParts.torso.rotation.x = falling ? 0.045 : -0.035 * ascentAmount
      this.playerParts.torso.rotation.y = 0
    }
  }

  private animateLandingPose(compression: number) {
    if (this.playerParts.leftArm) {
      this.playerParts.leftArm.position.y = 2.25 - compression * 0.06
      this.playerParts.leftArm.rotation.x = 0.28 * compression
    }
    if (this.playerParts.rightArm) {
      this.playerParts.rightArm.position.y = 2.25 - compression * 0.06
      this.playerParts.rightArm.rotation.x = -0.18 * compression
    }
    if (this.playerParts.leftLeg) {
      this.playerParts.leftLeg.position.y = 0.75 - compression * 0.08
      this.playerParts.leftLeg.rotation.x = -0.2 * compression
    }
    if (this.playerParts.rightLeg) {
      this.playerParts.rightLeg.position.y = 0.75 - compression * 0.08
      this.playerParts.rightLeg.rotation.x = 0.2 * compression
    }
    if (this.playerParts.leftShoe) {
      this.playerParts.leftShoe.position.y = 0.18 - compression * 0.025
      this.playerParts.leftShoe.position.z = -0.18
      this.playerParts.leftShoe.rotation.x = -0.08 * compression
    }
    if (this.playerParts.rightShoe) {
      this.playerParts.rightShoe.position.y = 0.18 - compression * 0.025
      this.playerParts.rightShoe.position.z = -0.18
      this.playerParts.rightShoe.rotation.x = 0.08 * compression
    }
    if (this.playerParts.torso) {
      this.playerParts.torso.rotation.x = 0.075 * compression
      this.playerParts.torso.rotation.y = 0
    }
  }

  private updatePlayerShadow(jumpHeight: number, landingCompression: number) {
    const shadow = this.playerShadow
    if (!shadow) return
    shadow.position.x = this.player.position.x
    shadow.position.y = this.surfaceHeight + 0.055
    const heightRatio = Math.min(1, jumpHeight / 2)
    const scale = 1 - heightRatio * 0.3 + landingCompression * 0.055
    shadow.scale.setScalar(scale)
    const material = shadow.material
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.34 - heightRatio * 0.13 + landingCompression * 0.035
    }
  }

  private checkCollisions() {
    const playerX = this.player.position.x
    for (const hazard of this.hazards) {
      if (hazard.hit) continue
      const zDistance = Math.abs(hazard.group.position.z - PLAYER_Z)
      const xDistance = Math.abs(LANES[hazard.lane] - playerX)
      const collisionDepth = hazard.kind === 'block' ? 3.0 : 1.36
      if (zDistance < collisionDepth && xDistance < 1.08) {
        const sliding = this.isCrouching()
        const safelyOnTrainRoof = hazard.kind === 'block' && isSafelyAboveTrainRoof(
          this.surfaceHeight + this.jumpMotion.height,
          OBSTACLE_TRAIN_ROOF_HEIGHT,
        )
        const safe =
          (hazard.kind === 'jump' && this.jumpMotion.height > JUMP_CLEARANCE_HEIGHT) ||
          (hazard.kind === 'slide' && sliding) ||
          safelyOnTrainRoof
        if (!safe) {
          hazard.hit = true
          this.crash()
          return
        }
      }
    }

    if (this.surfaceTransitionKind === 'unsupported') {
      const targetRouteSurface = this.getRouteSurfaceAtWorldZ(this.laneIndex, PLAYER_Z)
      if (
        targetRouteSurface > 0.62 &&
        Math.abs(LANES[this.laneIndex] - playerX) < 1.08 &&
        !isSafelyAboveTrainRoof(this.surfaceHeight + this.jumpMotion.height, targetRouteSurface)
      ) {
        this.crash()
        return
      }
    }

    for (const coin of this.coins) {
      if (coin.collected) continue
      if (
        Math.abs(coin.mesh.position.z - PLAYER_Z) < 1.18 &&
        Math.abs(coin.mesh.position.x - playerX) < 0.92 &&
        Math.abs(coin.mesh.position.y - (this.surfaceHeight + this.jumpMotion.height + 1.05)) < 1.45
      ) {
        this.triggerCoinBurst(coin.mesh.position)
        coin.collected = true
        coin.mesh.visible = false
        this.coinCount += 1
        this.score += 25
        this.options.onCoin()
      }
    }
  }

  private crash() {
    this.elevatedTransfer.active = false
    this.status = 'gameover'
    this.player.rotation.z = this.player.position.x < 0 ? 0.38 : -0.38
    this.options.onCrash(this.getSnapshot())
  }

  private getSnapshot(): GameSnapshot {
    return {
      score: this.score,
      coins: this.coinCount,
      distance: Math.floor(this.distance),
      speed: this.speed,
      multiplier: Math.min(5, 1 + Math.floor(this.distance / 300)),
    }
  }

  private emitSnapshot() {
    this.options.onSnapshot(this.getSnapshot())
  }

  private isCrouching() {
    return this.cameraCrouching || this.manualCrouching || this.fallbackSlideTimer > 0
  }

  private resize = () => {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.fov = width / height < 0.7 ? 60 : 54
    this.camera.updateProjectionMatrix()
  }
}
