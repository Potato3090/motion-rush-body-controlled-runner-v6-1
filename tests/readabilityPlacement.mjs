import assert from 'node:assert/strict'
import {
  READABILITY_PLACEMENT,
  chooseReadableCoinTrailLane,
  getCoinTrailPreferredLane,
  getCoinTrailStep,
} from '../.control-test-build/readabilityPlacement.js'

assert.equal(READABILITY_PLACEMENT.laneCount, 3, 'readability placement must preserve exactly three lanes')
assert.equal(READABILITY_PLACEMENT.overheadTrackPhase, 2, 'gantries use the shifted, non-foreground phase')
assert.ok(
  READABILITY_PLACEMENT.vegetationTreeVisibleFarZ > 15.3,
  'full-detail trees remain active until they have passed the camera',
)
assert.ok(
  READABILITY_PLACEMENT.vegetationMidSupportNearZ > 15.3,
  'slim supporting trees remain active until they have passed the camera',
)
assert.ok(
  READABILITY_PLACEMENT.criticalVisibleNearZ < READABILITY_PLACEMENT.sceneryVisibleNearZ,
  'critical gameplay silhouettes become visible before scenery groups',
)
assert.ok(
  READABILITY_PLACEMENT.coinVisibleNearZ <= READABILITY_PLACEMENT.sceneryVisibleNearZ,
  'coin guidance becomes visible no later than decorative scenery',
)

assert.deepEqual(
  Array.from({ length: 8 }, (_, index) => getCoinTrailPreferredLane(index)),
  [1, 1, 2, 0, 1, 1, 2, 0],
  'trail lanes form a deterministic center-weighted sequence',
)
assert.equal(getCoinTrailStep(1), READABILITY_PLACEMENT.coinTrailSpacing)
assert.equal(getCoinTrailStep(10), READABILITY_PLACEMENT.coinTrailSpacing)
assert.equal(getCoinTrailStep(11), READABILITY_PLACEMENT.coinTrailGap)

const clearLane = chooseReadableCoinTrailLane(2, -40, 6, (lane) => lane !== 2)
assert.equal(clearLane, 1, 'a blocked side lane falls back to the adjacent center lane')

const bestPartialLane = chooseReadableCoinTrailLane(
  1,
  -40,
  6,
  (lane, worldZ) => lane === 0 || (lane === 1 && worldZ > -44),
)
assert.equal(bestPartialLane, 0, 'the least-obstructed whole trail wins over a scattered preferred trail')

for (let seed = 1; seed <= 32; seed += 1) {
  const isClear = (lane, worldZ) => {
    const depthCell = Math.round(Math.abs(worldZ) * 10)
    return ((seed * 17 + lane * 11 + depthCell * 3) % 7) > 1
  }
  const preferredLane = seed % READABILITY_PLACEMENT.laneCount
  const frontZ = -35 - seed * 1.7
  const chosenLane = chooseReadableCoinTrailLane(
    preferredLane,
    frontZ,
    READABILITY_PLACEMENT.coinTrailLength,
    isClear,
  )
  const blockedCount = (lane) => Array.from(
    { length: READABILITY_PLACEMENT.coinTrailLength },
    (_, coinIndex) => isClear(
      lane,
      frontZ - coinIndex * READABILITY_PLACEMENT.coinTrailSpacing,
    ) ? 0 : 1,
  ).reduce((sum, blocked) => sum + blocked, 0)
  assert.ok(chosenLane >= 0 && chosenLane < 3, `seed ${seed} stays inside the three-lane contract`)
  assert.equal(
    blockedCount(chosenLane),
    Math.min(blockedCount(0), blockedCount(1), blockedCount(2)),
    `seed ${seed} selects a lane with minimum critical overlap`,
  )
}

console.log('Stage 7 readability placement: all acceptance checks passed.')
