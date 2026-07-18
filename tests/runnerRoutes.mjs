import assert from 'node:assert/strict'
import {
  ROUTE_RAMP_LENGTH,
  ROUTE_ROOF_HEIGHT,
  areRoofHeightsCompatible,
  getRouteSurfaceHeight,
  isSafelyAboveTrainRoof,
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
}

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

console.log('Runner ramps and roof transitions: all acceptance checks passed.')
