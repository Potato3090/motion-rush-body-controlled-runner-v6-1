import * as THREE from 'three'
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

type HazardKind = 'block' | 'jump' | 'slide'

interface Hazard {
  group: THREE.Group
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
const TRAIN_ROOF_HEIGHT = 2.5
const RAMP_LENGTH = 10
const ROUTE_UP_FRONT = 19
const ROUTE_UP_BACK = ROUTE_UP_FRONT - RAMP_LENGTH
const ROUTE_ROOF_BACK = -19
const ROUTE_DOWN_BACK = ROUTE_ROOF_BACK - RAMP_LENGTH

const palette = {
  ink: 0x132543,
  purple: 0x6c48e8,
  violet: 0xa886ff,
  cyan: 0x22d3c5,
  blue: 0x168fea,
  sky: 0x7dd8ff,
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
  item.castShadow = true
  item.receiveShadow = true
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
  private readonly tracks: THREE.Group[] = []
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
  private surfaceHeight = 0
  private previousSurfaceHeight = 0
  private cameraLookHeight = 1.9
  private cameraLookX = 0
  private burstCursor = 0
  private landingEffectAge = 1

  constructor(container: HTMLElement, options: RunnerEngineOptions) {
    this.container = container
    this.options = options
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.14
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
      this.camera.position.x = 0
      this.camera.position.y = 7.8
      this.camera.lookAt(0, this.cameraLookHeight, -18)
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
    this.camera.position.set(0, 7.8, 15.1)
    this.camera.lookAt(0, this.cameraLookHeight, -18)
    this.landingEffectAge = 1
    this.resetWorldObjects()
    this.emitSnapshot()
  }

  action(action: RunnerAction) {
    if (this.status !== 'playing') return

    if (action === 'left') {
      this.laneIndex = Math.max(0, this.laneIndex - 1) as RunnerLane
      this.targetX = LANES[this.laneIndex]
      return
    }
    if (action === 'right') {
      this.laneIndex = Math.min(2, this.laneIndex + 1) as RunnerLane
      this.targetX = LANES[this.laneIndex]
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
    this.scene.fog = new THREE.Fog(0xbceaff, 82, 285)

    const hemisphere = new THREE.HemisphereLight(0xeafaff, 0x6c7764, 2.75)
    this.scene.add(hemisphere)

    const sun = new THREE.DirectionalLight(0xfff0c5, 3.35)
    sun.position.set(-16, 24, 18)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -12
    sun.shadow.camera.right = 12
    sun.shadow.camera.top = 20
    sun.shadow.camera.bottom = -7
    sun.shadow.camera.near = 2
    sun.shadow.camera.far = 70
    sun.shadow.bias = -0.00018
    this.scene.add(sun)

    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(6.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false }),
    )
    sunDisc.position.set(-24, 22, -150)
    this.scene.add(sunDisc)

    this.createSkyline()

    this.camera.position.set(0, 7.8, 15.1)
    this.camera.lookAt(0, 1.9, -18)

    for (let i = 0; i < TRACK_SEGMENTS; i += 1) this.createTrackSegment(i)
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
      this.scene.add(coin.mesh)
    }

    this.createEffects()

