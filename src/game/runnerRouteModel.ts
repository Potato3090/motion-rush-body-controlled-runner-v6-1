export const ROOF_TRANSFER_HEIGHT_TOLERANCE = 0.7
export const RAMP_SIDE_ENTRY_MAX_HEIGHT = 0.62
export const ROUTE_RAMP_LENGTH = 4.25
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

export interface LandingSurfaceCandidate {
  lane: number
  height: number
  kind: 'ground' | 'ramp' | 'roof'
}

/** Selects the highest valid support directly beneath the runner's feet. */
export function resolveLandingSurfaceCandidate(
  playerX: number,
  supportHalfWidth: number,
  laneCenters: readonly number[],
  surfaceHeights: readonly number[],
  surfaceKinds?: readonly LandingSurfaceCandidate['kind'][],
  output?: LandingSurfaceCandidate,
) {
  const result = output ?? { lane: 0, height: 0, kind: 'ground' }
  result.lane = 0
  result.height = 0
  result.kind = 'ground'

  if (!Number.isFinite(playerX) || !Number.isFinite(supportHalfWidth) || supportHalfWidth < 0) {
    return result
  }

  for (let lane = 0; lane < laneCenters.length; lane += 1) {
    if (Math.abs(playerX - laneCenters[lane]) > supportHalfWidth) continue
    const height = surfaceHeights[lane] ?? 0
    if (!Number.isFinite(height) || height <= result.height) continue
    result.lane = lane
    result.height = height
    result.kind = surfaceKinds?.[lane] ?? 'roof'
  }

  return result
}

export function didDescendingFeetCrossMovingRamp(
  previousFeetY: number,
  nextFeetY: number,
  nextVelocity: number,
  previousSurface: LandingSurfaceCandidate,
  currentSurface: LandingSurfaceCandidate,
) {
  if (
    nextVelocity >= 0 ||
    currentSurface.kind !== 'ramp' ||
    !Number.isFinite(previousFeetY) ||
    !Number.isFinite(nextFeetY) ||
    !Number.isFinite(currentSurface.height)
  ) return false

  const previousSurfaceHeight = previousSurface.kind === 'ramp' &&
    previousSurface.lane === currentSurface.lane
    ? previousSurface.height
    : 0
  return previousFeetY >= previousSurfaceHeight - 1e-6 &&
    nextFeetY <= currentSurface.height + 1e-6
}

/** Grounded roof-to-roof lane changes are valid top traversal, not side impacts. */
export function isValidAdjacentRoofTransfer(
  airborne: boolean,
  transitionKind: SurfaceTransitionKind,
) {
  return !airborne && transitionKind === 'roof-to-roof'
}

/** Roof endpoints are valid; positions beyond them belong to the lethal train body. */
export function isInsideLongitudinalRoofFootprint(
  worldZ: number,
  roofCenterZ: number,
  roofHalfLength: number,
) {
  return roofHalfLength > 0 && Math.abs(worldZ - roofCenterZ) <= roofHalfLength + 1e-9
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

export function clearsTrainRoofTop(playerFeet: number, trainRoofHeight: number) {
  return playerFeet >= trainRoofHeight - 0.04
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
