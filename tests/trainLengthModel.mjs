import assert from 'node:assert/strict'
import {
  TRAIN_LENGTH_SYSTEM,
  getLongitudinalGap,
  getTrainCarCount,
  getTrainComposition,
  getTrainLongitudinalBounds,
  getTrainModuleRole,
  getTrainSpawnPreset,
  longitudinalBoundsOverlap,
} from '../.control-test-build/trainLengthModel.js'

const near = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`)
}

const squaredShort = getTrainComposition('squared-metro', 'short')
const squaredStandard = getTrainComposition('squared-metro', 'standard')
const squaredLong = getTrainComposition('squared-metro', 'long')
const commuterStandard = getTrainComposition('rounded-commuter', 'standard')

assert.equal(squaredShort.carCount, 2)
assert.equal(squaredStandard.carCount, 3)
assert.equal(squaredLong.carCount, 5)
assert.equal(commuterStandard.carCount, 4)
assert.ok(squaredShort.totalLength < squaredStandard.totalLength)
assert.ok(squaredStandard.totalLength < squaredLong.totalLength)
assert.equal(getTrainCarCount('rounded-commuter', 'long'), 5)
near(squaredLong.totalLength, 33.72)

for (const composition of [squaredShort, squaredStandard, squaredLong, commuterStandard]) {
  assert.equal(composition.moduleCenters.length, composition.carCount)
  assert.equal(composition.jointCenters.length, composition.carCount - 1)
  assert.equal(getTrainModuleRole(0, composition.carCount), 'front')
  assert.equal(getTrainModuleRole(composition.carCount - 1, composition.carCount), 'rear')
  for (let index = 1; index < composition.carCount - 1; index += 1) {
    assert.equal(getTrainModuleRole(index, composition.carCount), 'middle')
  }
  for (let index = 1; index < composition.moduleCenters.length; index += 1) {
    near(
      composition.moduleCenters[index - 1] - composition.moduleCenters[index],
      TRAIN_LENGTH_SYSTEM.wagonLength + TRAIN_LENGTH_SYSTEM.interCarGap,
    )
  }
}

assert.ok(
  TRAIN_LENGTH_SYSTEM.connectorDepth > TRAIN_LENGTH_SYSTEM.interCarGap,
  'the dark gangway overlaps both car ends while preserving a readable visual seam',
)
assert.ok(
  squaredLong.totalLength - TRAIN_LENGTH_SYSTEM.wagonLength >=
    TRAIN_LENGTH_SYSTEM.rampLandingRunway,
  'a long ramp-compatible set has ample supported roof runway after landing',
)

const forward = getTrainLongitudinalBounds(-40, 1, squaredLong)
const reverse = getTrainLongitudinalBounds(-40, -1, squaredLong)
assert.ok(forward.frontZ > forward.rearZ)
assert.ok(reverse.frontZ < reverse.rearZ)
near(forward.maxZ - -40, -40 - reverse.minZ)
near(forward.minZ - -40, -40 - reverse.maxZ)

const safelySeparated = {
  minZ: forward.maxZ + TRAIN_LENGTH_SYSTEM.minSameLaneGap,
  maxZ: forward.maxZ + TRAIN_LENGTH_SYSTEM.minSameLaneGap + squaredShort.totalLength,
}
near(getLongitudinalGap(forward, safelySeparated), TRAIN_LENGTH_SYSTEM.minSameLaneGap)
assert.equal(longitudinalBoundsOverlap(forward, safelySeparated), false)
assert.equal(
  longitudinalBoundsOverlap(forward, safelySeparated, TRAIN_LENGTH_SYSTEM.minSameLaneGap),
  true,
)

for (const family of ['squared-metro', 'rounded-commuter']) {
  const sideCadence = Array.from({ length: 12 }, (_, index) => (
    getTrainSpawnPreset(index, 0, family)
  ))
  assert.ok(sideCadence.filter((preset) => preset === 'standard').length >= 8)
  assert.ok(sideCadence.includes('short'))
  assert.ok(sideCadence.includes('long'))
  assert.equal(
    Array.from({ length: 12 }, (_, index) => getTrainSpawnPreset(index, 1, family))
      .includes('long'),
    false,
    'long environmental sets are restricted to side lanes',
  )
}

console.log('Train length model: all Stage 15 acceptance checks passed.')
