export type BuildingBand = 'near' | 'mid' | 'far'
export type BuildingFamilyId =
  | 'broad-block'
  | 'narrow-midrise'
  | 'podium-block'
  | 'stepped-block'
  | 'compact-tower'
  | 'asymmetric-block'
export type BuildingRoofProfile = 'flat-cap' | 'step-cap' | 'angled-cap'
export type BuildingHeightRole = 'filler' | 'supporting' | 'dominant'

export interface BuildingMassTier {
  kind: 'podium' | 'main' | 'upper'
  baseFloor: number
  floors: number
  width: number
  depth: number
  /** Positive values step away from the gameplay corridor. */
  outwardOffset: number
  /** A bounded longitudinal shift for controlled asymmetry. */
  longitudinalOffset: number
}

export interface BuildingFamilyPreset {
  id: BuildingFamilyId
  label: string
  heightRole: BuildingHeightRole
  roofProfile: BuildingRoofProfile
  totalFloors: number
  masses: readonly BuildingMassTier[]
  allowedBands: readonly BuildingBand[]
  heightWidthRatio: readonly [number, number]
  heightDepthRatio: readonly [number, number]
}

export interface BuildingFamilyMetrics {
  id: BuildingFamilyId
  totalHeight: number
  maxWidth: number
  maxDepth: number
  heightWidthRatio: number
  heightDepthRatio: number
}

export interface SkylineMassTier {
  baseHeight: number
  height: number
  width: number
  depth: number
  outwardOffset: number
  longitudinalOffset: number
}

export interface SkylineSilhouettePreset {
  id: 'skyline-filler-block' | 'skyline-supporting-step' | 'skyline-dominant-tower'
  heightRole: BuildingHeightRole
  roofProfile: BuildingRoofProfile
  masses: readonly SkylineMassTier[]
}

/**
 * Stage 10 architectural silhouettes. Every family is authored at final world
 * dimensions so near/mid geometry never depends on non-uniform transform scaling.
 */
export const BUILDING_FAMILIES = {
  'broad-block': {
    id: 'broad-block',
    label: 'Low broad urban block',
    heightRole: 'filler',
    roofProfile: 'flat-cap',
    totalFloors: 4,
    masses: [
      { kind: 'main', baseFloor: 0, floors: 4, width: 6.8, depth: 7.1, outwardOffset: 0, longitudinalOffset: 0 },
    ],
    allowedBands: ['near', 'mid', 'far'],
    heightWidthRatio: [1.15, 1.3],
    heightDepthRatio: [1.1, 1.25],
  },
  'narrow-midrise': {
    id: 'narrow-midrise',
    label: 'Narrow mid-rise',
    heightRole: 'supporting',
    roofProfile: 'flat-cap',
    totalFloors: 6,
    masses: [
      { kind: 'main', baseFloor: 0, floors: 6, width: 4.8, depth: 6.1, outwardOffset: 0, longitudinalOffset: 0 },
    ],
    allowedBands: ['near', 'mid'],
    heightWidthRatio: [2.45, 2.7],
    heightDepthRatio: [1.9, 2.15],
  },
  'podium-block': {
    id: 'podium-block',
    label: 'Podium and upper block',
    heightRole: 'supporting',
    roofProfile: 'flat-cap',
    totalFloors: 6,
    masses: [
      { kind: 'podium', baseFloor: 0, floors: 1, width: 6.8, depth: 7, outwardOffset: 0, longitudinalOffset: 0 },
      { kind: 'main', baseFloor: 1, floors: 5, width: 5.9, depth: 6.3, outwardOffset: 0.24, longitudinalOffset: 0 },
    ],
    allowedBands: ['near', 'mid'],
    heightWidthRatio: [1.7, 1.95],
    heightDepthRatio: [1.65, 1.9],
  },
  'stepped-block': {
    id: 'stepped-block',
    label: 'Stepped urban block',
    heightRole: 'supporting',
    roofProfile: 'step-cap',
    totalFloors: 6,
    masses: [
      { kind: 'podium', baseFloor: 0, floors: 3, width: 6.8, depth: 7, outwardOffset: 0, longitudinalOffset: 0 },
      { kind: 'main', baseFloor: 3, floors: 2, width: 5.9, depth: 6.3, outwardOffset: 0.24, longitudinalOffset: 0 },
      { kind: 'upper', baseFloor: 5, floors: 1, width: 5, depth: 5.6, outwardOffset: 0.48, longitudinalOffset: 0.16 },
    ],
    allowedBands: ['near', 'mid', 'far'],
    heightWidthRatio: [1.7, 1.95],
    heightDepthRatio: [1.65, 1.9],
  },
  'compact-tower': {
    id: 'compact-tower',
    label: 'Compact tower',
    heightRole: 'dominant',
    roofProfile: 'angled-cap',
    totalFloors: 7,
    masses: [
      { kind: 'podium', baseFloor: 0, floors: 1, width: 6.2, depth: 6.7, outwardOffset: 0, longitudinalOffset: 0 },
      { kind: 'main', baseFloor: 1, floors: 5, width: 5.2, depth: 5.9, outwardOffset: 0.16, longitudinalOffset: 0 },
      { kind: 'upper', baseFloor: 6, floors: 1, width: 4.6, depth: 5.2, outwardOffset: 0.34, longitudinalOffset: 0 },
    ],
    allowedBands: ['near', 'mid', 'far'],
    heightWidthRatio: [2.2, 2.45],
    heightDepthRatio: [2.05, 2.25],
  },
  'asymmetric-block': {
    id: 'asymmetric-block',
    label: 'Controlled asymmetric mass',
    heightRole: 'supporting',
    roofProfile: 'step-cap',
    totalFloors: 6,
    masses: [
      { kind: 'podium', baseFloor: 0, floors: 2, width: 6.8, depth: 7, outwardOffset: 0, longitudinalOffset: 0 },
      { kind: 'main', baseFloor: 2, floors: 3, width: 5.9, depth: 6.4, outwardOffset: 0.22, longitudinalOffset: 0.62 },
      { kind: 'upper', baseFloor: 5, floors: 1, width: 4.9, depth: 5.6, outwardOffset: 0.56, longitudinalOffset: -0.42 },
    ],
    allowedBands: ['near', 'mid'],
    heightWidthRatio: [1.7, 1.95],
    heightDepthRatio: [1.65, 1.9],
  },
} as const satisfies Record<BuildingFamilyId, BuildingFamilyPreset>

