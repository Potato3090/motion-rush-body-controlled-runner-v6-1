import assert from 'node:assert/strict'
import {
  RAMP_VISUAL_ANGLE_RADIANS,
  RAMP_VISUAL_SHELL,
  getRampVisualShellBounds,
  getRampVisualSurfaceHeight,
} from '../.control-test-build/rampVisualModel.js'
import {
  ROUTE_RAMP_LENGTH,
  ROUTE_ROOF_HEIGHT,
  getRouteSurfaceHeight,
} from '../.control-test-build/runnerRouteModel.js'

assert.equal(RAMP_VISUAL_SHELL.length, 4.25, 'Stage 22 preserves the approved ramp length')
assert.equal(RAMP_VISUAL_SHELL.length, ROUTE_RAMP_LENGTH)
assert.equal(RAMP_VISUAL_SHELL.roofHeight, ROUTE_ROOF_HEIGHT)
assert.equal(RAMP_VISUAL_SHELL.width, 2.58, 'the shell remains inside one traversal lane')
assert.ok(RAMP_VISUAL_SHELL.deckThickness >= 0.2, 'the deck is visibly structural')
assert.equal(RAMP_VISUAL_SHELL.chevronCount, 3, 'direction uses a small number of large cues')
assert.ok(RAMP_VISUAL_SHELL.edgeRailEndClearance > 0.3, 'edge rails clear both transitions')

const angleDegrees = RAMP_VISUAL_ANGLE_RADIANS * 180 / Math.PI
assert.ok(Math.abs(angleDegrees - 30.46554491945988) < 1e-9)

const halfLength = RAMP_VISUAL_SHELL.length / 2
for (const descending of [false, true]) {
  for (const localZ of [halfLength, halfLength / 2, 0, -halfLength / 2, -halfLength]) {
    const visualHeight = getRampVisualSurfaceHeight(localZ, descending)
    const routeHeight = descending
      ? getRouteSurfaceHeight(
          -21.125 + localZ, 19, 14.75, -19, -23.25, ROUTE_ROOF_HEIGHT,
        )
      : getRouteSurfaceHeight(
          16.875 + localZ, 19, 14.75, -19, -23.25, ROUTE_ROOF_HEIGHT,
        )
    assert.ok(
      Math.abs(visualHeight - routeHeight) < 1e-9,
      `visual top follows the ${descending ? 'descending' : 'ascending'} collider at z=${localZ}`,
    )
  }
}

const bounds = getRampVisualShellBounds()
assert.equal(bounds.minZ, -ROUTE_RAMP_LENGTH / 2)
assert.equal(bounds.maxZ, ROUTE_RAMP_LENGTH / 2)
assert.equal(bounds.maxX - bounds.minX, RAMP_VISUAL_SHELL.width)
assert.ok(bounds.minY >= 0, 'mounting geometry does not sink below the support plane')

console.log('Stage 22 ramp visual shell: all acceptance checks passed.')
