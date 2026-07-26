import assert from 'node:assert/strict'
import {
  FACADE_FAMILIES,
  getEntranceCenter,
  getFacadeFamily,
  getRoofDetailPreset,
  getWindowGrid,
} from '../.control-test-build/buildingFacadeModel.js'

assert.deepEqual(
  Object.keys(FACADE_FAMILIES).sort(),
  ['heavy-urban', 'mixed-use', 'office', 'residential'],
)

const massingFamilies = [
  'broad-block',
  'narrow-midrise',
  'podium-block',
  'stepped-block',
  'compact-tower',
  'asymmetric-block',
]
assert.equal(new Set(massingFamilies.map(getFacadeFamily)).size, 4)

for (const family of Object.values(FACADE_FAMILIES)) {
  for (const span of [4.6, 5.2, 5.9, 6.3, 7.1]) {
    const grid = getWindowGrid(span, family)
    assert.ok(grid.columns >= family.minColumns && grid.columns <= family.maxColumns)
    assert.equal(grid.positions.length, grid.columns)
    assert.ok(grid.windowWidth >= family.minWindowWidth)
    assert.ok(grid.windowWidth <= family.maxWindowWidth)
    for (const center of grid.positions) {
      assert.ok(
        Math.abs(center) + grid.windowWidth / 2 <= span / 2 - family.cornerMargin + 1e-9,
        `${family.id} windows remain inside safe corner margins`,
      )
    }

    const entranceCenter = getEntranceCenter(span, family)
    assert.ok(Math.abs(entranceCenter) <= span / 2 - family.cornerMargin)
  }
  assert.equal(getRoofDetailPreset(family, 0, 'flat-cap'), 'none')
  assert.equal(getRoofDetailPreset(family, 1, 'angled-cap'), 'none')
  assert.equal(getRoofDetailPreset(family, 1, 'flat-cap'), family.roofDetail)
}

console.log('buildingFacadeModel: families, fitted grids, entrances, and roof presets passed')