const BAND_FAMILIES: Record<BuildingBand, readonly BuildingFamilyId[]> = {
  near: [
    'broad-block',
    'podium-block',
    'narrow-midrise',
    'stepped-block',
    'asymmetric-block',
    'compact-tower',
  ],
  mid: [
    'podium-block',
    'narrow-midrise',
    'stepped-block',
    'asymmetric-block',
    'compact-tower',
  ],
  far: ['broad-block', 'stepped-block', 'compact-tower'],
}

const SKYLINE_RHYTHM: readonly BuildingHeightRole[] = [
  'supporting',
  'filler',
  'supporting',
  'dominant',
  'filler',
  'supporting',
  'filler',
]

export const SKYLINE_SILHOUETTES = {
  'skyline-filler-block': {
    id: 'skyline-filler-block',
    heightRole: 'filler',
    roofProfile: 'flat-cap',
    masses: [
      { baseHeight: 0, height: 10.5, width: 7.2, depth: 6.4, outwardOffset: 0, longitudinalOffset: 0 },
    ],
  },
  'skyline-supporting-step': {
    id: 'skyline-supporting-step',
    heightRole: 'supporting',
    roofProfile: 'step-cap',
    masses: [
      { baseHeight: 0, height: 11.5, width: 6.6, depth: 6.2, outwardOffset: 0, longitudinalOffset: 0 },
      { baseHeight: 11.5, height: 5, width: 5.4, depth: 5.4, outwardOffset: 0.34, longitudinalOffset: 0 },
    ],
  },
  'skyline-dominant-tower': {
    id: 'skyline-dominant-tower',
    heightRole: 'dominant',
    roofProfile: 'angled-cap',
    masses: [
      { baseHeight: 0, height: 4.2, width: 6.4, depth: 6.4, outwardOffset: 0, longitudinalOffset: 0 },
      { baseHeight: 4.2, height: 14.8, width: 5, depth: 5.5, outwardOffset: 0.22, longitudinalOffset: 0 },
      { baseHeight: 19, height: 3.2, width: 4.3, depth: 4.8, outwardOffset: 0.38, longitudinalOffset: 0 },
    ],
  },
} as const satisfies Record<string, SkylineSilhouettePreset>

function hashInteger(seed: number, index: number, salt: number) {
  let value = (seed ^ Math.imul(index + 17, 0x45d9f3b) ^ Math.imul(salt + 29, 0x27d4eb2d)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d)
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b)
  value ^= value >>> 16
  return value >>> 0
}

export function getBuildingFamilyId(
  band: BuildingBand,
  seed: number,
  segmentIndex: number,
  placementIndex: number,
  side: -1 | 1,
) {
  const families = BAND_FAMILIES[band]
  if (band === 'near') {
    return families[(segmentIndex * 5 + seed) % families.length]
  }
  const salt = placementIndex * 7 + (side > 0 ? 3 : 0) + (band === 'far' ? 11 : 5)
  return families[hashInteger(seed, segmentIndex, salt) % families.length]
}

export function getBuildingFamilyPreset(id: BuildingFamilyId) {
  return BUILDING_FAMILIES[id]
}

export function getBuildingFamilyMetrics(
  preset: BuildingFamilyPreset,
  floorHeight: number,
): BuildingFamilyMetrics {
  const totalHeight = preset.totalFloors * floorHeight
  const maxWidth = Math.max(...preset.masses.map((mass) => mass.width))
  const maxDepth = Math.max(...preset.masses.map((mass) => mass.depth))
  return {
    id: preset.id,
    totalHeight,
    maxWidth,
    maxDepth,
    heightWidthRatio: totalHeight / maxWidth,
    heightDepthRatio: totalHeight / maxDepth,
  }
}

export function getSkylineSilhouette(index: number, seed: number) {
  const role = SKYLINE_RHYTHM[(index + seed) % SKYLINE_RHYTHM.length]
  if (role === 'dominant') return SKYLINE_SILHOUETTES['skyline-dominant-tower']
  if (role === 'supporting') return SKYLINE_SILHOUETTES['skyline-supporting-step']
  return SKYLINE_SILHOUETTES['skyline-filler-block']
}
