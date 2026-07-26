import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import {
  EDGE_STANDARDS,
  resolveEdgeRadius,
} from '../.control-test-build/geometryQualityModel.js'
import { GeometryQualityFactory } from '../.control-test-build/geometryQuality.js'

assert.equal(Object.keys(EDGE_STANDARDS).length, 10)
assert.equal(EDGE_STANDARDS.largeArchitectural.segments, 1)
assert.equal(EDGE_STANDARDS.intentionalHard.segments, 0)
assert.equal(resolveEdgeRadius([6, 12, 7], 'largeArchitectural', 'far'), 0)
assert.equal(resolveEdgeRadius([3, 1.2, 10], 'vehicleBody', 'near'), 0.024)
assert.ok(Math.abs(
  resolveEdgeRadius([2.92, 0.18, 10], 'vehicleBody', 'near', 2.92) - 0.0396,
) < 1e-9)

const factory = new GeometryQualityFactory()
const chamferedBox = factory.box(6, 8, 7, 'largeArchitectural')
const repeatedBox = factory.box(6, 8, 7, 'largeArchitectural')
const chamferedPrism = factory.prism(3, 0.2, 0.6, 'x', 'plasticComposite')
const topChamferedPrism = factory.topPrism(3, 0.2, 0.6, 'x', 'plasticComposite')
const openTopChamferedPrism = factory.openTopPrism(3, 0.2, 0.6, 'x', 'plasticComposite')

assert.notEqual(chamferedBox, repeatedBox)
assert.equal(chamferedBox.getAttribute('position').count / 3, 44)
assert.equal(chamferedPrism.getAttribute('position').count / 3, 28)
assert.equal(topChamferedPrism.getAttribute('position').count / 3, 20)
assert.equal(openTopChamferedPrism.getAttribute('position').count / 3, 12)
assert.deepEqual(factory.getStats(), { templates: 4, vertices: 312, triangles: 104 })

for (const geometry of [
  chamferedBox,
  chamferedPrism,
  topChamferedPrism,
  openTopChamferedPrism,
]) {
  geometry.computeBoundingBox()
  assert.ok(geometry.boundingBox)
  const center = geometry.boundingBox.getCenter(new Vector3())
  assert.deepEqual([center.x, center.y, center.z], [0, 0, 0])
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  for (let index = 0; index < positions.count; index += 1) {
    const outwardDot = positions.getX(index) * normals.getX(index) +
      positions.getY(index) * normals.getY(index) +
      positions.getZ(index) * normals.getZ(index)
    assert.ok(outwardDot > 0, `normal ${index} must face away from the local origin`)
  }
}

assert.deepEqual(chamferedBox.boundingBox.min.toArray(), [-3, -4, -3.5])
assert.deepEqual(chamferedBox.boundingBox.max.toArray(), [3, 4, 3.5])
const assertVectorNear = (actual, expected) => actual.forEach((value, index) => (
  assert.ok(Math.abs(value - expected[index]) < 1e-6)
))
assertVectorNear(chamferedPrism.boundingBox.min.toArray(), [-1.5, -0.1, -0.3])
assertVectorNear(chamferedPrism.boundingBox.max.toArray(), [1.5, 0.1, 0.3])

factory.dispose()
assert.deepEqual(factory.getStats(), { templates: 0, vertices: 0, triangles: 0 })

console.log('geometry quality model tests passed')
