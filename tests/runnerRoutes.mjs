import assert from 'node:assert/strict'
import {
  ROUTE_RAMP_LENGTH,
  ROUTE_ROOF_HEIGHT,
  areRoofHeightsCompatible,
  clearsTrainRoofTop,
  didDescendingFeetCrossMovingRamp,
  getRouteSurfaceHeight,
  isInsideLongitudinalRoofFootprint,
  isSafelyAboveTrainRoof,
  isValidAdjacentRoofTransfer,
  resolveLandingSurfaceCandidate,
  resolveSurfaceTransition,
} from '../.control-test-build/runnerRouteModel.js'

const upFront = 19
const upBack = upFront - ROUTE_RAMP_LENGTH
const roofBack = -19
const downBack = roofBack - ROUTE_RAMP_LENGTH

assert.equal(ROUTE_RAMP_LENGTH, 4.25, 'forward ramp length is short enough to create a clear, playable steep incline')
assert.ok(
  Math.atan(ROUTE_ROOF_HEIGHT / ROUTE_RAMP_LENGTH) * (180 / Math.PI) > 30,
  'the ramp incline is visibly steeper than thirty degrees',
)
assert.equal(getRouteSurfaceHeight(upFront, upFront, upBack, roofBack, downBack, ROUTE_ROOF_HEIGHT), 0)
assert.equal(getRouteSurfaceHeight(upBack, upFront, upBack, roofBack, downBack, ROUTE_ROOF_HEIGHT), ROUTE_ROOF_HEIGHT)
assert.equal(getRouteSurfaceHeight((upFront + upBack) / 2, upFront, upBack, roofBack, downBack, ROUTE_ROOF_HEIGHT), ROUTE_ROOF_HEIGHT / 2)
assert.equal(getRouteSurfaceHeight(0, upFront, upBack, roofBack, downBack, ROUTE_ROOF_HEIGHT), ROUTE_ROOF_HEIGHT)
assert.equal(getRouteSurfaceHeight((roofBack + downBack) / 2, upFront, upBack, roofBack, downBack, ROUTE_ROOF_HEIGHT), ROUTE_ROOF_HEIGHT / 2)
assert.equal(getRouteSurfaceHeight(downBack, upFront, upBack, roofBack, downBack, ROUTE_ROOF_HEIGHT), 0)

for (const [sourceLane, destinationLane] of [[1, 0], [1, 2], [0, 1], [2, 1]]) {
  const transfer = resolveSurfaceTransition({
    sourceLane,
    destinationLane,
    sourceSurface: 2.5,
    destinationSurface: 2.5,
    progress: 0.5,
  })
  assert.equal(transfer.kind, 'roof-to-roof')
  assert.equal(transfer.height, 2.5)
  assert.equal(transfer.destinationSupported, true)
  assert.equal(
    isValidAdjacentRoofTransfer(false, transfer.kind),
    true,
    `grounded ${sourceLane}->${destinationLane} roof transfer must suppress a body collision`,
  )
}
assert.equal(isValidAdjacentRoofTransfer(true, 'roof-to-roof'), false, 'airborne collisions require a top-down landing')
assert.equal(isValidAdjacentRoofTransfer(false, 'unsupported'), false, 'invalid side contact remains lethal')

assert.equal(areRoofHeightsCompatible(2.5, 3), true)
const mixedHeightTransfer = resolveSurfaceTransition({
  sourceLane: 1,
  destinationLane: 2,
  sourceSurface: 2.5,
  destinationSurface: 3,
  progress: 0.5,
})
assert.equal(mixedHeightTransfer.kind, 'roof-to-roof')
assert.equal(mixedHeightTransfer.height, 2.75)
assert.equal(isSafelyAboveTrainRoof(mixedHeightTransfer.height, 3), true)

const skippedLane = resolveSurfaceTransition({
  sourceLane: 0,
  destinationLane: 2,
  sourceSurface: 2.5,
  destinationSurface: 2.5,
  progress: 0.5,
})
assert.equal(skippedLane.kind, 'unsupported', 'roof support cannot bridge across the center lane')

const supportedFastRetarget = resolveSurfaceTransition({
  sourceLane: 0,
  destinationLane: 2,
  sourceSurface: 2.5,
  intermediateSurface: 2.5,
  destinationSurface: 3,
  progress: 0.75,
})
assert.equal(supportedFastRetarget.kind, 'roof-to-roof', 'absolute body tracking can cross all supported lanes')
assert.equal(supportedFastRetarget.destinationSupported, true)
assert.ok(supportedFastRetarget.height >= 2.5 && supportedFastRetarget.height <= 3)

const safeGroundExit = resolveSurfaceTransition({
  sourceLane: 1,
  destinationLane: 0,
  sourceSurface: 2.5,
  destinationSurface: 0,
  progress: 0.5,
})
assert.equal(safeGroundExit.kind, 'roof-to-ground')
assert.equal(safeGroundExit.height, 1.25)
assert.equal(safeGroundExit.destinationSupported, true)

