import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CameraViewMode } from './presentationSettings'
import type { GameSnapshot, GameStatus, RunnerAction, RunnerLane } from './types'
import {
  JUMP_CLEARANCE_HEIGHT,
  LANDING_TOTAL_DURATION,
  createGroundedJumpMotion,
  getLandingCompression,
  stepJumpMotion,
  tryStartJump,
} from './jumpMotion'
import {
  PLAYER_CHARACTER,
  damp,
  getCharacterPose,
  getJumpShadowHeightRatio,
  type CharacterPose,
  type CharacterPoseInput,
} from './playerCharacterModel'
import {
  areRoofHeightsCompatible,
  clearsTrainRoofTop,
  didDescendingFeetCrossMovingRamp,
  getRouteSurfaceHeight,
  isInsideLongitudinalRoofFootprint,
  isValidAdjacentRoofTransfer,
  resolveLandingSurfaceCandidate,
  resolveSurfaceTransition,
  ROUTE_RAMP_LENGTH,
  ROUTE_ROOF_HEIGHT,
  type SurfaceTransitionInput,
  type SurfaceTransitionKind,
  type SurfaceTransitionResult,
  type LandingSurfaceCandidate,
} from './runnerRouteModel'
import {
  RAMP_VISUAL_ANGLE_RADIANS,
  RAMP_VISUAL_SHELL,
  RAMP_VISUAL_SLOPE_LENGTH,
  getRampVisualSurfaceHeight,
} from './rampVisualModel'
import {
  READABILITY_PLACEMENT,
  chooseReadableCoinTrailLane,
  getCoinTrailPreferredLane,
  getCoinTrailStep,
} from './readabilityPlacement'
import {
  getTrainFormDimensions,
  PLAYER_TRAIN_SCALE,
  TRAIN_FORM,
} from './trainFormModel'
import {
  TRAIN_FRONT_SYSTEM,
  getTrainBogieCenters,
  getTrainDirectionYaw,
  getTrainFrontFamily,
  getTrainWheelPlacements,
  type TrainDirection,
  type TrainFrontFamily,
} from './trainFrontModel'
import {
  TRAIN_LENGTH_SYSTEM,
  getTrainComposition,
  getTrainLongitudinalBounds,
  getTrainSpawnPreset,
  longitudinalBoundsOverlap,
  type TrainComposition,
  type TrainLengthPreset,
  type TrainModuleRole,
} from './trainLengthModel'
import {
  TrainComponentGeometryCache,
  createSectionedFrontShellGeometry,
} from './trainFrontGeometry'
import {
  CITY_DEPTH,
  createCityDepthLayout,
  normalizeCitySeed,
  type CityDepthLayout,
} from './cityDepthModel'
import {
  BUILDING_FAMILIES,
  getBuildingFamilyId,
  getBuildingFamilyMetrics,
  getBuildingFamilyPreset,
  getSkylineSilhouette,
  type BuildingFamilyId,
  type BuildingFamilyPreset,
  type SkylineSilhouettePreset,
} from './buildingMassingModel'
import {
  FACADE_FAMILIES,
  getEntranceCenter,
  getFacadeFamily,
  getRoofDetailPreset,
  getWindowGrid,
  type FacadeFamilyPreset,
} from './buildingFacadeModel'
import {
  MATERIAL_FAMILIES,
  MATERIAL_ENVIRONMENT_RESPONSE_MAX,
  MATERIAL_RESPONSE_ATTRIBUTE,
  getMaterialFamily,
  getMaterialResponseTuple,
  type MaterialFamilyId,
} from './materialResponseModel'
import { GeometryQualityFactory } from './geometryQuality.js'
import {
  EDGE_STANDARDS,
  type GeometryDistanceBand,
} from './geometryQualityModel.js'
import {
  TRACK_SYSTEM,
  getRailCenterlines,
  getSleeperPositions,
  getTrackDetailSleeperOffsets,
  getTrackDetailTileCenters,
  trackDetailIsVisible,
  trackDetailOverlapsFootprint,
} from './trackSystemModel.js'
import {
  TrackGeometryCache,
  createFastenerClipGeometry,
  createRailProfileGeometry,
  createTrackBedGeometry,
} from './trackSystemGeometry.js'
import {
  HAZARD_VISUAL_FAMILIES,
  getHazardVisualFamily,
  type StaticHazardKind,
} from './hazardVisualModel.js'
import {
  SHRUB_FAMILIES,
  TREE_FAMILIES,
  TREE_SIZES,
  compositionHasTree,
  getPlantingLayout,
  type FoliageMassPreset,
  type ShrubFamilyId,
  type TreeFamilyId,
  type TreeSizeId,
} from './vegetationModel.js'
import { VegetationGeometryCache } from './vegetationGeometry.js'

type HazardKind = 'block' | 'jump' | 'slide'

interface TrainAssembly {
  group: THREE.Group
  frontModule: THREE.Mesh
  middleModules: THREE.InstancedMesh
  rearModule: THREE.Mesh
  connectors: THREE.InstancedMesh
  family: TrainFrontFamily
  preset: TrainLengthPreset
  composition: TrainComposition
  themeIndex: number
  direction: TrainDirection
  roofRoute: boolean
}

interface Hazard {
  group: THREE.Group
  visual: THREE.Mesh
  assetVisual?: THREE.Group
  train: TrainAssembly
  kind: HazardKind
  lane: number
  hit: boolean
  variant: number
  direction: TrainDirection
  trainPreset: TrainLengthPreset
  active: boolean
  bounds: { minZ: number; maxZ: number }
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
  train: TrainAssembly
  lane: number
  theme: number
  direction: TrainDirection
  trainPreset: TrainLengthPreset
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
const TRACK_LENGTH = TRACK_SYSTEM.segmentLength
const TRACK_SEGMENTS = TRACK_SYSTEM.segmentCount
const PLAYER_Z = 5.5
const START_SPEED = 19
const MAX_SPEED = 35
const TRAIN_ROOF_HEIGHT = ROUTE_ROOF_HEIGHT
const OBSTACLE_TRAIN_ROOF_HEIGHT = 3
const RAMP_LENGTH = ROUTE_RAMP_LENGTH
const ROUTE_UP_FRONT = 19
const ROUTE_UP_BACK = ROUTE_UP_FRONT - RAMP_LENGTH
const ROUTE_ROOF_BACK = -19
const ROUTE_DOWN_BACK = ROUTE_ROOF_BACK - RAMP_LENGTH
const ROUTE_RAMP_CENTERS = [
  (ROUTE_UP_FRONT + ROUTE_UP_BACK) / 2,
  (ROUTE_ROOF_BACK + ROUTE_DOWN_BACK) / 2,
] as const
const CHASE_CAMERA = {
  groundHeight: 6.05,
  positionZ: 15.3,
  lookHeight: 1.35,
  lookZ: -25,
  surfaceHeightFactor: 1,
  surfaceLookFactor: 1,
  lateralPositionFactor: 0.72,
  lateralLookFactor: 0.44,
  portraitFov: 61,
  landscapeFov: 55,
} as const
const RUNNER_POV_CAMERA = {
  eyeHeight: PLAYER_CHARACTER.visualFootOffset + PLAYER_CHARACTER.visualHeight * 0.88,
  crouchDrop: PLAYER_CHARACTER.crouchPelvisDrop * PLAYER_CHARACTER.visualScale + 0.24,
  positionZ: PLAYER_Z - 0.04,
  lookDown: 1.1,
  lookDistance: 28,
  followRate: 22,
} as const
const CAMERA_FAR = 500
const WORLD_WIDTH = {
  serviceOuterEdge: 16,
  buildingZoneOuterEdge: 23.5,
  outerServiceEdge: 32,
  cityGroundOuterEdge: 100,
  citySurfaceTop: 0.3,
  foundationDepth: 4.6,
  centralFoundationDepth: 3.6,
  outerWallThickness: 0.7,
  buildingFoundationPadding: 1.4,
  buildingFoundationLength: 8.2,
  buildingFoundationTop: 0.38,
} as const
const PEDESTRIAN_CORRIDOR = {
  platformInnerEdge: 5.95,
  platformOuterEdge: 8.03,
  sidewalkOuterEdge: 10.75,
  platformSlabBottom: -0.27,
  platformSurfaceTop: 0.64,
  platformCapThickness: 0.14,
  trackEdgeBandWidth: 0.22,
  safetyStripWidth: 0.3,
  cityTransitionFaceThickness: 0.04,
  sidewalkSlabBottom: 0.3,
  sidewalkSurfaceTop: 0.46,
  curbWidth: 0.24,
  curbFaceTop: 0.5,
  curbTop: 0.54,
  slabSeamSpacing: 6,
  slabSeamWidth: 0.035,
} as const
const SCENERY_SPACING = 13.5
const CITY_DEPTH_WORLD = {
  sidewalkOuterEdge: PEDESTRIAN_CORRIDOR.sidewalkOuterEdge,
  buildingZoneOuterEdge: WORLD_WIDTH.buildingZoneOuterEdge,
  outerServiceEdge: WORLD_WIDTH.outerServiceEdge,
  cityGroundOuterEdge: WORLD_WIDTH.cityGroundOuterEdge,
  segmentSpacing: SCENERY_SPACING,
  segmentCount: 24,
} as const
const OVERHEAD_WIRE_HEIGHT = 11.55
const OVERHEAD_GANTRY_HEIGHT = 11.85
const OVERHEAD_GANTRY_TRACK_OFFSET = -7.4
const OVERHEAD_GANTRY_COUNT = Math.floor(TRACK_SEGMENTS / 3)
const OVERHEAD_GANTRY_RECYCLE_Z = CHASE_CAMERA.positionZ + TRACK_LENGTH * 3
const BRIDGE_DECK_HEIGHT = 13.65
const ELEVATED_TRANSFER_MAX_DISTANCE = 12
const PROPORTIONS = {
  player: {
    visualScale: PLAYER_TRAIN_SCALE.visualScale,
    authoredHeight: PLAYER_TRAIN_SCALE.authoredHeight,
    shadowRadius: PLAYER_TRAIN_SCALE.contactShadowRadius,
  },
  train: {
    windowHeight: 0.84,
    doorHeight: 1.68,
  },
  building: {
    baseY: 0.34,
    floorHeight: 2.05,
    windowHeight: 1.08,
    windowDepth: 0.82,
    doorHeight: 1.95,
    roofThickness: 0.42,
    parapetHeight: 0.5,
  },
  overhead: {
    postRadiusTop: 0.18,
    postRadiusBottom: 0.25,
    postHeight: 12.2,
    beamHeight: 0.34,
    beamDepth: 0.32,
    wireThickness: 0.032,
    dropperThickness: 0.085,
  },
  bridge: {
    columnWidth: 1.05,
    columnDepth: 1.12,
    deckThickness: 1.08,
    deckDepth: 1.4,
  },
  gameplay: {
    rampWidth: RAMP_VISUAL_SHELL.width,
    rampThickness: RAMP_VISUAL_SHELL.deckThickness,
    rampEdgeHeight: RAMP_VISUAL_SHELL.edgeRailHeight,
  },
  props: {
    railingHeight: 1.78,
    railingPostWidth: 0.15,
    railingBarThickness: 0.12,
    lampHeight: 6,
    lampPostRadiusTop: 0.1,
    lampPostRadiusBottom: 0.14,
    planterHeight: 0.64,
  },
  vegetation: {
    shrubRadius: 0.82,
    flowerRadius: 0.19,
    soilPatchHeight: 0.055,
  },
  coin: {
    radius: 0.37,
    thickness: 0.1,
    rimRadius: 0.05,
    boltScale: 0.41,
  },
} as const
// Cosmetic reference height H; gameplay roots and collision surfaces remain in their original units.
const PLAYER_VISUAL_HEIGHT = PLAYER_CHARACTER.visualHeight

const TONAL_OUTPUT = {
  exposure: 0.70,
  hemisphereIntensity: 1.45,
  directionalIntensity: 3.35,
} as const

// Stage 5 lighting is intentionally independent from the locked Stage 4 tonal output.
// The fixed corridor-centered frustum stays stable while the world streams past the player.
const LIGHTING_SHADOWS = {
  keyPosition: [-20, 22, 10] as const,
  keyTarget: [0, 0, -8] as const,
  mapSize: 1024,
  camera: {
    left: -23,
    right: 18,
    top: 20,
    bottom: -12,
    near: 1,
    far: 70,
  },
  bias: -0.00012,
  normalBias: 0.028,
  sceneryCasterNearZ: -30,
  sceneryCasterFarZ: 20,
  contactShadowOpacity: 0.2,
} as const

// Stage 6 keeps color authorship centralized while preserving the existing merged
// vertex-color and instancing paths. Semantic roles prevent background props from
// competing with rewards, hazards, traversable routes, or the runner.
const WORLD_PALETTE = {
  sky: {
    top: 0x1f82cb,
    middle: 0x55b8e7,
    horizon: 0xc4e4f1,
    cloudHighlight: 0xf5f7f2,
    cloudBody: 0xe5eff0,
    cloudUnderside: 0xcbdde2,
    skyline: [0x708ca4, 0x7894a7, 0x74899a, 0x849baa] as const,
    tunnel: 0x496c82,
  },
  neutral: {
    ink: 0x17283f,
    darkest: 0x253341,
    dark: 0x3f4a53,
    mid: 0x6d7479,
    light: 0xd4d2ca,
    cream: 0xf0eadf,
  },
  track: {
    foundation: 0x4a494e,
    ballast: 0x91887b,
    laneCenter: 0x706e72,
    laneOuter: 0x7b787a,
    railFoot: 0x454a50,
    rail: 0xcbd1d6,
    sleeper: 0x5e4a3f,
    fastener: 0x887b65,
    sideFoundationLeft: 0x59585d,
    sideFoundationRight: 0x555d62,
    platformSlab: 0xcbbca6,
    platformTop: 0xebe1cf,
    platformMarker: 0x9b8c72,
    platformEdge: 0x526977,
    sidewalkLeft: 0xd8cebc,
    sidewalkRight: 0xd0cdc1,
    serviceLeft: 0x6b6b70,
    serviceRight: 0x68757d,
    buildingGroundLeft: 0xb4a68d,
    buildingGroundRight: 0xaab49a,
    outerGroundLeft: 0x898270,
    outerGroundRight: 0x7d8877,
    cityGroundLeft: 0x958c7a,
    cityGroundRight: 0x87937f,
    crossingLeft: 0x636269,
    crossingRight: 0x5e686e,
    outerWallLeft: 0x4b535d,
    outerWallRight: 0x46545b,
  },
  infrastructure: {
    primary: 0x4d6675,
    secondary: 0x5c7280,
    cable: 0x78909d,
    railing: 0x496472,
    bridgeCool: 0x506b7c,
    bridgeWarm: 0x6b6963,
    signFace: 0xd8d3c8,
  },
  gameplay: {
    hazard: 0xe64c45,
    hazardLight: 0xf2ede3,
    hazardDark: 0x2a3947,
    warningLight: 0xff4a45,
    ramp: 0x176fce,
    rampHighlight: 0x3eb7cd,
    rampLight: 0xe9f2ed,
    rampSupport: 0x405f73,
    rampEdge: 0x104f7c,
    rampFoot: 0x314957,
  },
  reward: {
    gold: 0xf3b91f,
    rim: 0xffd455,
    face: 0xffefad,
    sparkle: 0xffdc67,
  },
  player: {
    primaryWarm: 0xf06d42,
    warmHighlight: 0xf39a62,
    darkNeutral: 0x17283f,
    lightNeutral: 0xf0eadf,
    coolTrim: 0x4db3c4,
    backpack: 0x4f4c86,
    skin: 0xb96b45,
  },
  vegetation: {
    trunk: 0x80533c,
    foliageDark: 0x3f8056,
    foliageMid: 0x5e995f,
    foliageLight: 0x8abd6d,
    blossom: 0xc98291,
    shrub: 0x579160,
  },
  props: {
    planterWarm: 0x927b70,
    planterCool: 0x697f7d,
    lamp: 0x455f6d,
    lampGlobe: 0xe3d4a7,
    bannerIndigo: 0x70658d,
    bannerTerracotta: 0xaa6c55,
  },
  effects: {
    landing: 0xbfe7e6,
    contactShadow: 0x0d0920,
  },
} as const

// Stage 24 atmosphere is tied to the real streamed-world extent: the near edge
// begins after six scenery segments, while the far edge sits just beyond the
// far-city recycle boundary and comfortably inside the 500-unit camera plane.
const ATMOSPHERE = {
  textureWidth: 8,
  textureHeight: 128,
  fogNear: SCENERY_SPACING * 6,
  fogFar: Math.min(CAMERA_FAR * 0.62, Math.abs(CITY_DEPTH.visibility.farBackCullZ) * 1.15),
} as const

type CloudTone = 'highlight' | 'body' | 'underside'
type CloudLobe = readonly [x: number, y: number, z: number, sx: number, sy: number, sz: number, tone: CloudTone]

const CLOUD_FAMILIES = {
  small: [
    [-0.92, 0.0, 0.0, 1.18, 0.66, 0.72, 'body'],
    [0.28, 0.04, -0.04, 1.04, 0.62, 0.68, 'body'],
    [-0.18, 0.5, 0.0, 0.88, 0.78, 0.7, 'highlight'],
    [-0.12, -0.3, 0.08, 1.34, 0.42, 0.72, 'underside'],
  ],
  medium: [
    [-1.5, -0.03, 0.0, 1.42, 0.68, 0.78, 'body'],
    [-0.24, 0.08, -0.08, 1.5, 0.82, 0.86, 'body'],
    [1.15, 0.0, 0.06, 1.28, 0.64, 0.74, 'body'],
    [-0.72, 0.67, -0.04, 1.0, 0.98, 0.8, 'highlight'],
    [0.45, 0.62, 0.02, 0.92, 0.9, 0.76, 'highlight'],
    [-0.12, -0.42, 0.13, 2.18, 0.43, 0.9, 'underside'],
  ],
  bank: [
    [-2.25, -0.02, 0.12, 1.72, 0.72, 0.86, 'body'],
    [-0.78, 0.14, 0.0, 1.82, 0.88, 0.96, 'body'],
    [0.85, 0.08, -0.08, 1.68, 0.78, 0.9, 'body'],
    [2.18, -0.08, 0.08, 1.35, 0.62, 0.8, 'body'],
    [-1.25, 0.8, -0.08, 1.14, 1.08, 0.9, 'highlight'],
    [0.25, 0.92, 0.0, 1.3, 1.14, 0.98, 'highlight'],
    [1.42, 0.58, 0.03, 0.96, 0.88, 0.82, 'highlight'],
    [-0.05, -0.48, 0.2, 3.22, 0.48, 1.02, 'underside'],
  ],
} as const satisfies Record<string, readonly CloudLobe[]>

const CLOUD_PLACEMENTS = [
  { family: 'small', position: [-18.5, 29, -70], scale: 2.15, rotation: 0.08 },
  { family: 'medium', position: [23, 31.5, -84], scale: 2.25, rotation: -0.08 },
  { family: 'small', position: [43, 31, -178], scale: 2.25, rotation: 0.12 },
  { family: 'medium', position: [-43, 28, -166], scale: 2.4, rotation: -0.1 },
  { family: 'small', position: [25, 19.5, -202], scale: 1.8, rotation: -0.04 },
  { family: 'bank', position: [-59, 20.5, -244], scale: 2.65, rotation: 0.06 },
  { family: 'bank', position: [62, 22.5, -258], scale: 2.5, rotation: -0.07 },
] as const satisfies readonly {
  family: keyof typeof CLOUD_FAMILIES
  position: readonly [number, number, number]
  scale: number
  rotation: number
}[]

const BUILDING_PALETTES = [
  {
    facade: 0xb58f82, roof: 0x81554d, base: 0x525d68, trim: 0xd2c8b8,
    parapet: 0x596b76, window: 0x29485b, awning: 0x87979e, door: 0x536f78,
  },
  {
    facade: 0x5d918a, roof: 0x49635f, base: 0x465c67, trim: 0xc9d0c7,
    parapet: 0x536c72, window: 0x27495a, awning: 0x83999a, door: 0x55747a,
  },
  {
    facade: 0xbba67d, roof: 0x82665b, base: 0x5d5f63, trim: 0xd9d0bf,
    parapet: 0x68727a, window: 0x2c4858, awning: 0x9a9488, door: 0x60727a,
  },
  {
    facade: 0x667f9e, roof: 0x475a6c, base: 0x3f5365, trim: 0xcbd1ce,
    parapet: 0x536878, window: 0x253f54, awning: 0x778b98, door: 0x4d6877,
  },
  {
    facade: 0x82909a, roof: 0x505b68, base: 0x465462, trim: 0xd0cdca,
    parapet: 0x5d6274, window: 0x293f54, awning: 0x85838f, door: 0x596775,
  },
  {
    facade: 0x75917e, roof: 0x52655b, base: 0x485b57, trim: 0xcdd0c2,
    parapet: 0x5c7068, window: 0x294958, awning: 0x87978d, door: 0x5c746e,
  },
] as const

const TRAIN_PALETTES = [
  {
    primary: 0xc89b35, secondary: 0x356b99, trim: 0xe9e6dc, roof: 0x405866,
    window: 0x1f465e, glass: 0x9fc6d2, undercarriage: 0x293844,
    frontWindow: 0x193e56, headlight: 0xeee0b8,
  },
  {
    primary: 0x655588, secondary: 0xdedce2, trim: 0x8c7ba5, roof: 0x425763,
    window: 0x244758, glass: 0xa9c9d0, undercarriage: 0x2d3943,
    frontWindow: 0x203d52, headlight: 0xeee2c2,
  },
  {
    primary: 0x4f7c94, secondary: 0xd7dedc, trim: 0x6c9bac, roof: 0x3f5663,
    window: 0x234758, glass: 0xa5cad3, undercarriage: 0x2b3944,
    frontWindow: 0x1d4055, headlight: 0xede0bd,
  },
  {
    primary: 0xa56d60, secondary: 0xe0d5c3, trim: 0x4e6c81, roof: 0x4b575d,
    window: 0x244556, glass: 0xa7c8cf, undercarriage: 0x303940,
    frontWindow: 0x213e50, headlight: 0xeee0b9,
  },
] as const

type TrainPalette = (typeof TRAIN_PALETTES)[number]

interface ColoredGeometryPart {
  geometry: THREE.BufferGeometry
  color: number
  family: MaterialFamilyId
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

interface CityDepthInstance {
  x: number
  y: number
  z: number
  rotationY: number
}

interface CityDepthRuntimeLayer {
  name: 'mid' | 'far'
  familyId: BuildingFamilyId
  mesh: THREE.InstancedMesh
  instances: CityDepthInstance[]
  parallax: number
  backCullZ: number
  frontCullZ: number
  activeCount: number
}

const identityPosition: [number, number, number] = [0, 0, 0]
const identityRotation: [number, number, number] = [0, 0, 0]
const identityScale: [number, number, number] = [1, 1, 1]

type BuildingPalette = (typeof BUILDING_PALETTES)[number]

function appendCorridorWindow(
  parts: ColoredGeometryPart[],
  palette: BuildingPalette,
  family: FacadeFamilyPreset,
  side: -1 | 1,
  wallX: number,
  y: number,
  z: number,
  width: number,
  height: number,
) {
  const corridorOffset = (depth: number) => wallX - side * depth
  parts.push(
    {
      geometry: new THREE.BoxGeometry(0.035, height + 0.2, width + 0.2),
      color: palette.base,
      family: 'architecturalPanel',
      position: [corridorOffset(0.018), y, z],
    },
    {
      geometry: new THREE.BoxGeometry(0.03, height + family.frameWidth, width + family.frameWidth),
      color: palette.trim,
      family: 'paintedMetal',
      position: [corridorOffset(0.043), y, z],
    },
    {
      geometry: new THREE.BoxGeometry(0.026, height, width, 1, 1, 1),
      color: palette.window,
      family: 'stylizedGlass',
      position: [corridorOffset(0.068), y, z],
    },
  )
  if (family.id === 'office' && width > 0.92) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.025, height, 0.045),
      color: palette.trim,
      family: 'paintedMetal',
      position: [corridorOffset(0.083), y, z],
    })
  }
  if (family.sill) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.13, 0.07, width + 0.16),
      color: palette.trim,
      family: 'architecturalPanel',
      position: [corridorOffset(0.07), y - height / 2 - 0.07, z],
    })
  }
}

function appendSideWindow(
  parts: ColoredGeometryPart[],
  palette: BuildingPalette,
  family: FacadeFamilyPreset,
  wallZ: number,
  faceDirection: -1 | 1,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const faceZ = (depth: number) => wallZ + faceDirection * depth
  parts.push(
    {
      geometry: new THREE.BoxGeometry(width + 0.18, height + 0.18, 0.035),
      color: palette.base,
      family: 'architecturalPanel',
      position: [x, y, faceZ(0.018)],
    },
    {
      geometry: new THREE.BoxGeometry(width + family.frameWidth, height + family.frameWidth, 0.03),
      color: palette.trim,
      family: 'paintedMetal',
      position: [x, y, faceZ(0.043)],
    },
    {
      geometry: new THREE.BoxGeometry(width, height, 0.026),
      color: palette.window,
      family: 'stylizedGlass',
      position: [x, y, faceZ(0.068)],
    },
  )
}

