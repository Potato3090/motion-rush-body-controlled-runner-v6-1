import assert from 'node:assert/strict'
import {
  TRAIN_FRONT_SYSTEM,
  getTrainBogieCenters,
  getTrainDirectionYaw,
  getTrainFrontFamily,
  getTrainWheelPlacements,
} from '../.control-test-build/trainFrontModel.js'
import {
  TrainComponentGeometryCache,
  createSectionedFrontShellGeometry,
} from '../.control-test-build/trainFrontGeometry.js'
import { getRailCenterlines } from '../.control-test-build/trackSystemModel.js'

const near = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`)
}

assert.equal(getTrainFrontFamily(0), 'squared-metro')
assert.equal(getTrainFrontFamily(1), 'rounded-commuter')
assert.equal(getTrainFrontFamily(2), 'squared-metro')
assert.equal(getTrainFrontFamily(3), 'rounded-commuter')
assert.equal(getTrainFrontFamily(-1), 'rounded-commuter')

assert.equal(getTrainDirectionYaw(1), 0)
assert.equal(getTrainDirectionYaw(-1), Math.PI)
assert.ok(TRAIN_FRONT_SYSTEM.maxForwardProjection <= 0.36)
assert.ok(TRAIN_FRONT_SYSTEM.rearProjection <= 0.07)
assert.ok(
  TRAIN_FRONT_SYSTEM.windshield['rounded-commuter'].glassWidthScale >= 0.65 &&
  TRAIN_FRONT_SYSTEM.windshield['rounded-commuter'].glassWidthScale <= 0.78,
)
assert.ok(TRAIN_FRONT_SYSTEM.windshield['rounded-commuter'].glassHeightScale >= 0.48)
assert.ok(TRAIN_FRONT_SYSTEM.windshield['rounded-commuter'].rake < 0)
assert.ok(TRAIN_FRONT_SYSTEM.windshield['squared-metro'].maskHeightScale >= 0.7)
assert.ok(TRAIN_FRONT_SYSTEM.windshield['squared-metro'].rake < 0)
assert.ok(
  TRAIN_FRONT_SYSTEM.shell['rounded-commuter'].frontTopWidthScale <
    TRAIN_FRONT_SYSTEM.shell['rounded-commuter'].frontBottomWidthScale,
)

const railCenters = getRailCenterlines(0)
for (const length of [6.1, 34]) {
  const bogies = getTrainBogieCenters(length)
  assert.equal(bogies.length, 2)
  assert.ok(bogies[0] < 0 && bogies[1] > 0)
  assert.ok(Math.abs(bogies[0]) < length / 2)
  assert.ok(Math.abs(bogies[1]) < length / 2)

  const wheels = getTrainWheelPlacements(length)
  assert.equal(wheels.length, 4)
  assert.deepEqual([...new Set(wheels.map(({ x }) => x))], [...railCenters])
  for (const wheel of wheels) {
    near(
      wheel.y - TRAIN_FRONT_SYSTEM.runningGear.wheelRadius,
      TRAIN_FRONT_SYSTEM.runningGear.railHeadTop -
        TRAIN_FRONT_SYSTEM.runningGear.wheelRailOverlap,
    )
  }
}

const shell = createSectionedFrontShellGeometry({
  backWidth: 2.62,
  frontBottomWidth: 2.38,
  frontTopWidth: 1.91,
  height: 2.64,
  depth: 0.36,
  cornerCut: 0.29,
  topRake: 0.12,
})
shell.computeBoundingBox()
near(shell.boundingBox.max.x - shell.boundingBox.min.x, 2.62)
near(shell.boundingBox.max.y - shell.boundingBox.min.y, 2.64, 1e-5)
assert.ok(shell.boundingBox.max.z <= 0.181)
for (let index = 0; index < shell.getAttribute('normal').count; index += 1) {
  const nx = shell.getAttribute('normal').getX(index)
  const ny = shell.getAttribute('normal').getY(index)
  const nz = shell.getAttribute('normal').getZ(index)
  assert.ok(Number.isFinite(nx + ny + nz))
  assert.ok(nx * nx + ny * ny + nz * nz > 0.25)
}

const cache = new TrainComponentGeometryCache()
const cachedA = cache.clone('shell', () => shell)
const cachedB = cache.clone('shell', () => shell)
assert.notEqual(cachedA, cachedB)
assert.equal(cache.getStats().templates, 1)
cachedA.dispose()
cachedB.dispose()
cache.dispose()

console.log('Train front model: all Stage 14R acceptance checks passed.')
