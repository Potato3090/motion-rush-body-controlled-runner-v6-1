export type CityDensityState = 'open' | 'medium' | 'dense'

export interface CityDepthWorldMetrics {
  sidewalkOuterEdge: number
  buildingZoneOuterEdge: number
  outerServiceEdge: number
  cityGroundOuterEdge: number
  segmentSpacing: number
  segmentCount: number
}

export interface CityBuildingPlacement {
  side: -1 | 1
  setback: number
  zOffset: number
  modelIndex: number
}

export interface FarCityPlacement {
  side: -1 | 1
  setback: number
  zOffset: number
  width: number
  height: number
  depth: number
}

export interface CitySegmentLayout {
  index: number
  density: CityDensityState
  nearSide: -1 | 1
  mid: CityBuildingPlacement[]
  far: FarCityPlacement[]
}

export interface CityDepthLayout {
  seed: number
  cycleLength: number
  setbacks: {
    midMin: number
    midMax: number
    farMin: number
    farMax: number
    skylineMin: number
    skylineMax: number
  }
  segments: CitySegmentLayout[]
}

/**
 * Stage 9 city-depth policy. Values describe rhythm, streaming and relative depth;
 * actual setbacks are derived from the live world-width metrics below.
 */
export const CITY_DEPTH = {
  defaultSeed: 9107,
  densityPattern: [
    'medium',
    'dense',
    'medium',
    'open',
    'medium',
    'dense',
    'medium',
    'open',
  ] as const satisfies readonly CityDensityState[],
  densityCounts: {
    open: { mid: 1, far: 1 },
    medium: { mid: 1, far: 2 },
    dense: { mid: 2, far: 3 },
  } as const,
  // Exact existing 4/6/4-floor variants; no Stage 9 rescaling or new facade family.
  sharedMidBuildingModels: [0, 2, 4] as const,
  parallax: {
    foreground: 0.92,
    mid: 0.76,
    far: 0.54,
  } as const,
  visibility: {
    midBackCullZ: -208,
    midFrontCullZ: 38,
    farBackCullZ: -252,
    farFrontCullZ: 44,
  } as const,
  skylineCount: 34,
  skylineRows: 7,
} as const

const SIDE_PATTERN = [-1, 1, 1, -1, 1, -1] as const
const BUILDING_WIDTHS = [4.8, 5.8, 6.8] as const
const BUILDING_HEIGHTS = [8.2, 10.25, 12.3, 14.35] as const

function positiveInteger(value: number) {
  const integer = Number.isFinite(value) ? Math.trunc(value) : CITY_DEPTH.defaultSeed
  return Math.abs(integer) || CITY_DEPTH.defaultSeed
}

function hash01(seed: number, index: number, salt: number) {
  let value = (seed ^ Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 11, 0x27d4eb2d)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d)
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b)
  value ^= value >>> 16
  return (value >>> 0) / 0x100000000
}

function lerp(min: number, max: number, ratio: number) {
  return min + (max - min) * ratio
}

export function normalizeCitySeed(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return CITY_DEPTH.defaultSeed
  return positiveInteger(typeof value === 'number' ? value : Number(value))
}

export function createCityDepthLayout(
  world: CityDepthWorldMetrics,
  requestedSeed: number = CITY_DEPTH.defaultSeed,
): CityDepthLayout {
  const seed = normalizeCitySeed(requestedSeed)
  const midMin = world.sidewalkOuterEdge + 5.2
  const midMax = Math.min(
    world.outerServiceEdge - 5.4,
    world.buildingZoneOuterEdge + 3,
  )
  const farMin = world.outerServiceEdge - 1.5
  const farMax = Math.min(world.cityGroundOuterEdge * 0.58, world.cityGroundOuterEdge - 18)
  const skylineMin = Math.max(farMin + 13, world.cityGroundOuterEdge * 0.46)
  const skylineMax = Math.min(world.cityGroundOuterEdge * 0.8, world.cityGroundOuterEdge - 12)
  const patternOffset = seed % CITY_DEPTH.densityPattern.length
  const sideOffset = seed % SIDE_PATTERN.length

  const segments = Array.from({ length: world.segmentCount }, (_, index): CitySegmentLayout => {
    const density = CITY_DEPTH.densityPattern[
      (index + patternOffset) % CITY_DEPTH.densityPattern.length
    ]
    const nearSide = SIDE_PATTERN[(index + sideOffset) % SIDE_PATTERN.length]
    const counts = CITY_DEPTH.densityCounts[density]
    const mid: CityBuildingPlacement[] = []
    const far: FarCityPlacement[] = []

    for (let placementIndex = 0; placementIndex < counts.mid; placementIndex += 1) {
      const side = (placementIndex === 0 ? -nearSide : nearSide) as -1 | 1
      const setbackRatio = hash01(seed, index, 20 + placementIndex)
      mid.push({
        side,
        setback: lerp(midMin, midMax, setbackRatio),
        zOffset: lerp(-3.1, 3.1, hash01(seed, index, 30 + placementIndex)),
        modelIndex: CITY_DEPTH.sharedMidBuildingModels[
          Math.floor(hash01(seed, index, 40 + placementIndex) *
            CITY_DEPTH.sharedMidBuildingModels.length)
        ],
      })
    }

    for (let placementIndex = 0; placementIndex < counts.far; placementIndex += 1) {
      const sideRoll = hash01(seed, index, 50 + placementIndex)
      const side = (sideRoll < 0.5 ? -1 : 1) as -1 | 1
      const width = BUILDING_WIDTHS[
        Math.floor(hash01(seed, index, 60 + placementIndex) * BUILDING_WIDTHS.length)
      ]
      const height = BUILDING_HEIGHTS[
        Math.floor(hash01(seed, index, 70 + placementIndex) * BUILDING_HEIGHTS.length)
      ]
      far.push({
        side,
        setback: lerp(farMin, farMax, hash01(seed, index, 80 + placementIndex)),
        zOffset: lerp(-4.6, 4.6, hash01(seed, index, 90 + placementIndex)),
        width,
        height,
        depth: 5.8,
      })
    }

    return { index, density, nearSide, mid, far }
  })

  return {
    seed,
    cycleLength: world.segmentSpacing * world.segmentCount,
    setbacks: { midMin, midMax, farMin, farMax, skylineMin, skylineMax },
    segments,
  }
}