    this.resetWorldObjects()
  }

  private createSkyline() {
    const cloudMaterial = flatMaterial(0xffffff, 0.78)
    for (let i = 0; i < 7; i += 1) {
      const cloud = new THREE.Group()
      for (let puff = 0; puff < 4; puff += 1) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(1.2 + (puff % 2) * 0.45, 12, 8),
          cloudMaterial,
        )
        sphere.scale.y = 0.56
        sphere.position.set((puff - 1.5) * 1.25, (puff % 2) * 0.42, 0)
        cloud.add(sphere)
      }
      cloud.position.set((i % 2 ? 1 : -1) * (10 + i * 2.8), 13 + (i % 3) * 2.1, -65 - i * 22)
      cloud.rotation.y = i % 2 ? -0.16 : 0.14
      this.scene.add(cloud)
    }

    const skyline = new THREE.Group()
    const skylineColors = [0x6f94bd, 0x7aa5bd, 0x7395ad, 0x84a6c6]
    for (let i = 0; i < 22; i += 1) {
      const side = i % 2 ? 1 : -1
      const height = 9 + ((i * 7) % 16)
      const building = mesh(
        new THREE.BoxGeometry(4 + (i % 4), height, 5),
        skylineColors[i % skylineColors.length],
        0.95,
      )
      building.castShadow = false
      building.position.set(side * (14 + (i % 7) * 5), height / 2 - 0.5, -135 - (i % 5) * 18)
      skyline.add(building)
    }

    const tunnelArch = new THREE.Mesh(
      new THREE.TorusGeometry(6.4, 0.38, 8, 32, Math.PI),
      material(0x376f91, 0.7, 0.18),
    )
    tunnelArch.position.set(0, 0.6, -205)
    const tunnelLeft = mesh(new THREE.BoxGeometry(0.78, 6.7, 1.0), 0x376f91, 0.72, 0.16)
    tunnelLeft.position.set(-6.4, 3.4, -205)
    const tunnelRight = tunnelLeft.clone()
    tunnelRight.position.x = 6.4
    skyline.add(tunnelArch, tunnelLeft, tunnelRight)
    this.scene.add(skyline)
  }

  private createTrainVisual(themeIndex: number, length: number, roofRoute: boolean) {
    const theme = trainThemes[themeIndex % trainThemes.length]
    const train = new THREE.Group()
    const bodyHeight = roofRoute ? 2.25 : 2.75
    const body = mesh(new THREE.BoxGeometry(2.72, bodyHeight, length), theme.primary, 0.56, 0.08)
    body.position.y = bodyHeight / 2 + 0.12
    train.add(body)

    const lowerBand = mesh(new THREE.BoxGeometry(2.78, 0.42, length + 0.05), theme.secondary, 0.55, 0.08)
    lowerBand.position.y = 0.49
    train.add(lowerBand)

    const roof = mesh(new THREE.BoxGeometry(2.8, 0.2, length - 0.18), theme.trim, 0.48, 0.14)
    roof.position.y = roofRoute ? TRAIN_ROOF_HEIGHT - 0.1 : bodyHeight + 0.15
    train.add(roof)

    const windowY = roofRoute ? 1.58 : 1.9
    const windowCount = Math.max(2, Math.min(9, Math.floor(length / 3.3)))
    const windowSpacing = (length - 2.1) / windowCount
    for (let i = 0; i < windowCount; i += 1) {
      const z = -length / 2 + 1.1 + windowSpacing * (i + 0.5)
      for (const side of [-1, 1]) {
        const window = mesh(new THREE.BoxGeometry(0.055, 0.72, Math.min(1.65, windowSpacing * 0.66)), 0x174b70, 0.2, 0.3)
        window.position.set(side * 1.385, windowY, z)
        train.add(window)
      }
    }

    const doorZs = length > 12 ? [-length * 0.28, length * 0.28] : [0]
    for (const z of doorZs) {
      for (const side of [-1, 1]) {
        const door = mesh(new THREE.BoxGeometry(0.06, 1.38, 1.04), theme.secondary, 0.58)
        door.position.set(side * 1.405, 1.23, z)
        train.add(door)
        const doorWindow = mesh(new THREE.BoxGeometry(0.065, 0.48, 0.58), 0xbeeaff, 0.18, 0.2)
        doorWindow.position.set(side * 1.442, 1.58, z)
        train.add(doorWindow)
      }
    }

    for (const z of [-length * 0.31, length * 0.31]) {
      const axle = mesh(new THREE.CylinderGeometry(0.31, 0.31, 2.42, 12), 0x26303c, 0.68, 0.36)
      axle.rotation.z = Math.PI / 2
      axle.position.set(0, 0.25, z)
      train.add(axle)
    }

    const front = mesh(new THREE.BoxGeometry(2.5, roofRoute ? 1.75 : 2.2, 0.16), theme.secondary, 0.42, 0.08)
    front.position.set(0, roofRoute ? 1.32 : 1.56, length / 2 + 0.09)
    train.add(front)
    const windshield = mesh(new THREE.BoxGeometry(1.78, roofRoute ? 0.62 : 0.82, 0.1), 0x153e63, 0.16, 0.28)
    windshield.position.set(0, roofRoute ? 1.66 : 2.0, length / 2 + 0.19)
    train.add(windshield)
    const bumper = mesh(new THREE.BoxGeometry(2.76, 0.3, 0.24), theme.trim, 0.48, 0.18)
    bumper.position.set(0, 0.48, length / 2 + 0.2)
    train.add(bumper)
    for (const x of [-0.82, 0.82]) {
      const light = mesh(new THREE.SphereGeometry(0.16, 10, 8), 0xfff2a8, 0.2, 0.05)
      light.position.set(x, 0.94, length / 2 + 0.23)
      train.add(light)
    }

    return train
  }

  private createRamp(centerZ: number, descending: boolean) {
    const ramp = new THREE.Group()
    const slope = new THREE.Group()
    const angle = Math.atan(TRAIN_ROOF_HEIGHT / RAMP_LENGTH) * (descending ? -1 : 1)
    slope.position.set(0, TRAIN_ROOF_HEIGHT / 2, centerZ)
    slope.rotation.x = angle

    const deck = mesh(new THREE.BoxGeometry(2.78, 0.2, RAMP_LENGTH), palette.blue, 0.52, 0.08)
    slope.add(deck)
    for (const side of [-1, 1]) {
      const rail = mesh(new THREE.BoxGeometry(0.14, 0.25, RAMP_LENGTH + 0.08), palette.cream, 0.55, 0.08)
      rail.position.set(side * 1.34, 0.18, 0)
      slope.add(rail)
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
    for (const z of [-3.1, 0, 3.1]) {
      const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), flatMaterial(palette.cream))
      arrow.rotation.x = -Math.PI / 2
      arrow.rotation.z = descending ? Math.PI : 0
      arrow.position.set(0, 0.112, z)
      slope.add(arrow)
    }
    ramp.add(slope)

    for (const side of [-1, 1]) {
      const support = mesh(new THREE.BoxGeometry(0.14, TRAIN_ROOF_HEIGHT, 0.14), 0x315e81, 0.65, 0.22)
      support.position.set(side * 1.1, TRAIN_ROOF_HEIGHT / 2, centerZ + (descending ? -RAMP_LENGTH * 0.42 : -RAMP_LENGTH * 0.42))
      ramp.add(support)
    }
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
    const group = new THREE.Group()
    const disc = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 22), palette.yellow, 0.2, 0.82)
    disc.rotation.x = Math.PI / 2
    disc.castShadow = true
    const rim = mesh(new THREE.TorusGeometry(0.4, 0.055, 8, 22), 0xffe779, 0.16, 0.88)
    const mark = new THREE.Mesh(new THREE.ShapeGeometry(createBoltShape(0.45)), flatMaterial(0xfff6bb))
    mark.position.z = 0.075
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), flatMaterial(0xffdf64, 0.16))
    glow.position.z = -0.09
    group.add(glow, disc, rim, mark)
    group.scale.setScalar(0.84)
    return { mesh: group, lane: 1, collected: false, baseY: 1.1 }
  }

  private createEffects() {
    const ringMaterial = flatMaterial(0xc9fbff, 0)
    ringMaterial.depthWrite = false
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.76, 24), ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    this.landingRing = ring
    this.scene.add(ring)

    for (let burstIndex = 0; burstIndex < 6; burstIndex += 1) {
      const group = new THREE.Group()
      const burstMaterial = new THREE.MeshBasicMaterial({ color: 0xffe36c, transparent: true, opacity: 0 })
      const velocities: THREE.Vector3[] = []
      for (let i = 0; i < 7; i += 1) {
        const sparkle = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), burstMaterial)
        group.add(sparkle)
        velocities.push(new THREE.Vector3())
      }
      group.visible = false
      this.coinBursts.push({ group, velocities, age: 1 })
      this.scene.add(group)
    }
  }

  private createTrackSegment(index: number) {
    const group = new THREE.Group()
    const trackBed = mesh(new THREE.BoxGeometry(12.2, 0.5, TRACK_LENGTH), palette.ballast, 0.98)
    trackBed.position.y = -0.34
    group.add(trackBed)

    const railGeometry = new THREE.BoxGeometry(0.11, 0.14, TRACK_LENGTH)
    const railInstances = new THREE.InstancedMesh(railGeometry, material(palette.rail, 0.22, 0.82), 6)
    const railShadowInstances = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.2, 0.055, TRACK_LENGTH),
      material(0x484b51, 0.9),
      6,
    )
    const sleeperInstances = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.72, 0.105, 0.28),
      material(palette.sleeper, 0.96),
      27,
    )
    const instanceTransform = new THREE.Object3D()
    let railIndex = 0
    let sleeperIndex = 0

    for (let lane = 0; lane < LANES.length; lane += 1) {
      const laneBed = mesh(
        new THREE.BoxGeometry(2.8, 0.11, TRACK_LENGTH - 0.06),
        lane === 1 ? 0x77747a : 0x838087,
        0.95,
      )
      laneBed.position.set(LANES[lane], -0.055, 0)
      group.add(laneBed)

      for (const offset of [-0.72, 0.72]) {
        instanceTransform.position.set(LANES[lane] + offset, 0.13, 0)
        instanceTransform.updateMatrix()
        railInstances.setMatrixAt(railIndex, instanceTransform.matrix)
        instanceTransform.position.y = 0.035
        instanceTransform.updateMatrix()
        railShadowInstances.setMatrixAt(railIndex, instanceTransform.matrix)
        railIndex += 1
      }

      for (let z = -8; z <= 8; z += 1.82) {
        instanceTransform.position.set(LANES[lane], 0.025, z)
        instanceTransform.updateMatrix()
        sleeperInstances.setMatrixAt(sleeperIndex, instanceTransform.matrix)
        sleeperIndex += 1
      }
    }
    railInstances.castShadow = true
    railInstances.receiveShadow = true
    railShadowInstances.receiveShadow = true
    sleeperInstances.receiveShadow = true
    group.add(railInstances, railShadowInstances, sleeperInstances)

    for (const side of [-1, 1]) {
      const platform = mesh(new THREE.BoxGeometry(2.05, 0.62, TRACK_LENGTH), 0xd8c8a8, 0.92)
      platform.position.set(side * 7.0, 0.04, 0)
      group.add(platform)
      const platformTop = mesh(new THREE.BoxGeometry(2.06, 0.11, TRACK_LENGTH), 0xf5e6c8, 0.82)
      platformTop.position.set(side * 7.0, 0.405, 0)
      group.add(platformTop)
      const safetyLine = mesh(new THREE.BoxGeometry(0.24, 0.045, TRACK_LENGTH), palette.yellow, 0.58)
      safetyLine.position.set(side * 6.02, 0.485, 0)
      group.add(safetyLine)
      const curb = mesh(new THREE.BoxGeometry(0.18, 0.7, TRACK_LENGTH), side < 0 ? palette.blue : palette.coral, 0.7)
      curb.position.set(side * 5.95, 0.05, 0)
      group.add(curb)
    }

    for (const x of [LANES[0], LANES[2]]) {
      const wire = mesh(new THREE.BoxGeometry(0.018, 0.018, TRACK_LENGTH), 0x8da8b3, 0.45, 0.55)
      wire.position.set(x, 6.45, 0)
      wire.castShadow = false
      group.add(wire)
    }

    if (index % 3 === 1) {
      for (const side of [-1, 1]) {
        const mast = mesh(new THREE.CylinderGeometry(0.11, 0.15, 6.65, 8), 0x52758a, 0.55, 0.38)
        mast.position.set(side * 5.72, 3.3, -7.4)
        group.add(mast)
      }
      const gantry = mesh(new THREE.BoxGeometry(11.65, 0.17, 0.2), 0x52758a, 0.55, 0.38)
      gantry.position.set(0, 6.42, -7.4)
      group.add(gantry)
      for (const x of [LANES[0], LANES[2]]) {
        const hanger = mesh(new THREE.BoxGeometry(0.055, 0.7, 0.055), 0x52758a, 0.5, 0.35)
        hanger.position.set(x, 6.02, -7.4)
        group.add(hanger)
      }
    }

    group.position.z = -index * TRACK_LENGTH + 9
    this.tracks.push(group)
    this.scene.add(group)
  }

  private createScenery(index: number) {
    const group = new THREE.Group()
    const side = index % 2 === 0 ? -1 : 1
    const height = 5.5 + ((index * 5) % 8)
    const width = 4 + ((index * 3) % 4)
    const buildingColors = [0xff856a, 0x4dbfc0, 0xffd06d, 0x6e82df, 0xa56bd8, 0x60b97a]
    const buildingX = side * (10.5 + (index % 3) * 1.5)
    const body = mesh(
      new THREE.BoxGeometry(width, height, 5.8),
      buildingColors[index % buildingColors.length],
      0.84,
    )
    body.position.set(buildingX, height / 2 + 0.3, 0)
    group.add(body)

    const roof = mesh(
      new THREE.BoxGeometry(width + 0.35, 0.32, 6.15),
      index % 2 ? palette.coral : palette.yellow,
      0.72,
    )
    roof.position.set(buildingX, height + 0.48, 0)
    group.add(roof)

    const windowMaterial = flatMaterial(index % 3 === 0 ? 0xe9fbff : 0x254d74)
    const windowPositions: Array<{ y: number; z: number }> = []
    for (let y = 1.7; y < height - 0.45; y += 1.55) {
      for (const z of [-1.55, 0, 1.55]) {
        windowPositions.push({ y, z })
      }
    }
    const windowInstances = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.62, 0.78),
      windowMaterial,
      windowPositions.length,
    )
    const windowTransform = new THREE.Object3D()
    windowPositions.forEach((position, windowIndex) => {
      windowTransform.position.set(buildingX - side * (width / 2 + 0.012), position.y, position.z)
      windowTransform.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2
      windowTransform.updateMatrix()
      windowInstances.setMatrixAt(windowIndex, windowTransform.matrix)
    })
    windowInstances.castShadow = false
    group.add(windowInstances)

    const awning = mesh(new THREE.BoxGeometry(1.5, 0.16, 2.8), index % 2 ? palette.cyan : palette.cream, 0.68)
    awning.position.set(buildingX - side * (width / 2 + 0.7), 2.0, 0)
    awning.rotation.z = side * 0.08
    group.add(awning)

    const fenceColor = index % 2 ? 0x3d7185 : 0x4e6684
    for (const z of [-3.9, 0, 3.9]) {
      const fencePost = mesh(new THREE.BoxGeometry(0.11, 1.25, 0.11), fenceColor, 0.6, 0.25)
      fencePost.position.set(side * 8.15, 1.0, z)
      group.add(fencePost)
    }
    for (const y of [0.65, 1.28]) {
      const fenceRail = mesh(new THREE.BoxGeometry(0.09, 0.09, 7.8), fenceColor, 0.6, 0.25)
      fenceRail.position.set(side * 8.15, y, 0)
      group.add(fenceRail)
    }

    if (index % 3 !== 1) {
      const trunk = mesh(new THREE.CylinderGeometry(0.18, 0.25, 2.15, 8), 0x8a5738, 0.95)
      trunk.position.set(side * 8.9, 1.45, 2.6)
      const leaves = mesh(new THREE.IcosahedronGeometry(1.2, 1), index % 2 ? 0x43b967 : 0x66c75d, 0.92)
      leaves.position.set(side * 8.9, 3.25, 2.6)
      const accentLeaves = mesh(new THREE.IcosahedronGeometry(0.72, 1), index % 4 === 0 ? 0xff70a5 : 0x8dde6e, 0.9)
      accentLeaves.position.set(side * 8.55, 3.65, 2.35)
      group.add(trunk, leaves, accentLeaves)
    }

    const lampPost = mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8), 0x31576e, 0.58, 0.28)
    lampPost.position.set(side * 7.15, 2.55, -3.4)
    const lampArm = mesh(new THREE.BoxGeometry(0.9, 0.09, 0.09), 0x31576e, 0.58, 0.28)
    lampArm.position.set(side * 6.75, 4.58, -3.4)
    const lamp = mesh(new THREE.SphereGeometry(0.2, 10, 8), 0xffed9d, 0.28)
    lamp.position.set(side * 6.35, 4.38, -3.4)
    group.add(lampPost, lampArm, lamp)

    const banner = mesh(new THREE.BoxGeometry(0.06, 1.3, 0.9), index % 2 ? palette.purple : palette.orange, 0.72)
    banner.position.set(side * 7.0, 3.35, -3.38)
    const bannerMark = new THREE.Mesh(new THREE.ShapeGeometry(createBoltShape(0.38)), flatMaterial(palette.cream))
    bannerMark.position.set(side * 6.955, 3.34, -3.87)
    bannerMark.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2
    bannerMark.rotation.z = -0.08
    group.add(banner, bannerMark)

    if (index % 8 === 5) {
      const bridgeColor = index % 16 === 5 ? 0x3e76a3 : 0xe96855
      for (const bridgeSide of [-1, 1]) {
        const support = mesh(new THREE.BoxGeometry(0.7, 11.1, 0.75), bridgeColor, 0.75)
        support.position.set(bridgeSide * 7.9, 5.6, 0)
        group.add(support)
      }
      const bridge = mesh(new THREE.BoxGeometry(16.4, 0.76, 1.1), bridgeColor, 0.72)
      bridge.position.set(0, 10.72, 0)
      group.add(bridge)
      const bridgePanel = mesh(new THREE.BoxGeometry(5.2, 0.52, 0.12), palette.cream, 0.65)
      bridgePanel.position.set(0, 10.72, 0.61)
      group.add(bridgePanel)
      for (const x of [-1.5, 0, 1.5]) {
        const bolt = new THREE.Mesh(new THREE.ShapeGeometry(createBoltShape(0.24)), flatMaterial(x === 0 ? palette.coral : palette.blue))
        bolt.position.set(x, 10.72, 0.685)
        group.add(bolt)
      }
    }

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = false
    })
    body.castShadow = true
    roof.castShadow = true
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
    this.scene.add(this.player)
  }

  private createHazard(kind: HazardKind): Hazard {
    const group = new THREE.Group()
    this.buildHazard(group, kind, 0)
    return { group, kind, lane: 1, hit: false, variant: 0 }
  }

  private buildHazard(group: THREE.Group, kind: HazardKind, variant: number) {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose())
      else object.material.dispose()
    })
    group.clear()
    if (kind === 'block') {
      group.add(this.createTrainVisual(variant, 6.1, false))
    } else if (kind === 'jump') {
      const barrier = mesh(new THREE.BoxGeometry(2.72, 0.78, 0.54), palette.coral, 0.58)
      barrier.position.y = 0.78
      group.add(barrier)
      for (const x of [-0.92, -0.31, 0.31, 0.92]) {
        const stripe = mesh(new THREE.BoxGeometry(0.24, 0.82, 0.58), palette.cream, 0.58)
        stripe.position.set(x, 0.79, 0)
        stripe.rotation.z = -0.28
        group.add(stripe)
      }
      const foot = mesh(new THREE.BoxGeometry(3, 0.16, 0.98), 0x24354b, 0.72, 0.15)
      foot.position.y = 0.08
      group.add(foot)
      for (const x of [-1.12, 1.12]) {
        const post = mesh(new THREE.BoxGeometry(0.17, 1.36, 0.18), 0x344f62, 0.65, 0.25)
        post.position.set(x, 0.68, -0.12)
        const warning = mesh(new THREE.SphereGeometry(0.16, 10, 8), 0xff3b45, 0.2)
        warning.position.set(x, 1.48, 0.04)
        group.add(post, warning)
      }
    } else {
      const leftPost = mesh(new THREE.BoxGeometry(0.2, 3.05, 0.24), 0x315e7a, 0.58, 0.25)
      leftPost.position.set(-1.25, 1.52, 0)
      const rightPost = leftPost.clone()
      rightPost.position.x = 1.25
      const beam = mesh(new THREE.BoxGeometry(2.82, 0.88, 0.52), palette.cream, 0.6)
      beam.position.y = 2.45
      group.add(leftPost, rightPost, beam)
      const signFace = mesh(new THREE.BoxGeometry(2.4, 0.56, 0.08), palette.blue, 0.42)
      signFace.position.set(0, 2.46, 0.31)
      group.add(signFace)
      for (const x of [-0.72, 0, 0.72]) {
        const arrow = new THREE.Mesh(new THREE.ShapeGeometry(createBoltShape(0.22)), flatMaterial(palette.cream))
        arrow.position.set(x, 2.45, 0.36)
        group.add(arrow)
      }
      const clearance = mesh(new THREE.BoxGeometry(2.35, 0.1, 0.13), palette.coral, 0.55)
      clearance.position.set(0, 1.86, 0)
      group.add(clearance)
    }
  }

  private getRouteSurfaceAtLocalZ(localZ: number) {
    if (localZ <= ROUTE_UP_FRONT && localZ >= ROUTE_UP_BACK) {
      return ((ROUTE_UP_FRONT - localZ) / RAMP_LENGTH) * TRAIN_ROOF_HEIGHT
    }
    if (localZ < ROUTE_UP_BACK && localZ >= ROUTE_ROOF_BACK) return TRAIN_ROOF_HEIGHT
    if (localZ < ROUTE_ROOF_BACK && localZ >= ROUTE_DOWN_BACK) {
      return ((localZ - ROUTE_DOWN_BACK) / RAMP_LENGTH) * TRAIN_ROOF_HEIGHT
    }
    return 0
  }

  private getRouteSurfaceAtWorldZ(lane: number, worldZ: number) {
    let height = 0
    for (const route of this.roofRoutes) {
      if (route.lane !== lane) continue
      height = Math.max(height, this.getRouteSurfaceAtLocalZ(worldZ - route.group.position.z))
    }
    return height
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
    this.placeRoofRoute(this.roofRoutes[0], 1, -82)
    this.placeRoofRoute(this.roofRoutes[1], 0, -232)

    let hazardZ = -36
    this.hazards.forEach((hazard, index) => {
      hazardZ -= 22 + (index % 3) * 4
      const kind: HazardKind = index % 3 === 0 ? 'jump' : index % 3 === 1 ? 'block' : 'slide'
      const lane = this.findOpenLane((index * 2 + 1) % 3, hazardZ)
      this.updateHazard(hazard, kind, lane, hazardZ, (index + lane) % trainThemes.length)
    })

    const routeCoinZs = [16.5, 14, 11.2, 8, 4, 0, -4, -8, -12, -17, -22, -26]
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
  }

  private updateHazard(hazard: Hazard, kind: HazardKind, lane: number, z: number, variant: number) {
    if (hazard.kind !== kind || hazard.variant !== variant) this.buildHazard(hazard.group, kind, variant)
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
  }

  private updateWorld(travel: number, delta: number) {
    const totalTrackLength = TRACK_LENGTH * TRACK_SEGMENTS
    this.tracks.forEach((track) => {
      track.position.z += travel
      if (track.position.z > 18) track.position.z -= totalTrackLength
    })

    this.scenery.forEach((item) => {
      item.position.z += travel * 0.92
      if (item.position.z > 34) item.position.z -= this.scenery.length * 13.5
    })

    this.roofRoutes.forEach((route) => {
      route.group.position.z += travel
      if (route.group.position.z > PLAYER_Z - ROUTE_DOWN_BACK + 7) this.recycleRoofRoute(route)
    })

    this.hazards.forEach((hazard) => {
      hazard.group.position.z += travel
      if (hazard.group.position.z > 15) this.recycleHazard(hazard)
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

    this.updateEffects(delta)
  }

  private updatePlayer(delta: number) {
    const xDelta = this.targetX - this.player.position.x
    this.player.position.x += xDelta * Math.min(1, delta * 17.5)
    this.player.rotation.z = THREE.MathUtils.lerp(this.player.rotation.z, -xDelta * 0.07, Math.min(1, delta * 18))

    this.previousSurfaceHeight = this.surfaceHeight
    const nearTargetLane = Math.abs(this.player.position.x - LANES[this.laneIndex]) < 1.28
    const routeSurface = nearTargetLane
      ? this.getRouteSurfaceAtWorldZ(this.laneIndex, PLAYER_Z)
      : 0
    if (routeSurface > 0 || this.surfaceHeight < 0.035) {
      this.surfaceHeight = routeSurface
    } else {
      this.surfaceHeight = THREE.MathUtils.lerp(this.surfaceHeight, 0, 1 - Math.exp(-delta * 7.5))
      if (this.surfaceHeight < 0.018) this.surfaceHeight = 0
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

    const targetCameraY = 7.8 + this.surfaceHeight * 0.68
    const targetCameraX = this.player.position.x * 0.72
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCameraX, 1 - Math.exp(-delta * 7))
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCameraY, 1 - Math.exp(-delta * 5.5))
    const targetLookHeight = 1.9 + this.surfaceHeight * 0.56
    this.cameraLookHeight = THREE.MathUtils.lerp(this.cameraLookHeight, targetLookHeight, 1 - Math.exp(-delta * 6))
    this.cameraLookX = THREE.MathUtils.lerp(this.cameraLookX, this.player.position.x * 0.44, 1 - Math.exp(-delta * 7))
    this.camera.lookAt(this.cameraLookX, this.cameraLookHeight, -18)
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
        const safe =
          (hazard.kind === 'jump' && this.jumpMotion.height > JUMP_CLEARANCE_HEIGHT) ||
          (hazard.kind === 'slide' && sliding)
        if (!safe) {
          hazard.hit = true
          this.status = 'gameover'
          this.player.rotation.z = playerX < 0 ? 0.38 : -0.38
          this.options.onCrash(this.getSnapshot())
          return
        }
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
