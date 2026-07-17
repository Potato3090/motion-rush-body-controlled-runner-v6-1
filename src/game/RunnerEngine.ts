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
}

interface Coin {
  mesh: THREE.Mesh
  lane: number
  collected: boolean
}

interface RunnerEngineOptions {
  onSnapshot: (snapshot: GameSnapshot) => void
  onCrash: (snapshot: GameSnapshot) => void
  onCoin: () => void
}

const LANES = [-3.15, 0, 3.15]
const TRACK_LENGTH = 18
const TRACK_SEGMENTS = 14
const PLAYER_Z = 5.5
const START_SPEED = 19
const MAX_SPEED = 35

const palette = {
  ink: 0x171034,
  purple: 0x5d38e8,
  violet: 0x8d68ff,
  cyan: 0x45e6de,
  yellow: 0xffd84b,
  coral: 0xff5f6f,
  cream: 0xfff1cf,
  road: 0x30245b,
  rail: 0xa9a4bf,
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
  item.castShadow = true
  item.receiveShadow = true
  return item
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
  private readonly player = new THREE.Group()
  private playerShadow?: THREE.Mesh
  private readonly playerParts: {
    leftArm?: THREE.Object3D
    rightArm?: THREE.Object3D
    leftLeg?: THREE.Object3D
    rightLeg?: THREE.Object3D
    torso?: THREE.Object3D
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

  constructor(container: HTMLElement, options: RunnerEngineOptions) {
    this.container = container
    this.options = options
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
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
    this.scene.background = new THREE.Color(0x7355d4)
    this.scene.fog = new THREE.FogExp2(0x7355d4, 0.012)

    const hemisphere = new THREE.HemisphereLight(0xffe7bc, 0x1b1640, 2.45)
    this.scene.add(hemisphere)

    const sun = new THREE.DirectionalLight(0xfff1cd, 4.2)
    sun.position.set(-12, 22, 16)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -14
    sun.shadow.camera.right = 14
    sun.shadow.camera.top = 24
    sun.shadow.camera.bottom = -8
    this.scene.add(sun)

    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffc95a, fog: false }),
    )
    sunDisc.position.set(-23, 19, -125)
    this.scene.add(sunDisc)

    this.camera.position.set(0, 7.2, 13.8)
    this.camera.lookAt(0, 1.7, -15)

    for (let i = 0; i < TRACK_SEGMENTS; i += 1) this.createTrackSegment(i)
    for (let i = 0; i < 18; i += 1) this.createScenery(i)
    this.createPlayer()

    for (let i = 0; i < 13; i += 1) {
      const hazard = this.createHazard(i % 3 === 0 ? 'block' : i % 3 === 1 ? 'jump' : 'slide')
      this.hazards.push(hazard)
      this.scene.add(hazard.group)
    }

    const coinGeometry = new THREE.TorusGeometry(0.36, 0.13, 10, 22)
    const coinMaterial = new THREE.MeshStandardMaterial({
      color: palette.yellow,
      emissive: 0x7f4f00,
      emissiveIntensity: 0.42,
      roughness: 0.25,
      metalness: 0.72,
    })
    for (let i = 0; i < 42; i += 1) {
      const coinMesh = new THREE.Mesh(coinGeometry, coinMaterial)
      coinMesh.castShadow = true
      this.coins.push({ mesh: coinMesh, lane: 1, collected: false })
      this.scene.add(coinMesh)
    }

    this.resetWorldObjects()
  }

  private createTrackSegment(index: number) {
    const group = new THREE.Group()
    const road = mesh(new THREE.BoxGeometry(11.2, 0.36, TRACK_LENGTH), palette.road, 0.9)
    road.position.y = -0.28
    group.add(road)

    for (const x of [-4.72, -1.58, 1.58, 4.72]) {
      const rail = mesh(new THREE.BoxGeometry(0.1, 0.11, TRACK_LENGTH), palette.rail, 0.25, 0.85)
      rail.position.set(x, 0.02, 0)
      group.add(rail)
    }

    for (let z = -8; z <= 8; z += 2.1) {
      const sleeper = mesh(new THREE.BoxGeometry(10.2, 0.1, 0.32), 0x473762, 0.95)
      sleeper.position.set(0, -0.02, z)
      group.add(sleeper)
    }

    const edgeLeft = mesh(new THREE.BoxGeometry(0.42, 0.45, TRACK_LENGTH), palette.cyan, 0.72)
    edgeLeft.position.set(-5.65, -0.06, 0)
    const edgeRight = edgeLeft.clone()
    edgeRight.position.x = 5.65
    group.add(edgeLeft, edgeRight)

    group.position.z = -index * TRACK_LENGTH + 9
    this.tracks.push(group)
    this.scene.add(group)
  }

  private createScenery(index: number) {
    const group = new THREE.Group()
    const side = index % 2 === 0 ? -1 : 1
    const height = 3 + ((index * 7) % 8)
    const width = 3 + ((index * 3) % 4)
    const body = mesh(
      new THREE.BoxGeometry(width, height, 4.2),
      index % 3 === 0 ? 0x3e2f79 : index % 3 === 1 ? 0x493582 : 0x2f2867,
      0.88,
    )
    body.position.y = height / 2 - 0.15
    group.add(body)

    const roof = mesh(new THREE.BoxGeometry(width + 0.35, 0.28, 4.5), index % 2 ? palette.coral : palette.yellow)
    roof.position.y = height
    group.add(roof)

    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd56a })
    for (let y = 1.2; y < height - 0.6; y += 1.5) {
      const window = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.62), windowMaterial)
      window.position.set(side < 0 ? width / 2 + 0.01 : -width / 2 - 0.01, y, 0.8)
      window.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2
      group.add(window)
    }

    group.position.set(side * (9 + (index % 4) * 1.7), 0, -index * 14)
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
    this.player.add(backpack)

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
    this.player.add(leftShoe, rightShoe)

    this.player.position.set(0, 0, PLAYER_Z)
    this.player.rotation.y = Math.PI
    this.scene.add(this.player)
  }

  private createHazard(kind: HazardKind): Hazard {
    const group = new THREE.Group()
    this.buildHazard(group, kind)
    return { group, kind, lane: 1, hit: false }
  }

  private buildHazard(group: THREE.Group, kind: HazardKind) {
    group.clear()
    if (kind === 'block') {
      const body = mesh(new THREE.BoxGeometry(2.55, 3.9, 4.4), 0x43327e, 0.6, 0.12)
      body.position.y = 1.95
      group.add(body)
      const glass = mesh(new THREE.BoxGeometry(1.72, 1.02, 0.12), 0x84f5ee, 0.12, 0.25)
      glass.position.set(0, 2.45, 2.24)
      group.add(glass)
      const bumper = mesh(new THREE.BoxGeometry(2.7, 0.38, 0.35), palette.yellow)
      bumper.position.set(0, 0.55, 2.36)
      group.add(bumper)
      for (const x of [-0.78, 0.78]) {
        const light = mesh(new THREE.SphereGeometry(0.18, 10, 8), palette.coral)
        light.position.set(x, 1.15, 2.28)
        group.add(light)
      }
    } else if (kind === 'jump') {
      const barrier = mesh(new THREE.BoxGeometry(2.65, 1.08, 0.68), palette.coral)
      barrier.position.y = 0.55
      group.add(barrier)
      for (const x of [-0.9, 0, 0.9]) {
        const stripe = mesh(new THREE.BoxGeometry(0.32, 1.12, 0.72), palette.cream)
        stripe.position.set(x, 0.57, 0)
        stripe.rotation.z = -0.28
        group.add(stripe)
      }
      const foot = mesh(new THREE.BoxGeometry(3, 0.16, 1.05), palette.ink)
      foot.position.y = 0.1
      group.add(foot)
    } else {
      const leftPost = mesh(new THREE.BoxGeometry(0.22, 2.9, 0.28), palette.cyan)
      leftPost.position.set(-1.2, 1.45, 0)
      const rightPost = leftPost.clone()
      rightPost.position.x = 1.2
      const beam = mesh(new THREE.BoxGeometry(2.75, 1.02, 0.6), palette.yellow)
      beam.position.y = 2.32
      group.add(leftPost, rightPost, beam)
      for (const x of [-0.82, -0.28, 0.28, 0.82]) {
        const stripe = mesh(new THREE.BoxGeometry(0.22, 1.05, 0.64), palette.ink)
        stripe.position.set(x, 2.32, 0)
        stripe.rotation.z = -0.22
        group.add(stripe)
      }
    }
  }

  private resetWorldObjects() {
    let hazardZ = -36
    this.hazards.forEach((hazard, index) => {
      hazardZ -= 22 + (index % 3) * 4
      const kind: HazardKind = index % 3 === 0 ? 'jump' : index % 3 === 1 ? 'block' : 'slide'
      this.updateHazard(hazard, kind, (index * 2 + 1) % 3, hazardZ)
    })

    let coinZ = -18
    this.coins.forEach((coin, index) => {
      if (index % 6 === 0) coinZ -= 10
      const lane = Math.floor(index / 6) % 3
      coin.lane = lane
      coin.collected = false
      coin.mesh.visible = true
      coin.mesh.position.set(LANES[lane], 1.05 + (index % 6 === 3 ? 0.55 : 0), coinZ - (index % 6) * 2.15)
      coin.mesh.rotation.y = Math.PI / 2
    })
  }

  private updateHazard(hazard: Hazard, kind: HazardKind, lane: number, z: number) {
    if (hazard.kind !== kind) this.buildHazard(hazard.group, kind)
    hazard.kind = kind
    hazard.lane = lane
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
    this.updateHazard(hazard, kind, lane, farthestZ - spacing)
  }

  private recycleCoin(coin: Coin) {
    const farthestZ = Math.min(...this.coins.map((item) => item.mesh.position.z))
    const lane = Math.floor(Math.random() * 3)
    coin.lane = lane
    coin.collected = false
    coin.mesh.visible = true
    coin.mesh.position.set(LANES[lane], Math.random() < 0.22 ? 2.25 : 1.05, farthestZ - 2.25)
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
      item.position.z += travel * 0.88
      if (item.position.z > 34) item.position.z -= this.scenery.length * 14
    })

    this.hazards.forEach((hazard) => {
      hazard.group.position.z += travel
      if (hazard.kind === 'block') hazard.group.position.y = Math.sin(this.elapsed * 4 + hazard.group.position.z) * 0.025
      if (hazard.group.position.z > 15) this.recycleHazard(hazard)
    })

    this.coins.forEach((coin) => {
      coin.mesh.position.z += travel
      coin.mesh.rotation.y += delta * 6.5
      coin.mesh.position.y += Math.sin(this.elapsed * 6 + coin.mesh.position.z) * delta * 0.16
      if (coin.mesh.position.z > 13) this.recycleCoin(coin)
    })
  }

  private updatePlayer(delta: number) {
    const xDelta = this.targetX - this.player.position.x
    this.player.position.x += xDelta * Math.min(1, delta * 17.5)
    this.player.rotation.z = THREE.MathUtils.lerp(this.player.rotation.z, -xDelta * 0.07, Math.min(1, delta * 18))

    const jumpStep = stepJumpMotion(this.jumpMotion, delta)
    this.jumpMotion = jumpStep.state
    if (jumpStep.landed) this.landingElapsed = 0
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

    this.player.position.y = this.jumpMotion.height
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
    if (this.playerParts.torso) {
      this.playerParts.torso.rotation.x = 0.075 * compression
      this.playerParts.torso.rotation.y = 0
    }
  }

  private updatePlayerShadow(jumpHeight: number, landingCompression: number) {
    const shadow = this.playerShadow
    if (!shadow) return
    shadow.position.x = this.player.position.x
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
      if (zDistance < 1.36 && xDistance < 1.08) {
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
        Math.abs(coin.mesh.position.y - (this.jumpMotion.height + 1.05)) < 1.45
      ) {
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
    this.camera.fov = width / height < 0.7 ? 63 : 55
    this.camera.updateProjectionMatrix()
  }
}
