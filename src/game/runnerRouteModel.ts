export const ROOF_TRANSFER_HEIGHT_TOLERANCE = 0.7
export const RAMP_SIDE_ENTRY_MAX_HEIGHT = 0.62
export const ROUTE_RAMP_LENGTH = 6
export const ROUTE_ROOF_HEIGHT = 2.5

export type SurfaceTransitionKind =
  | 'same-lane'
  | 'ground-to-ground'
  | 'roof-to-roof'
  | 'roof-to-ground'
  | 'ramp-entry'
  | 'unsupported'

export interface SurfaceTransitionInput {
  sourceLane: number
  destinationLane: number
  sourceSurface: number
  destinationSurface: number
  intermediateSurface?: number
  progress: number
}

export interface SurfaceTransitionResult {
  height: number
  kind: SurfaceTransitionKind
  destinationSupported: boolean
}

function setTransitionResult(
  result: SurfaceTransitionResult,
  height: number,
  kind: SurfaceTransitionKind,
  destinationSupported: boolean,
) {
  result.height = height
  result.kind = kind
  result.destinationSupported = destinationSupported
  return result
}

export function areRoofHeightsCompatible(sourceSurface: number, destinationSurface: number) {
  return sourceSurface > 0 &&
    destinationSurface > 0 &&
    Math.abs(sourceSurface - destinationSurface) <= ROOF_TRANSFER_HEIGHT_TOLERANCE
}

function smoothProgress(progress: number) {
  const clamped = Math.max(0, Math.min(1, progress))
  return clamped * clamped * (3 - 2 * clamped)
}

/**
 * Resolves the runner's foot surface while moving laterally. Keeping this as a
 * pure model makes roof transfers symmetric and independently testable without
 * changing the existing lane-input system.
 */
export function resolveSurfaceTransition(
  input: SurfaceTransitionInput,
  output?: SurfaceTransitionResult,
): SurfaceTransitionResult {
  const result = output ?? { height: 0, kind: 'unsupported', destinationSupported: false }
  const {
    sourceLane,
    destinationLane,
    sourceSurface,
    destinationSurface,
  } = input

  if (sourceLane === destinationLane) {
    return setTransitionResult(result, destinationSurface, 'same-lane', true)
  }

  const progress = smoothProgress(input.progress)
  const laneDistance = Math.abs(sourceLane - destinationLane)
  const intermediateSurface = input.intermediateSurface ?? 0
  const validAdjacentRoof = laneDistance === 1 &&
    areRoofHeightsCompatible(sourceSurface, destinationSurface)
  const validTwoLaneRoofPath = laneDistance === 2 &&
    areRoofHeightsCompatible(sourceSurface, intermediateSurface) &&
    areRoofHeightsCompatible(intermediateSurface, destinationSurface)
  if (validAdjacentRoof || validTwoLaneRoofPath) {
    const height = validTwoLaneRoofPath
      ? progress < 0.5
        ? sourceSurface + (intermediateSurface - sourceSurface) * smoothProgress(progress * 2)
        : intermediateSurface + (destinationSurface - intermediateSurface) * smoothProgress((progress - 0.5) * 2)
      : sourceSurface + (destinationSurface - sourceSurface) * progress
    return setTransitionResult(result, height, 'roof-to-roof', true)
  }

  if (sourceSurface > 0 && destinationSurface <= 0) {
    return setTransitionResult(result, sourceSurface * (1 - progress), 'roof-to-ground', true)
  }

  if (sourceSurface <= 0 && destinationSurface <= 0) {
    return setTransitionResult(result, 0, 'ground-to-ground', true)
  }

  if (sourceSurface <= 0 && destinationSurface > 0 && destinationSurface <= RAMP_SIDE_ENTRY_MAX_HEIGHT) {
    return setTransitionResult(result, destinationSurface * progress, 'ramp-entry', true)
  }

  return setTransitionResult(result, sourceSurface, 'unsupported', false)
}

export function isSafelyAboveTrainRoof(playerFeet: number, trainRoofHeight: number) {
  return playerFeet >= trainRoofHeight - 0.36
}

export function getRouteSurfaceHeight(
  localZ: number,
  upFront: number,
  upBack: number,
  roofBack: number,
  downBack: number,
  roofHeight: number,
) {
  const rampLength = upFront - upBack
  if (localZ <= upFront && localZ >= upBack) {
    return ((upFront - localZ) / rampLength) * roofHeight
  }
  if (localZ < upBack && localZ >= roofBack) return roofHeight
  if (localZ < roofBack && localZ >= downBack) {
    return ((localZ - downBack) / (roofBack - downBack)) * roofHeight
  }
  return 0
}