function appendBuildingModelParts(
  parts: ColoredGeometryPart[],
  geometryQuality: GeometryQualityFactory,
  distanceBand: GeometryDistanceBand,
  preset: BuildingFamilyPreset,
  paletteIndex: number,
  side: -1 | 1,
  buildingX: number,
  buildingZ: number,
  includeFoundation: boolean,
  includeFacadeDetails: boolean,
  silhouettePalette?: { facade: number; base: number; roof: number },
  facadeParts: ColoredGeometryPart[] = parts,
) {
  const buildingPalette = BUILDING_PALETTES[paletteIndex % BUILDING_PALETTES.length]
  const facadeFamily = getFacadeFamily(preset.id)
  const facadeColor = silhouettePalette?.facade ?? buildingPalette.facade
  const baseColor = silhouettePalette?.base ?? buildingPalette.base
  const roofColor = silhouettePalette?.roof ?? buildingPalette.roof
  const floorHeight = PROPORTIONS.building.floorHeight
  const maxWidth = Math.max(...preset.masses.map((mass) => mass.width))

  if (includeFoundation) {
    const buildingFoundationWidth = maxWidth + WORLD_WIDTH.buildingFoundationPadding * 2
    parts.push(
      {
        geometry: new THREE.BoxGeometry(
          buildingFoundationWidth,
          WORLD_WIDTH.foundationDepth,
          WORLD_WIDTH.buildingFoundationLength,
        ),
        color: side < 0
          ? WORLD_PALETTE.track.sideFoundationLeft
          : WORLD_PALETTE.track.sideFoundationRight,
        family: 'rawConcrete',
        position: [
          buildingX,
          WORLD_WIDTH.buildingFoundationTop - WORLD_WIDTH.foundationDepth / 2,
          buildingZ,
        ],
      },
      {
        geometry: new THREE.BoxGeometry(
          buildingFoundationWidth + 0.36,
          0.16,
          WORLD_WIDTH.buildingFoundationLength + 0.36,
        ),
        color: side < 0
          ? WORLD_PALETTE.track.buildingGroundLeft
          : WORLD_PALETTE.track.buildingGroundRight,
        family: 'asphalt',
        position: [buildingX, WORLD_WIDTH.buildingFoundationTop - 0.08, buildingZ],
      },
    )
  }

  for (const mass of preset.masses) {
    const massHeight = mass.floors * floorHeight
    const massBaseY = PROPORTIONS.building.baseY + mass.baseFloor * floorHeight
    const massX = buildingX + side * mass.outwardOffset
    const massZ = buildingZ + mass.longitudinalOffset
    parts.push({
      geometry: geometryQuality.prism(
        mass.width,
        massHeight,
        mass.depth,
        'y',
        distanceBand === 'mid' && mass.kind !== 'main'
          ? 'intentionalHard'
          : 'largeArchitectural',
        { distanceBand },
      ),
      color: mass.kind === 'podium' ? baseColor : facadeColor,
      family: mass.kind === 'podium' ? 'architecturalPanel' : 'paintedPlaster',
      position: [massX, massBaseY + massHeight / 2, massZ],
    })
    if (includeFacadeDetails) {
      const corridorWallX = massX - side * mass.width / 2
      if (mass.baseFloor === 0) {
        facadeParts.push(
          {
            geometry: new THREE.BoxGeometry(0.09, 0.44, mass.depth + 0.08),
            color: baseColor,
            family: 'architecturalPanel',
            position: [corridorWallX - side * 0.045, PROPORTIONS.building.baseY + 0.22, massZ],
          },
          {
            geometry: new THREE.BoxGeometry(0.08, 0.16, mass.depth + 0.14),
            color: buildingPalette.trim,
            family: 'architecturalPanel',
            position: [
              corridorWallX - side * 0.045,
              PROPORTIONS.building.baseY + floorHeight - 0.08,
              massZ,
            ],
          },
        )
      }
      const tierTop = massBaseY + massHeight
      facadeParts.push({
        geometry: new THREE.BoxGeometry(0.075, facadeFamily.topBandHeight, mass.depth + 0.12),
        color: mass.kind === 'podium' ? buildingPalette.trim : roofColor,
        family: 'architecturalPanel',
        position: [
          corridorWallX - side * 0.04,
          tierTop - facadeFamily.topBandHeight / 2,
          massZ,
        ],
      })
      if (facadeFamily.id === 'heavy-urban' && mass.floors >= 3) {
        facadeParts.push({
          geometry: new THREE.BoxGeometry(0.08, massHeight - 0.55, 0.18),
          color: buildingPalette.trim,
          family: 'architecturalPanel',
          position: [corridorWallX - side * 0.045, massBaseY + massHeight / 2, massZ],
        })
      }
    }
  }

  const topMass = preset.masses.reduce((highest, mass) => (
    mass.baseFloor + mass.floors > highest.baseFloor + highest.floors ? mass : highest
  ))
  const buildingTop = PROPORTIONS.building.baseY + preset.totalFloors * floorHeight
  const topX = buildingX + side * topMass.outwardOffset
  const topZ = buildingZ + topMass.longitudinalOffset
  if (preset.roofProfile === 'angled-cap') {
    parts.push({
      geometry: createTaperedPrismGeometry(
        topMass.width + 0.28,
        topMass.width * 0.72,
        0.82,
        topMass.depth + 0.28,
      ),
      color: roofColor,
      family: 'darkCoatedMetal',
      position: [topX, buildingTop, topZ],
    })
  } else {
    const capInset = preset.roofProfile === 'step-cap' ? 0.12 : 0
    const roofWidth = topMass.width + 0.45 - capInset
    const roofDepth = topMass.depth + 0.45 - capInset
    const roofDeckThickness = 0.14
    const parapetHeight = PROPORTIONS.building.roofThickness - roofDeckThickness
    const parapetThickness = 0.16
    parts.push(
      {
        geometry: geometryQuality.prism(
          roofWidth,
          roofDeckThickness,
          roofDepth,
          'y',
          'largeArchitectural',
          { distanceBand, referenceDimension: Math.min(roofWidth, roofDepth) },
        ),
        color: roofColor,
        family: 'darkCoatedMetal',
        position: [topX, buildingTop + roofDeckThickness / 2, topZ],
      },
      {
        geometry: new THREE.BoxGeometry(roofWidth, parapetHeight, parapetThickness),
        color: buildingPalette.parapet,
        family: 'architecturalPanel',
        position: [
          topX,
          buildingTop + roofDeckThickness + parapetHeight / 2,
          topZ - roofDepth / 2 + parapetThickness / 2,
        ],
      },
      {
        geometry: new THREE.BoxGeometry(roofWidth, parapetHeight, parapetThickness),
        color: buildingPalette.parapet,
        family: 'architecturalPanel',
        position: [
          topX,
          buildingTop + roofDeckThickness + parapetHeight / 2,
          topZ + roofDepth / 2 - parapetThickness / 2,
        ],
      },
      {
        geometry: new THREE.BoxGeometry(parapetThickness, parapetHeight, roofDepth - parapetThickness * 2),
        color: buildingPalette.parapet,
        family: 'architecturalPanel',
        position: [
          topX - roofWidth / 2 + parapetThickness / 2,
          buildingTop + roofDeckThickness + parapetHeight / 2,
          topZ,
        ],
      },
      {
        geometry: new THREE.BoxGeometry(parapetThickness, parapetHeight, roofDepth - parapetThickness * 2),
        color: buildingPalette.parapet,
        family: 'architecturalPanel',
        position: [
          topX + roofWidth / 2 - parapetThickness / 2,
          buildingTop + roofDeckThickness + parapetHeight / 2,
          topZ,
        ],
      },
    )
  }

  if (!includeFacadeDetails) return

  for (let floor = 1; floor < preset.totalFloors; floor += 1) {
    const mass = preset.masses.find((candidate) => (
      floor >= candidate.baseFloor && floor < candidate.baseFloor + candidate.floors
    )) ?? preset.masses[0]
    const y = PROPORTIONS.building.baseY + floorHeight * (floor + 0.52)
    const massX = buildingX + side * mass.outwardOffset
    const massZ = buildingZ + mass.longitudinalOffset
    const corridorGrid = getWindowGrid(mass.depth, facadeFamily)
    const corridorWallX = massX - side * mass.width / 2
    for (const z of corridorGrid.positions) {
      appendCorridorWindow(
        facadeParts,
        buildingPalette,
        facadeFamily,
        side,
        corridorWallX,
        y,
        massZ + z,
        corridorGrid.windowWidth,
        facadeFamily.windowHeight,
      )
    }

    if (facadeFamily.sideWindows) {
      const sideGrid = getWindowGrid(mass.width, {
        ...facadeFamily,
        minColumns: 2,
        maxColumns: 3,
      })
      for (const faceDirection of [-1, 1] as const) {
        for (const x of sideGrid.positions) {
          appendSideWindow(
            facadeParts,
            buildingPalette,
            facadeFamily,
            massZ + faceDirection * mass.depth / 2,
            faceDirection,
            massX + x,
            y,
            sideGrid.windowWidth,
            facadeFamily.windowHeight * 0.92,
          )
        }
      }
    }
  }

  const groundMass = preset.masses.find((mass) => mass.baseFloor === 0) ?? preset.masses[0]
  const groundX = buildingX + side * groundMass.outwardOffset
  const groundZ = buildingZ + groundMass.longitudinalOffset
  const groundWallX = groundX - side * groundMass.width / 2
  const entranceCenter = getEntranceCenter(groundMass.depth, facadeFamily)
  const entranceWidth = facadeFamily.entrance === 'glazed-double' ? 1.44 : 1.08
  const thresholdY = PEDESTRIAN_CORRIDOR.sidewalkSurfaceTop
  const entranceHeight = facadeFamily.id === 'heavy-urban' ? 1.78 : 1.9
  const groundGrid = getWindowGrid(groundMass.depth, facadeFamily)
  for (const z of groundGrid.positions) {
    if (Math.abs(z - entranceCenter) < (groundGrid.windowWidth + entranceWidth) / 2 + 0.16) continue
    appendCorridorWindow(
      facadeParts,
      buildingPalette,
      facadeFamily,
      side,
      groundWallX,
      thresholdY + entranceHeight * 0.54,
      groundZ + z,
      groundGrid.windowWidth * facadeFamily.groundWindowScale,
      Math.min(1.28, facadeFamily.windowHeight * facadeFamily.groundWindowScale),
    )
  }

  const corridorOffset = (depth: number) => groundWallX - side * depth
  facadeParts.push(
    {
      geometry: new THREE.BoxGeometry(0.12, entranceHeight + 0.2, entranceWidth + 0.24),
      color: buildingPalette.base,
      family: 'architecturalPanel',
      position: [corridorOffset(0.035), thresholdY + entranceHeight / 2, groundZ + entranceCenter],
    },
    {
      geometry: new THREE.BoxGeometry(0.045, entranceHeight + 0.08, entranceWidth + 0.1),
      color: buildingPalette.trim,
      family: 'paintedMetal',
      position: [corridorOffset(0.095), thresholdY + entranceHeight / 2, groundZ + entranceCenter],
    },
    {
      geometry: new THREE.BoxGeometry(0.04, entranceHeight, entranceWidth),
      color: facadeFamily.entrance === 'glazed-double' ? buildingPalette.window : buildingPalette.door,
      family: facadeFamily.entrance === 'glazed-double' ? 'stylizedGlass' : 'architecturalPanel',
      position: [corridorOffset(0.13), thresholdY + entranceHeight / 2, groundZ + entranceCenter],
    },
    {
      geometry: new THREE.BoxGeometry(0.3, 0.08, entranceWidth + 0.18),
      color: buildingPalette.trim,
      family: 'architecturalPanel',
      position: [corridorOffset(0.12), thresholdY + 0.04, groundZ + entranceCenter],
    },
  )

  if (facadeFamily.entrance === 'glazed-double') {
    facadeParts.push({
      geometry: new THREE.BoxGeometry(0.035, entranceHeight, 0.055),
      color: buildingPalette.trim,
      family: 'paintedMetal',
      position: [corridorOffset(0.155), thresholdY + entranceHeight / 2, groundZ + entranceCenter],
    })
  }
  if (facadeFamily.entrance === 'canopy-entry') {
    facadeParts.push({
      geometry: new THREE.BoxGeometry(0.74, 0.12, entranceWidth + 0.54),
      color: buildingPalette.awning,
      family: 'paintedMetal',
      position: [corridorOffset(0.37), thresholdY + entranceHeight + 0.13, groundZ + entranceCenter],
      rotation: [0, 0, side * 0.045],
    })
  }

  const roofDetail = getRoofDetailPreset(facadeFamily, paletteIndex, preset.roofProfile)
  const roofSurfaceY = buildingTop + PROPORTIONS.building.roofThickness
  if (roofDetail === 'service-room') {
    facadeParts.push({
      geometry: new THREE.BoxGeometry(1.55, 0.9, 1.7),
      color: facadeColor,
      family: 'paintedPlaster',
      position: [topX + side * 0.42, roofSurfaceY + 0.45, topZ],
    })
  } else if (roofDetail === 'hvac') {
    facadeParts.push(
      {
        geometry: new THREE.BoxGeometry(1.2, 0.48, 0.86),
        color: buildingPalette.parapet,
        family: 'paintedMetal',
        position: [topX + side * 0.34, roofSurfaceY + 0.24, topZ - 0.36],
      },
      {
        geometry: new THREE.BoxGeometry(0.72, 0.38, 0.68),
        color: buildingPalette.base,
        family: 'paintedMetal',
        position: [topX - side * 0.5, roofSurfaceY + 0.19, topZ + 0.42],
      },
    )
  } else if (roofDetail === 'tank') {
    facadeParts.push(
      {
        geometry: new THREE.CylinderGeometry(0.48, 0.48, 0.72, 10),
        color: buildingPalette.parapet,
        family: 'paintedMetal',
        position: [topX + side * 0.34, roofSurfaceY + 0.56, topZ],
      },
      {
        geometry: new THREE.BoxGeometry(0.82, 0.2, 0.82),
        color: buildingPalette.base,
        family: 'paintedMetal',
        position: [topX + side * 0.34, roofSurfaceY + 0.1, topZ],
      },
    )
  } else if (roofDetail === 'antenna') {
    facadeParts.push(
      {
        geometry: new THREE.CylinderGeometry(0.045, 0.065, 1.15, 7),
        color: buildingPalette.parapet,
        family: 'paintedMetal',
        position: [topX, roofSurfaceY + 0.575, topZ],
      },
      {
        geometry: new THREE.BoxGeometry(0.72, 0.28, 0.72),
        color: buildingPalette.base,
        family: 'paintedMetal',
        position: [topX, roofSurfaceY + 0.14, topZ],
      },
    )
  }
}

function appendSkylineSilhouetteParts(
  parts: ColoredGeometryPart[],
  preset: SkylineSilhouettePreset,
  color: number,
  side: -1 | 1,
  buildingX: number,
  buildingZ: number,
) {
  for (const mass of preset.masses) {
    parts.push({
      geometry: new THREE.BoxGeometry(mass.width, mass.height, mass.depth),
      color,
      family: 'paintedPlaster',
      position: [
        buildingX + side * mass.outwardOffset,
        mass.baseHeight + mass.height / 2 - 0.5,
        buildingZ + mass.longitudinalOffset,
      ],
    })
  }
  const topMass = preset.masses.reduce((highest, mass) => (
    mass.baseHeight + mass.height > highest.baseHeight + highest.height ? mass : highest
  ))
  const topY = topMass.baseHeight + topMass.height - 0.5
  const topX = buildingX + side * topMass.outwardOffset
  const topZ = buildingZ + topMass.longitudinalOffset
  if (preset.roofProfile === 'angled-cap') {
    parts.push({
      geometry: createTaperedPrismGeometry(
        topMass.width + 0.2,
        topMass.width * 0.68,
        1.15,
        topMass.depth + 0.2,
      ),
      color,
      family: 'darkCoatedMetal',
      position: [topX, topY, topZ],
    })
  } else {
    parts.push({
      geometry: new THREE.BoxGeometry(topMass.width + 0.28, 0.34, topMass.depth + 0.28),
      color,
      family: 'darkCoatedMetal',
      position: [topX, topY + 0.17, topZ],
    })
  }
}

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
    const response = getMaterialResponseTuple(part.family)
    const responses = new Uint8Array(geometry.attributes.position.count * response.length)
    for (let index = 0; index < responses.length; index += response.length) {
      responses[index] = Math.round(response[0] * 255)
      responses[index + 1] = Math.round(response[1] * 255)
      responses[index + 2] = Math.round(
        (response[2] / MATERIAL_ENVIRONMENT_RESPONSE_MAX) * 255,
      )
      responses[index + 3] = Math.round(response[3] * 255)
    }
    geometry.setAttribute(
      MATERIAL_RESPONSE_ATTRIBUTE,
      new THREE.Uint8BufferAttribute(responses, response.length, true),
    )
    return geometry
  })
  const merged = mergeGeometries(transformed, false)
  transformed.forEach((geometry) => geometry.dispose())
  if (!merged) throw new Error('Unable to merge Motion Rush geometry')
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function vegetationToneColor(tone: FoliageMassPreset['tone']) {
  if (tone === 'dark') return WORLD_PALETTE.vegetation.foliageDark
  if (tone === 'light') return WORLD_PALETTE.vegetation.foliageLight
  if (tone === 'blossom') return WORLD_PALETTE.vegetation.blossom
  return WORLD_PALETTE.vegetation.foliageMid
}

function appendSoilPatch(
  parts: ColoredGeometryPart[],
  cache: VegetationGeometryCache,
  x: number,
  ground: number,
  z: number,
  width: number,
  depth: number,
) {
  parts.push({
    geometry: cache.clone('soil-patch', () => new THREE.BoxGeometry(1, 1, 1)),
    color: WORLD_PALETTE.vegetation.trunk,
    family: 'trackBed',
    position: [x, ground + PROPORTIONS.vegetation.soilPatchHeight / 2, z],
    scale: [width, PROPORTIONS.vegetation.soilPatchHeight, depth],
  })
}

function appendTreeParts(
  parts: ColoredGeometryPart[],
  cache: VegetationGeometryCache,
  familyId: TreeFamilyId,
  sizeId: TreeSizeId,
  side: -1 | 1,
  ground: number,
  z: number,
  farProxy = false,
) {
  const family = TREE_FAMILIES[familyId]
  const size = TREE_SIZES[sizeId]
  const x = side * READABILITY_PLACEMENT.vegetationTreeLateralOffset
  const canopyCenterY = ground + size.trunkHeight + size.canopyRadius * 0.56
  appendSoilPatch(parts, cache, x, ground, z, 1.45, 1.62)
  parts.push({
    geometry: cache.clone('tapered-trunk', () => new THREE.CylinderGeometry(0.66, 1, 1, 7)),
    color: WORLD_PALETTE.vegetation.trunk,
    family: 'treeTrunk',
    position: [x, ground + size.trunkHeight / 2, z],
    scale: [size.trunkRadiusBottom, size.trunkHeight, size.trunkRadiusBottom],
  })

  if (!farProxy && sizeId !== 'short') {
    parts.push({
      geometry: cache.clone('restrained-branch', () => new THREE.CylinderGeometry(0.62, 1, 1, 6)),
      color: WORLD_PALETTE.vegetation.trunk,
      family: 'treeTrunk',
      position: [x + side * 0.22, ground + size.trunkHeight * 0.79, z + 0.02],
      rotation: [0.08, 0, -side * 0.64],
      scale: [size.trunkRadiusTop * 0.56, 0.82, size.trunkRadiusTop * 0.56],
    })
  }

  const masses = farProxy ? family.masses.slice(0, 2) : family.masses
  for (const mass of masses) {
    parts.push({
      geometry: cache.clone(
        farProxy ? 'far-foliage-mass' : 'layered-foliage-mass',
        () => new THREE.IcosahedronGeometry(1, farProxy ? 0 : 1),
      ),
      color: vegetationToneColor(farProxy && mass.tone === 'blossom' ? 'mid' : mass.tone),
      family: 'foliage',
      position: [
        x + side * mass.offset[0] * size.canopyRadius,
        canopyCenterY + mass.offset[1] * size.canopyRadius,
        z + mass.offset[2] * size.canopyRadius,
      ],
      rotation: [0, (mass.offset[0] + mass.offset[2]) * 0.32, 0],
      scale: [
        mass.scale[0] * size.canopyRadius,
        mass.scale[1] * size.canopyRadius,
        mass.scale[2] * size.canopyRadius,
      ],
    })
  }
}

function appendShrubParts(
  parts: ColoredGeometryPart[],
  cache: VegetationGeometryCache,
  familyId: ShrubFamilyId,
  x: number,
  ground: number,
  z: number,
  scale = 1,
  flowering = false,
) {
  const radius = PROPORTIONS.vegetation.shrubRadius * scale
  for (const [massIndex, mass] of SHRUB_FAMILIES[familyId].entries()) {
    parts.push({
      geometry: cache.clone('shrub-mass', () => new THREE.DodecahedronGeometry(1, 0)),
      color: flowering && massIndex === 2
        ? WORLD_PALETTE.vegetation.blossom
        : vegetationToneColor(mass.tone),
      family: 'foliage',
      position: [
        x + mass.offset[0] * radius,
        ground + radius * 0.45 + mass.offset[1] * radius,
        z + mass.offset[2] * radius,
      ],
      scale: [mass.scale[0] * radius, mass.scale[1] * radius, mass.scale[2] * radius],
    })
  }
}

function appendFlowerCluster(
  parts: ColoredGeometryPart[],
  cache: VegetationGeometryCache,
  x: number,
  ground: number,
  z: number,
  side: -1 | 1,
) {
  const flowerOffsets = [
    [-0.46, 0, -0.25], [-0.12, 0.05, 0.18], [0.25, 0, -0.14], [0.48, 0.04, 0.22],
  ] as const
  for (const [index, offset] of flowerOffsets.entries()) {
    parts.push({
      geometry: cache.clone('flower-blossom', () => new THREE.OctahedronGeometry(1, 0)),
      color: index % 3 === 0
        ? WORLD_PALETTE.vegetation.foliageLight
        : WORLD_PALETTE.vegetation.blossom,
      family: 'foliage',
      position: [x + side * offset[0], ground + 0.25 + offset[1], z + offset[2]],
      scale: [
        PROPORTIONS.vegetation.flowerRadius * 1.4,
        PROPORTIONS.vegetation.flowerRadius,
        PROPORTIONS.vegetation.flowerRadius * 1.25,
      ],
    })
  }
  for (const leafOffset of [-0.28, 0.24]) {
    parts.push({
      geometry: cache.clone('ground-leaf', () => new THREE.TetrahedronGeometry(1, 0)),
      color: WORLD_PALETTE.vegetation.shrub,
      family: 'foliage',
      position: [x + leafOffset, ground + 0.13, z + leafOffset * 0.4],
      rotation: [0, leafOffset * 1.7, 0],
      scale: [0.38, 0.16, 0.3],
    })
  }
}

function createTaperedPrismGeometry(
  bottomWidth: number,
  topWidth: number,
  height: number,
  length: number,
) {
  const profile = new THREE.Shape()
  profile.moveTo(-bottomWidth / 2, 0)
  profile.lineTo(bottomWidth / 2, 0)
  profile.lineTo(topWidth / 2, height)
  profile.lineTo(-topWidth / 2, height)
  profile.closePath()
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: length,
    steps: 1,
    bevelEnabled: false,
  })
  geometry.translate(0, 0, -length / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

const ENVIRONMENT_WIDTH = 32
const ENVIRONMENT_HEIGHT = 16

function smootherStep(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1)
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10)
}

