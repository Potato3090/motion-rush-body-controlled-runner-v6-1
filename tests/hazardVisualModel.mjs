import assert from 'node:assert/strict'
import { HAZARD_VISUAL_FAMILIES } from '../.control-test-build/hazardVisualModel.js'
import { TRACK_SYSTEM } from '../.control-test-build/trackSystemModel.js'

const laneSpacing = 3.15
const railOuterEdge = TRACK_SYSTEM.gauge / 2 + TRACK_SYSTEM.rail.headWidth / 2
const sleeperHalfWidth = TRACK_SYSTEM.sleeper.length / 2

assert.deepEqual(Object.keys(HAZARD_VISUAL_FAMILIES).sort(), ['jump', 'slide'])

for (const [kind, family] of Object.entries(HAZARD_VISUAL_FAMILIES)) {
  assert.equal(family.movement, kind)
  assert.equal(family.mounting, 'ground')
  assert.ok(family.panel.width < laneSpacing, `${kind} stays inside one lane`)
  assert.ok(family.colliderHalfWidth * 2 < laneSpacing, `${kind} collider stays inside one lane`)
  assert.ok(
    family.support.centerX - family.support.footWidth / 2 > railOuterEdge,
    `${kind} feet clear the rail heads`,
  )
  assert.ok(
    family.support.centerX + family.support.footWidth / 2 <= sleeperHalfWidth,
    `${kind} feet remain supported by the sleeper`,
  )
  assert.equal(family.support.footBottomY, TRACK_SYSTEM.vertical.sleeperTop)
  assert.ok(
    Math.abs(family.colliderHalfDepth - family.support.footDepth / 2) <= 0.05,
    `${kind} longitudinal collider follows the visible footprint`,
  )
  assert.ok(family.stripeCount <= 4, `${kind} warning pattern stays broad at distance`)
}

assert.equal(HAZARD_VISUAL_FAMILIES.jump.openingHeight, 0)
assert.ok(HAZARD_VISUAL_FAMILIES.slide.openingHeight >= 1.65)
assert.ok(
  HAZARD_VISUAL_FAMILIES.slide.panel.centerY -
    HAZARD_VISUAL_FAMILIES.slide.panel.height / 2 >=
    HAZARD_VISUAL_FAMILIES.slide.openingHeight,
  'slide family preserves a readable lower opening',
)
assert.notEqual(
  HAZARD_VISUAL_FAMILIES.jump.panel.centerY,
  HAZARD_VISUAL_FAMILIES.slide.panel.centerY,
  'movement requirements do not share one scaled silhouette',
)

console.log('hazardVisualModel: family, lane, support, opening, and collider checks passed')
