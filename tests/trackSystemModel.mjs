import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import {
  TRACK_SYSTEM,
  getRailCenterlines,
  getRailProfile,
  getSleeperPositions,
  getTrackBedProfile,
  getTrackDetailSleeperOffsets,
  getTrackDetailTileCenters,
  segmentUsesConnectionDetail,
  trackDetailIsVisible,
  trackDetailOverlapsFootprint,
} from '../.control-test-build/trackSystemModel.js'
import {
  TrackGeometryCache,
  createFastenerClipGeometry,
  createRailProfileGeometry,
  createTrackBedGeometry,
} from '../.control-test-build/trackSystemGeometry.js'

const near = (actual, expected, tolerance = 1e-9) => (
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`)
)

assert.equal(TRACK_SYSTEM.gauge, 1.66, 'the approved Stage 12 gauge stays locked')
assert.equal(TRACK_SYSTEM.segmentLength, 18)
assert.equal(TRACK_SYSTEM.segmentCount, 18)
near(TRACK_SYSTEM.rail.webWidth / TRACK_SYSTEM.rail.headWidth, 4 / 9)
near(TRACK_SYSTEM.rail.footWidth / TRACK_SYSTEM.rail.headWidth, 68 / 45)
near(TRACK_SYSTEM.rail.headWidth / 0.18, 1.25)
assert.ok(TRACK_SYSTEM.rail.headHeight / TRACK_SYSTEM.rail.totalHeight > 0.3)
assert.ok(TRACK_SYSTEM.rail.footHeight / TRACK_SYSTEM.rail.totalHeight <= 0.22)
assert.ok(TRACK_SYSTEM.plate.width / TRACK_SYSTEM.rail.footWidth >= 1.1)
assert.ok(TRACK_SYSTEM.plate.width / TRACK_SYSTEM.rail.footWidth <= 1.45)
assert.ok(TRACK_SYSTEM.plate.depth / TRACK_SYSTEM.rail.footWidth >= 1.4)
assert.ok(TRACK_SYSTEM.plate.depth / TRACK_SYSTEM.rail.footWidth <= 2.1)
assert.equal(TRACK_SYSTEM.ballast.rows * TRACK_SYSTEM.ballast.columns, 36)
assert.equal(TRACK_SYSTEM.segmentLength % TRACK_SYSTEM.ballast.tileLength, 0)

assert.equal(TRACK_SYSTEM.vertical.bedSupportTop, TRACK_SYSTEM.vertical.sleeperBottom)
assert.equal(TRACK_SYSTEM.vertical.sleeperTop, TRACK_SYSTEM.vertical.plateBottom)
assert.equal(TRACK_SYSTEM.vertical.plateTop, TRACK_SYSTEM.vertical.railFootBottom)
assert.ok(TRACK_SYSTEM.vertical.ballastBottom >= TRACK_SYSTEM.vertical.bedSupportTop - 0.01)
assert.ok(TRACK_SYSTEM.vertical.ballastTop < TRACK_SYSTEM.vertical.sleeperTop)
near(
  TRACK_SYSTEM.vertical.railFootBottom + TRACK_SYSTEM.rail.totalHeight,
  TRACK_SYSTEM.vertical.railHeadTop,
)
assert.ok(Math.abs(TRACK_SYSTEM.vertical.railHeadTop - 0.22) <= 0.01)

for (const laneCenter of [-3.15, 0, 3.15]) {
  const [left, right] = getRailCenterlines(laneCenter)
  near((left + right) / 2, laneCenter)
  near(right - left, TRACK_SYSTEM.gauge)
}

const firstSegment = getSleeperPositions(-9, 9)
const secondSegment = getSleeperPositions(9, 27)
assert.equal(firstSegment.length, 12)
assert.equal(secondSegment.length, 12)
assert.equal(firstSegment[0], -9)
assert.equal(firstSegment.at(-1), 7.5)
assert.equal(secondSegment[0], 9)
const joined = [...firstSegment, ...secondSegment]
for (let index = 1; index < joined.length; index += 1) {
  near(joined[index] - joined[index - 1], TRACK_SYSTEM.sleeper.spacing)
}
assert.equal((TRACK_SYSTEM.segmentLength * TRACK_SYSTEM.segmentCount) % TRACK_SYSTEM.sleeper.spacing, 0)

const recycledCenters = new Float64Array(TRACK_SYSTEM.segmentCount)
for (let index = 0; index < recycledCenters.length; index += 1) {
  recycledCenters[index] = -index * TRACK_SYSTEM.segmentLength + TRACK_SYSTEM.segmentLength / 2
}
const cycleLength = TRACK_SYSTEM.segmentLength * TRACK_SYSTEM.segmentCount
for (let frame = 0; frame < 25000; frame += 1) {
  const travel = (19 + (frame % 17) / 17 * 16) / 60
  for (let index = 0; index < recycledCenters.length; index += 1) {
    recycledCenters[index] += travel
    if (recycledCenters[index] > TRACK_SYSTEM.segmentLength) recycledCenters[index] -= cycleLength
  }
  if (frame % 100 !== 0) continue
  const orderedCenters = [...recycledCenters].sort((a, b) => a - b)
  for (let index = 1; index < orderedCenters.length; index += 1) {
    near(orderedCenters[index] - orderedCenters[index - 1], TRACK_SYSTEM.segmentLength, 1e-8)
  }
  const recycledSleepers = orderedCenters.flatMap((center) => (
    firstSegment.map((localZ) => center + localZ)
  )).sort((a, b) => a - b)
  for (let index = 1; index < recycledSleepers.length; index += 1) {
    near(recycledSleepers[index] - recycledSleepers[index - 1], TRACK_SYSTEM.sleeper.spacing, 1e-8)
  }
}

assert.equal(segmentUsesConnectionDetail(-99), true)
assert.equal(segmentUsesConnectionDetail(-129), false)
assert.equal(segmentUsesConnectionDetail(27), false)
assert.deepEqual(getTrackDetailTileCenters(), [-6.75, -2.25, 2.25, 6.75])
assert.deepEqual(getTrackDetailSleeperOffsets(), [-2.25, -0.75, 0.75])
assert.deepEqual(
  getTrackDetailTileCenters().flatMap((tileCenter) => (
    getTrackDetailSleeperOffsets().map((offset) => tileCenter + offset)
  )),
  firstSegment,
)
assert.equal(trackDetailIsVisible(-105, 'plate'), true)
assert.equal(trackDetailIsVisible(-114, 'plate'), false)
assert.equal(trackDetailIsVisible(-45, 'fastener'), true)
assert.equal(trackDetailIsVisible(-54, 'fastener'), false)
assert.equal(trackDetailIsVisible(-69, 'ballast'), true)
assert.equal(trackDetailIsVisible(-78, 'ballast'), false)
assert.equal(trackDetailOverlapsFootprint(0, 2.25, 3, 0.6, 0.16), true)
assert.equal(trackDetailOverlapsFootprint(0, 2.25, 3.1, 0.6, 0.16), false)

const railProfile = getRailProfile()
assert.equal(Math.max(...railProfile.map(({ x }) => x)) * 2, TRACK_SYSTEM.rail.footWidth)
assert.equal(Math.max(...railProfile.map(({ y }) => y)), TRACK_SYSTEM.rail.totalHeight)
const bedProfile = getTrackBedProfile()
assert.equal(Math.max(...bedProfile.map(({ x }) => x)), TRACK_SYSTEM.bed.halfWidth)
assert.equal(Math.max(...bedProfile.map(({ y }) => y)), TRACK_SYSTEM.vertical.bedSupportTop)
assert.equal(
  bedProfile.filter(({ y }) => y === TRACK_SYSTEM.vertical.bedSupportTop).length,
  6,
)

const railGeometry = createRailProfileGeometry()
const bedGeometry = createTrackBedGeometry()
const fastenerGeometry = createFastenerClipGeometry()
for (const geometry of [railGeometry, bedGeometry, fastenerGeometry]) {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  assert.ok(positions.count > 0)
  assert.equal(positions.count, normals.count)
  for (let index = 0; index < normals.count; index += 1) {
    const normal = new Vector3(normals.getX(index), normals.getY(index), normals.getZ(index))
    near(normal.length(), 1, 1e-6)
  }
}
for (let index = 0; index < railGeometry.getAttribute('normal').count; index += 1) {
  near(railGeometry.getAttribute('normal').getZ(index), 0)
}
assert.equal(railGeometry.getAttribute('position').count / 3, getRailProfile().length * 2)
assert.equal(bedGeometry.getAttribute('position').count / 3, getTrackBedProfile().length * 12)
assert.equal(fastenerGeometry.getAttribute('position').count / 3, 8)
assert.equal(railGeometry.boundingBox.min.z, -TRACK_SYSTEM.segmentLength / 2)
assert.equal(railGeometry.boundingBox.max.z, TRACK_SYSTEM.segmentLength / 2)
near(
  fastenerGeometry.boundingBox.max.x - fastenerGeometry.boundingBox.min.x,
  TRACK_SYSTEM.fastener.width,
  1e-6,
)
near(fastenerGeometry.boundingBox.max.y, TRACK_SYSTEM.fastener.height, 1e-6)
near(
  fastenerGeometry.boundingBox.max.z - fastenerGeometry.boundingBox.min.z,
  TRACK_SYSTEM.fastener.depth,
  1e-6,
)

const cache = new TrackGeometryCache()
const cachedRailA = cache.clone('rail', createRailProfileGeometry)
const cachedRailB = cache.clone('rail', createRailProfileGeometry)
assert.notEqual(cachedRailA, cachedRailB)
assert.deepEqual(cache.getStats(), {
  templates: 1,
  vertices: railGeometry.getAttribute('position').count,
  triangles: railGeometry.getAttribute('position').count / 3,
})
cache.dispose()
assert.deepEqual(cache.getStats(), { templates: 0, vertices: 0, triangles: 0 })

railGeometry.dispose()
bedGeometry.dispose()
fastenerGeometry.dispose()
cachedRailA.dispose()
cachedRailB.dispose()

console.log('Stage 13R track-system model tests passed.')