function createSkyGradientTexture() {
  const data = new Uint8Array(ATMOSPHERE.textureWidth * ATMOSPHERE.textureHeight * 4)
  const top = new THREE.Color(WORLD_PALETTE.sky.top)
  const middle = new THREE.Color(WORLD_PALETTE.sky.middle)
  const horizon = new THREE.Color(WORLD_PALETTE.sky.horizon)
  const rowColor = new THREE.Color()

  for (let y = 0; y < ATMOSPHERE.textureHeight; y += 1) {
    const latitude = y / (ATMOSPHERE.textureHeight - 1)
    if (latitude <= 0.5) {
      rowColor.copy(horizon)
    } else if (latitude < 0.58) {
      rowColor.lerpColors(horizon, middle, smootherStep((latitude - 0.5) / 0.08))
    } else {
      rowColor.lerpColors(middle, top, smootherStep((latitude - 0.58) / 0.12))
    }
    for (let x = 0; x < ATMOSPHERE.textureWidth; x += 1) {
      const offset = (y * ATMOSPHERE.textureWidth + x) * 4
      data[offset] = Math.round(rowColor.r * 255)
      data[offset + 1] = Math.round(rowColor.g * 255)
      data[offset + 2] = Math.round(rowColor.b * 255)
      data[offset + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(
    data,
    ATMOSPHERE.textureWidth,
    ATMOSPHERE.textureHeight,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = 'stage-24-three-zone-sky-gradient'
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function createStylizedEnvironmentTexture() {
  const data = new Uint8Array(ENVIRONMENT_WIDTH * ENVIRONMENT_HEIGHT * 4)
  const upperSky = new THREE.Color(0x79bad4)
  const horizon = new THREE.Color(0xc7d9d1)
  const ground = new THREE.Color(0x596052)
  const warmHighlight = new THREE.Color(0xf8edcf)
  const rowColor = new THREE.Color()
  const pixelColor = new THREE.Color()
  for (let y = 0; y < ENVIRONMENT_HEIGHT; y += 1) {
    const vertical = y / (ENVIRONMENT_HEIGHT - 1)
    if (vertical < 0.56) rowColor.lerpColors(upperSky, horizon, vertical / 0.56)
    else rowColor.lerpColors(horizon, ground, (vertical - 0.56) / 0.44)
    for (let x = 0; x < ENVIRONMENT_WIDTH; x += 1) {
      const horizontal = x / (ENVIRONMENT_WIDTH - 1)
      const highlightDistance = Math.min(
        Math.abs(horizontal - 0.92),
        1 - Math.abs(horizontal - 0.92),
      )
      const highlightLobe = Math.exp(-(highlightDistance * highlightDistance) / 0.018) *
        Math.max(0, 1 - Math.abs(vertical - 0.34) / 0.42) * 0.42
      pixelColor.copy(rowColor).lerp(warmHighlight, highlightLobe)
      const offset = (y * ENVIRONMENT_WIDTH + x) * 4
      data[offset] = Math.round(pixelColor.r * 255)
      data[offset + 1] = Math.round(pixelColor.g * 255)
      data[offset + 2] = Math.round(pixelColor.b * 255)
      data[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(
    data,
    ENVIRONMENT_WIDTH,
    ENVIRONMENT_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = 'stage-11-stylized-environment'
  // THREE.Color stores these authored swatches in the renderer's linear working
  // space, so the generated environment data remains explicitly linear.
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function createWorldSurfaceMaterial() {
  const worldMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.82,
  })
  worldMaterial.name = 'stage-11-world-surface-families'
  worldMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute vec4 ${MATERIAL_RESPONSE_ATTRIBUTE};\nvarying vec4 vMaterialResponse;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvMaterialResponse = ${MATERIAL_RESPONSE_ATTRIBUTE};\nvMaterialResponse.z *= ${MATERIAL_ENVIRONMENT_RESPONSE_MAX.toFixed(1)};`,
      )

    const familyLights = THREE.ShaderChunk.lights_fragment_maps
      .replace(
        'iblIrradiance += getIBLIrradiance( geometryNormal );',
        'iblIrradiance += getIBLIrradiance( geometryNormal ) * vMaterialResponse.z;',
      )
      .replace(
        'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
        'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * vMaterialResponse.z;',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vMaterialResponse;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vMaterialResponse.w;',
      )
      .replace(
        'float roughnessFactor = roughness;',
        'float roughnessFactor = vMaterialResponse.x;',
      )
      .replace(
        'float metalnessFactor = metalness;',
        'float metalnessFactor = vMaterialResponse.y;',
      )
      .replace('#include <lights_fragment_maps>', familyLights)
  }
  worldMaterial.customProgramCacheKey = () => 'motion-rush-stage-11-surface-response-v1'
  return worldMaterial
}

function flatMaterial(color: number, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    side: THREE.FrontSide,
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

type WarningPatternPoint = { x: number; y: number }

function clipWarningPolygon(
  polygon: WarningPatternPoint[],
  signedDistance: (point: WarningPatternPoint) => number,
) {
  const result: WarningPatternPoint[] = []
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    const startDistance = signedDistance(start)
    const endDistance = signedDistance(end)
    const startInside = startDistance >= 0
    const endInside = endDistance >= 0
    if (startInside) result.push(start)
    if (startInside === endInside) continue
    const amount = startDistance / (startDistance - endDistance)
    result.push({
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
    })
  }
  return result
}

/** Creates broad clipped bands, so warning graphics never overhang the panel. */
function createWarningStripeShapes(width: number, height: number, count: number) {
  const slope = 0.48
  const span = width + slope * height
  const bandWidth = span / (count * 2 - 0.35)
  const firstCenter = -span / 2 + bandWidth / 2
  const shapes: THREE.Shape[] = []
  for (let index = 0; index < count; index += 1) {
    const center = firstCenter + index * bandWidth * 2
    const lower = center - bandWidth / 2
    const upper = center + bandWidth / 2
    let polygon: WarningPatternPoint[] = [
      { x: -width / 2, y: -height / 2 },
      { x: width / 2, y: -height / 2 },
      { x: width / 2, y: height / 2 },
      { x: -width / 2, y: height / 2 },
    ]
    polygon = clipWarningPolygon(polygon, (point) => point.x + slope * point.y - lower)
    polygon = clipWarningPolygon(polygon, (point) => upper - point.x - slope * point.y)
    if (polygon.length < 3) continue
    const shape = new THREE.Shape()
    shape.moveTo(polygon[0].x, polygon[0].y)
    polygon.slice(1).forEach((point) => shape.lineTo(point.x, point.y))
    shape.closePath()
    shapes.push(shape)
  }
  return shapes
}

/** Thin closed wedge used twice, leaving the underside open and readable. */
function createRampSidePanelGeometry(descending: boolean) {
  const shell = RAMP_VISUAL_SHELL
  const halfLength = shell.length / 2
  const minimumTop = shell.sidePanelGroundClearance + 0.075
  const entryTop = Math.max(
    minimumTop,
    getRampVisualSurfaceHeight(halfLength, descending) - shell.sidePanelDeckOverlap,
  )
  const exitTop = Math.max(
    minimumTop,
    getRampVisualSurfaceHeight(-halfLength, descending) - shell.sidePanelDeckOverlap,
  )
  const halfThickness = shell.sidePanelThickness / 2
  const positions = new Float32Array([
    -halfThickness, shell.sidePanelGroundClearance, halfLength,
    -halfThickness, shell.sidePanelGroundClearance, -halfLength,
    -halfThickness, exitTop, -halfLength,
    -halfThickness, entryTop, halfLength,
    halfThickness, shell.sidePanelGroundClearance, halfLength,
    halfThickness, shell.sidePanelGroundClearance, -halfLength,
    halfThickness, exitTop, -halfLength,
    halfThickness, entryTop, halfLength,
  ])
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8 * 2), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** One broad V marking; three copies remain legible without a decal material. */
function createRampChevronGeometry() {
  const { chevronWidth: width, chevronDepth: depth, chevronBand: band } =
    RAMP_VISUAL_SHELL
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, -depth / 2)
  shape.lineTo(0, depth / 2)
  shape.lineTo(width / 2, -depth / 2)
  shape.lineTo(width / 2 - band, -depth / 2)
  shape.lineTo(0, depth / 2 - band * 1.45)
  shape.lineTo(-width / 2 + band, -depth / 2)
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

export class RunnerEngine {
  private readonly container: HTMLElement
  private readonly options: RunnerEngineOptions
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, CAMERA_FAR)
  private readonly clock = new THREE.Clock()
  private readonly cityMaterial = createWorldSurfaceMaterial()
  private readonly skyGradientTexture = createSkyGradientTexture()
  private readonly environmentTexture = createStylizedEnvironmentTexture()
  private readonly geometryQuality = new GeometryQualityFactory()
  private readonly trackGeometryCache = new TrackGeometryCache()
  private readonly trainComponentGeometryCache = new TrainComponentGeometryCache()
  private readonly vegetationGeometryCache = new VegetationGeometryCache()
  private readonly surfaceMaterialCache = new Map<string, THREE.MeshStandardMaterial>()
  private readonly trainGeometryCache = new Map<string, THREE.BufferGeometry>()
  private readonly hazardGeometryCache = new Map<string, THREE.BufferGeometry>()
  private jumpBarrierTemplate?: THREE.Group
  private readonly rampGeometryCache = new Map<'ascending' | 'descending', THREE.BufferGeometry>()
  private readonly trackZs = new Float64Array(TRACK_SEGMENTS)
  private readonly overheadZs = new Float64Array(OVERHEAD_GANTRY_COUNT)
  private readonly trackDetailTileCenters = getTrackDetailTileCenters()
  private trackInstances?: THREE.InstancedMesh
  private trackConnectionInstances?: THREE.InstancedMesh
  private trackFastenerInstances?: THREE.InstancedMesh
  private trackBallastInstances?: THREE.InstancedMesh
  private readonly overheadGantries: THREE.Group[] = []
  private coinInstances?: THREE.InstancedMesh
  private readonly instanceTransform = new THREE.Object3D()
  private readonly scenery: THREE.Group[] = []
  private readonly citySeed = import.meta.env.DEV
    ? normalizeCitySeed(new URLSearchParams(window.location.search).get('citySeed'))
    : CITY_DEPTH.defaultSeed
  private readonly cityDepthLayout: CityDepthLayout = createCityDepthLayout(
    CITY_DEPTH_WORLD,
    this.citySeed,
  )
  private readonly cityDepthLayers: CityDepthRuntimeLayer[] = []
  private readonly hazards: Hazard[] = []
  private readonly coins: Coin[] = []
  private readonly roofRoutes: RoofRoute[] = []
  private readonly coinBursts: CoinBurst[] = []
  private readonly player = new THREE.Group()
  private readonly playerVisual = new THREE.Group()
  private playerShadow?: THREE.Mesh
  private landingRing?: THREE.Mesh
  private readonly playerParts: {
    pelvis?: THREE.Object3D
    torso?: THREE.Object3D
    head?: THREE.Object3D
    leftShoulder?: THREE.Object3D
    rightShoulder?: THREE.Object3D
    leftElbow?: THREE.Object3D
    rightElbow?: THREE.Object3D
    leftHip?: THREE.Object3D
    rightHip?: THREE.Object3D
    leftKnee?: THREE.Object3D
    rightKnee?: THREE.Object3D
    leftAnkle?: THREE.Object3D
    rightAnkle?: THREE.Object3D
  } = {}
  private crouchVisualBlend = 0
  private laneVisualLean = 0
  private readonly characterPoseInput: CharacterPoseInput = {
    elapsed: 0,
    speed: START_SPEED,
    crouch: 0,
    airborne: false,
    jumpVelocity: 0,
    landing: 0,
    laneLean: 0,
    rampLean: 0,
  }
  private readonly characterPose: CharacterPose = getCharacterPose(this.characterPoseInput)

  private animationFrame = 0
  private status: GameStatus = 'menu'
  private cameraViewMode: CameraViewMode = 'third-person'
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
  private recycledGroundCoinCount = 0
  private recycledGroundCoinLane = 1
  private score = 0
  private speed = START_SPEED
  private snapshotTimer = 0
  private destroyed = false
  private lastHazardLane = 1
  private lastHazardKind: HazardKind = 'jump'
  private trainSpawnSequence = 0
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
  private readonly landingSurfaceHeights = [0, 0, 0]
  private readonly landingSurfaceKinds: LandingSurfaceCandidate['kind'][] = ['ground', 'ground', 'ground']
  private readonly landingSurfaceCandidate: LandingSurfaceCandidate = { lane: 1, height: 0, kind: 'ground' }
  private readonly previousLandingSurface: LandingSurfaceCandidate = { lane: 1, height: 0, kind: 'ground' }
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
  private cameraLookHeight: number = CHASE_CAMERA.lookHeight
  private cameraLookX = 0
  private burstCursor = 0
  private landingEffectAge = 1
  private readonly profiling = new URLSearchParams(window.location.search).has('profile')
  private readonly roofTestMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('roofTest')
  private readonly maxSpeedTestMode = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has('maxSpeedTest')
  private readonly cityPortraitTestMode = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('cityViewport') === 'portrait'
  private readonly geometryDiagnosticMode = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('geometryDiagnostic')
    : null
  private readonly hazardDiagnosticMode = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('hazardDiagnostic')
    : null
  private readonly trainDiagnosticMode = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('trainDiagnostic')
    : null
  private readonly trackDiagnosticMode = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('trackDiagnostic')
    : null
  private profileElapsed = 0
  private profileStateElapsed = 0
  private profileFrames = 0
  private readonly profileFrameTimes: number[] = []
  private geometryDiagnosticMaterial?: THREE.Material
  private readonly geometryBoundsDiagnostics: {
    target: THREE.Object3D
    helper: THREE.Box3Helper
  }[] = []

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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = TONAL_OUTPUT.exposure
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
      this.cameraLookHeight = CHASE_CAMERA.lookHeight
      this.cameraLookX = 0
      this.supportLaneIndex = 1
      this.surfaceTransitionKind = 'same-lane'
      this.elevatedTransfer.active = false
      if (this.cameraViewMode === 'third-person') this.resetChaseCameraPresentation()
      else this.updateRunnerPovCamera(1)
    }
    if (status === 'playing') this.clock.getDelta()
  }

  setCameraViewMode(mode: CameraViewMode) {
    if (this.cameraViewMode === mode) return
    this.cameraViewMode = mode
    const runnerPov = mode === 'runner-pov'
    this.playerVisual.visible = !runnerPov
    if (this.playerShadow) this.playerShadow.visible = !runnerPov

    if (runnerPov) this.updateRunnerPovCamera(1)
    else this.resetChaseCameraPresentation()
  }

  start() {
    this.distance = this.maxSpeedTestMode ? (MAX_SPEED - START_SPEED) * 235 : 0
    this.coinCount = 0
    this.score = 0
    this.speed = this.maxSpeedTestMode ? MAX_SPEED : START_SPEED
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
    this.playerVisual.position.set(0, PLAYER_CHARACTER.visualFootOffset, 0)
    this.playerVisual.rotation.set(0, 0, 0)
    this.playerVisual.scale.setScalar(PLAYER_CHARACTER.visualScale)
    this.crouchVisualBlend = 0
    this.laneVisualLean = 0
    this.surfaceHeight = 0
    this.previousSurfaceHeight = 0
    this.previousLandingSurface.lane = 1
    this.previousLandingSurface.height = 0
    this.previousLandingSurface.kind = 'ground'
    this.cameraLookHeight = CHASE_CAMERA.lookHeight
    this.cameraLookX = 0
    if (this.cameraViewMode === 'third-person') this.resetChaseCameraPresentation()
    else this.updateRunnerPovCamera(1)
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
      const jumpRequest = tryStartJump(this.jumpMotion, this.player.position.y)
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
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        geometries.add(object.geometry)
        if (Array.isArray(object.material)) object.material.forEach((item) => materials.add(item))
        else materials.add(object.material)
      }
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((item) => item.dispose())
    this.environmentTexture.dispose()
    this.skyGradientTexture.dispose()
    this.trackGeometryCache.dispose()
    this.trainComponentGeometryCache.dispose()
    this.vegetationGeometryCache.dispose()
    this.geometryQuality.dispose()
    this.geometryDiagnosticMaterial?.dispose()
    this.surfaceMaterialCache.clear()
    this.rampGeometryCache.clear()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private createScene() {
    this.renderer.setClearColor(WORLD_PALETTE.sky.horizon, 1)
    this.scene.background = this.skyGradientTexture
    this.scene.environment = this.environmentTexture
    this.scene.fog = new THREE.Fog(
      WORLD_PALETTE.sky.horizon,
      ATMOSPHERE.fogNear,
      ATMOSPHERE.fogFar,
    )

    const hemisphere = new THREE.HemisphereLight(
      0xeafaff,
      0x6c7764,
      TONAL_OUTPUT.hemisphereIntensity,
    )
    this.scene.add(hemisphere)

    const sun = new THREE.DirectionalLight(0xfff0c5, TONAL_OUTPUT.directionalIntensity)
    sun.position.set(...LIGHTING_SHADOWS.keyPosition)
    sun.target.position.set(...LIGHTING_SHADOWS.keyTarget)
    sun.castShadow = true
    sun.shadow.mapSize.set(LIGHTING_SHADOWS.mapSize, LIGHTING_SHADOWS.mapSize)
    sun.shadow.camera.left = LIGHTING_SHADOWS.camera.left
    sun.shadow.camera.right = LIGHTING_SHADOWS.camera.right
    sun.shadow.camera.top = LIGHTING_SHADOWS.camera.top
    sun.shadow.camera.bottom = LIGHTING_SHADOWS.camera.bottom
    sun.shadow.camera.near = LIGHTING_SHADOWS.camera.near
    sun.shadow.camera.far = LIGHTING_SHADOWS.camera.far
    sun.shadow.bias = LIGHTING_SHADOWS.bias
    sun.shadow.normalBias = LIGHTING_SHADOWS.normalBias
    sun.shadow.camera.updateProjectionMatrix()
    this.scene.add(sun, sun.target)

    this.createSkyline()

    this.camera.position.set(0, CHASE_CAMERA.groundHeight, CHASE_CAMERA.positionZ)
    this.camera.lookAt(0, CHASE_CAMERA.lookHeight, CHASE_CAMERA.lookZ)

    this.createTrackSystem()
    for (let i = 0; i < 24; i += 1) this.createScenery(i)
    this.createCityDepthLayers()

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
    this.loadJumpBarrierAsset()

    for (let i = 0; i < 46; i += 1) {
      const coin = this.createCoin()
      this.coins.push(coin)
    }
    this.createCoinInstances()

    this.createEffects()

    this.resetWorldObjects()
    if (this.trainDiagnosticMode) this.createTrainDiagnostic()
    this.createHazardDiagnostic()
    this.applyGeometryDiagnosticMode()
    this.applyTrackDiagnosticMode()
  }

  private createHazardDiagnostic() {
    if (this.hazardDiagnosticMode !== 'jump' && this.hazardDiagnosticMode !== 'slide') return
    const kind = this.hazardDiagnosticMode
    const diagnostic = new THREE.Mesh(this.getHazardGeometry(kind, 0), this.cityMaterial)
    diagnostic.name = `stage-12-hazard-diagnostic-${kind}`
    diagnostic.position.set(LANES[2], 0, -7.5)
    diagnostic.castShadow = true
    diagnostic.receiveShadow = true
    this.scene.add(diagnostic)
  }

  /** Development-only clay, normal, silhouette, wireframe, and bounds views. */
  private applyGeometryDiagnosticMode() {
    const mode = this.geometryDiagnosticMode
    if (!mode) return
    if (mode === 'wireframe') {
      this.cityMaterial.wireframe = true
      return
    }
    if (mode === 'clay') {
      this.geometryDiagnosticMaterial = new THREE.MeshStandardMaterial({
        color: 0xc8c3b7,
        roughness: 0.82,
        metalness: 0,
      })
      this.scene.overrideMaterial = this.geometryDiagnosticMaterial
      return
    }
    if (mode === 'normals') {
      this.geometryDiagnosticMaterial = new THREE.MeshNormalMaterial({ flatShading: true })
      this.scene.overrideMaterial = this.geometryDiagnosticMaterial
      return
    }
    if (mode === 'silhouette') {
      this.geometryDiagnosticMaterial = new THREE.MeshBasicMaterial({ color: 0x050505 })
      this.scene.overrideMaterial = this.geometryDiagnosticMaterial
      return
    }
    if (mode === 'bounds') {
      const targets: THREE.Object3D[] = []
      this.scene.traverse((object) => {
        if (
          object.name.startsWith('stage-12-') ||
          object.name.startsWith('stage-13-') ||
          object.name.startsWith('stage-13r-')
        ) {
          targets.push(object)
        }
      })
      for (const target of targets) {
        target.updateWorldMatrix(true, true)
        const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(target), 0x35ff78)
        this.geometryBoundsDiagnostics.push({ target, helper })
        this.scene.add(helper)
      }
    }
  }

  /** Development-only component isolation for the Stage 13 matched-view captures. */
  private applyTrackDiagnosticMode() {
    if (!this.trackDiagnosticMode) return
    const keep = new Set<THREE.Object3D>([
      ...(this.trackInstances ? [this.trackInstances] : []),
      ...(this.trackConnectionInstances ? [this.trackConnectionInstances] : []),
      ...(this.trackFastenerInstances ? [this.trackFastenerInstances] : []),
      ...(this.trackBallastInstances ? [this.trackBallastInstances] : []),
    ])
    for (const child of this.scene.children) {
      child.visible = keep.has(child) || child instanceof THREE.Light || child.type === 'Object3D'
    }
  }

  private createSkyline() {
    const cloudGeometry = new THREE.SphereGeometry(1, 10, 7)
    cloudGeometry.name = 'stage-24-shared-cloud-lobe'
    const cloudMaterials: Record<CloudTone, THREE.MeshBasicMaterial> = {
      highlight: new THREE.MeshBasicMaterial({
        color: WORLD_PALETTE.sky.cloudHighlight,
        fog: true,
        depthTest: true,
        depthWrite: true,
      }),
      body: new THREE.MeshBasicMaterial({
        color: WORLD_PALETTE.sky.cloudBody,
        fog: true,
        depthTest: true,
        depthWrite: true,
      }),
      underside: new THREE.MeshBasicMaterial({
        color: WORLD_PALETTE.sky.cloudUnderside,
        fog: true,
        depthTest: true,
        depthWrite: true,
      }),
    }
    const toneCounts: Record<CloudTone, number> = { highlight: 0, body: 0, underside: 0 }
    for (const placement of CLOUD_PLACEMENTS) {
      for (const lobe of CLOUD_FAMILIES[placement.family]) toneCounts[lobe[6]] += 1
    }

    const createCloudMesh = (tone: CloudTone) => {
      const mesh = new THREE.InstancedMesh(cloudGeometry, cloudMaterials[tone], toneCounts[tone])
      mesh.name = `stage-24-cloud-${tone}-instances`
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      mesh.castShadow = false
      mesh.receiveShadow = false
      // Static atmosphere spans a deliberately wide composition; explicit
      // no-cull avoids portrait/fullscreen changes clipping side cloud banks.
      mesh.frustumCulled = false
      return mesh
    }
    const cloudMeshes: Record<CloudTone, THREE.InstancedMesh> = {
      highlight: createCloudMesh('highlight'),
      body: createCloudMesh('body'),
      underside: createCloudMesh('underside'),
    }
    const toneIndices: Record<CloudTone, number> = { highlight: 0, body: 0, underside: 0 }
    const cloudTransform = new THREE.Object3D()
    const rotatedOffset = new THREE.Vector3()

    for (const placement of CLOUD_PLACEMENTS) {
      const cosine = Math.cos(placement.rotation)
      const sine = Math.sin(placement.rotation)
      for (const [x, y, z, sx, sy, sz, tone] of CLOUD_FAMILIES[placement.family]) {
        rotatedOffset.set(x * cosine - z * sine, y, x * sine + z * cosine)
          .multiplyScalar(placement.scale)
        cloudTransform.position.set(
          placement.position[0] + rotatedOffset.x,
          placement.position[1] + rotatedOffset.y,
          placement.position[2] + rotatedOffset.z,
        )
        cloudTransform.rotation.set(0, placement.rotation, placement.rotation * 0.3)
        cloudTransform.scale.set(
          sx * placement.scale,
          sy * placement.scale,
          sz * placement.scale,
        )
        cloudTransform.updateMatrix()
        cloudMeshes[tone].setMatrixAt(toneIndices[tone], cloudTransform.matrix)
        toneIndices[tone] += 1
      }
    }
    const atmosphereClouds = new THREE.Group()
    atmosphereClouds.name = 'stage-24-persistent-atmosphere-clouds'
    for (const tone of Object.keys(cloudMeshes) as CloudTone[]) {
      cloudMeshes[tone].instanceMatrix.needsUpdate = true
      cloudMeshes[tone].computeBoundingBox()
      cloudMeshes[tone].computeBoundingSphere()
      atmosphereClouds.add(cloudMeshes[tone])
    }
    this.scene.add(atmosphereClouds)

    const skylineParts: ColoredGeometryPart[] = []
    const skylineColors = WORLD_PALETTE.sky.skyline
    for (let i = 0; i < CITY_DEPTH.skylineCount; i += 1) {
      const side: -1 | 1 = i % 2 ? 1 : -1
      const lateralRatio = ((i * 11) % 19) / 18
      const setback = THREE.MathUtils.lerp(
        this.cityDepthLayout.setbacks.skylineMin,
        this.cityDepthLayout.setbacks.skylineMax,
        lateralRatio,
      )
      const skylineRow = i % CITY_DEPTH.skylineRows
      appendSkylineSilhouetteParts(
        skylineParts,
        getSkylineSilhouette(i, this.cityDepthLayout.seed),
        skylineColors[i % skylineColors.length],
        side,
        side * setback,
        -118 - skylineRow * 21 - (i % 3) * 4,
      )
    }

    skylineParts.push(
      {
        geometry: new THREE.TorusGeometry(6.4, 0.38, 8, 24, Math.PI),
        color: WORLD_PALETTE.sky.tunnel,
        family: 'rawConcrete',
        position: [0, 0.6, -205],
      },
      {
        geometry: new THREE.BoxGeometry(0.78, 6.7, 1.0),
        color: WORLD_PALETTE.sky.tunnel,
        family: 'rawConcrete',
        position: [-6.4, 3.4, -205],
      },
      {
        geometry: new THREE.BoxGeometry(0.78, 6.7, 1.0),
        color: WORLD_PALETTE.sky.tunnel,
        family: 'rawConcrete',
        position: [6.4, 3.4, -205],
      },
    )
    const skyline = new THREE.Mesh(mergeColoredParts(skylineParts), this.cityMaterial)
    skyline.castShadow = false
    skyline.receiveShadow = false
    this.scene.add(skyline)
  }

  private createCityDepthLayers() {
    const midInstancesByFamily = new Map<BuildingFamilyId, CityDepthInstance[]>()
    const farInstancesByFamily = new Map<BuildingFamilyId, CityDepthInstance[]>()

    for (const segment of this.cityDepthLayout.segments) {
      const segmentZ = -segment.index * SCENERY_SPACING
      segment.mid.forEach((placement, placementIndex) => {
        const familyId = getBuildingFamilyId(
          'mid',
          this.cityDepthLayout.seed,
          segment.index,
          placementIndex,
          placement.side,
        )
        const instances = midInstancesByFamily.get(familyId) ?? []
        instances.push({
          x: placement.side * placement.setback,
          y: 0,
          z: segmentZ + placement.zOffset,
          rotationY: placement.side > 0 ? Math.PI : 0,
        })
        midInstancesByFamily.set(familyId, instances)
      })
      segment.far.forEach((placement, placementIndex) => {
        const familyId = getBuildingFamilyId(
          'far',
          this.cityDepthLayout.seed,
          segment.index,
          placementIndex,
          placement.side,
        )
        const instances = farInstancesByFamily.get(familyId) ?? []
        instances.push({
          x: placement.side * placement.setback,
          y: 0,
          z: segmentZ + placement.zOffset,
          rotationY: placement.side > 0 ? Math.PI : 0,
        })
        farInstancesByFamily.set(familyId, instances)
      })
    }

    const familyIds = Object.keys(BUILDING_FAMILIES) as BuildingFamilyId[]
    for (const [familyIndex, familyId] of familyIds.entries()) {
      const instances = midInstancesByFamily.get(familyId) ?? []
      if (instances.length === 0) continue
      const parts: ColoredGeometryPart[] = []
      appendBuildingModelParts(
        parts,
        this.geometryQuality,
        'mid',
        getBuildingFamilyPreset(familyId),
        familyIndex,
        -1,
        0,
        0,
        false,
        true,
      )
      const mesh = new THREE.InstancedMesh(
        mergeColoredParts(parts),
        this.cityMaterial,
        instances.length,
      )
      mesh.name = `city-depth-mid-${familyId}`
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      this.cityDepthLayers.push({
        name: 'mid',
        familyId,
        mesh,
        instances,
        parallax: CITY_DEPTH.parallax.mid,
        backCullZ: CITY_DEPTH.visibility.midBackCullZ,
        frontCullZ: CITY_DEPTH.visibility.midFrontCullZ,
        activeCount: 0,
      })
      this.scene.add(mesh)
    }

    const farPalette = {
      facade: WORLD_PALETTE.sky.skyline[1],
      base: WORLD_PALETTE.sky.skyline[0],
      roof: WORLD_PALETTE.sky.skyline[2],
    }
    for (const [familyIndex, familyId] of familyIds.entries()) {
      const instances = farInstancesByFamily.get(familyId) ?? []
      if (instances.length === 0) continue
      const parts: ColoredGeometryPart[] = []
      appendBuildingModelParts(
        parts,
        this.geometryQuality,
        'far',
        getBuildingFamilyPreset(familyId),
        familyIndex,
        -1,
        0,
        0,
        false,
        false,
        farPalette,
      )
      const mesh = new THREE.InstancedMesh(
        mergeColoredParts(parts),
        this.cityMaterial,
        instances.length,
      )
      mesh.name = `city-depth-far-${familyId}`
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      this.cityDepthLayers.push({
        name: 'far',
        familyId,
        mesh,
        instances,
        parallax: CITY_DEPTH.parallax.far,
        backCullZ: CITY_DEPTH.visibility.farBackCullZ,
        frontCullZ: CITY_DEPTH.visibility.farFrontCullZ,
        activeCount: 0,
      })
      this.scene.add(mesh)
    }
    this.syncCityDepthLayers()
  }

  private syncCityDepthLayers() {
    for (const layer of this.cityDepthLayers) {
      let activeCount = 0
      for (const instance of layer.instances) {
        if (instance.z <= layer.backCullZ || instance.z >= layer.frontCullZ) continue
        this.instanceTransform.position.set(instance.x, instance.y, instance.z)
        this.instanceTransform.rotation.set(0, instance.rotationY, 0)
        this.instanceTransform.scale.set(1, 1, 1)
        this.instanceTransform.updateMatrix()
        layer.mesh.setMatrixAt(activeCount, this.instanceTransform.matrix)
        activeCount += 1
      }
      layer.activeCount = activeCount
      layer.mesh.count = activeCount
      layer.mesh.instanceMatrix.needsUpdate = true
    }
  }

  private updateCityDepthLayers(travel: number) {
    for (const layer of this.cityDepthLayers) {
      for (const instance of layer.instances) {
        instance.z += travel * layer.parallax
        if (instance.z > layer.frontCullZ + 5) {
          instance.z -= this.cityDepthLayout.cycleLength
        }
      }
    }
    this.syncCityDepthLayers()
  }

  private createTrainVisual(
    themeIndex: number,
    preset: TrainLengthPreset,
    roofRoute: boolean,
    direction: TrainDirection = 1,
  ): TrainAssembly {
    const normalizedTheme = ((themeIndex % TRAIN_PALETTES.length) + TRAIN_PALETTES.length) %
      TRAIN_PALETTES.length
    const family = getTrainFrontFamily(normalizedTheme)
    const group = new THREE.Group()
    const frontModule = new THREE.Mesh(
      this.getTrainModuleGeometry(normalizedTheme, 'front', roofRoute),
      this.cityMaterial,
    )
    frontModule.name = 'stage-15-front-wagon'
    frontModule.castShadow = true
    frontModule.receiveShadow = true
    const middleModules = new THREE.InstancedMesh(
      this.getTrainModuleGeometry(normalizedTheme, 'middle', roofRoute),
      this.cityMaterial,
      TRAIN_LENGTH_SYSTEM.maxCars - 2,
    )
    middleModules.name = 'stage-15-repeated-middle-wagons'
    middleModules.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    middleModules.castShadow = true
    middleModules.receiveShadow = true
    const rearModule = new THREE.Mesh(
      this.getTrainModuleGeometry(normalizedTheme, 'rear', roofRoute),
      this.cityMaterial,
    )
    rearModule.name = 'stage-15-rear-wagon'
    rearModule.castShadow = true
    rearModule.receiveShadow = true
    const connectorGeometry = this.getTrainConnectorGeometry(roofRoute)
    const connectors = new THREE.InstancedMesh(
      connectorGeometry,
      this.cityMaterial,
      TRAIN_LENGTH_SYSTEM.maxCars - 1,
    )
    connectors.name = 'stage-15-inter-car-connectors'
    connectors.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    connectors.castShadow = false
    connectors.receiveShadow = true
    group.add(frontModule, middleModules, rearModule, connectors)
    const assembly: TrainAssembly = {
      group,
      frontModule,
      middleModules,
      rearModule,
      connectors,
      family,
      preset,
      composition: getTrainComposition(family, preset),
      themeIndex: normalizedTheme,
      direction,
      roofRoute,
    }
    this.configureTrainAssembly(assembly, normalizedTheme, preset, direction)
    return assembly
  }

  private configureTrainAssembly(
    assembly: TrainAssembly,
    themeIndex: number,
    preset: TrainLengthPreset,
    direction: TrainDirection,
  ) {
    const normalizedTheme = ((themeIndex % TRAIN_PALETTES.length) + TRAIN_PALETTES.length) %
      TRAIN_PALETTES.length
    const family = getTrainFrontFamily(normalizedTheme)
    const composition = getTrainComposition(family, preset)
    assembly.family = family
    assembly.preset = preset
    assembly.composition = composition
    assembly.themeIndex = normalizedTheme
    assembly.direction = direction
    assembly.group.name = `stage-15-${family}-${preset}-${
      assembly.roofRoute ? 'roof-route' : 'moving'
    }`
    assembly.group.rotation.y = getTrainDirectionYaw(direction)
    assembly.frontModule.geometry = this.getTrainModuleGeometry(
      normalizedTheme,
      'front',
      assembly.roofRoute,
    )
    assembly.frontModule.position.set(0, 0, composition.moduleCenters[0])
    assembly.rearModule.geometry = this.getTrainModuleGeometry(
      normalizedTheme,
      'rear',
      assembly.roofRoute,
    )
    assembly.rearModule.position.set(
      0,
      0,
      composition.moduleCenters[composition.carCount - 1],
    )
    assembly.middleModules.geometry = this.getTrainModuleGeometry(
      normalizedTheme,
      'middle',
      assembly.roofRoute,
    )
    assembly.middleModules.count = Math.max(0, composition.carCount - 2)
    for (let index = 0; index < assembly.middleModules.count; index += 1) {
      this.instanceTransform.position.set(0, 0, composition.moduleCenters[index + 1])
      this.instanceTransform.rotation.set(0, 0, 0)
      this.instanceTransform.scale.set(1, 1, 1)
      this.instanceTransform.updateMatrix()
      assembly.middleModules.setMatrixAt(index, this.instanceTransform.matrix)
    }
    assembly.middleModules.instanceMatrix.needsUpdate = true
    assembly.middleModules.boundingBox = null
    assembly.middleModules.boundingSphere = null
    assembly.middleModules.computeBoundingBox()
    assembly.middleModules.computeBoundingSphere()
    assembly.connectors.count = composition.jointCenters.length
    for (let index = 0; index < composition.jointCenters.length; index += 1) {
      this.instanceTransform.position.set(0, 0, composition.jointCenters[index])
      this.instanceTransform.rotation.set(0, 0, 0)
      this.instanceTransform.scale.set(1, 1, 1)
      this.instanceTransform.updateMatrix()
      assembly.connectors.setMatrixAt(index, this.instanceTransform.matrix)
    }
    assembly.connectors.instanceMatrix.needsUpdate = true
    assembly.connectors.boundingBox = null
    assembly.connectors.boundingSphere = null
    assembly.connectors.computeBoundingBox()
    assembly.connectors.computeBoundingSphere()
    assembly.group.userData.stage15 = {
      preset,
      direction,
      frontFamily: family,
      carCount: composition.carCount,
      totalLength: composition.totalLength,
      moduleCenters: [...composition.moduleCenters],
      jointCenters: [...composition.jointCenters],
      roofTraversal: 'one continuous scalar proxy across the full assembly bounds',
      orientationPolicy: 'positive rotation only; no negative-scale mirroring',
    }
  }

  private getTrainModuleGeometry(
    themeIndex: number,
    role: TrainModuleRole,
    roofRoute: boolean,
  ) {
    const normalizedTheme = ((themeIndex % TRAIN_PALETTES.length) + TRAIN_PALETTES.length) %
      TRAIN_PALETTES.length
    const cacheKey = `stage15:${normalizedTheme}:${role}:${roofRoute ? 'roof' : 'obstacle'}`
    let geometry = this.trainGeometryCache.get(cacheKey)
    if (!geometry) {
      geometry = this.createTrainModuleGeometry(normalizedTheme, role, roofRoute)
      this.trainGeometryCache.set(cacheKey, geometry)
    }
    return geometry
  }

  private getTrainConnectorGeometry(roofRoute: boolean) {
    const cacheKey = `stage15:connector:${roofRoute ? 'roof' : 'obstacle'}`
    let geometry = this.trainGeometryCache.get(cacheKey)
    if (geometry) return geometry
    const roofHeight = roofRoute ? TRAIN_ROOF_HEIGHT : OBSTACLE_TRAIN_ROOF_HEIGHT
    const gangwayHeight = roofHeight - TRAIN_LENGTH_SYSTEM.gangwayBottomY - 0.16
    geometry = mergeColoredParts([
      {
        geometry: this.geometryQuality.prism(
          TRAIN_LENGTH_SYSTEM.gangwayWidth,
          gangwayHeight,
          TRAIN_LENGTH_SYSTEM.connectorDepth,
          'z',
          'vehicleBody',
        ),
        color: WORLD_PALETTE.neutral.darkest,
        family: 'rubber',
        position: [
          0,
          TRAIN_LENGTH_SYSTEM.gangwayBottomY + gangwayHeight / 2,
          0,
        ],
      },
      {
        geometry: this.geometryQuality.prism(
          TRAIN_LENGTH_SYSTEM.roofBridgeWidth,
          TRAIN_LENGTH_SYSTEM.roofBridgeThickness,
          TRAIN_LENGTH_SYSTEM.connectorDepth + 0.1,
          'z',
          'thinMechanical',
        ),
        color: WORLD_PALETTE.neutral.dark,
        family: 'darkCoatedMetal',
        position: [0, roofHeight - TRAIN_LENGTH_SYSTEM.roofBridgeThickness / 2, 0],
      },
    ])
    geometry.name = `stage-15-inter-car-connector-${roofRoute ? 'roof' : 'obstacle'}`
    this.trainGeometryCache.set(cacheKey, geometry)
    return geometry
  }

  private cloneTrainComponent(key: string, factory: () => THREE.BufferGeometry) {
    return this.trainComponentGeometryCache.clone(key, factory)
  }

  private appendTrainRunningGear(
    parts: ColoredGeometryPart[],
    length: number,
    theme: TrainPalette,
  ) {
    const runningGear = TRAIN_FRONT_SYSTEM.runningGear
    const chassisCenterY = runningGear.railHeadTop +
      TRAIN_FRONT_SYSTEM.lowerBody.chassisHeight / 2 + 0.035
    parts.push({
      geometry: this.geometryQuality.prism(
        TRAIN_FRONT_SYSTEM.lowerBody.chassisWidth,
        TRAIN_FRONT_SYSTEM.lowerBody.chassisHeight,
        length - 0.46,
        'z',
        'thinMechanical',
      ),
      color: theme.undercarriage,
      family: 'darkCoatedMetal',
      position: [0, chassisCenterY, 0],
    })

    for (const z of getTrainBogieCenters(length)) {
      parts.push({
        geometry: this.geometryQuality.prism(
          runningGear.bogieWidth,
          runningGear.bogieHeight,
          runningGear.bogieLength,
          'z',
          'thinMechanical',
        ),
        color: theme.undercarriage,
        family: 'darkCoatedMetal',
        position: [0, runningGear.railHeadTop + 0.2, z],
      })
    }

    for (const wheel of getTrainWheelPlacements(length)) {
      parts.push(
        {
          geometry: this.cloneTrainComponent(
            'stage-14r-wheel-tire-0.25x0.16x10',
            () => new THREE.CylinderGeometry(
              runningGear.wheelRadius,
              runningGear.wheelRadius,
              runningGear.wheelWidth,
              10,
            ),
          ),
          color: theme.undercarriage,
          family: 'rubber',
          position: [wheel.x, wheel.y, wheel.z],
          rotation: [0, 0, Math.PI / 2],
        },
        {
          geometry: this.cloneTrainComponent(
            'stage-14r-wheel-hub-0.095x0.17x8',
            () => new THREE.CylinderGeometry(0.095, 0.095, 0.17, 8),
          ),
          color: WORLD_PALETTE.neutral.mid,
          family: 'darkCoatedMetal',
          position: [wheel.x, wheel.y, wheel.z],
          rotation: [0, 0, Math.PI / 2],
        },
      )
    }
  }

  private appendTrainLowerFront(
    parts: ColoredGeometryPart[],
    length: number,
    theme: TrainPalette,
    accentColor: number,
  ) {
    const lower = TRAIN_FRONT_SYSTEM.lowerBody
    const skirtBottom = TRAIN_FRONT_SYSTEM.runningGear.railHeadTop + 0.035
    const skirtCenterY = skirtBottom + lower.skirtHeight / 2
    parts.push(
      {
        geometry: this.geometryQuality.prism(
          TRAIN_FORM.maxBodyWidth * lower.skirtWidthScale,
          lower.skirtHeight,
          0.22,
          'z',
          'vehicleBody',
        ),
        color: theme.undercarriage,
        family: 'darkCoatedMetal',
        position: [0, skirtCenterY, length / 2 + 0.2],
      },
      {
        geometry: this.geometryQuality.prism(
          TRAIN_FORM.maxBodyWidth * lower.crashBandWidthScale,
          0.12,
          0.08,
          'z',
          'thinMechanical',
        ),
        color: accentColor,
        family: 'paintedMetal',
        position: [0, skirtBottom + lower.skirtHeight * 0.72, length / 2 + 0.3],
      },
      {
        geometry: this.geometryQuality.prism(
          0.72,
          0.2,
          0.11,
          'z',
          'thinMechanical',
        ),
        color: theme.undercarriage,
        family: 'darkCoatedMetal',
        position: [0, skirtBottom + 0.1, length / 2 + 0.295],
      },
      {
        geometry: this.geometryQuality.prism(
          0.18,
          0.15,
          0.16,
          'z',
          'thinMechanical',
        ),
        color: theme.undercarriage,
        family: 'darkCoatedMetal',
        position: [0, skirtBottom + 0.02, length / 2 + 0.265],
      },
      {
        geometry: this.geometryQuality.prism(
          lower.couplerWidth,
          lower.couplerHeight,
          0.1,
          'z',
          'thinMechanical',
        ),
        color: WORLD_PALETTE.neutral.darkest,
        family: 'rubber',
        position: [0, skirtBottom + 0.02, length / 2 + 0.31],
      },
    )
  }

  private appendTrainHeadlights(
    parts: ColoredGeometryPart[],
    family: TrainFrontFamily,
    length: number,
    form: ReturnType<typeof getTrainFormDimensions>,
    theme: TrainPalette,
  ) {
    const lightY = form.lowerBandTopY + form.totalVisualHeight * 0.02
    const lightX = TRAIN_FORM.maxBodyWidth * (
      family === 'rounded-commuter' ? 0.33 : 0.36
    )
    for (const x of [-lightX, lightX]) {
      if (family === 'rounded-commuter') {
        parts.push(
          {
            geometry: this.geometryQuality.prism(
              0.46,
              0.32,
              0.1,
              'z',
              'thinMechanical',
            ),
            color: theme.undercarriage,
            family: 'rubber',
            position: [x, lightY, length / 2 + 0.29],
          },
          {
            geometry: this.cloneTrainComponent(
              'stage-14r-commuter-headlight-lens-0.135x0.035x10',
              () => new THREE.CylinderGeometry(0.135, 0.135, 0.035, 10),
            ),
            color: theme.headlight,
            family: 'emissiveAccent',
            position: [x, lightY, length / 2 + 0.335],
            rotation: [Math.PI / 2, 0, 0],
          },
        )
      } else {
        parts.push(
          {
            geometry: this.geometryQuality.prism(
              0.44,
              0.31,
              0.1,
              'z',
              'thinMechanical',
            ),
            color: theme.undercarriage,
            family: 'rubber',
            position: [x, lightY, length / 2 + 0.29],
          },
          {
            geometry: this.geometryQuality.prism(
              0.26,
              0.16,
              0.04,
              'z',
              'thinMechanical',
            ),
            color: theme.headlight,
            family: 'emissiveAccent',
            position: [x, lightY, length / 2 + 0.335],
          },
        )
      }
    }
  }

  private appendTrainFrontModule(
    parts: ColoredGeometryPart[],
    family: TrainFrontFamily,
    length: number,
    form: ReturnType<typeof getTrainFormDimensions>,
    theme: TrainPalette,
  ) {
    const shell = TRAIN_FRONT_SYSTEM.shell[family]
    const windshield = TRAIN_FRONT_SYSTEM.windshield[family]
    const frontUsableHeight = form.roofDeckBottomY - TRAIN_FORM.bodyBottom
    const shellColor = family === 'rounded-commuter' ? theme.secondary : theme.primary
    const accentColor = family === 'rounded-commuter' ? theme.primary : theme.secondary
    const shellKey = [
      family,
      frontUsableHeight.toFixed(3),
      shell.depth.toFixed(3),
      'front-shell',
    ].join(':')
    parts.push({
      geometry: this.cloneTrainComponent(shellKey, () => createSectionedFrontShellGeometry({
        backWidth: TRAIN_FORM.maxBodyWidth,
        frontBottomWidth: TRAIN_FORM.maxBodyWidth * shell.frontBottomWidthScale,
        frontTopWidth: TRAIN_FORM.maxBodyWidth * shell.frontTopWidthScale,
        height: frontUsableHeight,
        depth: shell.depth,
        cornerCut: shell.cornerCut,
        topRake: shell.topRake,
      })),
      color: shellColor,
      family: 'paintedMetal',
      position: [
        0,
        TRAIN_FORM.bodyBottom + frontUsableHeight / 2,
        length / 2 + shell.depth / 2,
      ],
    })

    const maskWidth = TRAIN_FORM.maxBodyWidth * windshield.maskWidthScale
    const maskHeight = frontUsableHeight * windshield.maskHeightScale
    const maskY = TRAIN_FORM.bodyBottom + frontUsableHeight * windshield.centerHeightScale
    const insetPanel = (
      label: string,
      width: number,
      height: number,
      depth: number,
      bottomScale: number,
      topScale: number,
      cornerCut: number,
      topRake: number,
    ) => this.cloneTrainComponent(
      [label, width.toFixed(3), height.toFixed(3), 'stage-14-final-panel'].join(':'),
      () => createSectionedFrontShellGeometry({
        backWidth: width,
        frontBottomWidth: width * bottomScale,
        frontTopWidth: width * topScale,
        height,
        depth,
        cornerCut,
        topRake,
      }),
    )
    if (family === 'rounded-commuter') {
      const glassWidth = TRAIN_FORM.maxBodyWidth * windshield.glassWidthScale
      const glassHeight = frontUsableHeight * windshield.glassHeightScale
      parts.push(
        {
          geometry: insetPanel(
            'commuter-mask',
            maskWidth,
            maskHeight,
            0.09,
            0.9,
            0.96,
            0.14,
            0.035,
          ),
          color: theme.primary,
          family: 'darkCoatedMetal',
          position: [0, maskY, length / 2 + 0.28],
          rotation: [windshield.rake, 0, 0],
        },
        {
          geometry: insetPanel(
            'commuter-glass',
            glassWidth,
            glassHeight,
            0.04,
            0.89,
            0.95,
            0.1,
            0.025,
          ),
          color: theme.frontWindow,
          family: 'stylizedGlass',
          position: [0, maskY + 0.015, length / 2 + 0.315],
          rotation: [windshield.rake, 0, 0],
        },
      )
      for (const side of [-1, 1]) {
        parts.push({
          geometry: this.geometryQuality.prism(
            0.16,
            maskHeight * 0.82,
            0.12,
            'z',
            'thinMechanical',
          ),
          color: theme.primary,
          family: 'paintedMetal',
          position: [
            side * (maskWidth / 2 + 0.075),
            maskY - 0.02,
            length / 2 + 0.22,
          ],
        })
      }
      parts.push(
        {
          geometry: this.geometryQuality.prism(
            TRAIN_FORM.maxBodyWidth * 0.89,
            Math.min(0.75, form.lowerBandHeight * 1.25),
            0.16,
            'z',
            'vehicleBody',
          ),
          color: accentColor,
          family: 'paintedMetal',
          position: [0, form.lowerBandTopY + 0.16, length / 2 + 0.265],
        },
        {
          geometry: this.geometryQuality.prism(
            TRAIN_FORM.maxBodyWidth * 0.82,
            0.26,
            0.13,
            'z',
            'vehicleBody',
          ),
          color: theme.primary,
          family: 'paintedMetal',
          position: [0, form.roofDeckBottomY - 0.15, length / 2 + 0.245],
        },
      )
    } else {
      const sideGlassWidth = TRAIN_FORM.maxBodyWidth * windshield.glassWidthScale
      const glassHeight = frontUsableHeight * windshield.glassHeightScale
      const glassX = maskWidth * 0.29
      parts.push({
        geometry: insetPanel(
          'metro-mask',
          maskWidth,
          maskHeight,
          0.1,
          0.95,
          0.89,
          0.13,
          0.018,
        ),
        color: theme.undercarriage,
        family: 'darkCoatedMetal',
        position: [0, maskY, length / 2 + 0.285],
      })
      for (const x of [-glassX, glassX]) {
        parts.push({
          geometry: this.geometryQuality.prism(
            sideGlassWidth,
            glassHeight,
            0.05,
            'z',
            'vehicleBody',
          ),
          color: theme.secondary,
          family: 'stylizedGlass',
          position: [x, maskY + maskHeight * 0.07, length / 2 + 0.335],
          rotation: [windshield.rake, 0, 0],
        })
      }
      parts.push(
        {
          geometry: this.geometryQuality.prism(
            0.6,
            maskHeight * 0.88,
            0.08,
            'z',
            'vehicleBody',
          ),
          color: theme.primary,
          family: 'paintedMetal',
          position: [0, maskY - 0.04, length / 2 + 0.29],
        },
        {
          geometry: this.geometryQuality.prism(
            0.46,
            maskHeight * 0.8,
            0.045,
            'z',
            'thinMechanical',
          ),
          color: theme.secondary,
          family: 'paintedMetal',
          position: [0, maskY - 0.04, length / 2 + 0.315],
        },
        {
          geometry: this.geometryQuality.prism(
            0.32,
            glassHeight * 0.76,
            0.035,
            'z',
            'thinMechanical',
          ),
          color: theme.glass,
          family: 'stylizedGlass',
          position: [0, maskY + maskHeight * 0.09, length / 2 + 0.34],
        },
        {
          geometry: this.geometryQuality.prism(
            TRAIN_FORM.maxBodyWidth * 0.88,
            0.3,
            0.12,
            'z',
            'vehicleBody',
          ),
          color: theme.primary,
          family: 'paintedMetal',
          position: [0, form.roofDeckBottomY - 0.17, length / 2 + 0.245],
        },
      )
    }

    this.appendTrainHeadlights(parts, family, length, form, theme)
    this.appendTrainLowerFront(parts, length, theme, accentColor)
  }

  private appendTrainRearModule(
    parts: ColoredGeometryPart[],
    length: number,
    form: ReturnType<typeof getTrainFormDimensions>,
    theme: TrainPalette,
    family: TrainFrontFamily,
  ) {
    const frontUsableHeight = form.roofDeckBottomY - TRAIN_FORM.bodyBottom
    const rearWindowY = TRAIN_FORM.bodyBottom + frontUsableHeight * 0.67
    const shellColor = family === 'rounded-commuter' ? theme.secondary : theme.primary
    parts.push(
      {
        geometry: this.geometryQuality.prism(
          TRAIN_FORM.maxBodyWidth,
          frontUsableHeight,
          0.12,
          'z',
          'vehicleBody',
        ),
        color: shellColor,
        family: 'paintedMetal',
        position: [0, TRAIN_FORM.bodyBottom + frontUsableHeight / 2, -length / 2 + 0.06],
      },
      {
        geometry: this.geometryQuality.prism(
          TRAIN_FORM.maxBodyWidth * 0.82,
          frontUsableHeight * 0.38,
          0.08,
          'z',
          'vehicleBody',
        ),
        color: theme.undercarriage,
        family: 'darkCoatedMetal',
        position: [0, rearWindowY, -length / 2 - 0.025],
      },
      {
        geometry: this.geometryQuality.prism(
          TRAIN_FORM.maxBodyWidth * 0.7,
          frontUsableHeight * 0.29,
          0.035,
          'z',
          'vehicleBody',
        ),
        color: theme.frontWindow,
        family: 'stylizedGlass',
        position: [0, rearWindowY, -length / 2 - 0.052],
      },
      {
        geometry: this.geometryQuality.prism(
          TRAIN_FORM.maxBodyWidth * 0.9,
          TRAIN_FRONT_SYSTEM.lowerBody.skirtHeight,
          0.07,
          'z',
          'vehicleBody',
        ),
        color: theme.undercarriage,
        family: 'darkCoatedMetal',
        position: [
          0,
          TRAIN_FRONT_SYSTEM.runningGear.railHeadTop + 0.035 +
            TRAIN_FRONT_SYSTEM.lowerBody.skirtHeight / 2,
          -length / 2 - 0.03,
        ],
      },
    )
    for (const x of [-TRAIN_FORM.maxBodyWidth * 0.34, TRAIN_FORM.maxBodyWidth * 0.34]) {
      parts.push(
        {
          geometry: this.cloneTrainComponent(
            'stage-14r-rear-marker-housing-0.11x0.035x8',
            () => new THREE.CylinderGeometry(0.11, 0.11, 0.035, 8),
          ),
          color: theme.undercarriage,
          family: 'rubber',
          position: [x, form.lowerBandTopY + 0.05, -length / 2 - 0.038],
          rotation: [Math.PI / 2, 0, 0],
        },
        {
          geometry: this.cloneTrainComponent(
            'stage-14r-rear-marker-lens-0.07x0.02x8',
            () => new THREE.CylinderGeometry(0.07, 0.07, 0.02, 8),
          ),
          color: WORLD_PALETTE.gameplay.warningLight,
          family: 'emissiveAccent',
          position: [x, form.lowerBandTopY + 0.05, -length / 2 - 0.06],
          rotation: [Math.PI / 2, 0, 0],
        },
      )
    }
  }

  private createTrainModuleGeometry(
    themeIndex: number,
    role: TrainModuleRole,
    roofRoute: boolean,
  ) {
    const normalizedTheme = ((themeIndex % TRAIN_PALETTES.length) + TRAIN_PALETTES.length) %
      TRAIN_PALETTES.length
    const theme = TRAIN_PALETTES[normalizedTheme]
    const frontFamily = getTrainFrontFamily(normalizedTheme)
    const length = TRAIN_LENGTH_SYSTEM.wagonLength
    const roofHeight = roofRoute ? TRAIN_ROOF_HEIGHT : OBSTACLE_TRAIN_ROOF_HEIGHT
    const form = getTrainFormDimensions(roofHeight)
    const legacyBodyHeight = form.roofDeckBottomY - TRAIN_FORM.bodyBottom
    const visibleSideBandBottom = TRAIN_FRONT_SYSTEM.runningGear.railHeadTop + 0.16
    const visibleSideBandHeight = form.lowerBandTopY - visibleSideBandBottom
    const sideWindowDepth = 0.035
    const sideDoorDepth = TRAIN_FORM.sideDetailMaxDepth
    const sideGlassDepth = 0.025
    const sideSurfaceX = (side: number, depth: number) => side * (
      TRAIN_FORM.maxBodyWidth / 2 + depth / 2 + TRAIN_FORM.sideDetailGap
    )
    const parts: ColoredGeometryPart[] = [
      {
        geometry: this.geometryQuality.box(
          TRAIN_FORM.maxBodyWidth,
          form.mainBodyHeight,
          length,
          'vehicleBody',
        ),
        color: theme.primary,
        family: 'paintedMetal',
        position: [0, form.mainBodyBottomY + form.mainBodyHeight / 2, 0],
      },
      {
        geometry: this.geometryQuality.prism(
          TRAIN_FORM.lowerBandWidth,
          visibleSideBandHeight,
          length,
          'z',
          'vehicleBody',
        ),
        color: theme.secondary,
        family: 'paintedMetal',
        position: [0, visibleSideBandBottom + visibleSideBandHeight / 2, 0],
      },
      {
        geometry: createTaperedPrismGeometry(
          TRAIN_FORM.maxBodyWidth,
          TRAIN_FORM.roofDeckWidth,
          form.upperShoulderHeight,
          length,
        ),
        color: theme.primary,
        family: 'paintedMetal',
        position: [0, form.upperShoulderBottomY, 0],
      },
      {
        geometry: this.geometryQuality.prism(
          TRAIN_FORM.roofDeckWidth,
          TRAIN_FORM.roofDeckThickness,
          length,
          'z',
          'vehicleBody',
          { referenceDimension: TRAIN_FORM.roofDeckWidth },
        ),
        color: theme.roof,
        family: 'darkCoatedMetal',
        position: [0, form.roofDeckCenterY, 0],
      },
    ]

    const windowY = TRAIN_FORM.bodyBottom + legacyBodyHeight * 0.64
    const windowCount = 2
    const windowSpacing = (length - 2.1) / windowCount
    for (let i = 0; i < windowCount; i += 1) {
      const z = -length / 2 + 1.1 + windowSpacing * (i + 0.5)
      for (const side of [-1, 1]) {
        parts.push({
          geometry: new THREE.BoxGeometry(
            sideWindowDepth,
            PROPORTIONS.train.windowHeight,
            Math.min(1.72, windowSpacing * 0.68),
          ),
          color: theme.window,
          family: 'stylizedGlass',
          position: [sideSurfaceX(side, sideWindowDepth), windowY, z],
        })
      }
    }

    const doorZs = [0]
    for (const z of doorZs) {
      for (const side of [-1, 1]) {
        parts.push(
          {
            geometry: new THREE.BoxGeometry(
              sideDoorDepth,
              PROPORTIONS.train.doorHeight,
              1.08,
            ),
            color: theme.secondary,
            family: 'paintedMetal',
            position: [
              sideSurfaceX(side, sideDoorDepth),
              TRAIN_FORM.bodyBottom + PROPORTIONS.train.doorHeight / 2,
              z,
            ],
          },
          {
            geometry: new THREE.BoxGeometry(sideGlassDepth, 0.56, 0.62),
            color: theme.glass,
            family: 'stylizedGlass',
            position: [sideSurfaceX(side, sideGlassDepth), 1.55, z],
          },
        )
      }
    }

    for (const z of [-length * 0.27, length * 0.27]) {
      parts.push({
        geometry: new THREE.BoxGeometry(1.54, 0.09, 0.76),
        color: theme.trim,
        family: 'paintedComposite',
        position: [0, roofHeight + 0.045, z],
      })
    }

    this.appendTrainRunningGear(parts, length, theme)
    if (role === 'front') this.appendTrainFrontModule(parts, frontFamily, length, form, theme)
    if (role === 'rear') this.appendTrainRearModule(parts, length, form, theme, frontFamily)
    const geometry = mergeColoredParts(parts)
    geometry.name = `stage-15-${frontFamily}-${role}-wagon-${
      roofRoute ? 'roof' : 'obstacle'
    }`
    return geometry
  }

  /** Development-only matched-view harness; never enabled by production code. */
  private createTrainDiagnostic() {
    const mode = this.trainDiagnosticMode
    if (!mode) return
    if (mode.includes('composition')) {
      const compositionGroup = new THREE.Group()
      compositionGroup.name = 'stage-15-three-lane-mixed-composition'
      const placements: readonly {
        lane: number
        z: number
        theme: number
        preset: TrainLengthPreset
        direction: TrainDirection
      }[] = [
        { lane: 0, z: -30, theme: 1, preset: 'long', direction: -1 },
        { lane: 1, z: -13, theme: 0, preset: 'short', direction: 1 },
        { lane: 2, z: -38, theme: 0, preset: 'standard', direction: 1 },
      ]
      for (const placement of placements) {
        const diagnosticTrain = this.createTrainVisual(
          placement.theme,
          placement.preset,
          false,
          placement.direction,
        )
        diagnosticTrain.group.position.set(LANES[placement.lane], 0, placement.z)
        compositionGroup.add(diagnosticTrain.group)
      }
      this.scene.add(compositionGroup)
      return
    }
    const preset: TrainLengthPreset = mode.includes('long')
      ? 'long'
      : mode.includes('short')
        ? 'short'
        : 'standard'
    const roofRoute = mode.includes('roof') || mode.includes('ramp')
    const roofHeight = roofRoute ? TRAIN_ROOF_HEIGHT : OBSTACLE_TRAIN_ROOF_HEIGHT
    const themeIndex = mode.includes('purple') ? 1 : mode.includes('blue') ? 2 : 0
    const direction: TrainDirection = mode.includes('reverse') || mode.includes('rear') ? -1 : 1
    const angle = mode.includes('side')
      ? Math.PI / 2
      : mode.includes('three-quarter')
        ? Math.PI / 7
        : 0
    const diagnosticZ = mode.includes('close')
      ? 0.5
      : preset === 'long'
        ? -25
        : preset === 'standard'
          ? -16
          : -7.5
    const diagnosticX = mode.includes('isolated') && mode.includes('three-quarter')
      ? preset === 'long'
        ? -1.8
        : preset === 'standard'
          ? -1.1
          : -0.45
      : mode.includes('isolated')
        ? 0
        : mode.includes('close')
          ? -1.45
          : mode.includes('front')
            ? LANES[0]
            : 0
    const group = new THREE.Group()
    group.position.set(
      diagnosticX,
      0,
      diagnosticZ,
    )
    group.rotation.y = angle

    const train = this.createTrainVisual(themeIndex, preset, roofRoute, direction)
    train.group.name = `stage-15-diagnostic-${train.family}-${preset}`
    const trainMeshes = [
      train.frontModule,
      train.middleModules,
      train.rearModule,
      train.connectors,
    ]
    if (!mode.includes('color')) {
      const silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0x050505 })
      trainMeshes.forEach((mesh) => { mesh.material = silhouetteMaterial })
    }
    trainMeshes.forEach((mesh) => {
      mesh.castShadow = false
      mesh.receiveShadow = false
    })
    if (mode.includes('ramp')) {
      train.group.position.z = (ROUTE_UP_BACK + ROUTE_ROOF_BACK) / 2
      group.add(
        this.createRamp((ROUTE_UP_FRONT + ROUTE_UP_BACK) / 2, false),
        this.createRamp((ROUTE_ROOF_BACK + ROUTE_DOWN_BACK) / 2, true),
      )
    }
    group.add(train.group)

    if (mode.includes('bounds')) {
      const form = getTrainFormDimensions(roofHeight)
      const visualBounds = new THREE.Box3().setFromObject(train.group)
      group.add(new THREE.Box3Helper(visualBounds, 0x35ff78))
      const collider = new THREE.Mesh(
        new THREE.BoxGeometry(2.16, roofHeight, train.composition.totalLength),
        new THREE.MeshBasicMaterial({ color: 0xff4f45, wireframe: true }),
      )
      collider.position.y = roofHeight / 2
      const traversal = new THREE.Mesh(
        new THREE.BoxGeometry(
          PROPORTIONS.gameplay.rampWidth,
          0.05,
          train.composition.totalLength,
        ),
        new THREE.MeshBasicMaterial({ color: 0x38c8ff, wireframe: true }),
      )
      traversal.position.y = roofHeight + 0.025
      const laneEnvelope = new THREE.Mesh(
        new THREE.BoxGeometry(
          LANES[1] - LANES[0],
          form.totalVisualHeight,
          train.composition.totalLength,
        ),
        new THREE.MeshBasicMaterial({ color: 0xffd83d, wireframe: true }),
      )
      laneEnvelope.position.y = TRAIN_FORM.visualBaseY + form.totalVisualHeight / 2
      group.add(collider, traversal, laneEnvelope)
    }
    this.scene.add(group)
    if (mode.includes('isolated')) this.player.visible = false
  }

  private createRampShellGeometry(descending: boolean) {
    const cacheKey = descending ? 'descending' : 'ascending'
    const cached = this.rampGeometryCache.get(cacheKey)
    if (cached) return cached

    const shell = RAMP_VISUAL_SHELL
    const angle = RAMP_VISUAL_ANGLE_RADIANS * (descending ? -1 : 1)
    const slopeCenterY = shell.roofHeight / 2 - Math.cos(angle) * shell.deckThickness / 2
    const parts: ColoredGeometryPart[] = []
    const addSlopePart = (
      geometry: THREE.BufferGeometry,
      color: number,
      family: MaterialFamilyId,
      localPosition: [number, number, number] = [0, 0, 0],
    ) => {
      const [x, y, z] = localPosition
      parts.push({
        geometry,
        color,
        family,
        position: [
          x,
          slopeCenterY + y * Math.cos(angle) - z * Math.sin(angle),
          y * Math.sin(angle) + z * Math.cos(angle),
        ],
        rotation: [angle, 0, 0],
      })
    }

    // The thick deck's upper plane is mathematically identical to the route collider.
    addSlopePart(
      this.geometryQuality.prism(
        shell.width,
        shell.deckThickness,
        RAMP_VISUAL_SLOPE_LENGTH,
        'z',
        'plasticComposite',
      ),
      WORLD_PALETTE.gameplay.ramp,
      'paintedComposite',
    )
    addSlopePart(
      new THREE.BoxGeometry(shell.centerPanelWidth, 0.026, RAMP_VISUAL_SLOPE_LENGTH - 0.18),
      WORLD_PALETTE.gameplay.rampHighlight,
      'hardPlastic',
      [0, shell.deckThickness / 2 + 0.014, 0],
    )

    const railLength = RAMP_VISUAL_SLOPE_LENGTH - shell.edgeRailEndClearance * 2
    for (const side of [-1, 1]) {
      addSlopePart(
        this.geometryQuality.prism(
          shell.edgeRailWidth,
          shell.edgeRailHeight,
          railLength,
          'z',
          'plasticComposite',
        ),
        WORLD_PALETTE.gameplay.rampLight,
        'paintedComposite',
        [
          side * (shell.width / 2 - shell.edgeRailWidth / 2),
          shell.deckThickness / 2 + shell.edgeRailHeight / 2 - 0.015,
          0,
        ],
      )
    }

    // Broad, flush bands organize entry and roof hand-off without a raised snag.
    const reinforcementOffset = RAMP_VISUAL_SLOPE_LENGTH / 2 - 0.28
    for (const z of [-reinforcementOffset, reinforcementOffset]) {
      addSlopePart(
        new THREE.BoxGeometry(
          shell.width - shell.edgeBandWidth * 2,
          0.032,
          shell.reinforcementDepth,
        ),
        WORLD_PALETTE.gameplay.rampEdge,
        'paintedComposite',
        [0, shell.deckThickness / 2 + 0.017, z],
      )
    }

    const chevronSpacing = 0.83
    for (let index = 0; index < shell.chevronCount; index += 1) {
      addSlopePart(
        createRampChevronGeometry(),
        WORLD_PALETTE.gameplay.rampLight,
        'paintedComposite',
        [
          0,
          shell.deckThickness / 2 + 0.034,
          (index - (shell.chevronCount - 1) / 2) * chevronSpacing,
        ],
      )
    }

    // Two filled side wedges create the silhouette while preserving an open underside.
    for (const side of [-1, 1]) {
      parts.push({
        geometry: createRampSidePanelGeometry(descending),
        color: WORLD_PALETTE.gameplay.rampEdge,
        family: 'paintedComposite',
        position: [
          side * (shell.width / 2 - shell.sidePanelThickness / 2),
          0,
          0,
        ],
      })
    }

    const highEndSign = descending ? 1 : -1
    const groundEndSign = -highEndSign
    const highSupportZ = highEndSign * (shell.length / 2 - shell.supportLongitudinalInset)
    const highSurface = getRampVisualSurfaceHeight(highSupportZ, descending)
    const postHeight = highSurface - shell.deckThickness - shell.supportFootHeight
    const supportX = shell.width / 2 - shell.supportInset
    for (const side of [-1, 1]) {
      const x = side * supportX
      parts.push(
        {
          geometry: this.geometryQuality.prism(
            shell.supportPostWidth,
            postHeight,
            shell.supportPostWidth,
            'y',
            'thinMechanical',
          ),
          color: WORLD_PALETTE.gameplay.rampSupport,
          family: 'darkCoatedMetal',
          position: [x, shell.supportFootHeight + postHeight / 2, highSupportZ],
        },
        {
          geometry: new THREE.BoxGeometry(
            shell.supportFootWidth,
            shell.supportFootHeight,
            shell.supportFootDepth,
          ),
          color: WORLD_PALETTE.gameplay.rampFoot,
          family: 'darkCoatedMetal',
          position: [x, shell.supportFootHeight / 2, highSupportZ],
        },
        {
          geometry: new THREE.BoxGeometry(
            shell.supportFootWidth,
            shell.supportFootHeight,
            shell.supportFootDepth,
          ),
          color: WORLD_PALETTE.gameplay.rampFoot,
          family: 'darkCoatedMetal',
          position: [
            x,
            shell.supportFootHeight / 2,
            groundEndSign * (shell.length / 2 - shell.supportFootDepth / 2),
          ],
        },
      )
    }
    parts.push({
      geometry: new THREE.BoxGeometry(
        shell.width - shell.supportInset * 2,
        0.14,
        shell.supportPostWidth,
      ),
      color: WORLD_PALETTE.gameplay.rampSupport,
      family: 'darkCoatedMetal',
      position: [0, highSurface - shell.deckThickness - 0.08, highSupportZ],
    })

    // A low inset nose visually joins the riding panel to track/roof support planes.
    parts.push({
      geometry: new THREE.BoxGeometry(
        shell.width - shell.edgeBandWidth * 2,
        shell.entryNoseHeight,
        shell.entryNoseLength,
      ),
      color: WORLD_PALETTE.gameplay.rampHighlight,
      family: 'hardPlastic',
      position: [
        0,
        shell.entryNoseHeight / 2,
        groundEndSign * (shell.length / 2 - shell.entryNoseLength / 2),
      ],
    })

    const geometry = mergeColoredParts(parts)
    geometry.name = `stage-22-${cacheKey}-ramp-visual-shell`
    this.rampGeometryCache.set(cacheKey, geometry)
    return geometry
  }

  private createRamp(centerZ: number, descending: boolean) {
    const ramp = new THREE.Group()
    ramp.name = `stage-22-${descending ? 'descending' : 'ascending'}-ramp-root`
    ramp.position.z = centerZ
    const shell = new THREE.Mesh(this.createRampShellGeometry(descending), this.cityMaterial)
    shell.name = 'stage-22-ramp-visual-shell'
    shell.castShadow = true
    shell.receiveShadow = true
    shell.userData.lifecycle = 'owned-by-roof-route-root'
    ramp.add(shell)
    return ramp
  }

  private createRoofRoute(lane: number, theme: number): RoofRoute {
    const group = new THREE.Group()
    const direction: TrainDirection = lane === 0 ? -1 : 1
    const train = this.createTrainVisual(
      theme,
      'long',
      true,
      direction,
    )
    train.group.position.z = (ROUTE_UP_BACK + ROUTE_ROOF_BACK) / 2
    group.add(train.group)
    group.add(
      this.createRamp((ROUTE_UP_FRONT + ROUTE_UP_BACK) / 2, false),
      this.createRamp((ROUTE_ROOF_BACK + ROUTE_DOWN_BACK) / 2, true),
    )

    group.position.x = LANES[lane]
    return { group, train, lane, theme, direction, trainPreset: 'long' }
  }

  private createCoin(): Coin {
    return { mesh: new THREE.Group(), lane: 1, collected: false, baseY: 1.1 }
  }

  private createCoinInstances() {
    const geometry = mergeColoredParts([
      {
        geometry: new THREE.CylinderGeometry(
          PROPORTIONS.coin.radius,
          PROPORTIONS.coin.radius,
          PROPORTIONS.coin.thickness,
          14,
        ),
        color: WORLD_PALETTE.reward.gold,
        family: 'rewardMetal',
        rotation: [Math.PI / 2, 0, 0],
      },
      {
        geometry: new THREE.TorusGeometry(PROPORTIONS.coin.radius, PROPORTIONS.coin.rimRadius, 6, 14),
        color: WORLD_PALETTE.reward.rim,
        family: 'rewardMetal',
      },
      {
        geometry: new THREE.ShapeGeometry(createBoltShape(PROPORTIONS.coin.boltScale)),
        color: WORLD_PALETTE.reward.face,
        family: 'rewardMetal',
        position: [0, 0, PROPORTIONS.coin.thickness / 2 + 0.012],
      },
      {
        geometry: new THREE.ShapeGeometry(createBoltShape(PROPORTIONS.coin.boltScale)),
        color: WORLD_PALETTE.reward.face,
        family: 'rewardMetal',
        position: [0, 0, -(PROPORTIONS.coin.thickness / 2 + 0.012)],
        rotation: [0, Math.PI, 0],
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
      const inActiveRange = coin.mesh.position.z > READABILITY_PLACEMENT.coinVisibleNearZ &&
        coin.mesh.position.z < READABILITY_PLACEMENT.gameplayVisibleFarZ
      this.instanceTransform.scale.setScalar(!coin.collected && coin.mesh.visible && inActiveRange ? 1 : 0)
      this.instanceTransform.updateMatrix()
      instances.setMatrixAt(index, this.instanceTransform.matrix)
    }
    instances.instanceMatrix.needsUpdate = true
  }

  private createEffects() {
    const ringMaterial = flatMaterial(WORLD_PALETTE.effects.landing, 0)
    ringMaterial.depthWrite = false
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.76, 24), ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    this.landingRing = ring
    this.scene.add(ring)

    const sparkleGeometry = new THREE.OctahedronGeometry(0.11, 0)
    for (let burstIndex = 0; burstIndex < 4; burstIndex += 1) {
      const group = new THREE.Group()
      const burstMaterial = new THREE.MeshBasicMaterial({
        color: WORLD_PALETTE.reward.sparkle,
        transparent: true,
        opacity: 0,
      })
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
    const pedestrian = PEDESTRIAN_CORRIDOR
    const platformBodyInnerEdge = pedestrian.platformInnerEdge + pedestrian.trackEdgeBandWidth
    const platformBodyCenter = (platformBodyInnerEdge + pedestrian.platformOuterEdge) / 2
    const platformBodyWidth = pedestrian.platformOuterEdge - platformBodyInnerEdge
    const centralFoundationTop = TRACK_SYSTEM.vertical.foundationTop
    const platformSlabHeight = pedestrian.platformSurfaceTop -
      pedestrian.platformCapThickness - pedestrian.platformSlabBottom
    const platformSlabY = pedestrian.platformSlabBottom + platformSlabHeight / 2
    const gantryBeamBottom = OVERHEAD_GANTRY_HEIGHT - 0.17 / 2
    const foundationParts: ColoredGeometryPart[] = [{
      geometry: new THREE.BoxGeometry(
        pedestrian.platformOuterEdge * 2,
        WORLD_WIDTH.centralFoundationDepth,
        TRACK_LENGTH,
      ),
      color: WORLD_PALETTE.track.foundation,
      family: 'rawConcrete',
      position: [
        0,
        centralFoundationTop - WORLD_WIDTH.centralFoundationDepth / 2,
        0,
      ],
    }]
    const bedParts: ColoredGeometryPart[] = [{
      geometry: this.trackGeometryCache.clone('bed-shell', createTrackBedGeometry),
      color: WORLD_PALETTE.track.ballast,
      family: 'trackBed',
    }]
    const railParts: ColoredGeometryPart[] = []
    const sleeperParts: ColoredGeometryPart[] = []
    const plateTileParts: ColoredGeometryPart[] = []
    const fastenerTileParts: ColoredGeometryPart[] = []
    const ballastTileParts: ColoredGeometryPart[] = []
    const corridorParts: ColoredGeometryPart[] = []
    const segmentStart = -TRACK_LENGTH / 2
    const sleeperPositions = getSleeperPositions(segmentStart, TRACK_LENGTH / 2)
    const detailSleeperOffsets = getTrackDetailSleeperOffsets()

    for (const trackCenter of LANES) {
      for (const railCenter of getRailCenterlines(trackCenter)) {
        railParts.push({
          geometry: this.trackGeometryCache.clone('rail-profile', createRailProfileGeometry),
          color: WORLD_PALETTE.track.rail,
          family: 'bareMetal',
          position: [railCenter, TRACK_SYSTEM.vertical.railFootBottom, 0],
        })
      }
      for (const z of sleeperPositions) {
        sleeperParts.push({
          geometry: this.trackGeometryCache.clone('sleeper', () => (
            this.geometryQuality.topPrism(
              TRACK_SYSTEM.sleeper.length,
              TRACK_SYSTEM.sleeper.height,
              TRACK_SYSTEM.sleeper.depth,
              'x',
              'smallCityProp',
              { referenceDimension: TRACK_SYSTEM.sleeper.depth },
            )
          )),
          color: WORLD_PALETTE.track.sleeper,
          family: 'wood',
          position: [
            trackCenter,
            TRACK_SYSTEM.vertical.sleeperBottom + TRACK_SYSTEM.sleeper.height / 2,
            z,
          ],
        })
      }
    }

    // One local tile is instanced across tracks and segments. It contains three
    // complete rail-to-sleeper connections, so obstacles can suppress a 4.5 m
    // footprint without creating per-plate or per-clip draw calls.
    for (const z of detailSleeperOffsets) {
      for (const railCenter of getRailCenterlines(0)) {
        plateTileParts.push({
          geometry: this.trackGeometryCache.clone('tie-plate-stage-13r', () => (
            this.geometryQuality.topPrism(
              TRACK_SYSTEM.plate.width,
              TRACK_SYSTEM.plate.height,
              TRACK_SYSTEM.plate.depth,
              'x',
              'thinMechanical',
              { referenceDimension: TRACK_SYSTEM.plate.width },
            )
          )),
          color: WORLD_PALETTE.track.railFoot,
          family: 'darkCoatedMetal',
          position: [
            railCenter,
            TRACK_SYSTEM.vertical.plateBottom + TRACK_SYSTEM.plate.height / 2,
            z,
          ],
        })
        for (const side of [-1, 1]) {
          const clipOffset = TRACK_SYSTEM.rail.footWidth / 2 +
            TRACK_SYSTEM.fastener.railClearance + TRACK_SYSTEM.fastener.width / 2
          fastenerTileParts.push({
            geometry: this.trackGeometryCache.clone(
              'fastener-clip-stage-13r',
              createFastenerClipGeometry,
            ),
            color: WORLD_PALETTE.track.railFoot,
            family: 'darkCoatedMetal',
            position: [
              railCenter + side * clipOffset,
              TRACK_SYSTEM.vertical.plateTop,
              z,
            ],
            rotation: [0, side > 0 ? Math.PI : 0, 0],
          })
        }
      }
    }

    // Thirty-six coarse tetrahedra form one reusable ballast tile. The stones
    // use deterministic, bounded transforms and existing Stage 6 palette roles.
    const ballastColors = [
      WORLD_PALETTE.track.ballast,
      WORLD_PALETTE.track.ballast,
      WORLD_PALETTE.track.laneOuter,
      WORLD_PALETTE.track.laneCenter,
    ] as const
    const ballast = TRACK_SYSTEM.ballast
    const usableHalfWidth = ballast.trackHalfWidth - ballast.stoneRadiusMax
    for (let row = 0; row < ballast.rows; row += 1) {
      const zBase = -ballast.tileLength / 2 + ballast.tileLength * (row + 0.5) / ballast.rows
      for (let column = 0; column < ballast.columns; column += 1) {
        const stoneIndex = row * ballast.columns + column
        const hash = Math.abs(Math.sin((stoneIndex + 1) * 91.731 + row * 17.17))
        const radius = THREE.MathUtils.lerp(
          ballast.stoneRadiusMin,
          ballast.stoneRadiusMax,
          hash,
        )
        const halfHeight = THREE.MathUtils.lerp(
          ballast.stoneHalfHeightMin,
          ballast.stoneHalfHeightMax,
          Math.abs(Math.sin((stoneIndex + 4) * 43.117)),
        )
        const columnRatio = column / (ballast.columns - 1)
        const xJitter = (Math.sin((stoneIndex + 3) * 12.9898) * 0.055)
        const zJitter = (Math.cos((stoneIndex + 7) * 7.233) * 0.09)
        ballastTileParts.push({
          geometry: this.trackGeometryCache.clone(
            'ballast-stone-stage-13r',
            () => new THREE.TetrahedronGeometry(1, 0),
          ),
          color: ballastColors[Math.min(3, Math.floor(hash * ballastColors.length))],
          family: 'trackBed',
          position: [
            THREE.MathUtils.lerp(-usableHalfWidth, usableHalfWidth, columnRatio) + xJitter,
            TRACK_SYSTEM.vertical.ballastBottom + halfHeight,
            zBase + zJitter,
          ],
          rotation: [hash * 0.24, hash * Math.PI, (1 - hash) * 0.2],
          scale: [
            radius * (0.88 + (stoneIndex % 3) * 0.08),
            halfHeight,
            radius * (0.76 + ((stoneIndex + 1) % 4) * 0.07),
          ],
        })
      }
    }

    for (const side of [-1, 1]) {
      // Stage 16 owns non-overlapping lateral bands. Each band meets its neighbor
      // at one boundary, so distinct face colors cannot create coplanar flicker.
      const sidewalkInnerEdge = pedestrian.platformOuterEdge
      const sidewalkOuterEdge = pedestrian.sidewalkOuterEdge - pedestrian.curbWidth
      const sidewalkWidth = sidewalkOuterEdge - sidewalkInnerEdge
      const sidewalkSlabHeight = pedestrian.sidewalkSurfaceTop - pedestrian.sidewalkSlabBottom
      const serviceWidth = WORLD_WIDTH.serviceOuterEdge - pedestrian.sidewalkOuterEdge
      const buildingZoneWidth = WORLD_WIDTH.buildingZoneOuterEdge - WORLD_WIDTH.serviceOuterEdge
      const outerServiceWidth = WORLD_WIDTH.outerServiceEdge - WORLD_WIDTH.buildingZoneOuterEdge
      const cityEnvelopeWidth = WORLD_WIDTH.cityGroundOuterEdge - WORLD_WIDTH.outerServiceEdge
      const sideFoundationWidth = WORLD_WIDTH.cityGroundOuterEdge - pedestrian.platformOuterEdge
      const sideFoundationCenter = (pedestrian.platformOuterEdge + WORLD_WIDTH.cityGroundOuterEdge) / 2
      corridorParts.push(
        {
          geometry: new THREE.BoxGeometry(
            sideFoundationWidth,
            WORLD_WIDTH.foundationDepth,
            TRACK_LENGTH,
          ),
          color: side < 0
            ? WORLD_PALETTE.track.sideFoundationLeft
            : WORLD_PALETTE.track.sideFoundationRight,
          family: 'rawConcrete',
          position: [
            side * sideFoundationCenter,
            WORLD_WIDTH.citySurfaceTop - WORLD_WIDTH.foundationDepth / 2,
            0,
          ],
        },
        {
          geometry: this.geometryQuality.openTopPrism(
            platformBodyWidth,
            platformSlabHeight,
            TRACK_LENGTH,
            'z',
            'concretePlatform',
          ),
          color: WORLD_PALETTE.track.platformSlab,
          family: 'rawConcrete',
          position: [side * platformBodyCenter, platformSlabY, 0],
        },
        {
          geometry: this.geometryQuality.openTopPrism(
            platformBodyWidth,
            pedestrian.platformCapThickness,
            TRACK_LENGTH,
            'z',
            'concretePlatform',
          ),
          color: WORLD_PALETTE.track.platformTop,
          family: 'paintedPlaster',
          position: [
            side * platformBodyCenter,
            pedestrian.platformSurfaceTop - pedestrian.platformCapThickness / 2,
            0,
          ],
        },
        {
          geometry: this.geometryQuality.openTopPrism(
            pedestrian.safetyStripWidth,
            0.045,
            TRACK_LENGTH,
            'z',
            'thinMechanical',
          ),
          color: WORLD_PALETTE.track.platformMarker,
          family: 'paintedComposite',
          position: [
            side * (platformBodyInnerEdge + pedestrian.safetyStripWidth / 2 + 0.08),
            pedestrian.platformSurfaceTop + 0.0225,
            0,
          ],
        },
        {
          geometry: this.geometryQuality.openTopPrism(
            pedestrian.trackEdgeBandWidth,
            pedestrian.platformSurfaceTop - pedestrian.platformSlabBottom,
            TRACK_LENGTH,
            'z',
            'concretePlatform',
            { referenceDimension: pedestrian.trackEdgeBandWidth },
          ),
          color: WORLD_PALETTE.track.platformEdge,
          family: 'architecturalPanel',
          position: [
            side * (pedestrian.platformInnerEdge + pedestrian.trackEdgeBandWidth / 2),
            (pedestrian.platformSurfaceTop + pedestrian.platformSlabBottom) / 2,
            0,
          ],
        },
        {
          geometry: this.geometryQuality.openTopPrism(
            sidewalkWidth,
            sidewalkSlabHeight,
            TRACK_LENGTH,
            'z',
            'concretePlatform',
          ),
          color: side < 0 ? WORLD_PALETTE.track.sidewalkLeft : WORLD_PALETTE.track.sidewalkRight,
          family: 'rawConcrete',
          position: [
            side * ((sidewalkInnerEdge + sidewalkOuterEdge) / 2),
            pedestrian.sidewalkSlabBottom + sidewalkSlabHeight / 2,
            0,
          ],
        },
        {
          geometry: this.geometryQuality.openTopPrism(
            pedestrian.cityTransitionFaceThickness,
            pedestrian.platformSurfaceTop - pedestrian.sidewalkSurfaceTop,
            TRACK_LENGTH,
            'z',
            'concretePlatform',
            { referenceDimension: pedestrian.cityTransitionFaceThickness },
          ),
          color: WORLD_PALETTE.track.platformSlab,
          family: 'architecturalPanel',
          position: [
            side * (pedestrian.platformOuterEdge + pedestrian.cityTransitionFaceThickness / 2),
            (pedestrian.platformSurfaceTop + pedestrian.sidewalkSurfaceTop) / 2,
            0,
          ],
        },
        {
          geometry: this.geometryQuality.openTopPrism(
            pedestrian.curbWidth,
            pedestrian.curbFaceTop - pedestrian.sidewalkSlabBottom,
            TRACK_LENGTH,
            'z',
            'concretePlatform',
            { referenceDimension: pedestrian.curbWidth },
          ),
          color: WORLD_PALETTE.track.platformSlab,
          family: 'rawConcrete',
          position: [
            side * (pedestrian.sidewalkOuterEdge - pedestrian.curbWidth / 2),
            pedestrian.sidewalkSlabBottom +
              (pedestrian.curbFaceTop - pedestrian.sidewalkSlabBottom) / 2,
            0,
          ],
        },
        {
          geometry: this.geometryQuality.openTopPrism(
            pedestrian.curbWidth + 0.02,
            pedestrian.curbTop - pedestrian.curbFaceTop,
            TRACK_LENGTH,
            'z',
            'concretePlatform',
            { referenceDimension: pedestrian.curbWidth },
          ),
          color: WORLD_PALETTE.track.platformTop,
          family: 'paintedPlaster',
          position: [
            side * (pedestrian.sidewalkOuterEdge - pedestrian.curbWidth / 2),
            (pedestrian.curbTop + pedestrian.curbFaceTop) / 2,
            0,
          ],
        },
        {
          geometry: new THREE.BoxGeometry(serviceWidth, 0.16, TRACK_LENGTH),
          color: side < 0 ? WORLD_PALETTE.track.serviceLeft : WORLD_PALETTE.track.serviceRight,
          family: 'asphalt',
          position: [
            side * ((pedestrian.sidewalkOuterEdge + WORLD_WIDTH.serviceOuterEdge) / 2),
            WORLD_WIDTH.citySurfaceTop - 0.08,
            0,
          ],
        },
        {
          geometry: new THREE.BoxGeometry(buildingZoneWidth, 0.18, TRACK_LENGTH),
          color: side < 0
            ? WORLD_PALETTE.track.buildingGroundLeft
            : WORLD_PALETTE.track.buildingGroundRight,
          family: 'asphalt',
          position: [
            side * ((WORLD_WIDTH.serviceOuterEdge + WORLD_WIDTH.buildingZoneOuterEdge) / 2),
            WORLD_WIDTH.citySurfaceTop - 0.05,
            0,
          ],
        },
        {
          geometry: new THREE.BoxGeometry(outerServiceWidth, 0.2, TRACK_LENGTH),
          color: side < 0 ? WORLD_PALETTE.track.outerGroundLeft : WORLD_PALETTE.track.outerGroundRight,
          family: 'asphalt',
          position: [
            side * ((WORLD_WIDTH.buildingZoneOuterEdge + WORLD_WIDTH.outerServiceEdge) / 2),
            WORLD_WIDTH.citySurfaceTop - 0.06,
            0,
          ],
        },
        {
          geometry: new THREE.BoxGeometry(cityEnvelopeWidth, 0.22, TRACK_LENGTH),
          color: side < 0 ? WORLD_PALETTE.track.cityGroundLeft : WORLD_PALETTE.track.cityGroundRight,
          family: 'asphalt',
          position: [
            side * ((WORLD_WIDTH.outerServiceEdge + WORLD_WIDTH.cityGroundOuterEdge) / 2),
            WORLD_WIDTH.citySurfaceTop - 0.07,
            0,
          ],
        },
        {
          geometry: new THREE.BoxGeometry(
            WORLD_WIDTH.cityGroundOuterEdge - WORLD_WIDTH.serviceOuterEdge,
            0.04,
            2.6,
          ),
          color: side < 0 ? WORLD_PALETTE.track.crossingLeft : WORLD_PALETTE.track.crossingRight,
          family: 'asphalt',
          position: [
            side * ((WORLD_WIDTH.serviceOuterEdge + WORLD_WIDTH.cityGroundOuterEdge) / 2),
            WORLD_WIDTH.citySurfaceTop + 0.04,
            5.8,
          ],
        },
        {
          geometry: new THREE.BoxGeometry(
            WORLD_WIDTH.outerWallThickness,
            WORLD_WIDTH.foundationDepth + 0.7,
            TRACK_LENGTH,
          ),
          color: side < 0 ? WORLD_PALETTE.track.outerWallLeft : WORLD_PALETTE.track.outerWallRight,
          family: 'rawConcrete',
          position: [
            side * (WORLD_WIDTH.cityGroundOuterEdge - WORLD_WIDTH.outerWallThickness / 2),
            WORLD_WIDTH.citySurfaceTop - (WORLD_WIDTH.foundationDepth + 0.7) / 2,
            0,
          ],
        },
      )
      // Interior-only seams repeat on the exact segment divisor. Keeping them off
      // segment ends prevents duplicates while preserving one world-space phase.
      for (
        let z = -TRACK_LENGTH / 2 + pedestrian.slabSeamSpacing / 2;
        z < TRACK_LENGTH / 2;
        z += pedestrian.slabSeamSpacing
      ) {
        corridorParts.push({
          geometry: new THREE.BoxGeometry(
            platformBodyWidth - pedestrian.safetyStripWidth - 0.35,
            0.012,
            pedestrian.slabSeamWidth,
          ),
          color: WORLD_PALETTE.track.platformMarker,
          family: 'rawConcrete',
          position: [
            side * (platformBodyInnerEdge + pedestrian.safetyStripWidth + 0.16 +
              (platformBodyWidth - pedestrian.safetyStripWidth - 0.35) / 2),
            pedestrian.platformSurfaceTop + 0.006,
            z,
          ],
        }, {
          geometry: new THREE.BoxGeometry(
            sidewalkWidth - 0.18,
            0.012,
            pedestrian.slabSeamWidth,
          ),
          color: WORLD_PALETTE.track.platformMarker,
          family: 'rawConcrete',
          position: [
            side * (sidewalkInnerEdge + 0.09 + (sidewalkWidth - 0.18) / 2),
            pedestrian.sidewalkSurfaceTop + 0.006,
            z,
          ],
        })
      }
    }
    for (const x of [LANES[0], LANES[2]]) {
      corridorParts.push({
        geometry: new THREE.BoxGeometry(
          PROPORTIONS.overhead.wireThickness,
          PROPORTIONS.overhead.wireThickness,
          TRACK_LENGTH,
        ),
        color: WORLD_PALETTE.infrastructure.cable,
        family: 'darkCoatedMetal',
        position: [x, OVERHEAD_WIRE_HEIGHT, 0],
      })
    }

    const gantryPostLateralOffset = pedestrian.platformInnerEdge + PROPORTIONS.overhead.postRadiusBottom
    const gantryBeamWidth = (gantryPostLateralOffset + 0.12) * 2
    const overheadParts: ColoredGeometryPart[] = []
    for (const side of [-1, 1]) {
      overheadParts.push({
        geometry: new THREE.CylinderGeometry(
          PROPORTIONS.overhead.postRadiusTop,
          PROPORTIONS.overhead.postRadiusBottom,
          PROPORTIONS.overhead.postHeight,
          8,
        ),
        color: WORLD_PALETTE.infrastructure.primary,
        family: 'paintedMetal',
        position: [side * gantryPostLateralOffset, PROPORTIONS.overhead.postHeight / 2, 0],
      })
    }
    overheadParts.push({
      geometry: this.geometryQuality.prism(
        gantryBeamWidth,
        PROPORTIONS.overhead.beamHeight,
        PROPORTIONS.overhead.beamDepth,
        'x',
        'thinMechanical',
      ),
      color: WORLD_PALETTE.infrastructure.primary,
      family: 'paintedMetal',
      position: [0, gantryBeamBottom + PROPORTIONS.overhead.beamHeight / 2, 0],
    })
    for (const x of [LANES[0], LANES[2]]) {
      overheadParts.push({
        geometry: new THREE.BoxGeometry(
          PROPORTIONS.overhead.dropperThickness,
          0.62,
          PROPORTIONS.overhead.dropperThickness,
        ),
        color: WORLD_PALETTE.infrastructure.primary,
        family: 'darkCoatedMetal',
        position: [x, OVERHEAD_GANTRY_HEIGHT - 0.4, 0],
      })
    }

    const diagnosticParts = this.trackDiagnosticMode === 'rails'
      ? railParts
      : this.trackDiagnosticMode === 'sleepers'
        ? sleeperParts
        : this.trackDiagnosticMode === 'bed' || this.trackDiagnosticMode === 'ballast'
          ? bedParts
          : [...bedParts, ...sleeperParts, ...railParts]
    const assembledTrackParts = this.trackDiagnosticMode
      ? diagnosticParts
      : [...foundationParts, ...bedParts, ...sleeperParts, ...railParts, ...corridorParts]
    const tracks = new THREE.InstancedMesh(
      mergeColoredParts(assembledTrackParts),
      this.cityMaterial,
      TRACK_SEGMENTS,
    )
    tracks.name = this.trackDiagnosticMode
      ? `stage-13r-track-isolation-${this.trackDiagnosticMode}`
      : 'stage-13r-track-bed-rails-sleepers-platform-system'
    tracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    tracks.receiveShadow = true
    tracks.frustumCulled = false
    this.trackInstances = tracks
    const detailTileCount = this.trackDetailTileCenters.length
    const detailCapacity = TRACK_SEGMENTS * detailTileCount * LANES.length
    const includePlateBatch = !this.trackDiagnosticMode ||
      ['full', 'plates', 'fasteners'].includes(this.trackDiagnosticMode)
    const includeFastenerBatch = !this.trackDiagnosticMode ||
      ['full', 'clips', 'fasteners'].includes(this.trackDiagnosticMode)
    const includeBallastBatch = !this.trackDiagnosticMode ||
      ['full', 'ballast'].includes(this.trackDiagnosticMode)
    const connections = includePlateBatch
      ? new THREE.InstancedMesh(
        mergeColoredParts(plateTileParts),
        this.cityMaterial,
        detailCapacity,
      )
      : undefined
    if (connections) {
      connections.name = 'stage-13r-track-tie-plate-tiles'
      connections.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      connections.castShadow = false
      connections.receiveShadow = true
      connections.frustumCulled = false
      this.trackConnectionInstances = connections
    }
    const fasteners = includeFastenerBatch
      ? new THREE.InstancedMesh(
        mergeColoredParts(fastenerTileParts),
        this.cityMaterial,
        detailCapacity,
      )
      : undefined
    if (fasteners) {
      fasteners.name = 'stage-13r-track-fastener-clip-tiles'
      fasteners.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      fasteners.castShadow = false
      fasteners.receiveShadow = true
      fasteners.frustumCulled = false
      this.trackFastenerInstances = fasteners
    }
    const ballastClusters = includeBallastBatch
      ? new THREE.InstancedMesh(
        mergeColoredParts(ballastTileParts),
        this.cityMaterial,
        detailCapacity,
      )
      : undefined
    if (ballastClusters) {
      ballastClusters.name = 'stage-13r-track-macro-ballast-tiles'
      ballastClusters.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      ballastClusters.castShadow = false
      ballastClusters.receiveShadow = true
      ballastClusters.frustumCulled = false
      this.trackBallastInstances = ballastClusters
    }
    const overheadGeometry = mergeColoredParts(overheadParts)
    // The portal is unusually large relative to its origin. Keep complete local
    // bounds for diagnostics even though both root and visual opt out of culling.
    overheadGeometry.computeBoundingBox()
    overheadGeometry.computeBoundingSphere()
    for (let index = 0; index < OVERHEAD_GANTRY_COUNT; index += 1) {
      const root = new THREE.Group()
      root.name = `stage-12-overhead-gantry-root-${index}`
      root.frustumCulled = false

      const visual = new THREE.Mesh(overheadGeometry, this.cityMaterial)
      visual.name = `stage-12-overhead-gantry-visual-${index}`
      visual.castShadow = false
      visual.receiveShadow = true
      visual.frustumCulled = false
      root.add(visual)
      this.overheadGantries.push(root)
    }
    let overheadIndex = 0
    for (let index = 0; index < TRACK_SEGMENTS; index += 1) {
      this.trackZs[index] = -index * TRACK_LENGTH + 9
      if (index % 3 === READABILITY_PLACEMENT.overheadTrackPhase) {
        this.overheadZs[overheadIndex] = this.trackZs[index] + OVERHEAD_GANTRY_TRACK_OFFSET
        overheadIndex += 1
      }
    }
    this.syncTrackInstances()
    this.scene.add(tracks, ...this.overheadGantries)
    if (connections) this.scene.add(connections)
    if (fasteners) this.scene.add(fasteners)
    if (ballastClusters) this.scene.add(ballastClusters)
  }

  private trackDetailTileOverlapsRamp(
    laneIndex: number,
    worldCenterZ: number,
  ) {
    const tileHalfLength = TRACK_SYSTEM.ballast.tileLength / 2
    for (const route of this.roofRoutes) {
      if (route.lane !== laneIndex) continue
      for (const rampCenter of ROUTE_RAMP_CENTERS) {
        if (trackDetailOverlapsFootprint(
          worldCenterZ,
          tileHalfLength,
          route.group.position.z + rampCenter,
          RAMP_LENGTH / 2,
          TRACK_SYSTEM.exclusionRules.rampPadding,
        )) return true
      }
    }
    return false
  }

  private trackDetailTileOverlapsHazard(laneIndex: number, worldCenterZ: number) {
    const tileHalfLength = TRACK_SYSTEM.ballast.tileLength / 2
    for (const hazard of this.hazards) {
      if (hazard.lane !== laneIndex) continue
      const bounds = hazard.visual.geometry.boundingBox
      const hazardHalfLength = hazard.kind === 'block'
        ? hazard.train.composition.totalLength / 2 + TRAIN_LENGTH_SYSTEM.headTailSafetyMargin
        : bounds
          ? Math.max(0.3, (bounds.max.z - bounds.min.z) / 2)
          : 0.65
      if (trackDetailOverlapsFootprint(
        worldCenterZ,
        tileHalfLength,
        hazard.group.position.z,
        hazardHalfLength,
        TRACK_SYSTEM.exclusionRules.hazardPadding,
      )) return true
    }
    return false
  }

  private syncTrackInstances() {
    if (!this.trackInstances) return
    let plateIndex = 0
    let fastenerIndex = 0
    let ballastIndex = 0
    for (let index = 0; index < TRACK_SEGMENTS; index += 1) {
      this.instanceTransform.position.set(0, 0, this.trackZs[index])
      this.instanceTransform.rotation.set(0, 0, 0)
      this.instanceTransform.scale.set(1, 1, 1)
      this.instanceTransform.updateMatrix()
      this.trackInstances.setMatrixAt(index, this.instanceTransform.matrix)
      for (const tileCenter of this.trackDetailTileCenters) {
        const worldTileCenter = this.trackZs[index] + tileCenter
        const plateVisible = Boolean(this.trackConnectionInstances) &&
          trackDetailIsVisible(worldTileCenter, 'plate')
        const fastenerVisible = Boolean(this.trackFastenerInstances) &&
          trackDetailIsVisible(worldTileCenter, 'fastener')
        const ballastVisible = Boolean(this.trackBallastInstances) &&
          trackDetailIsVisible(worldTileCenter, 'ballast')
        if (!plateVisible && !fastenerVisible && !ballastVisible) continue
        for (let laneIndex = 0; laneIndex < LANES.length; laneIndex += 1) {
          const rampConflict = this.trackDetailTileOverlapsRamp(laneIndex, worldTileCenter)
          const hazardConflict = fastenerVisible &&
            this.trackDetailTileOverlapsHazard(laneIndex, worldTileCenter)
          const renderPlate = plateVisible && !rampConflict
          const renderFastener = fastenerVisible && !rampConflict && !hazardConflict
          const renderBallast = ballastVisible && !rampConflict
          if (!renderPlate && !renderFastener && !renderBallast) continue
          this.instanceTransform.position.set(LANES[laneIndex], 0, worldTileCenter)
          this.instanceTransform.rotation.set(0, 0, 0)
          this.instanceTransform.scale.set(1, 1, 1)
          this.instanceTransform.updateMatrix()
          if (
            this.trackConnectionInstances &&
            renderPlate
          ) {
            this.trackConnectionInstances.setMatrixAt(plateIndex, this.instanceTransform.matrix)
            plateIndex += 1
          }
          if (
            this.trackFastenerInstances &&
            renderFastener
          ) {
            this.trackFastenerInstances.setMatrixAt(fastenerIndex, this.instanceTransform.matrix)
            fastenerIndex += 1
          }
          if (
            this.trackBallastInstances &&
            renderBallast
          ) {
            this.trackBallastInstances.setMatrixAt(ballastIndex, this.instanceTransform.matrix)
            ballastIndex += 1
          }
        }
      }
    }
    for (let overheadIndex = 0; overheadIndex < this.overheadZs.length; overheadIndex += 1) {
      const overhead = this.overheadGantries[overheadIndex]
      overhead.position.set(0, 0, this.overheadZs[overheadIndex])
      overhead.rotation.set(0, 0, 0)
      overhead.scale.setScalar(1)
      overhead.visible = true
    }
    this.trackInstances.instanceMatrix.needsUpdate = true
    if (this.trackConnectionInstances) {
      this.trackConnectionInstances.count = plateIndex
      this.trackConnectionInstances.instanceMatrix.needsUpdate = true
    }
    if (this.trackFastenerInstances) {
      this.trackFastenerInstances.count = fastenerIndex
      this.trackFastenerInstances.instanceMatrix.needsUpdate = true
    }
    if (this.trackBallastInstances) {
      this.trackBallastInstances.count = ballastIndex
      this.trackBallastInstances.instanceMatrix.needsUpdate = true
    }
  }

  private createScenery(index: number) {
    const group = new THREE.Group()
    // Props keep their Stage 7 cadence. Only the city mass changes sides here,
    // using a balanced-but-asymmetric deterministic sequence from Stage 9.
    const side = index % 2 === 0 ? -1 : 1
    const buildingSide = this.cityDepthLayout.segments[index].nearSide
    const buildingX = buildingSide * (10.5 + (index % 3) * 1.5)
    const buildingFamily = getBuildingFamilyPreset(getBuildingFamilyId(
      'near',
      this.cityDepthLayout.seed,
      index,
      0,
      buildingSide,
    ))
    const parts: ColoredGeometryPart[] = []
    const facadeParts: ColoredGeometryPart[] = []
    const treeParts: ColoredGeometryPart[] = []
    const farTreeParts: ColoredGeometryPart[] = []
    const lowVegetationParts: ColoredGeometryPart[] = []
    const midVegetationParts: ColoredGeometryPart[] = []
    appendBuildingModelParts(
      parts,
      this.geometryQuality,
      'near',
      buildingFamily,
      index,
      buildingSide,
      buildingX,
      0,
      true,
      true,
      undefined,
      facadeParts,
    )

    const fenceColor = WORLD_PALETTE.infrastructure.railing
    const railingBase = PEDESTRIAN_CORRIDOR.sidewalkSurfaceTop
    for (const z of [-3.9, 0, 3.9]) {
      parts.push({
        geometry: new THREE.BoxGeometry(
          PROPORTIONS.props.railingPostWidth,
          PROPORTIONS.props.railingHeight,
          PROPORTIONS.props.railingPostWidth,
        ),
        color: fenceColor,
        family: 'paintedMetal',
        position: [side * 8.15, railingBase + PROPORTIONS.props.railingHeight / 2, z],
      })
    }
    for (const heightRatio of [0.36, 0.84]) {
      parts.push({
        geometry: new THREE.BoxGeometry(
          PROPORTIONS.props.railingBarThickness,
          PROPORTIONS.props.railingBarThickness,
          7.8,
        ),
        color: fenceColor,
        family: 'paintedMetal',
        position: [side * 8.15, railingBase + PROPORTIONS.props.railingHeight * heightRatio, 0],
      })
    }

    // Stage 17 keeps the main canopy opposite the near building and suppresses
    // tall planting under bridge spans. The deterministic rhythm prevents both
    // mirrored planting and unrestricted procedural combinations.
    const hasBridge = index % 8 === 5
    const planting = getPlantingLayout(index, buildingSide, hasBridge)
    const hasTree = compositionHasTree(planting.composition)
    const hasLamp = !hasTree
    const hasPlanter = index % 3 !== 0

    if (hasTree && planting.treeFamily && planting.treeSize) {
      const treeGround = PEDESTRIAN_CORRIDOR.sidewalkSurfaceTop
      appendTreeParts(
        treeParts,
        this.vegetationGeometryCache,
        planting.treeFamily,
        planting.treeSize,
        planting.side,
        treeGround,
        planting.treeZ,
      )
      appendTreeParts(
        farTreeParts,
        this.vegetationGeometryCache,
        planting.treeFamily,
        planting.treeSize,
        planting.side,
        treeGround,
        planting.treeZ,
        true,
      )

      const shrubX = planting.side * READABILITY_PLACEMENT.vegetationShrubLateralOffset
      appendShrubParts(
        lowVegetationParts,
        this.vegetationGeometryCache,
        planting.shrubFamily,
        shrubX - planting.side * 0.7,
        treeGround + PROPORTIONS.vegetation.soilPatchHeight,
        planting.treeZ + 0.92,
        planting.composition === 'hero-tree' ? 0.86 : 0.72,
        planting.flowering,
      )
      if (planting.composition === 'hero-tree') {
        appendShrubParts(
          lowVegetationParts,
          this.vegetationGeometryCache,
          index % 2 ? 'compact' : 'layered',
          shrubX + planting.side * 0.62,
          treeGround + PROPORTIONS.vegetation.soilPatchHeight,
          planting.treeZ - 0.88,
          0.72,
        )
      } else {
        appendShrubParts(
          lowVegetationParts,
          this.vegetationGeometryCache,
          index % 2 ? 'compact' : 'layered',
          shrubX + planting.side * 0.56,
          treeGround + PROPORTIONS.vegetation.soilPatchHeight,
          planting.treeZ - 0.76,
          0.58,
        )
      }
      if (planting.flowering) {
        appendFlowerCluster(
          lowVegetationParts,
          this.vegetationGeometryCache,
          shrubX,
          treeGround + PROPORTIONS.vegetation.soilPatchHeight,
          planting.treeZ - 0.9,
          planting.side,
        )
      }
    } else {
      const shrubGround = PEDESTRIAN_CORRIDOR.sidewalkSurfaceTop
      const shrubX = planting.side * (
        READABILITY_PLACEMENT.vegetationShrubLateralOffset + (hasBridge ? 0.5 : 0)
      )
      appendSoilPatch(
        lowVegetationParts,
        this.vegetationGeometryCache,
        shrubX,
        shrubGround,
        2.2,
        planting.composition === 'shrub-group' ? (hasBridge ? 2 : 2.35) : 1.8,
        1.7,
      )
      appendShrubParts(
        lowVegetationParts,
        this.vegetationGeometryCache,
        planting.shrubFamily,
        shrubX,
        shrubGround + PROPORTIONS.vegetation.soilPatchHeight,
        2.2,
        planting.composition === 'background-greenery' ? 0.78 : 0.96,
      )
      if (planting.composition === 'shrub-group') {
        appendShrubParts(
          lowVegetationParts,
          this.vegetationGeometryCache,
          index % 2 ? 'compact' : 'spreading',
          shrubX + planting.side * 0.82,
          shrubGround + PROPORTIONS.vegetation.soilPatchHeight,
          1.55,
          0.68,
          index % 4 === 1,
        )
      }
      // Supporting trees occupy a mid-distance-only band. They reuse the
      // existing family builder and disappear before entering the decision
      // foreground, increasing depth without crowding nearby gameplay.
      if (!hasBridge) {
        appendTreeParts(
          midVegetationParts,
          this.vegetationGeometryCache,
          index % 2 === 0 ? 'ornamental' : 'upright',
          'short',
          planting.side,
          shrubGround,
          -2.45,
        )
        appendShrubParts(
          midVegetationParts,
          this.vegetationGeometryCache,
          index % 2 === 0 ? 'compact' : 'layered',
          shrubX - planting.side * 0.62,
          shrubGround + PROPORTIONS.vegetation.soilPatchHeight,
          -1.58,
          0.62,
        )
        appendShrubParts(
          midVegetationParts,
          this.vegetationGeometryCache,
          index % 2 === 0 ? 'layered' : 'spreading',
          shrubX + planting.side * 0.66,
          shrubGround + PROPORTIONS.vegetation.soilPatchHeight,
          -2.72,
          0.54,
        )
      }
    }

    if (hasPlanter) {
      const planterGround = PEDESTRIAN_CORRIDOR.platformSurfaceTop
      parts.push(
        {
          geometry: this.geometryQuality.box(
            1.2,
            PROPORTIONS.props.planterHeight,
            1.2,
            'concretePlatform',
          ),
          color: index % 2 ? WORLD_PALETTE.props.planterCool : WORLD_PALETTE.props.planterWarm,
          family: 'rawConcrete',
          position: [
            side * READABILITY_PLACEMENT.planterLateralOffset,
            planterGround + PROPORTIONS.props.planterHeight / 2,
            2.7,
          ],
        },
      )
      appendShrubParts(
        lowVegetationParts,
        this.vegetationGeometryCache,
        index % 2 ? 'compact' : 'layered',
        side * READABILITY_PLACEMENT.planterLateralOffset,
        planterGround + PROPORTIONS.props.planterHeight,
        2.7,
        0.72,
        index % 9 === 1,
      )
    }

    if (hasLamp) {
      const lampGround = PEDESTRIAN_CORRIDOR.platformSurfaceTop
      parts.push(
        {
          geometry: new THREE.CylinderGeometry(
            PROPORTIONS.props.lampPostRadiusTop,
            PROPORTIONS.props.lampPostRadiusBottom,
            PROPORTIONS.props.lampHeight,
            7,
          ),
          color: WORLD_PALETTE.props.lamp,
          family: 'paintedMetal',
          position: [
            side * READABILITY_PLACEMENT.lampPostLateralOffset,
            lampGround + PROPORTIONS.props.lampHeight / 2,
            -3.4,
          ],
        },
        {
          geometry: new THREE.BoxGeometry(1.1, 0.12, 0.12),
          color: WORLD_PALETTE.props.lamp,
          family: 'paintedMetal',
          position: [
            side * READABILITY_PLACEMENT.lampArmLateralOffset,
            lampGround + PROPORTIONS.props.lampHeight - 0.06,
            -3.4,
          ],
        },
        {
          geometry: new THREE.SphereGeometry(0.24, 8, 6),
          color: WORLD_PALETTE.props.lampGlobe,
          family: 'emissiveAccent',
          position: [
            side * READABILITY_PLACEMENT.lampGlobeLateralOffset,
            lampGround + PROPORTIONS.props.lampHeight - 0.28,
            -3.4,
          ],
        },
        {
          geometry: new THREE.BoxGeometry(0.08, 1.55, 1.02),
          color: index % 2 ? WORLD_PALETTE.props.bannerIndigo : WORLD_PALETTE.props.bannerTerracotta,
          family: 'fabric',
          position: [
            side * READABILITY_PLACEMENT.lampBannerLateralOffset,
            lampGround + PROPORTIONS.props.lampHeight - 1.32,
            -3.38,
          ],
        },
      )
    }

    const bridgeParts: ColoredGeometryPart[] = []
    if (hasBridge) {
      const bridgeColor = index % 16 === 5
        ? WORLD_PALETTE.infrastructure.bridgeCool
        : WORLD_PALETTE.infrastructure.bridgeWarm
      const bridgeDeckBottom = BRIDGE_DECK_HEIGHT - 0.76 / 2
      const bridgeDeckY = bridgeDeckBottom + PROPORTIONS.bridge.deckThickness / 2
      const bridgeBottom = PEDESTRIAN_CORRIDOR.platformSlabBottom
      const bridgeTop = bridgeDeckBottom + PROPORTIONS.bridge.deckThickness
      const bridgeColumnHeight = bridgeTop - bridgeBottom
      for (const bridgeSide of [-1, 1]) {
        bridgeParts.push({
          geometry: this.geometryQuality.prism(
            PROPORTIONS.bridge.columnWidth,
            bridgeColumnHeight,
            PROPORTIONS.bridge.columnDepth,
            'y',
            'largeArchitectural',
          ),
          color: bridgeColor,
          family: 'rawConcrete',
          position: [bridgeSide * 7.9, bridgeBottom + bridgeColumnHeight / 2, 0],
        })
      }
      bridgeParts.push(
        {
          geometry: this.geometryQuality.prism(
            16.4,
            PROPORTIONS.bridge.deckThickness,
            PROPORTIONS.bridge.deckDepth,
            'x',
            'largeArchitectural',
          ),
          color: bridgeColor,
          family: 'rawConcrete',
          position: [0, bridgeDeckY, 0],
        },
        {
          geometry: new THREE.BoxGeometry(5.5, 0.62, 0.14),
          color: WORLD_PALETTE.infrastructure.signFace,
          family: 'hardPlastic',
          position: [0, bridgeDeckY, PROPORTIONS.bridge.deckDepth / 2 + 0.07],
        },
      )
      for (const x of [-1.5, 0, 1.5]) {
        bridgeParts.push({
          geometry: new THREE.ShapeGeometry(createBoltShape(0.24)),
          color: x === 0
            ? WORLD_PALETTE.infrastructure.secondary
            : WORLD_PALETTE.infrastructure.primary,
          family: 'paintedComposite',
          position: [x, bridgeDeckY, PROPORTIONS.bridge.deckDepth / 2 + 0.15],
        })
      }
    }

    const visual = new THREE.Mesh(mergeColoredParts(parts), this.cityMaterial)
    visual.name = `stage-12-near-scenery-${index}`
    const initialZ = -index * SCENERY_SPACING
    visual.castShadow = initialZ > LIGHTING_SHADOWS.sceneryCasterNearZ &&
      initialZ < LIGHTING_SHADOWS.sceneryCasterFarZ
    visual.receiveShadow = true
    group.add(visual)
    if (facadeParts.length > 0) {
      const facadeVisual = new THREE.Mesh(mergeColoredParts(facadeParts), this.cityMaterial)
      facadeVisual.name = `stage-20-building-facade-${index}`
      facadeVisual.castShadow = false
      facadeVisual.receiveShadow = true
      group.add(facadeVisual)
    }
    if (treeParts.length > 0) {
      const treeVisual = new THREE.Mesh(mergeColoredParts(treeParts), this.cityMaterial)
      treeVisual.name = `stage-17-tree-full-${index}`
      treeVisual.visible = initialZ >= READABILITY_PLACEMENT.vegetationFullDetailNearZ &&
        initialZ < READABILITY_PLACEMENT.vegetationTreeVisibleFarZ
      treeVisual.castShadow = treeVisual.visible &&
        initialZ > LIGHTING_SHADOWS.sceneryCasterNearZ &&
        initialZ < LIGHTING_SHADOWS.sceneryCasterFarZ
      treeVisual.receiveShadow = true
      group.add(treeVisual)

      const farTreeVisual = new THREE.Mesh(mergeColoredParts(farTreeParts), this.cityMaterial)
      farTreeVisual.name = `stage-17-tree-far-${index}`
      farTreeVisual.visible = initialZ < READABILITY_PLACEMENT.vegetationFullDetailNearZ
      farTreeVisual.castShadow = false
      farTreeVisual.receiveShadow = false
      group.add(farTreeVisual)
    }
    if (lowVegetationParts.length > 0) {
      const lowVegetationVisual = new THREE.Mesh(
        mergeColoredParts(lowVegetationParts),
        this.cityMaterial,
      )
      lowVegetationVisual.name = `stage-17-low-vegetation-${index}`
      lowVegetationVisual.visible = initialZ >= READABILITY_PLACEMENT.vegetationLowDetailNearZ &&
        initialZ < READABILITY_PLACEMENT.vegetationForegroundCullZ
      lowVegetationVisual.castShadow = false
      lowVegetationVisual.receiveShadow = true
      group.add(lowVegetationVisual)
    }
    if (midVegetationParts.length > 0) {
      const midVegetationVisual = new THREE.Mesh(
        mergeColoredParts(midVegetationParts),
        this.cityMaterial,
      )
      midVegetationVisual.name = `stage-17-mid-support-${index}`
      midVegetationVisual.visible = initialZ >= READABILITY_PLACEMENT.vegetationMidSupportFarZ &&
        initialZ <= READABILITY_PLACEMENT.vegetationMidSupportNearZ
      midVegetationVisual.castShadow = false
      midVegetationVisual.receiveShadow = true
      group.add(midVegetationVisual)
    }
    if (bridgeParts.length > 0) {
      const bridgeVisual = new THREE.Mesh(mergeColoredParts(bridgeParts), this.cityMaterial)
      bridgeVisual.name = 'stage-12-readability-bridge'
      bridgeVisual.visible = initialZ < READABILITY_PLACEMENT.bridgeForegroundCullZ
      bridgeVisual.castShadow = visual.castShadow
      bridgeVisual.receiveShadow = true
      group.add(bridgeVisual)
    }
    group.position.set(0, 0, initialZ)
    this.scenery.push(group)
    this.scene.add(group)
  }

  private getSurfaceMaterial(color: number, familyId: MaterialFamilyId) {
    const cacheKey = `${familyId}:${color.toString(16)}`
    let surface = this.surfaceMaterialCache.get(cacheKey)
    if (!surface) {
      const family = getMaterialFamily(familyId)
      surface = new THREE.MeshStandardMaterial({
        color,
        roughness: family.roughness,
        metalness: family.metalness,
        envMapIntensity: 0.82 * family.environmentResponse,
      })
      surface.name = `stage-11-${familyId}-${color.toString(16)}`
      this.surfaceMaterialCache.set(cacheKey, surface)
    }
    return surface
  }

  private createSurfaceMesh(
    geometry: THREE.BufferGeometry,
    color: number,
    familyId: MaterialFamilyId,
  ) {
    const item = new THREE.Mesh(geometry, this.getSurfaceMaterial(color, familyId))
    item.castShadow = false
    item.receiveShadow = false
    return item
  }

  private createPlayer() {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(PROPORTIONS.player.shadowRadius, 24),
      new THREE.MeshBasicMaterial({
        color: WORLD_PALETTE.effects.contactShadow,
        transparent: true,
        opacity: LIGHTING_SHADOWS.contactShadowOpacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, 0.035, PLAYER_Z - 0.14)
    shadow.renderOrder = 1
    this.playerShadow = shadow
    this.scene.add(shadow)

    this.player.name = 'player-gameplay-root'
    this.playerVisual.name = 'player-visual-avatar-root'
    const pelvis = new THREE.Group()
    pelvis.name = 'player-pelvis'
    pelvis.position.y = 1.72
    this.playerParts.pelvis = pelvis
    this.playerVisual.add(pelvis)

    const pelvisMass = this.createSurfaceMesh(
      new THREE.CapsuleGeometry(0.42, 0.25, 4, 8),
      WORLD_PALETTE.player.darkNeutral,
      'fabric',
    )
    pelvisMass.name = 'player-pelvis-mass'
    pelvisMass.scale.set(1.12, 0.72, 0.78)
    pelvisMass.position.y = 0.03
    pelvis.add(pelvisMass)
    const waistband = this.createSurfaceMesh(
      new THREE.BoxGeometry(0.94, 0.16, 0.56),
      WORLD_PALETTE.player.coolTrim,
      'fabric',
    )
    waistband.name = 'player-waistband'
    waistband.position.y = 0.27
    pelvis.add(waistband)

    const torso = new THREE.Group()
    torso.name = 'player-chest-pivot'
    torso.position.y = 0.18
    this.playerParts.torso = torso
    pelvis.add(torso)
    const vest = this.createSurfaceMesh(
      createTaperedPrismGeometry(0.9, 1.34, 1.34, 0.62),
      WORLD_PALETTE.player.primaryWarm,
      'fabric',
    )
    vest.name = 'player-orange-vest'
    vest.position.y = 0.08
    torso.add(vest)
    const lowerShirt = this.createSurfaceMesh(
      createTaperedPrismGeometry(0.92, 1.02, 0.34, 0.56),
      WORLD_PALETTE.player.lightNeutral,
      'fabric',
    )
    lowerShirt.name = 'player-light-shirt-layer'
    lowerShirt.position.y = -0.04
    torso.add(lowerShirt)

    const hood = this.createSurfaceMesh(
      new THREE.TorusGeometry(0.39, 0.115, 7, 14),
      WORLD_PALETTE.player.lightNeutral,
      'fabric',
    )
    hood.name = 'player-hood-collar'
    hood.position.set(0, 1.35, 0.06)
    hood.scale.x = 1.14
    torso.add(hood)
    const hoodBack = this.createSurfaceMesh(
      new THREE.CapsuleGeometry(0.28, 0.25, 4, 8),
      WORLD_PALETTE.player.lightNeutral,
      'fabric',
    )
    hoodBack.name = 'player-hood-back'
    hoodBack.position.set(0, 1.2, 0.28)
    hoodBack.scale.set(1.18, 0.62, 0.56)
    torso.add(hoodBack)

    const backMark = new THREE.Mesh(
      new THREE.ShapeGeometry(createBoltShape(0.36)),
      this.getSurfaceMaterial(WORLD_PALETTE.player.coolTrim, 'hardPlastic'),
    )
    backMark.name = 'player-back-identity-mark'
    backMark.position.set(0, 0.69, 0.326)
    torso.add(backMark)

    const head = new THREE.Group()
    head.name = 'player-head-pivot'
    head.position.y = 1.53
    this.playerParts.head = head
    torso.add(head)
    const neck = this.createSurfaceMesh(
      new THREE.CylinderGeometry(0.18, 0.2, 0.25, 10),
      WORLD_PALETTE.player.skin,
      'skin',
    )
    neck.name = 'player-neck'
    neck.position.y = -0.04
    head.add(neck)
    const face = this.createSurfaceMesh(
      new THREE.SphereGeometry(0.49, 14, 10),
      WORLD_PALETTE.player.skin,
      'skin',
    )
    face.name = 'player-head'
    face.position.y = 0.43
    face.scale.set(0.94, 1.04, 0.92)
    head.add(face)
    const nose = this.createSurfaceMesh(
      new THREE.ConeGeometry(0.09, 0.2, 8),
      WORLD_PALETTE.player.skin,
      'skin',
    )
    nose.name = 'player-nose-cue'
    nose.rotation.x = -Math.PI / 2
    nose.position.set(0, 0.4, -0.48)
    head.add(nose)
    for (const side of [-1, 1] as const) {
      const ear = this.createSurfaceMesh(
        new THREE.SphereGeometry(0.105, 8, 6),
        WORLD_PALETTE.player.skin,
        'skin',
      )
      ear.name = `player-${side < 0 ? 'left' : 'right'}-ear`
      ear.position.set(side * 0.47, 0.43, 0)
      head.add(ear)
    }

    const hairGeometry = new THREE.IcosahedronGeometry(0.5, 1)
    const hairCrown = this.createSurfaceMesh(hairGeometry, WORLD_PALETTE.player.darkNeutral, 'hair')
    hairCrown.name = 'player-hair-crown'
    hairCrown.position.set(0, 0.7, 0.03)
    hairCrown.scale.set(1.06, 0.72, 0.98)
    head.add(hairCrown)
    const hairSpikeGeometry = new THREE.ConeGeometry(0.23, 0.62, 6)
    const hairSpikes = [
      [-0.31, 0.94, 0.02, -0.42],
      [0.02, 1.02, 0.04, -0.08],
      [0.32, 0.91, 0.08, 0.4],
      [0, 0.72, 0.43, Math.PI],
    ] as const
    for (const [x, y, z, rotationZ] of hairSpikes) {
      const spike = this.createSurfaceMesh(hairSpikeGeometry, WORLD_PALETTE.player.darkNeutral, 'hair')
      spike.name = 'player-hair-spike'
      spike.position.set(x, y, z)
      spike.rotation.z = rotationZ
      spike.scale.set(1, z > 0.4 ? 0.82 : 1, 0.86)
      head.add(spike)
    }

    const upperArmGeometry = new THREE.CapsuleGeometry(0.18, 0.38, 4, 8)
    const lowerArmGeometry = new THREE.CapsuleGeometry(0.15, 0.34, 4, 8)
    const handGeometry = new THREE.SphereGeometry(0.19, 9, 7)
    for (const side of [-1, 1] as const) {
      const sideName = side < 0 ? 'left' : 'right'
      const shoulder = new THREE.Group()
      shoulder.name = `player-${sideName}-shoulder`
      shoulder.position.set(side * 0.72, 1.15, 0)
      shoulder.rotation.z = side * -0.12
      const sleeve = this.createSurfaceMesh(
        new THREE.CapsuleGeometry(0.235, 0.2, 4, 8),
        WORLD_PALETTE.player.primaryWarm,
        'fabric',
      )
      sleeve.name = `player-${sideName}-sleeve`
      sleeve.position.y = -0.18
      const upperArm = this.createSurfaceMesh(upperArmGeometry, WORLD_PALETTE.player.skin, 'skin')
      upperArm.name = `player-${sideName}-upper-arm`
      upperArm.position.y = -0.4
      const elbow = new THREE.Group()
      elbow.name = `player-${sideName}-elbow`
      elbow.position.y = -0.76
      const armBand = this.createSurfaceMesh(
        new THREE.CylinderGeometry(0.175, 0.175, 0.13, 9),
        WORLD_PALETTE.player.coolTrim,
        'fabric',
      )
      armBand.name = `player-${sideName}-arm-band`
      armBand.position.y = -0.1
      const lowerArm = this.createSurfaceMesh(lowerArmGeometry, WORLD_PALETTE.player.skin, 'skin')
      lowerArm.name = `player-${sideName}-lower-arm`
      lowerArm.position.y = -0.35
      const hand = this.createSurfaceMesh(handGeometry, WORLD_PALETTE.player.skin, 'skin')
      hand.name = `player-${sideName}-hand`
      hand.position.y = -0.72
      elbow.add(armBand, lowerArm, hand)
      shoulder.add(sleeve, upperArm, elbow)
      torso.add(shoulder)
      if (side < 0) {
        this.playerParts.leftShoulder = shoulder
        this.playerParts.leftElbow = elbow
      } else {
        this.playerParts.rightShoulder = shoulder
        this.playerParts.rightElbow = elbow
      }
    }

    const upperLegGeometry = new THREE.CapsuleGeometry(0.205, 0.42, 4, 8)
    const lowerLegGeometry = new THREE.CapsuleGeometry(0.17, 0.38, 4, 8)
    const shoeGeometry = new THREE.BoxGeometry(0.52, 0.27, 0.82)
    const soleGeometry = new THREE.BoxGeometry(0.55, 0.09, 0.86)
    for (const side of [-1, 1] as const) {
      const sideName = side < 0 ? 'left' : 'right'
      const hip = new THREE.Group()
      hip.name = `player-${sideName}-hip`
      hip.position.x = side * 0.31
      const upperLeg = this.createSurfaceMesh(upperLegGeometry, WORLD_PALETTE.player.darkNeutral, 'fabric')
      upperLeg.name = `player-${sideName}-thigh`
      upperLeg.position.y = -0.4
      const knee = new THREE.Group()
      knee.name = `player-${sideName}-knee`
      knee.position.y = -0.8
      const kneeCap = this.createSurfaceMesh(
        new THREE.SphereGeometry(0.205, 9, 7),
        WORLD_PALETTE.player.darkNeutral,
        'fabric',
      )
      kneeCap.name = `player-${sideName}-knee-cap`
      const lowerLeg = this.createSurfaceMesh(lowerLegGeometry, WORLD_PALETTE.player.darkNeutral, 'fabric')
      lowerLeg.name = `player-${sideName}-lower-leg`
      lowerLeg.position.y = -0.36
      const ankle = new THREE.Group()
      ankle.name = `player-${sideName}-ankle`
      ankle.position.y = -0.72
      const shoe = this.createSurfaceMesh(shoeGeometry, WORLD_PALETTE.player.coolTrim, 'rubber')
      shoe.name = `player-${sideName}-shoe`
      shoe.position.set(0, -0.11, -0.17)
      const sole = this.createSurfaceMesh(soleGeometry, WORLD_PALETTE.player.lightNeutral, 'rubber')
      sole.name = `player-${sideName}-shoe-sole`
      sole.position.set(0, -0.245, -0.18)
      ankle.add(shoe, sole)
      knee.add(kneeCap, lowerLeg, ankle)
      hip.add(upperLeg, knee)
      pelvis.add(hip)
      if (side < 0) {
        this.playerParts.leftHip = hip
        this.playerParts.leftKnee = knee
        this.playerParts.leftAnkle = ankle
      } else {
        this.playerParts.rightHip = hip
        this.playerParts.rightKnee = knee
        this.playerParts.rightAnkle = ankle
      }
    }

    this.playerVisual.scale.setScalar(PLAYER_CHARACTER.visualScale)
    this.playerVisual.position.y = PLAYER_CHARACTER.visualFootOffset
    this.player.add(this.playerVisual)
    this.player.position.set(0, 0, PLAYER_Z)
    this.player.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.frustumCulled = false
      const majorMass = object.name === 'player-pelvis-mass' ||
        object.name === 'player-orange-vest' || object.name === 'player-head' ||
        object.name === 'player-hair-crown' || object.name.includes('upper-arm') ||
        object.name.includes('lower-arm') || object.name.includes('thigh') ||
        object.name.includes('lower-leg') || object.name.endsWith('-shoe')
      object.castShadow = majorMass
      object.receiveShadow = object.material instanceof THREE.MeshStandardMaterial
    })
    this.scene.add(this.player)
  }

  private createHazard(kind: HazardKind): Hazard {
    const group = new THREE.Group()
    const visual = new THREE.Mesh(
      this.getHazardGeometry(kind === 'block' ? 'jump' : kind, 0),
      this.cityMaterial,
    )
    visual.name = `stage-12-hazard-${kind}`
    visual.castShadow = true
    visual.receiveShadow = true
    const train = this.createTrainVisual(0, 'standard', false, 1)
    visual.visible = kind !== 'block'
    train.group.visible = kind === 'block'
    group.add(visual, train.group)
    return {
      group,
      visual,
      train,
      kind,
      lane: 1,
      hit: false,
      variant: 0,
      direction: 1,
      trainPreset: 'standard',
      active: false,
      bounds: { minZ: 0, maxZ: 0 },
    }
  }

  private loadJumpBarrierAsset() {
    const assetUrl = `${import.meta.env.BASE_URL}assets/motion-rush-lower-barrier.glb`
    new GLTFLoader().load(
      assetUrl,
      ({ scene }) => {
        if (this.destroyed) return
        scene.name = 'motion-rush-lower-barrier-template'
        scene.updateMatrixWorld(true)

        const sourceBounds = new THREE.Box3().setFromObject(scene)
        const sourceSize = sourceBounds.getSize(new THREE.Vector3())
        if (sourceSize.x <= 0 || sourceSize.y <= 0 || sourceSize.z <= 0) {
          console.warn('[Motion Rush] Low-barrier GLB has invalid bounds; keeping procedural fallback.')
          return
        }

        const family = getHazardVisualFamily('jump')
        const targetSize = new THREE.Vector3(
          family.support.centerX * 2 + family.support.footWidth,
          family.panel.centerY + family.panel.height / 2,
          family.support.footDepth,
        )
        scene.scale.set(
          targetSize.x / sourceSize.x,
          targetSize.y / sourceSize.y,
          targetSize.z / sourceSize.z,
        )
        scene.updateMatrixWorld(true)

        const scaledBounds = new THREE.Box3().setFromObject(scene)
        const scaledCenter = scaledBounds.getCenter(new THREE.Vector3())
        scene.position.set(-scaledCenter.x, -scaledBounds.min.y, -scaledCenter.z)
        scene.updateMatrixWorld(true)
        const overheadBarrierTones: Record<string, number> = {
          MotionRush_gray: WORLD_PALETTE.gameplay.hazardDark,
          MotionRush_red: WORLD_PALETTE.gameplay.hazard,
          MotionRush_cream: WORLD_PALETTE.gameplay.hazardLight,
          MotionRush_blue: WORLD_PALETTE.gameplay.warningLight,
        }
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          const material = object.material
          if (material instanceof THREE.MeshStandardMaterial) {
            const tone = overheadBarrierTones[material.name]
            if (tone !== undefined) material.color.setHex(tone)
          }
          object.castShadow = true
          object.receiveShadow = true
          object.frustumCulled = true
        })

        this.jumpBarrierTemplate = scene
        for (const hazard of this.hazards) this.attachJumpBarrierAsset(hazard)
      },
      undefined,
      (error) => {
        console.warn('[Motion Rush] Low-barrier GLB failed to load; keeping procedural fallback.', error)
      },
    )
  }

  private attachJumpBarrierAsset(hazard: Hazard) {
    if (!this.jumpBarrierTemplate || hazard.assetVisual) return
    const assetVisual = this.jumpBarrierTemplate.clone(true)
    assetVisual.name = 'motion-rush-lower-barrier'
    assetVisual.visible = hazard.kind === 'jump'
    hazard.assetVisual = assetVisual
    hazard.group.add(assetVisual)
    if (hazard.kind === 'jump') hazard.visual.visible = false
  }

  private getHazardGeometry(kind: HazardKind, variant: number) {
    if (kind === 'block') return this.getTrainModuleGeometry(variant, 'front', false)
    const cacheKey = kind
    const cached = this.hazardGeometryCache.get(cacheKey)
    if (cached) return cached
    const family = getHazardVisualFamily(kind as StaticHazardKind)
    const panel = family.panel
    const support = family.support
    const faceWidth = panel.width - panel.faceInset * 2
    const faceHeight = panel.height - panel.faceInset * 2
    const panelFrontZ = panel.depth / 2 + 0.026
    const parts: ColoredGeometryPart[] = []
    // Thick dark backing and inset warning face form the shared family core.
    parts.push(
      {
        geometry: this.geometryQuality.box(panel.width, panel.height, panel.depth, 'plasticComposite'),
        color: WORLD_PALETTE.gameplay.hazardDark,
        family: 'darkCoatedMetal',
        position: [0, panel.centerY, 0],
      },
      {
        geometry: this.geometryQuality.box(faceWidth, faceHeight, 0.05, 'plasticComposite'),
        color: WORLD_PALETTE.gameplay.hazardLight,
        family: 'paintedComposite',
        position: [0, panel.centerY, panelFrontZ],
      },
    )
    for (const shape of createWarningStripeShapes(faceWidth, faceHeight, family.stripeCount)) {
      parts.push({
        geometry: new THREE.ShapeGeometry(shape),
        color: WORLD_PALETTE.gameplay.hazard,
        family: 'paintedComposite',
        position: [0, panel.centerY, panelFrontZ + 0.027],
      })
    }

    const postTop = panel.centerY - panel.height / 2 + 0.08
    const postBottom = support.footBottomY + support.footHeight
    const postHeight = postTop - postBottom
    for (const x of [-support.centerX, support.centerX]) {
      parts.push(
        {
          geometry: this.geometryQuality.prism(
            support.postWidth,
            postHeight,
            support.postDepth,
            'y',
            'thinMechanical',
          ),
          color: WORLD_PALETTE.gameplay.hazardDark,
          family: 'darkCoatedMetal',
          position: [x, postBottom + postHeight / 2, -0.08],
        },
        {
          geometry: this.geometryQuality.prism(
            support.footWidth,
            support.footHeight,
            support.footDepth,
            'z',
            'thinMechanical',
          ),
          color: WORLD_PALETTE.gameplay.hazardDark,
          family: 'rubber',
          position: [x, support.footBottomY + support.footHeight / 2, -0.03],
        },
      )
    }

    // One rear cross-member makes the assembly credible from behind without
    // competing with the warning face at approach distance.
    parts.push({
      geometry: this.geometryQuality.prism(
        panel.width - 0.34,
        kind === 'jump' ? 0.16 : 0.18,
        0.16,
        'x',
        'thinMechanical',
      ),
      color: WORLD_PALETTE.infrastructure.primary,
      family: 'paintedMetal',
      position: [0, kind === 'jump' ? 0.5 : family.openingHeight + 0.08, -panel.depth / 2 - 0.08],
    })

    // Two restrained round reflectors strengthen the silhouette. Their low
    // tessellation remains part of the single cached merged hazard mesh.
    for (const x of [-panel.width * 0.36, panel.width * 0.36]) {
      parts.push(
        {
          geometry: new THREE.CylinderGeometry(0.15, 0.15, 0.1, 10),
          color: WORLD_PALETTE.gameplay.hazardDark,
          family: 'rubber',
          position: [x, panel.centerY, panelFrontZ + 0.08],
          rotation: [Math.PI / 2, 0, 0],
        },
        {
          geometry: new THREE.CylinderGeometry(0.095, 0.095, 0.11, 10),
          color: WORLD_PALETTE.gameplay.warningLight,
          family: 'paintedComposite',
          position: [x, panel.centerY, panelFrontZ + 0.14],
          rotation: [Math.PI / 2, 0, 0],
        },
      )
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

  private getHazardLongitudinalBounds(hazard: Hazard) {
    if (hazard.kind === 'block') {
      const halfLength = hazard.train.composition.totalLength / 2
      hazard.bounds.minZ = hazard.group.position.z - halfLength - (
        hazard.direction === 1
          ? TRAIN_FRONT_SYSTEM.rearProjection
          : TRAIN_FRONT_SYSTEM.maxForwardProjection
      )
      hazard.bounds.maxZ = hazard.group.position.z + halfLength + (
        hazard.direction === 1
          ? TRAIN_FRONT_SYSTEM.maxForwardProjection
          : TRAIN_FRONT_SYSTEM.rearProjection
      )
      return hazard.bounds
    }
    const geometryBounds = hazard.visual.geometry.boundingBox
    const halfLength = geometryBounds
      ? Math.max(0.3, (geometryBounds.max.z - geometryBounds.min.z) / 2)
      : 0.65
    hazard.bounds.minZ = hazard.group.position.z - halfLength
    hazard.bounds.maxZ = hazard.group.position.z + halfLength
    return hazard.bounds
  }

  private getObstacleTrainRoofAtWorldZ(lane: number, worldZ: number) {
    for (const hazard of this.hazards) {
      if (hazard.kind !== 'block' || hazard.lane !== lane) continue
      const roofHalfLength = hazard.train.composition.totalLength / 2 + 0.04
      if (isInsideLongitudinalRoofFootprint(worldZ, hazard.group.position.z, roofHalfLength)) {
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

  private getLandingSurfaceAtWorldZ(worldZ: number) {
    for (let lane = 0; lane < LANES.length; lane += 1) {
      const routeHeight = this.getRouteSurfaceAtWorldZ(lane, worldZ)
      const trainHeight = this.getObstacleTrainRoofAtWorldZ(lane, worldZ)
      this.landingSurfaceHeights[lane] = Math.max(routeHeight, trainHeight)
      this.landingSurfaceKinds[lane] = trainHeight >= routeHeight && trainHeight > 0
        ? 'roof'
        : routeHeight > 0 && routeHeight < TRAIN_ROOF_HEIGHT - 1e-6
          ? 'ramp'
          : routeHeight > 0
            ? 'roof'
            : 'ground'
    }
    return resolveLandingSurfaceCandidate(
      this.player.position.x,
      PROPORTIONS.gameplay.rampWidth / 2,
      LANES,
      this.landingSurfaceHeights,
      this.landingSurfaceKinds,
      this.landingSurfaceCandidate,
    )
  }

  private routeOccupies(lane: number, worldZ: number, margin = 2.5) {
    return this.roofRoutes.some((route) => {
      if (route.lane !== lane) return false
      const localZ = worldZ - route.group.position.z
      return localZ <= ROUTE_UP_FRONT + margin && localZ >= ROUTE_DOWN_BACK - margin
    })
  }

  private getRouteTrainBounds(route: RoofRoute) {
    return getTrainLongitudinalBounds(
      route.group.position.z + route.train.group.position.z,
      route.direction,
      route.train.composition,
    )
  }

  private getHazardCandidateBounds(
    kind: HazardKind,
    centerZ: number,
    variant: number,
    preset: TrainLengthPreset,
    direction: TrainDirection,
  ) {
    if (kind === 'block') {
      return getTrainLongitudinalBounds(
        centerZ,
        direction,
        getTrainComposition(getTrainFrontFamily(variant), preset),
      )
    }
    const geometryBounds = this.getHazardGeometry(kind, variant).boundingBox
    const halfLength = geometryBounds
      ? Math.max(0.3, (geometryBounds.max.z - geometryBounds.min.z) / 2)
      : 0.65
    return { minZ: centerZ - halfLength, maxZ: centerZ + halfLength }
  }

  private getOtherLongTrainBounds(ignoreHazard?: Hazard) {
    const trains: { lane: number; minZ: number; maxZ: number }[] = this.roofRoutes.map((route) => ({
      lane: route.lane,
      ...this.getRouteTrainBounds(route),
    }))
    for (const hazard of this.hazards) {
      if (
        hazard === ignoreHazard ||
        !hazard.active ||
        hazard.kind !== 'block' ||
        hazard.trainPreset !== 'long'
      ) continue
      trains.push({ lane: hazard.lane, ...this.getHazardLongitudinalBounds(hazard) })
    }
    return trains
  }

  private createsThreeLaneLongWall(
    lane: number,
    candidate: { minZ: number; maxZ: number },
    ignoreHazard?: Hazard,
  ) {
    const byOtherLane = [0, 1, 2]
      .filter((otherLane) => otherLane !== lane)
      .map((otherLane) => this.getOtherLongTrainBounds(ignoreHazard).filter((train) => (
        train.lane === otherLane && longitudinalBoundsOverlap(candidate, train)
      )))
    if (byOtherLane.length !== 2) return false
    return byOtherLane[0].some((first) => byOtherLane[1].some((second) => (
      Math.max(candidate.minZ, first.minZ, second.minZ) <=
      Math.min(candidate.maxZ, first.maxZ, second.maxZ)
    )))
  }

  private isHazardPlacementClear(
    lane: number,
    candidate: { minZ: number; maxZ: number },
    kind: HazardKind,
    preset: TrainLengthPreset,
    ignoreHazard?: Hazard,
  ) {
    const routeMargin = kind === 'block'
      ? TRAIN_LENGTH_SYSTEM.headTailSafetyMargin
      : 5
    for (const route of this.roofRoutes) {
      if (route.lane !== lane) continue
      const routeBounds = {
        minZ: route.group.position.z + ROUTE_DOWN_BACK,
        maxZ: route.group.position.z + ROUTE_UP_FRONT,
      }
      if (longitudinalBoundsOverlap(candidate, routeBounds, routeMargin)) return false
    }
    for (const other of this.hazards) {
      if (other === ignoreHazard || !other.active || other.lane !== lane) continue
      const margin = kind === 'block' || other.kind === 'block'
        ? TRAIN_LENGTH_SYSTEM.minSameLaneGap
        : 3
      if (longitudinalBoundsOverlap(candidate, this.getHazardLongitudinalBounds(other), margin)) {
        return false
      }
    }
    return preset !== 'long' || !this.createsThreeLaneLongWall(lane, candidate, ignoreHazard)
  }

  private staggerTrainCenter(
    lane: number,
    centerZ: number,
    candidate: { minZ: number; maxZ: number },
    ignoreHazard?: Hazard,
  ) {
    const otherTrains = [
      ...this.roofRoutes.map((route) => ({ lane: route.lane, ...this.getRouteTrainBounds(route) })),
      ...this.hazards
        .filter((hazard) => (
          hazard !== ignoreHazard && hazard.active && hazard.kind === 'block'
        ))
        .map((hazard) => ({ lane: hazard.lane, ...this.getHazardLongitudinalBounds(hazard) })),
    ]
    const aligned = otherTrains.some((other) => other.lane !== lane && (
      Math.abs(candidate.minZ - other.minZ) < TRAIN_LENGTH_SYSTEM.crossLaneStagger ||
      Math.abs(candidate.maxZ - other.maxZ) < TRAIN_LENGTH_SYSTEM.crossLaneStagger
    ))
    return aligned ? centerZ - TRAIN_LENGTH_SYSTEM.crossLaneStagger : centerZ
  }

  private findHazardPlacement(
    preferredLane: number,
    initialZ: number,
    kind: HazardKind,
    variant: number,
    requestedPreset: TrainLengthPreset,
    direction: TrainDirection,
    ignoreHazard?: Hazard,
  ): { lane: number; z: number; preset: TrainLengthPreset } {
    let preset = requestedPreset
    let z = initialZ
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const laneOrder = preset === 'long'
        ? [preferredLane === 1 ? 0 : preferredLane, preferredLane === 2 ? 0 : 2, 1]
        : [preferredLane, (preferredLane + 1) % 3, (preferredLane + 2) % 3]
      for (const lane of [...new Set(laneOrder)]) {
        if (preset === 'long' && lane === 1) continue
        let candidate = this.getHazardCandidateBounds(kind, z, variant, preset, direction)
        const staggeredZ = kind === 'block'
          ? this.staggerTrainCenter(lane, z, candidate, ignoreHazard)
          : z
        if (staggeredZ !== z) {
          candidate = this.getHazardCandidateBounds(
            kind,
            staggeredZ,
            variant,
            preset,
            direction,
          )
        }
        if (this.isHazardPlacementClear(lane, candidate, kind, preset, ignoreHazard)) {
          return { lane, z: staggeredZ, preset }
        }
      }
      z -= 8
    }
    if (preset === 'long') {
      preset = 'standard'
      return this.findHazardPlacement(
        preferredLane,
        z,
        kind,
        variant,
        preset,
        direction,
        ignoreHazard,
      )
    }
    return { lane: preferredLane, z, preset }
  }

  private isCoinPlacementClear(lane: number, worldZ: number) {
    if (this.routeOccupies(lane, worldZ, READABILITY_PLACEMENT.routeCoinClearance)) return false
    for (const hazard of this.hazards) {
      if (hazard.lane !== lane) continue
      const clearance = READABILITY_PLACEMENT.hazardCoinClearance[hazard.kind]
      const bounds = this.getHazardLongitudinalBounds(hazard)
      if (worldZ > bounds.minZ - clearance && worldZ < bounds.maxZ + clearance) return false
    }
    return true
  }

  private findReadableCoinTrailLane(preferredLane: number, frontZ: number, coinCount: number) {
    return chooseReadableCoinTrailLane(
      preferredLane,
      frontZ,
      coinCount,
      (lane, worldZ) => this.isCoinPlacementClear(lane, worldZ),
    )
  }

  private placeRoofRoute(route: RoofRoute, lane: number, z: number) {
    route.lane = lane
    route.group.position.set(LANES[lane], 0, z)
  }

  private resetWorldObjects() {
    this.placeRoofRoute(this.roofRoutes[0], 1, this.roofTestMode ? -34 : -82)
    this.placeRoofRoute(this.roofRoutes[1], this.roofTestMode ? 2 : 0, this.roofTestMode ? -34 : -232)

    this.trainSpawnSequence = 0
    this.hazards.forEach((hazard) => {
      hazard.active = false
      hazard.group.visible = false
    })
    let hazardZ = this.roofTestMode ? -190 : -36
    this.hazards.forEach((hazard, index) => {
      hazardZ -= 22 + (index % 3) * 4
      const kind: HazardKind = index % 3 === 0 ? 'jump' : index % 3 === 1 ? 'block' : 'slide'
      const preferredLane = (index * 2 + 1) % 3
      const variant = (index + preferredLane) % TRAIN_PALETTES.length
      const family = getTrainFrontFamily(variant)
      const direction: TrainDirection = kind === 'block' && (index + preferredLane) % 2 === 0
        ? -1
        : 1
      const requestedPreset = kind === 'block'
        ? getTrainSpawnPreset(this.trainSpawnSequence, preferredLane, family)
        : 'standard'
      const placement = this.findHazardPlacement(
        preferredLane,
        hazardZ,
        kind,
        variant,
        requestedPreset,
        direction,
        hazard,
      )
      this.updateHazard(
        hazard,
        kind,
        placement.lane,
        placement.z,
        variant,
        direction,
        placement.preset,
      )
      hazard.group.visible = true
    })
    if (this.roofTestMode) {
      const shortTransferTrain = this.hazards.find((hazard) => hazard.kind === 'block')
      if (shortTransferTrain) {
        this.updateHazard(shortTransferTrain, 'block', 0, -34, 3, 1, 'short')
      }
    }

    const routeCoinZs = [18.1, 16.4, 14.4, 10, 5, 0, -5, -10, -15, -18.2, -20.8, -22.8]
    const routeCoinCount = routeCoinZs.length * this.roofRoutes.length
    let groundCoinZ = -31.5
    let groundCoinTrailLane: number = getCoinTrailPreferredLane(0)
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
      if (groundIndex > 0) groundCoinZ -= getCoinTrailStep(groundIndex)
      const trailIndex = Math.floor(groundIndex / READABILITY_PLACEMENT.coinTrailLength)
      const trailOffset = groundIndex % READABILITY_PLACEMENT.coinTrailLength
      if (trailOffset === 0) {
        const coinsRemaining = Math.min(
          READABILITY_PLACEMENT.coinTrailLength,
          this.coins.length - index,
        )
        groundCoinTrailLane = this.findReadableCoinTrailLane(
          getCoinTrailPreferredLane(trailIndex),
          groundCoinZ,
          coinsRemaining,
        )
      }
      const z = groundCoinZ
      const lane = groundCoinTrailLane
      coin.lane = lane
      coin.collected = false
      coin.mesh.visible = true
      coin.baseY = this.getRouteSurfaceAtWorldZ(lane, z) + 1.08
      coin.mesh.position.set(LANES[lane], coin.baseY, z)
      coin.mesh.rotation.y = 0
    })
    this.recycledGroundCoinCount = 0
    this.recycledGroundCoinLane = getCoinTrailPreferredLane(0)
    this.syncCoinInstances()
  }

  private updateHazard(
    hazard: Hazard,
    kind: HazardKind,
    lane: number,
    z: number,
    variant: number,
    direction: TrainDirection = 1,
    requestedTrainPreset?: TrainLengthPreset,
  ) {
    if (kind !== 'block' && (hazard.kind !== kind || hazard.variant !== variant)) {
      hazard.visual.geometry = this.getHazardGeometry(kind, variant)
    }
    let trainPreset = hazard.trainPreset
    if (kind === 'block') {
      const family = getTrainFrontFamily(variant)
      trainPreset = requestedTrainPreset ?? getTrainSpawnPreset(
        this.trainSpawnSequence,
        lane,
        family,
      )
      this.trainSpawnSequence += 1
      this.configureTrainAssembly(hazard.train, variant, trainPreset, direction)
    }
    hazard.kind = kind
    hazard.lane = lane
    hazard.variant = variant
    hazard.direction = direction
    hazard.trainPreset = trainPreset
    hazard.active = true
    hazard.hit = false
    hazard.group.position.set(LANES[lane], 0, z)
    hazard.group.rotation.y = 0
    const usesJumpBarrierAsset = kind === 'jump' && Boolean(hazard.assetVisual)
    hazard.visual.visible = kind !== 'block' && !usesJumpBarrierAsset
    hazard.visual.rotation.y = 0
    if (hazard.assetVisual) hazard.assetVisual.visible = usesJumpBarrierAsset
    hazard.train.group.visible = kind === 'block'
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
    const variant = (Math.floor(this.distance / 90) + lane + Math.floor(Math.random() * 3)) % TRAIN_PALETTES.length
    const family = getTrainFrontFamily(variant)
    const direction: TrainDirection = kind === 'block' && (this.trainSpawnSequence + lane) % 2 === 1
      ? -1
      : 1
    const requestedPreset = kind === 'block'
      ? getTrainSpawnPreset(this.trainSpawnSequence, lane, family)
      : 'standard'
    const placement = this.findHazardPlacement(
      lane,
      z,
      kind,
      variant,
      requestedPreset,
      direction,
      hazard,
    )
    this.updateHazard(
      hazard,
      kind,
      placement.lane,
      placement.z,
      variant,
      direction,
      placement.preset,
    )
  }

  private recycleCoin(coin: Coin) {
    let farthestZ = Number.POSITIVE_INFINITY
    for (const item of this.coins) {
      if (!item.route) farthestZ = Math.min(farthestZ, item.mesh.position.z)
    }
    const sequenceIndex = this.recycledGroundCoinCount
    const trailOffset = sequenceIndex % READABILITY_PLACEMENT.coinTrailLength
    const z = farthestZ - getCoinTrailStep(sequenceIndex)
    if (trailOffset === 0) {
      const trailIndex = Math.floor(sequenceIndex / READABILITY_PLACEMENT.coinTrailLength)
      this.recycledGroundCoinLane = this.findReadableCoinTrailLane(
        getCoinTrailPreferredLane(trailIndex),
        z,
        READABILITY_PLACEMENT.coinTrailLength,
      )
    }
    const lane = this.recycledGroundCoinLane
    this.recycledGroundCoinCount += 1
    coin.lane = lane
    coin.collected = false
    coin.mesh.visible = true
    coin.baseY = this.getRouteSurfaceAtWorldZ(lane, z) + 1.08
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
        const candidateBounds = {
          minZ: z + ROUTE_DOWN_BACK - TRAIN_LENGTH_SYSTEM.headTailSafetyMargin,
          maxZ: z + ROUTE_UP_FRONT + TRAIN_LENGTH_SYSTEM.headTailSafetyMargin,
        }
        let score = this.hazards.filter((hazard) => (
          hazard.lane === lane &&
          longitudinalBoundsOverlap(
            candidateBounds,
            this.getHazardLongitudinalBounds(hazard),
            TRAIN_LENGTH_SYSTEM.minSameLaneGap,
          )
        )).length
        if (otherRoutes.some((other) => (
          other.lane === lane && longitudinalBoundsOverlap(
            candidateBounds,
            {
              minZ: other.group.position.z + ROUTE_DOWN_BACK,
              maxZ: other.group.position.z + ROUTE_UP_FRONT,
            },
            TRAIN_LENGTH_SYSTEM.minSameLaneGap,
          )
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

    if (
      this.cameraViewMode === 'runner-pov' &&
      this.status !== 'paused' &&
      this.status !== 'gameover'
    ) this.updateRunnerPovCamera(delta)

    for (const diagnostic of this.geometryBoundsDiagnostics) {
      diagnostic.helper.box.setFromObject(diagnostic.target)
    }
    if (this.trackDiagnosticMode) this.applyTrackDiagnosticMode()

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
        speed: this.speed,
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
    let shadowCasters = 0
    let shadowReceivers = 0
    let worldMeshesMissingResponse = 0
    let instancedMeshes = 0
    let nonUniformlyScaledObjects = 0
    let negativelyScaledObjects = 0
    const renderedTrianglesByFamily: Record<string, number> = {}
    const liveMaterials = new Set<THREE.Material>()
    const liveGeometries = new Set<THREE.BufferGeometry>()
    this.scene.traverse((object) => {
      sceneObjects += 1
      const { x: scaleX, y: scaleY, z: scaleZ } = object.scale
      if (scaleX < 0 || scaleY < 0 || scaleZ < 0) negativelyScaledObjects += 1
      if (Math.abs(scaleX - scaleY) > 1e-6 || Math.abs(scaleX - scaleZ) > 1e-6) {
        nonUniformlyScaledObjects += 1
      }
      if (!(object instanceof THREE.Mesh)) return
      liveGeometries.add(object.geometry)
      if (object instanceof THREE.InstancedMesh) instancedMeshes += 1
      const geometryTriangles = (object.geometry.index
        ? object.geometry.index.count
        : object.geometry.getAttribute('position').count) / 3
      const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1
      const geometryFamily = object.name.startsWith('city-depth-mid')
        ? 'mid-buildings'
        : object.name.startsWith('city-depth-far')
          ? 'far-buildings'
          : object.name.startsWith('stage-20-building-facade')
            ? 'near-building-facades'
          : object.name.startsWith('stage-12-near-scenery')
            ? 'near-buildings-and-props'
            : object.name || 'unnamed'
      renderedTrianglesByFamily[geometryFamily] =
        (renderedTrianglesByFamily[geometryFamily] ?? 0) + geometryTriangles * instanceCount
      if (object.castShadow) shadowCasters += 1
      if (object.receiveShadow) shadowReceivers += 1
      if (Array.isArray(object.material)) object.material.forEach((item) => liveMaterials.add(item))
      else liveMaterials.add(object.material)
      if (
        object.material === this.cityMaterial &&
        !object.geometry.getAttribute(MATERIAL_RESPONSE_ATTRIBUTE)
      ) {
        worldMeshesMissingResponse += 1
      }
    })
    const materialList = [...liveMaterials]
    const geometryList = [...liveGeometries]
    const uniqueGeometryVertices = geometryList.reduce((total, geometry) => (
      total + (geometry.getAttribute('position')?.count ?? 0)
    ), 0)
    const uniqueGeometryTriangles = geometryList.reduce((total, geometry) => {
      const positionCount = geometry.getAttribute('position')?.count ?? 0
      return total + (geometry.index ? geometry.index.count : positionCount) / 3
    }, 0)
    let missingNormalGeometries = 0
    let invalidNormalVertices = 0
    for (const geometry of geometryList) {
      const normal = geometry.getAttribute('normal')
      if (!normal) {
        missingNormalGeometries += 1
        continue
      }
      for (let index = 0; index < normal.count; index += 1) {
        const lengthSquared = normal.getX(index) ** 2 +
          normal.getY(index) ** 2 + normal.getZ(index) ** 2
        if (!Number.isFinite(lengthSquared) || lengthSquared < 0.25) invalidNormalVertices += 1
      }
    }
    const routeTrain = this.roofRoutes[0].train
    const obstacleTrain = this.hazards.find((hazard) => hazard.kind === 'block')?.train ??
      this.hazards[0].train
    const trainTriangles = (train: TrainAssembly) => [
      train.frontModule,
      train.middleModules,
      train.rearModule,
      train.connectors,
    ].reduce((total, mesh) => {
      const instanceCount = mesh instanceof THREE.InstancedMesh ? mesh.count : 1
      return total + (
        mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count
      ) / 3 * instanceCount
    }, 0)
    const playerVisualBounds = new THREE.Box3().setFromObject(this.playerVisual)
    const playerVisualSize = playerVisualBounds.getSize(new THREE.Vector3())
    let playerMeshes = 0
    let playerTriangles = 0
    let playerShadowCasters = 0
    const playerMaterials = new Set<THREE.Material>()
    this.playerVisual.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      playerMeshes += 1
      playerTriangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
      if (object.castShadow) playerShadowCasters += 1
      if (Array.isArray(object.material)) object.material.forEach((material) => playerMaterials.add(material))
      else playerMaterials.add(object.material)
    })
    const routeTrainBounds = new THREE.Box3().setFromObject(routeTrain.group)
    const obstacleTrainBounds = new THREE.Box3().setFromObject(obstacleTrain.group)
    const routeTrainSize = routeTrainBounds.getSize(new THREE.Vector3())
    const obstacleTrainSize = obstacleTrainBounds.getSize(new THREE.Vector3())
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
      materialSystem: {
        liveMaterialInstances: materialList.length,
        cachedSurfaceMaterials: this.surfaceMaterialCache.size,
        standardMaterials: materialList.filter((item) => (
          item instanceof THREE.MeshStandardMaterial &&
          !(item instanceof THREE.MeshPhysicalMaterial)
        )).length,
        physicalMaterials: materialList.filter((item) => (
          item instanceof THREE.MeshPhysicalMaterial
        )).length,
        basicMaterials: materialList.filter((item) => item instanceof THREE.MeshBasicMaterial).length,
        transparentMaterials: materialList.filter((item) => item.transparent).length,
        doubleSidedMaterials: materialList.filter((item) => item.side === THREE.DoubleSide).length,
        worldMeshesMissingResponse,
        responseAttribute: MATERIAL_RESPONSE_ATTRIBUTE,
        responseEncoding: 'normalized Uint8 vec4',
        responseBytesPerVertex: 4,
        environmentResponseMax: MATERIAL_ENVIRONMENT_RESPONSE_MAX,
        families: Object.values(MATERIAL_FAMILIES).map((family) => ({
          id: family.id,
          tier: family.tier,
          roughness: family.roughness,
          metalness: family.metalness,
          environmentResponse: family.environmentResponse,
          emissiveIntensity: family.emissiveIntensity,
          shading: family.shading,
        })),
        environment: {
          name: this.environmentTexture.name,
          width: ENVIRONMENT_WIDTH,
          height: ENVIRONMENT_HEIGHT,
          colorSpace: this.environmentTexture.colorSpace,
          mapping: 'EquirectangularReflectionMapping',
          visibleAsBackground: false,
        },
      },
      geometrySystem: {
        edgeStandards: Object.values(EDGE_STANDARDS),
        templates: this.geometryQuality.getStats(),
        trackTemplates: this.trackGeometryCache.getStats(),
        trainComponentTemplates: this.trainComponentGeometryCache.getStats(),
        vegetationTemplates: this.vegetationGeometryCache.getStats(),
        liveUniqueGeometries: geometryList.length,
        uniqueGeometryVertices,
        uniqueGeometryTriangles,
        instancedMeshes,
        trainCacheEntries: this.trainGeometryCache.size,
        hazardCacheEntries: this.hazardGeometryCache.size,
        nonUniformlyScaledObjects,
        negativelyScaledObjects,
        missingNormalGeometries,
        invalidNormalVertices,
        renderedTrianglesByFamily,
        mergedWorldMeshesMissingMaterialResponse: worldMeshesMissingResponse,
        runtimeGeometryCreation: 'startup-only; recycled objects reuse merged cached geometry',
        colliderPolicy: 'train proxies remain independent; Stage 21 static depth follows the visible support footprint',
      },
      hazardSystem: {
        categories: {
          jump: 'ground-mounted low construction barricade',
          slide: 'ground-mounted elevated construction gantry with clear lower opening',
          block: 'ground obstacle train with traversable supported roof',
        },
        staticFamilies: HAZARD_VISUAL_FAMILIES,
        staticRoofHazards: false,
        laneCenters: LANES,
        orientation: 'warning face perpendicular to travel and authored toward +Z',
        drawCallsPerStaticHazard: 1,
        cacheEntries: this.hazardGeometryCache.size,
        recyclingPolicy: 'pooled roots swap the two cached merged static geometries',
      },
      rampVisualShell: {
        specification: RAMP_VISUAL_SHELL,
        approvedFootprint: {
          length: RAMP_LENGTH,
          width: PROPORTIONS.gameplay.rampWidth,
          angleDegrees: THREE.MathUtils.radToDeg(RAMP_VISUAL_ANGLE_RADIANS),
        },
        geometryCacheEntries: this.rampGeometryCache.size,
        drawCallsPerRamp: 1,
        shellColliderAgreement: 'deck upper plane uses the unchanged route-height endpoints',
        mounting: 'ground feet remain above support plane; high end is flush with route roof',
        lifecycle: 'both ramp meshes are children of the recycled roof-route root',
        culling: 'one merged mesh per ramp; bounds include deck, panels, rails, feet, and supports',
      },
      sceneObjects,
      shadowCasters,
      shadowReceivers,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      pixelRatio: this.renderer.getPixelRatio(),
      lane: this.laneIndex,
      supportLane: this.supportLaneIndex,
      surfaceHeight: this.surfaceHeight,
      surfaceTransition: this.surfaceTransitionKind,
      status: this.status,
      distance: this.distance,
      speed: this.speed,
      rampLength: RAMP_LENGTH,
      rampAngleDegrees: THREE.MathUtils.radToDeg(Math.atan(TRAIN_ROOF_HEIGHT / RAMP_LENGTH)),
      cameraY: this.camera.position.y,
      cameraZ: this.camera.position.z,
      cameraFov: this.camera.fov,
      cameraLookHeight: this.cameraLookHeight,
      cameraLookZ: CHASE_CAMERA.lookZ,
      worldOuterEdge: WORLD_WIDTH.cityGroundOuterEdge,
      foundationDepth: WORLD_WIDTH.foundationDepth,
      scenerySpacing: SCENERY_SPACING,
      playerVisualScale: PLAYER_CHARACTER.visualScale,
      playerVisualHeight: PLAYER_VISUAL_HEIGHT,
      playerVisualBounds: {
        width: playerVisualSize.x,
        height: playerVisualSize.y,
        depth: playerVisualSize.z,
        minY: playerVisualBounds.min.y,
        maxY: playerVisualBounds.max.y,
      },
      playerCharacterSystem: {
        architecture: 'grouped-mesh anatomical hierarchy; no SkinnedMesh, AnimationMixer, or root motion',
        gameplayRoot: this.player.name,
        visualRoot: this.playerVisual.name,
        authoredHeight: PLAYER_CHARACTER.authoredHeight,
        authoredFootLevel: PLAYER_CHARACTER.authoredFootLevel,
        neutralWidth: PLAYER_CHARACTER.neutralWidth,
        meshCount: playerMeshes,
        materialCount: playerMaterials.size,
        triangles: playerTriangles,
        shadowCasters: playerShadowCasters,
        runPhase: this.characterPose.runPhase,
        animationAllocations: 'pose input/output and transforms are cached; no per-frame geometry or object creation',
        semanticReferences: ['pelvis', 'torso', 'head', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'],
        replacementContract: 'gameplay root + visual root + pose input + semantic references + scale/offset',
      },
      playerTrainScaleReference: {
        ...PLAYER_TRAIN_SCALE,
        neutralVisualWidth: PLAYER_TRAIN_SCALE.authoredNeutralWidth *
          PLAYER_TRAIN_SCALE.visualScale,
        neutralPlayerRoofShare: (
          PLAYER_TRAIN_SCALE.authoredNeutralWidth * PLAYER_TRAIN_SCALE.visualScale
        ) / TRAIN_FORM.roofDeckWidth,
      },
      trainBodyWidth: TRAIN_FORM.maxBodyWidth,
      trainRoofWidth: TRAIN_FORM.roofDeckWidth,
      trainLaneClearance: LANES[1] - LANES[0] -
        getTrainFormDimensions(TRAIN_ROOF_HEIGHT).maxVisualWidth,
      trainForm: {
        route: getTrainFormDimensions(TRAIN_ROOF_HEIGHT),
        obstacle: getTrainFormDimensions(OBSTACLE_TRAIN_ROOF_HEIGHT),
      },
      trainFrontSystem: {
        specification: TRAIN_FRONT_SYSTEM,
        themeFamilies: TRAIN_PALETTES.map((_, themeIndex) => getTrainFrontFamily(themeIndex)),
        wagonWheels: getTrainWheelPlacements(TRAIN_LENGTH_SYSTEM.wagonLength),
        orientationPolicy: 'front geometry authors toward +Z; reverse trains rotate +PI around Y',
        mirroringPolicy: 'no negative-scale mirroring',
        visualOnly: true,
      },
      trainLengthSystem: TRAIN_LENGTH_SYSTEM,
      trainGeometryCacheSize: this.trainGeometryCache.size,
      routeTrainTriangles: trainTriangles(routeTrain),
      obstacleTrainTriangles: trainTriangles(obstacleTrain),
      routeTrainGeometryBounds: {
        width: routeTrainSize.x,
        height: routeTrainSize.y,
        length: routeTrainSize.z,
        minY: routeTrainBounds.min.y,
        maxY: routeTrainBounds.max.y,
      },
      obstacleTrainGeometryBounds: {
        width: obstacleTrainSize.x,
        height: obstacleTrainSize.y,
        length: obstacleTrainSize.z,
        minY: obstacleTrainBounds.min.y,
        maxY: obstacleTrainBounds.max.y,
      },
      gameplayTrainProxies: {
        frontColliderWidth: 2.16,
        obstacleColliderLength: 'full preset assembly bounds',
        obstacleRoofHeight: OBSTACLE_TRAIN_ROOF_HEIGHT,
        routeRoofHeight: TRAIN_ROOF_HEIGHT,
        traversalWidth: PROPORTIONS.gameplay.rampWidth,
        jointPolicy: 'continuous scalar roof surface across every inter-car joint',
        laneCenterSpacing: LANES[1] - LANES[0],
      },
      trackSystem: {
        profile: TRACK_SYSTEM,
        laneCenters: LANES,
        railCenterlines: LANES.map((trackCenter) => getRailCenterlines(trackCenter)),
        sleeperPositionsPerSegment: getSleeperPositions(-TRACK_LENGTH / 2, TRACK_LENGTH / 2),
        baseSegmentVertices: this.trackInstances?.geometry.getAttribute('position')?.count ?? 0,
        baseSegmentTriangles: (
          this.trackInstances?.geometry.index?.count ??
          this.trackInstances?.geometry.getAttribute('position')?.count ??
          0
        ) / 3,
        plateTileVertices:
          this.trackConnectionInstances?.geometry.getAttribute('position')?.count ?? 0,
        plateTileTriangles: (
          this.trackConnectionInstances?.geometry.index?.count ??
          this.trackConnectionInstances?.geometry.getAttribute('position')?.count ??
          0
        ) / 3,
        fastenerTileVertices:
          this.trackFastenerInstances?.geometry.getAttribute('position')?.count ?? 0,
        fastenerTileTriangles: (
          this.trackFastenerInstances?.geometry.index?.count ??
          this.trackFastenerInstances?.geometry.getAttribute('position')?.count ??
          0
        ) / 3,
        ballastTileVertices:
          this.trackBallastInstances?.geometry.getAttribute('position')?.count ?? 0,
        ballastTileTriangles: (
          this.trackBallastInstances?.geometry.index?.count ??
          this.trackBallastInstances?.geometry.getAttribute('position')?.count ??
          0
        ) / 3,
        baseSegmentInstances: this.trackInstances?.count ?? 0,
        activePlateTileInstances: this.trackConnectionInstances?.count ?? 0,
        activeFastenerTileInstances: this.trackFastenerInstances?.count ?? 0,
        activeBallastTileInstances: this.trackBallastInstances?.count ?? 0,
        sleeperPhasePolicy: 'logical world phase; half-open intervals; exact 1.5 m cadence',
        railContinuityPolicy: 'open-ended profile; exact 18 m segment contract; no overlap',
        pedestrianCorridor: PEDESTRIAN_CORRIDOR,
        pedestrianContinuityPolicy:
          'open-ended merged profiles; exact 18 m segment contract; deterministic 6 m half-open seam phase',
        pedestrianCollisionPolicy: 'visual-only; no new surface colliders or gameplay proxies',
        fastenerPolicy: 'one instanced tile batch; two readable clamp wedges per rail contact',
        detailPolicy: 'plates to -108 m; ballast tiles to -72 m; clips to -48 m',
        exclusionPolicy: '4.5 m tiles suppress ballast/plates at ramps and clips at ramps/barriers',
        collisionPolicy: 'all Stage 13R geometry is visual-only',
        diagnosticMode: this.trackDiagnosticMode,
      },
      railGauge: TRACK_SYSTEM.gauge,
      sleeperLength: TRACK_SYSTEM.sleeper.length,
      platformTop: PEDESTRIAN_CORRIDOR.platformSurfaceTop,
      buildingFloorHeight: PROPORTIONS.building.floorHeight,
      coinDiameter: PROPORTIONS.coin.radius * 2,
      overheadHeight: OVERHEAD_GANTRY_HEIGHT,
      shadowMapType: 'PCFSoftShadowMap',
      shadowMapSize: LIGHTING_SHADOWS.mapSize,
      keyPosition: LIGHTING_SHADOWS.keyPosition,
      keyTarget: LIGHTING_SHADOWS.keyTarget,
      shadowCamera: LIGHTING_SHADOWS.camera,
      shadowBias: LIGHTING_SHADOWS.bias,
      shadowNormalBias: LIGHTING_SHADOWS.normalBias,
      elevatedTransfer: this.elevatedTransfer.active,
      trainHazards: this.hazards
        .filter((hazard) => hazard.kind === 'block')
        .map((hazard) => ({
          lane: hazard.lane,
          z: hazard.group.position.z,
          variant: hazard.variant,
          direction: hazard.direction,
          preset: hazard.trainPreset,
          carCount: hazard.train.composition.carCount,
          totalLength: hazard.train.composition.totalLength,
          bounds: this.getHazardLongitudinalBounds(hazard),
          groupScale: hazard.group.scale.toArray(),
          visualScale: hazard.train.group.scale.toArray(),
          geometryWidth: getTrainFormDimensions(OBSTACLE_TRAIN_ROOF_HEIGHT).maxVisualWidth,
        })),
      routePositions: this.roofRoutes.map((route) => ({
        lane: route.lane,
        z: route.group.position.z,
        direction: route.direction,
        preset: route.trainPreset,
        carCount: route.train.composition.carCount,
        totalLength: route.train.composition.totalLength,
        bounds: this.getRouteTrainBounds(route),
        groupScale: route.group.scale.toArray(),
      })),
      cityDepth: {
        seed: this.cityDepthLayout.seed,
        cycleLength: this.cityDepthLayout.cycleLength,
        setbacks: this.cityDepthLayout.setbacks,
        skylineCount: CITY_DEPTH.skylineCount,
        densitySegments: {
          open: this.cityDepthLayout.segments.filter((segment) => segment.density === 'open').length,
          medium: this.cityDepthLayout.segments.filter((segment) => segment.density === 'medium').length,
          dense: this.cityDepthLayout.segments.filter((segment) => segment.density === 'dense').length,
        },
        layers: this.cityDepthLayers.map((layer) => ({
          name: layer.name,
          familyId: layer.familyId,
          instances: layer.instances.length,
          active: layer.activeCount,
          parallax: layer.parallax,
          backCullZ: layer.backCullZ,
          frontCullZ: layer.frontCullZ,
        })),
      },
      buildingMassing: {
        nearFamilies: (Object.keys(BUILDING_FAMILIES) as BuildingFamilyId[]).map((familyId) => ({
          familyId,
          instances: this.cityDepthLayout.segments.filter((segment) => (
            getBuildingFamilyId(
              'near',
              this.cityDepthLayout.seed,
              segment.index,
              0,
              segment.nearSide,
            ) === familyId
          )).length,
        })),
        midFamilies: this.cityDepthLayers
          .filter((layer) => layer.name === 'mid')
          .map((layer) => ({ familyId: layer.familyId, instances: layer.instances.length })),
        farFamilies: this.cityDepthLayers
          .filter((layer) => layer.name === 'far')
          .map((layer) => ({ familyId: layer.familyId, instances: layer.instances.length })),
        skylineRoles: ['filler', 'supporting', 'dominant'].map((heightRole) => ({
          heightRole,
          instances: Array.from({ length: CITY_DEPTH.skylineCount }, (_, index) => (
            getSkylineSilhouette(index, this.cityDepthLayout.seed)
          )).filter((preset) => preset.heightRole === heightRole).length,
        })),
        presets: (Object.values(BUILDING_FAMILIES) as BuildingFamilyPreset[]).map((preset) => ({
          ...getBuildingFamilyMetrics(preset, PROPORTIONS.building.floorHeight),
          label: preset.label,
          heightRole: preset.heightRole,
          roofProfile: preset.roofProfile,
          massCount: preset.masses.length,
        })),
        transformedNonUniformly: 0,
      },
      buildingFacades: {
        families: Object.values(FACADE_FAMILIES),
        mapping: (Object.keys(BUILDING_FAMILIES) as BuildingFamilyId[]).map((familyId) => ({
          buildingFamilyId: familyId,
          facadeFamilyId: getFacadeFamily(familyId).id,
        })),
        corridorOrientation: 'side-sign selects the inward X face; no negative scale mirroring',
        geometryReuse: 'one merged static detail mesh per near segment; one instanced mesh per mid family',
        detailShadowPolicy: 'near detail meshes and all mid/far facade meshes do not cast shadows',
      },
      readabilityPlacement: READABILITY_PLACEMENT,
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
    this.player.position.y = 0
    this.player.scale.set(1, 1, 1)
    this.player.rotation.set(0, 0, 0)
    const poseInput = this.characterPoseInput
    poseInput.elapsed = this.elapsed
    poseInput.speed = 0
    poseInput.crouch = 0
    poseInput.airborne = false
    poseInput.jumpVelocity = 0
    poseInput.landing = 0
    poseInput.laneLean = 0
    poseInput.rampLean = 0
    const pose = getCharacterPose(poseInput, this.characterPose)
    pose.leftArm *= 0.24
    pose.rightArm *= 0.24
    pose.leftHip *= 0.24
    pose.rightHip *= 0.24
    pose.leftKnee *= 0.35
    pose.rightKnee *= 0.35
    pose.leftFoot *= 0.2
    pose.rightFoot *= 0.2
    pose.pelvisY *= 0.4
    pose.torsoYaw *= 0.25
    this.applyCharacterPose(pose)
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
    for (let index = 0; index < this.overheadZs.length; index += 1) {
      this.overheadZs[index] += travel
      if (this.overheadZs[index] > OVERHEAD_GANTRY_RECYCLE_Z) {
        this.overheadZs[index] -= totalTrackLength
      }
    }
    this.syncTrackInstances()

    this.scenery.forEach((item) => {
      item.position.z += travel * CITY_DEPTH.parallax.foreground
      if (item.position.z > 34) item.position.z -= this.scenery.length * SCENERY_SPACING
      item.visible = item.position.z > READABILITY_PLACEMENT.sceneryVisibleNearZ &&
        item.position.z < READABILITY_PLACEMENT.sceneryVisibleFarZ
      for (const child of item.children) {
        if (!(child instanceof THREE.Mesh)) continue
        if (child.name.startsWith('stage-12-near-scenery')) {
          child.castShadow = item.visible &&
            item.position.z > LIGHTING_SHADOWS.sceneryCasterNearZ &&
            item.position.z < LIGHTING_SHADOWS.sceneryCasterFarZ
        } else if (child.name.startsWith('stage-20-building-facade')) {
          child.visible = item.visible
          child.castShadow = false
        } else if (child.name.startsWith('stage-17-tree-full')) {
          child.visible = item.visible &&
            item.position.z >= READABILITY_PLACEMENT.vegetationFullDetailNearZ &&
            item.position.z < READABILITY_PLACEMENT.vegetationTreeVisibleFarZ
          child.castShadow = child.visible &&
            item.position.z > LIGHTING_SHADOWS.sceneryCasterNearZ &&
            item.position.z < LIGHTING_SHADOWS.sceneryCasterFarZ
        } else if (child.name.startsWith('stage-17-tree-far')) {
          child.visible = item.visible &&
            item.position.z < READABILITY_PLACEMENT.vegetationFullDetailNearZ
          child.castShadow = false
        } else if (child.name.startsWith('stage-17-low-vegetation')) {
          child.visible = item.visible &&
            item.position.z >= READABILITY_PLACEMENT.vegetationLowDetailNearZ &&
            item.position.z < READABILITY_PLACEMENT.vegetationForegroundCullZ
          child.castShadow = false
        } else if (child.name.startsWith('stage-17-mid-support')) {
          child.visible = item.visible &&
            item.position.z >= READABILITY_PLACEMENT.vegetationMidSupportFarZ &&
            item.position.z <= READABILITY_PLACEMENT.vegetationMidSupportNearZ
          child.castShadow = false
        } else if (child.name === 'stage-12-readability-bridge') {
          child.visible = item.visible &&
            item.position.z < READABILITY_PLACEMENT.bridgeForegroundCullZ
          child.castShadow = child.visible &&
            item.position.z > LIGHTING_SHADOWS.sceneryCasterNearZ &&
            item.position.z < LIGHTING_SHADOWS.sceneryCasterFarZ
        }
      }
    })
    this.updateCityDepthLayers(travel)

    this.roofRoutes.forEach((route) => {
      route.group.position.z += travel
      if (route.group.position.z > PLAYER_Z - ROUTE_DOWN_BACK + 7) this.recycleRoofRoute(route)
      route.group.visible = route.group.position.z + ROUTE_UP_FRONT > READABILITY_PLACEMENT.criticalVisibleNearZ &&
        route.group.position.z + ROUTE_DOWN_BACK < READABILITY_PLACEMENT.routeVisibleFarZ
      if (this.trainDiagnosticMode?.includes('isolated') ||
        this.trainDiagnosticMode?.includes('composition')) route.group.visible = false
    })

    this.hazards.forEach((hazard) => {
      hazard.group.position.z += travel
      let bounds = this.getHazardLongitudinalBounds(hazard)
      if (bounds.minZ > TRAIN_LENGTH_SYSTEM.despawnSafetyZ) {
        this.recycleHazard(hazard)
        bounds = this.getHazardLongitudinalBounds(hazard)
      }
      hazard.group.visible = bounds.maxZ >
        READABILITY_PLACEMENT.criticalVisibleNearZ - TRAIN_LENGTH_SYSTEM.cullSafetyMargin &&
        bounds.minZ < READABILITY_PLACEMENT.gameplayVisibleFarZ +
          TRAIN_LENGTH_SYSTEM.cullSafetyMargin
      if (this.trainDiagnosticMode?.includes('isolated') ||
        this.trainDiagnosticMode?.includes('composition')) hazard.group.visible = false
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
    this.laneVisualLean = damp(
      this.laneVisualLean,
      THREE.MathUtils.clamp(xDelta / (LANES[1] - LANES[0]), -1, 1),
      18,
      delta,
    )
    this.player.rotation.set(0, 0, 0)

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

    const previousFeetY = this.jumpMotion.airborne
      ? this.jumpMotion.takeoffHeight + this.jumpMotion.height
      : this.player.position.y
    const landingSurface = this.getLandingSurfaceAtWorldZ(PLAYER_Z)
    const jumpStep = stepJumpMotion(this.jumpMotion, delta, landingSurface.height)
    this.jumpMotion = jumpStep.state
    const nextFeetY = this.jumpMotion.airborne
      ? this.jumpMotion.takeoffHeight + this.jumpMotion.height
      : landingSurface.height
    const landedOnMovingRamp = !jumpStep.landed && this.jumpMotion.airborne &&
      didDescendingFeetCrossMovingRamp(
        previousFeetY,
        nextFeetY,
        this.jumpMotion.velocity,
        this.previousLandingSurface,
        landingSurface,
      )
    if (landedOnMovingRamp) this.jumpMotion = createGroundedJumpMotion()
    if (jumpStep.landed || landedOnMovingRamp) {
      this.surfaceHeight = landingSurface.height
      this.previousSurfaceHeight = landingSurface.height
      if (landingSurface.height > 0) {
        this.supportLaneIndex = landingSurface.lane as RunnerLane
        this.surfaceTransitionKind = this.supportLaneIndex === this.laneIndex
          ? 'same-lane'
          : 'roof-to-roof'
        this.elevatedTransfer.active = false
      }
      this.landingElapsed = 0
      this.triggerLandingEffect()
    }
    else if (!this.jumpMotion.airborne) {
      this.landingElapsed = Math.min(LANDING_TOTAL_DURATION, this.landingElapsed + delta)
    }

    this.fallbackSlideTimer = Math.max(0, this.fallbackSlideTimer - delta)
    const sliding = this.isCrouching() && !this.jumpMotion.airborne
    const landingCompression = getLandingCompression(this.landingElapsed)
    this.crouchVisualBlend = damp(
      this.crouchVisualBlend,
      sliding ? 1 : 0,
      PLAYER_CHARACTER.crouchBlendRate,
      delta,
    )
    this.player.position.y = this.jumpMotion.airborne
      ? this.jumpMotion.takeoffHeight + this.jumpMotion.height
      : this.surfaceHeight
    this.previousLandingSurface.lane = landingSurface.lane
    this.previousLandingSurface.height = landingSurface.height
    this.previousLandingSurface.kind = landingSurface.kind
    const rampLean = this.surfaceHeight > 0 && this.surfaceHeight < TRAIN_ROOF_HEIGHT - 0.04
      ? THREE.MathUtils.clamp(
        (this.surfaceHeight - this.previousSurfaceHeight) / Math.max(delta, 1 / 120) * 0.012,
        -0.025,
        0.075,
      )
      : 0
    const poseInput = this.characterPoseInput
    poseInput.elapsed = this.elapsed
    poseInput.speed = this.speed
    poseInput.crouch = this.crouchVisualBlend
    poseInput.airborne = this.jumpMotion.airborne
    poseInput.jumpVelocity = this.jumpMotion.velocity
    poseInput.landing = landingCompression
    poseInput.laneLean = this.laneVisualLean
    poseInput.rampLean = rampLean
    getCharacterPose(poseInput, this.characterPose)
    this.applyCharacterPose(this.characterPose)
    this.playerVisual.rotation.z = damp(
      this.playerVisual.rotation.z,
      -this.laneVisualLean * 0.1,
      PLAYER_CHARACTER.actionBlendRate,
      delta,
    )
    this.playerVisual.rotation.x = 0
    this.playerVisual.scale.setScalar(PLAYER_CHARACTER.visualScale)
    this.playerVisual.position.y = PLAYER_CHARACTER.visualFootOffset
    this.updatePlayerShadow(this.jumpMotion.height, landingCompression)

    if (this.cameraViewMode === 'runner-pov') return
    const targetCameraY = CHASE_CAMERA.groundHeight + this.surfaceHeight * CHASE_CAMERA.surfaceHeightFactor
    const targetCameraX = this.player.position.x * CHASE_CAMERA.lateralPositionFactor
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCameraX, 1 - Math.exp(-delta * 7))
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCameraY, 1 - Math.exp(-delta * 5.5))
    const targetLookHeight = CHASE_CAMERA.lookHeight + this.surfaceHeight * CHASE_CAMERA.surfaceLookFactor
    this.cameraLookHeight = THREE.MathUtils.lerp(this.cameraLookHeight, targetLookHeight, 1 - Math.exp(-delta * 6))
    this.cameraLookX = THREE.MathUtils.lerp(
      this.cameraLookX,
      this.player.position.x * CHASE_CAMERA.lateralLookFactor,
      1 - Math.exp(-delta * 7),
    )
    this.camera.position.z = THREE.MathUtils.lerp(
      this.camera.position.z,
      CHASE_CAMERA.positionZ,
      1 - Math.exp(-delta * 4),
    )
    this.camera.lookAt(this.cameraLookX, this.cameraLookHeight, CHASE_CAMERA.lookZ)
  }

  private resetChaseCameraPresentation() {
    this.cameraLookHeight = CHASE_CAMERA.lookHeight
    this.cameraLookX = 0
    this.camera.position.set(0, CHASE_CAMERA.groundHeight, CHASE_CAMERA.positionZ)
    this.camera.lookAt(0, this.cameraLookHeight, CHASE_CAMERA.lookZ)
  }

  private updateRunnerPovCamera(delta: number) {
    const targetX = this.player.position.x
    const crouchBlend = this.status === 'playing' ? this.crouchVisualBlend : 0
    const targetY = this.player.position.y + RUNNER_POV_CAMERA.eyeHeight -
      crouchBlend * RUNNER_POV_CAMERA.crouchDrop
    const blend = 1 - Math.exp(-delta * RUNNER_POV_CAMERA.followRate)
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX, blend)
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY, blend)
    this.camera.position.z = RUNNER_POV_CAMERA.positionZ
    this.camera.lookAt(
      this.camera.position.x,
      this.camera.position.y - RUNNER_POV_CAMERA.lookDown,
      RUNNER_POV_CAMERA.positionZ - RUNNER_POV_CAMERA.lookDistance,
    )
  }

  private applyCharacterPose(pose: CharacterPose) {
    const parts = this.playerParts
    if (parts.pelvis) {
      parts.pelvis.position.set(pose.pelvisX, 1.72 + pose.pelvisY, 0)
      parts.pelvis.rotation.set(0, pose.pelvisYaw, 0)
    }
    if (parts.torso) {
      parts.torso.rotation.set(pose.torsoPitch, pose.torsoYaw, pose.torsoRoll)
    }
    if (parts.head) parts.head.rotation.set(pose.headPitch, -pose.torsoYaw * 0.58, -pose.torsoRoll * 0.45)
    if (parts.leftShoulder) parts.leftShoulder.rotation.x = pose.leftArm
    if (parts.rightShoulder) parts.rightShoulder.rotation.x = pose.rightArm
    if (parts.leftElbow) parts.leftElbow.rotation.x = pose.leftElbow
    if (parts.rightElbow) parts.rightElbow.rotation.x = pose.rightElbow
    if (parts.leftHip) {
      parts.leftHip.rotation.x = pose.leftHip
      parts.leftHip.rotation.z = 0.035 + pose.leftKnee * 0.028
    }
    if (parts.rightHip) {
      parts.rightHip.rotation.x = pose.rightHip
      parts.rightHip.rotation.z = -0.035 - pose.rightKnee * 0.028
    }
    if (parts.leftKnee) {
      parts.leftKnee.rotation.x = -pose.leftKnee
      parts.leftKnee.rotation.z = -0.018
    }
    if (parts.rightKnee) {
      parts.rightKnee.rotation.x = -pose.rightKnee
      parts.rightKnee.rotation.z = 0.018
    }
    if (parts.leftAnkle) {
      parts.leftAnkle.position.y = -0.72 + pose.leftFootLift
      parts.leftAnkle.rotation.x = pose.leftFoot
    }
    if (parts.rightAnkle) {
      parts.rightAnkle.position.y = -0.72 + pose.rightFootLift
      parts.rightAnkle.rotation.x = pose.rightFoot
    }
  }

  private updatePlayerShadow(jumpHeight: number, landingCompression: number) {
    const shadow = this.playerShadow
    if (!shadow) return
    shadow.position.x = this.player.position.x
    shadow.position.y = this.surfaceHeight + 0.035
    shadow.position.z = PLAYER_Z - 0.14
    const heightRatio = getJumpShadowHeightRatio(jumpHeight)
    const width = 0.82 - heightRatio * 0.16 + landingCompression * 0.035
    const depth = 0.42 - heightRatio * 0.1 + landingCompression * 0.025
    shadow.scale.set(width, depth, 1)
    const material = shadow.material
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = LIGHTING_SHADOWS.contactShadowOpacity -
        heightRatio * 0.09 + landingCompression * 0.025
    }
  }

  private checkCollisions() {
    if (this.trainDiagnosticMode?.includes('isolated') ||
      this.trainDiagnosticMode?.includes('composition')) return
    const playerX = this.player.position.x
    for (const hazard of this.hazards) {
      if (hazard.hit) continue
      const xDistance = Math.abs(LANES[hazard.lane] - playerX)
      const insideLongitudinalCollider = hazard.kind === 'block'
        ? Math.abs(hazard.group.position.z - PLAYER_Z) <
          hazard.train.composition.totalLength / 2 - 0.05
        : Math.abs(hazard.group.position.z - PLAYER_Z) <
          getHazardVisualFamily(hazard.kind).colliderHalfDepth
      const colliderHalfWidth = hazard.kind === 'block'
        ? 1.08
        : getHazardVisualFamily(hazard.kind).colliderHalfWidth
      if (insideLongitudinalCollider && xDistance < colliderHalfWidth) {
        const sliding = this.isCrouching()
        const validAdjacentRoofTransfer = isValidAdjacentRoofTransfer(
          this.jumpMotion.airborne,
          this.surfaceTransitionKind,
        )
        const safelyOnTrainRoof = hazard.kind === 'block' && clearsTrainRoofTop(
          this.player.position.y,
          OBSTACLE_TRAIN_ROOF_HEIGHT,
        )
        const safe =
          (hazard.kind === 'jump' && this.jumpMotion.height > JUMP_CLEARANCE_HEIGHT) ||
          (hazard.kind === 'slide' && sliding) ||
          safelyOnTrainRoof ||
          (hazard.kind === 'block' && validAdjacentRoofTransfer)
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
        !clearsTrainRoofTop(this.player.position.y, targetRouteSurface)
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
        Math.abs(coin.mesh.position.y - (this.player.position.y + 1.05)) < 1.45
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
    const width = this.cityPortraitTestMode ? 390 : Math.max(1, this.container.clientWidth)
    const height = this.cityPortraitTestMode ? 844 : Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, this.cityPortraitTestMode)
    this.camera.aspect = width / height
    this.camera.fov = width / height < 0.7
      ? CHASE_CAMERA.portraitFov
      : CHASE_CAMERA.landscapeFov
    this.camera.updateProjectionMatrix()
  }
}
