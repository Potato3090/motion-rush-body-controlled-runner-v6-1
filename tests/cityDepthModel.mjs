import assert from 'node:assert/strict'
import {
  CITY_DEPTH,
  createCityDepthLayout,
  normalizeCitySeed,
} from '../.control-test-build/cityDepthModel.js'

const world = {
  sidewalkOuterEdge: 10.75,
  buildingZoneOuterEdge: 23.5,
  outerServiceEdge: 32,
  cityGroundOuterEdge: 100,
  segmentSpacing: 13.5,
  segmentCount: 24,
}

assert.equal(normalizeCitySeed(null), CITY_DEPTH.defaultSeed)
assert.equal(normalizeCitySeed('47'), 47)
assert.equal(normalizeCitySeed('-47'), 47)

for (const seed of [13, 29, 47, 71, 97]) {
  const layout = createCityDepthLayout(world, seed)
  const repeat = createCityDepthLayout(world, seed)
  assert.deepEqual(layout, repeat, `seed ${seed} must remain deterministic`)
  assert.equal(layout.segments.length, world.segmentCount)
  assert.equal(layout.cycleLength, world.segmentSpacing * world.segmentCount)

  const states = layout.segments.map((segment) => segment.density)
  assert.ok(states.includes('open'))
  assert.ok(states.includes('medium'))
  assert.ok(states.includes('dense'))
  states.forEach((state, index) => {
    const nextState = states[(index + 1) % states.length]
    assert.notEqual(
      `${state}:${nextState}`,
      'open:dense',
      `seed ${seed} must not jump directly from open to dense`,
    )
    assert.notEqual(
      `${state}:${nextState}`,
      'dense:open',
      `seed ${seed} must not jump directly from dense to open`,
    )
  })

  for (const segment of layout.segments) {
    const expected = CITY_DEPTH.densityCounts[segment.density]
    assert.equal(segment.mid.length, expected.mid)
    assert.equal(segment.far.length, expected.far)
    assert.ok(segment.nearSide === -1 || segment.nearSide === 1)
    segment.mid.forEach((placement) => {
      assert.ok(placement.setback >= layout.setbacks.midMin)
      assert.ok(placement.setback <= layout.setbacks.midMax)
      assert.ok(CITY_DEPTH.sharedMidBuildingModels.includes(placement.modelIndex))
      assert.ok(Math.abs(placement.zOffset) <= 3.1)
    })
    segment.far.forEach((placement) => {
      assert.ok(placement.setback >= layout.setbacks.farMin)
      assert.ok(placement.setback <= layout.setbacks.farMax)
      assert.ok([4.8, 5.8, 6.8].includes(placement.width))
      assert.ok([8.2, 10.25, 12.3, 14.35].includes(placement.height))
      assert.equal(placement.depth, 5.8)
    })
  }

  for (let start = 0; start < layout.segments.length; start += 6) {
    const sideBalance = layout.segments
      .slice(start, start + 6)
      .reduce((sum, segment) => sum + segment.nearSide, 0)
    assert.equal(sideBalance, 0, `seed ${seed} should balance each six-segment near-city window`)
  }
}

console.log('city depth model tests passed')
