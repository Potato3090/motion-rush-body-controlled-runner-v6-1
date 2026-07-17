import assert from 'node:assert/strict'
import {
  JUMP_ASCENT_GRAVITY,
  JUMP_CLEARANCE_HEIGHT,
  JUMP_DESCENT_GRAVITY,
  JUMP_INITIAL_VELOCITY,
  LANDING_RECOVERY_DURATION,
  LANDING_SQUASH_DURATION,
  LANDING_TOTAL_DURATION,
  MAX_FALL_SPEED,
  createGroundedJumpMotion,
  getJumpPhase,
  getLandingCompression,
  stepJumpMotion,
  tryStartJump,
} from '../.control-test-build/jumpMotion.js'

function simulateJump(fps) {
  const delta = 1 / fps
  let state = tryStartJump(createGroundedJumpMotion()).state
  let elapsed = 0
  let maxHeight = 0
  let apexTime = 0
  let safeTime = 0
  let maxFallSpeed = 0
  let sawTakeoff = false
  let sawRising = false
  let sawApex = false
  let sawFalling = false

  while (state.airborne && elapsed < 2) {
    const phase = getJumpPhase(state)
    sawTakeoff ||= phase === 'takeoff'
    sawRising ||= phase === 'rising'
    sawApex ||= phase === 'apex'
    sawFalling ||= phase === 'falling'
    if (state.height > maxHeight) {
      maxHeight = state.height
      apexTime = elapsed
    }
    if (state.height > JUMP_CLEARANCE_HEIGHT) safeTime += delta
    maxFallSpeed = Math.max(maxFallSpeed, -state.velocity)
    state = stepJumpMotion(state, delta).state
    elapsed += delta
  }

  return {
    fps,
    apexTime,
    maxHeight,
    airtime: elapsed,
    safeTime,
    maxFallSpeed,
    phases: { sawTakeoff, sawRising, sawApex, sawFalling },
  }
}

assert.equal(JUMP_INITIAL_VELOCITY, 11.6)
assert.equal(JUMP_ASCENT_GRAVITY, 34.5)
assert.equal(JUMP_DESCENT_GRAVITY, 45)
assert.ok(JUMP_DESCENT_GRAVITY > JUMP_ASCENT_GRAVITY, 'descent must be more forceful than ascent')

const grounded = createGroundedJumpMotion()
const firstRequest = tryStartJump(grounded)
assert.equal(firstRequest.started, true)
const repeatedRequest = tryStartJump(firstRequest.state)
assert.equal(repeatedRequest.started, false, 'an airborne jump cannot restart')
assert.deepEqual(repeatedRequest.state, firstRequest.state)

const simulations = [30, 60, 120].map(simulateJump)
for (const simulation of simulations) {
  assert.ok(simulation.apexTime >= 0.31 && simulation.apexTime <= 0.37, `apex timing at ${simulation.fps} FPS`)
  assert.ok(simulation.maxHeight >= 1.88 && simulation.maxHeight <= 2.02, `peak height at ${simulation.fps} FPS`)
  assert.ok(simulation.airtime >= 0.6 && simulation.airtime <= 0.68, `airtime at ${simulation.fps} FPS`)
  assert.ok(simulation.safeTime >= 0.4, `obstacle-clearance window at ${simulation.fps} FPS`)
  assert.ok(simulation.maxFallSpeed <= MAX_FALL_SPEED + 1e-9)
  assert.deepEqual(simulation.phases, {
    sawTakeoff: true,
    sawRising: true,
    sawApex: true,
    sawFalling: true,
  })
}
assert.ok(Math.max(...simulations.map((item) => item.maxHeight)) - Math.min(...simulations.map((item) => item.maxHeight)) < 0.02)
assert.ok(Math.max(...simulations.map((item) => item.airtime)) - Math.min(...simulations.map((item) => item.airtime)) < 0.04)

let landedState = firstRequest.state
while (landedState.airborne) landedState = stepJumpMotion(landedState, 1 / 60).state
assert.equal(tryStartJump(landedState).started, true, 'landing must allow a new jump')

assert.equal(getLandingCompression(-0.01), 0)
assert.ok(getLandingCompression(LANDING_SQUASH_DURATION * 0.9) > 0.9)
assert.ok(getLandingCompression(LANDING_SQUASH_DURATION + LANDING_RECOVERY_DURATION * 0.5) < 0.3)
assert.equal(getLandingCompression(LANDING_TOTAL_DURATION), 0)

console.log('Runner jump motion: all acceptance checks passed.')
console.log(JSON.stringify(simulations))
