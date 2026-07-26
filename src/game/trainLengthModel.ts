import {
  TRAIN_FRONT_SYSTEM,
  type TrainDirection,
  type TrainFrontFamily,
} from './trainFrontModel.js'

export type TrainLengthPreset = 'short' | 'standard' | 'long'
export type TrainModuleRole = 'front' | 'middle' | 'rear'

export interface TrainComposition {
  family: TrainFrontFamily
  preset: TrainLengthPreset
  carCount: number
  wagonLength: number
  interCarGap: number
  totalLength: number
  moduleCenters: readonly number[]
  jointCenters: readonly number[]
}

export interface TrainLongitudinalBounds {
  minZ: number
  maxZ: number
  frontZ: number
  rearZ: number
  centerZ: number
  totalLength: number
}

export const TRAIN_LENGTH_SYSTEM = {
  wagonLength: 6.6,
  interCarGap: 0.18,
  connectorDepth: 0.36,
  gangwayWidth: 2.2,
  gangwayBottomY: 0.34,
  roofBridgeWidth: 2.46,
  roofBridgeThickness: 0.1,
  minSameLaneGap: 6.5,
  headTailSafetyMargin: 1.25,
  rampLandingRunway: 8.5,
  crossLaneStagger: 4.8,
  despawnSafetyZ: 15,
  cullSafetyMargin: 3,
  maxCars: 5,
  families: {
    'squared-metro': {
      minCars: 2,
      maxCars: 5,
      presets: { short: 2, standard: 3, long: 5 },
    },
    'rounded-commuter': {
      minCars: 2,
      maxCars: 5,
      presets: { short: 2, standard: 4, long: 5 },
    },
  },
} as const

export function getTrainCarCount(
  family: TrainFrontFamily,
  preset: TrainLengthPreset,
) {
  return TRAIN_LENGTH_SYSTEM.families[family].presets[preset]
}

export function getTrainModuleRole(index: number, carCount: number): TrainModuleRole {
  if (index === 0) return 'front'
  if (index === carCount - 1) return 'rear'
  return 'middle'
}

export function getTrainComposition(
  family: TrainFrontFamily,
  preset: TrainLengthPreset,
): TrainComposition {
  const carCount = getTrainCarCount(family, preset)
  const pitch = TRAIN_LENGTH_SYSTEM.wagonLength + TRAIN_LENGTH_SYSTEM.interCarGap
  const totalLength = carCount * TRAIN_LENGTH_SYSTEM.wagonLength +
    (carCount - 1) * TRAIN_LENGTH_SYSTEM.interCarGap
  const firstCenter = totalLength / 2 - TRAIN_LENGTH_SYSTEM.wagonLength / 2
  const moduleCenters = Array.from(
    { length: carCount },
    (_, index) => firstCenter - index * pitch,
  )
  const jointCenters = moduleCenters.slice(0, -1).map((center, index) => (
    (center + moduleCenters[index + 1]) / 2
  ))
  return {
    family,
    preset,
    carCount,
    wagonLength: TRAIN_LENGTH_SYSTEM.wagonLength,
    interCarGap: TRAIN_LENGTH_SYSTEM.interCarGap,
    totalLength,
    moduleCenters,
    jointCenters,
  }
}

export function getTrainLongitudinalBounds(
  centerZ: number,
  direction: TrainDirection,
  composition: Pick<TrainComposition, 'totalLength'>,
): TrainLongitudinalBounds {
  const halfLength = composition.totalLength / 2
  const canonicalMin = -halfLength - TRAIN_FRONT_SYSTEM.rearProjection
  const canonicalMax = halfLength + TRAIN_FRONT_SYSTEM.maxForwardProjection
  const minZ = centerZ + (direction === 1 ? canonicalMin : -canonicalMax)
  const maxZ = centerZ + (direction === 1 ? canonicalMax : -canonicalMin)
  return {
    minZ,
    maxZ,
    frontZ: direction === 1 ? maxZ : minZ,
    rearZ: direction === 1 ? minZ : maxZ,
    centerZ,
    totalLength: composition.totalLength,
  }
}

export function getLongitudinalGap(
  first: Pick<TrainLongitudinalBounds, 'minZ' | 'maxZ'>,
  second: Pick<TrainLongitudinalBounds, 'minZ' | 'maxZ'>,
) {
  if (first.maxZ < second.minZ) return second.minZ - first.maxZ
  if (second.maxZ < first.minZ) return first.minZ - second.maxZ
  return 0
}

export function longitudinalBoundsOverlap(
  first: Pick<TrainLongitudinalBounds, 'minZ' | 'maxZ'>,
  second: Pick<TrainLongitudinalBounds, 'minZ' | 'maxZ'>,
  margin = 0,
) {
  return first.minZ <= second.maxZ + margin && first.maxZ >= second.minZ - margin
}

/**
 * Deterministic, bounded preset cadence: standard trains dominate, short sets
 * periodically reopen the corridor, and long sets are selective side framing.
 */
export function getTrainSpawnPreset(
  sequenceIndex: number,
  lane: number,
  family: TrainFrontFamily,
): TrainLengthPreset {
  const squaredCadence: readonly TrainLengthPreset[] = [
    'standard', 'short', 'standard', 'standard', 'long', 'standard',
  ]
  const commuterCadence: readonly TrainLengthPreset[] = [
    'standard', 'standard', 'short', 'standard', 'long', 'standard',
  ]
  const cadence = family === 'rounded-commuter' ? commuterCadence : squaredCadence
  const selected = cadence[((sequenceIndex % cadence.length) + cadence.length) % cadence.length]
  return selected === 'long' && lane === 1 ? 'standard' : selected
}
