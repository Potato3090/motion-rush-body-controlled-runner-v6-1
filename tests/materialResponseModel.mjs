import assert from 'node:assert/strict'
import {
  MATERIAL_FAMILIES,
  MATERIAL_ENVIRONMENT_RESPONSE_MAX,
  MATERIAL_RESPONSE_ATTRIBUTE,
  getMaterialFamily,
  getMaterialResponseTuple,
} from '../.control-test-build/materialResponseModel.js'

const families = Object.values(MATERIAL_FAMILIES)

assert.equal(families.length, 20, 'Stage 11 keeps one bounded semantic family registry')
assert.equal(MATERIAL_RESPONSE_ATTRIBUTE, 'materialResponse')

for (const family of families) {
  assert.equal(getMaterialFamily(family.id), family)
  assert.deepEqual(getMaterialResponseTuple(family.id), [
    family.roughness,
    family.metalness,
    family.environmentResponse,
    family.emissiveIntensity,
  ])
  assert.ok(family.roughness >= 0.12 && family.roughness <= 1)
  assert.ok(family.metalness >= 0 && family.metalness <= 1)
  assert.ok(
    family.environmentResponse >= 0 &&
      family.environmentResponse <= MATERIAL_ENVIRONMENT_RESPONSE_MAX,
  )
  assert.ok(family.emissiveIntensity >= 0 && family.emissiveIntensity <= 0.35)
}

assert.equal(MATERIAL_FAMILIES.stylizedGlass.tier, 1)
assert.equal(MATERIAL_FAMILIES.stylizedGlass.roughness, 0.18)
assert.equal(MATERIAL_FAMILIES.stylizedGlass.metalness, 0.08)
assert.ok(
  MATERIAL_FAMILIES.stylizedGlass.environmentResponse >
    MATERIAL_FAMILIES.paintedMetal.environmentResponse,
)

assert.equal(MATERIAL_FAMILIES.bareMetal.tier, 1)
assert.ok(MATERIAL_FAMILIES.bareMetal.metalness >= 0.75)
assert.ok(MATERIAL_FAMILIES.bareMetal.roughness >= 0.22)
assert.ok(MATERIAL_FAMILIES.bareMetal.roughness <= 0.48)

for (const id of ['rawConcrete', 'asphalt', 'trackBed', 'wood', 'rubber', 'foliage']) {
  assert.equal(MATERIAL_FAMILIES[id].metalness, 0)
  assert.ok(MATERIAL_FAMILIES[id].roughness >= 0.65)
  assert.equal(MATERIAL_FAMILIES[id].tier, 4)
}

assert.ok(MATERIAL_FAMILIES.rawConcrete.roughness > MATERIAL_FAMILIES.paintedPlaster.roughness)
assert.ok(MATERIAL_FAMILIES.paintedPlaster.roughness > MATERIAL_FAMILIES.paintedMetal.roughness)
assert.ok(MATERIAL_FAMILIES.rubber.roughness > MATERIAL_FAMILIES.hardPlastic.roughness)
assert.ok(MATERIAL_FAMILIES.foliage.roughness > MATERIAL_FAMILIES.paintedComposite.roughness)
assert.ok(MATERIAL_FAMILIES.rewardMetal.metalness >= 0.6)
assert.ok(MATERIAL_FAMILIES.rewardMetal.emissiveIntensity <= 0.05)

console.log('material response model tests passed')