const trainSideCollision = resolveSurfaceTransition({
  sourceLane: 1,
  destinationLane: 2,
  sourceSurface: 0,
  destinationSurface: 3,
  progress: 0.8,
})
assert.equal(trainSideCollision.kind, 'unsupported')
assert.equal(trainSideCollision.destinationSupported, false)
assert.equal(isSafelyAboveTrainRoof(1.95, 3), false, 'a ground jump cannot pass through a train body')
assert.equal(clearsTrainRoofTop(3, 3), true, 'a clean top-down landing clears the train body')
assert.equal(clearsTrainRoofTop(2.95, 3), false, 'a shallow side/front penetration remains lethal')
assert.equal(clearsTrainRoofTop(2.5, 3), false, 'an underside impact remains lethal')

const rampEntry = resolveSurfaceTransition({
  sourceLane: 1,
  destinationLane: 2,
  sourceSurface: 0,
  destinationSurface: 0.4,
  progress: 0.75,
})
assert.equal(rampEntry.kind, 'ramp-entry')
assert.equal(rampEntry.destinationSupported, true)

const groundLaneChange = resolveSurfaceTransition({
  sourceLane: 0,
  destinationLane: 1,
  sourceSurface: 0,
  destinationSurface: 0,
  progress: 0.7,
})
assert.equal(groundLaneChange.kind, 'ground-to-ground')
assert.equal(groundLaneChange.height, 0)
assert.equal(groundLaneChange.destinationSupported, true)

const laneCenters = [-3.15, 0, 3.15]
const roofHalfWidth = 1.2
for (const [sourceLane, destinationLane] of [[0, 2], [2, 0]]) {
  const surfaceHeights = [0, 0, 0]
  surfaceHeights[sourceLane] = 3
  surfaceHeights[destinationLane] = 3

  const overEmptyTrack = resolveLandingSurfaceCandidate(
    laneCenters[1],
    roofHalfWidth,
    laneCenters,
    surfaceHeights,
  )
  assert.equal(overEmptyTrack.height, 0, 'an empty track gap must not provide airborne support')

  const destinationRoof = resolveLandingSurfaceCandidate(
    laneCenters[destinationLane],
    roofHalfWidth,
    laneCenters,
    surfaceHeights,
  )
  assert.deepEqual(destinationRoof, { lane: destinationLane, height: 3, kind: 'roof' })

  const nextFrame = resolveSurfaceTransition({
    sourceLane: destinationRoof.lane,
    destinationLane,
    sourceSurface: destinationRoof.height,
    destinationSurface: 3,
    progress: 1,
  })
  assert.equal(nextFrame.kind, 'same-lane', 'a roof landing must remain supported on the next frame')
  assert.equal(nextFrame.destinationSupported, true)
}

assert.equal(
  resolveLandingSurfaceCandidate(laneCenters[2] - roofHalfWidth, roofHalfWidth, laneCenters, [0, 0, 3]).height,
  3,
  'the exact lateral roof edge is landable',
)
assert.equal(
  resolveLandingSurfaceCandidate(laneCenters[2] - roofHalfWidth - 0.01, roofHalfWidth, laneCenters, [0, 0, 3]).height,
  0,
  'a side impact outside the roof footprint remains unsupported',
)

assert.equal(
  didDescendingFeetCrossMovingRamp(
    1.1,
    1,
    -4,
    { lane: 1, height: 0.8, kind: 'ramp' },
    { lane: 1, height: 1.2, kind: 'ramp' },
  ),
  true,
  'a descending runner lands when a moving ramp top sweeps through the feet',
)
assert.equal(
  didDescendingFeetCrossMovingRamp(
    1.1,
    1,
    2,
    { lane: 1, height: 0.8, kind: 'ramp' },
    { lane: 1, height: 1.2, kind: 'ramp' },
  ),
  false,
  'an ascending runner must not snap onto a ramp',
)
assert.deepEqual(
  resolveLandingSurfaceCandidate(Number.NaN, roofHalfWidth, laneCenters, [0, 1, 0]),
  { lane: 0, height: 0, kind: 'ground' },
  'invalid transforms must resolve to a finite ground support',
)

for (const movingCenterZ of [-12, 4, 19]) {
  const shortRoofHalfLength = 3.4
  assert.equal(isInsideLongitudinalRoofFootprint(movingCenterZ, movingCenterZ, shortRoofHalfLength), true)
  assert.equal(
    isInsideLongitudinalRoofFootprint(movingCenterZ - shortRoofHalfLength, movingCenterZ, shortRoofHalfLength),
    true,
    'the rear roof edge is landable',
  )
  assert.equal(
    isInsideLongitudinalRoofFootprint(movingCenterZ + shortRoofHalfLength, movingCenterZ, shortRoofHalfLength),
    true,
    'the front roof edge is landable',
  )
  assert.equal(
    isInsideLongitudinalRoofFootprint(movingCenterZ + shortRoofHalfLength + 0.01, movingCenterZ, shortRoofHalfLength),
    false,
    'an impact beyond the front roof edge remains lethal',
  )
}

console.log('Runner ramps and roof transitions: all acceptance checks passed.')
