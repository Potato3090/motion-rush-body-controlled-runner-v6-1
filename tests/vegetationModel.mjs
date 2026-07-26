import assert from 'node:assert/strict'
import {
  TREE_FAMILIES,
  TREE_SIZES,
  SHRUB_FAMILIES,
  compositionHasTree,
  getPlantingLayout,
} from '../.control-test-build/vegetationModel.js'

assert.equal(Object.keys(TREE_FAMILIES).length, 5)
assert.equal(Object.keys(TREE_SIZES).length, 3)
assert.equal(Object.keys(SHRUB_FAMILIES).length, 3)
assert.ok(TREE_FAMILIES.rounded.masses.length >= 3)
assert.ok(TREE_FAMILIES.upright.masses.length >= 3)
assert.ok(TREE_FAMILIES.spreading.masses.length >= 3)
for (const family of Object.values(TREE_FAMILIES)) {
  assert.ok(family.masses.length >= 4, `${family.id} keeps a layered, non-single-ball silhouette`)
  assert.ok(
    Math.max(...family.masses.map((mass) => Math.abs(mass.offset[0]))) >= 0.5,
    `${family.id} breaks up its crown laterally`,
  )
}
for (const size of Object.values(TREE_SIZES)) {
  assert.ok(size.trunkRadiusBottom / size.canopyRadius >= 0.28, `${size.id} keeps a readable trunk/crown ratio`)
}

const layouts = Array.from({ length: 24 }, (_, index) => (
  getPlantingLayout(index, index % 3 === 0 ? -1 : 1, index % 8 === 5)
))
assert.ok(new Set(layouts.map((layout) => layout.composition)).size >= 4)
assert.ok(new Set(layouts.filter((layout) => compositionHasTree(layout.composition)).map((layout) => layout.treeFamily)).size >= 3)
assert.ok(layouts.filter((layout) => layout.flowering).length <= 2)
for (const index of [5, 13, 21]) assert.equal(compositionHasTree(layouts[index].composition), false)
for (const layout of layouts) assert.equal(layout.side === -1 || layout.side === 1, true)

console.log('vegetationModel: planting families, rarity, and bridge clearance passed')
