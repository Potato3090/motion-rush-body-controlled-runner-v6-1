import assert from 'node:assert/strict'
import {
  PLAYER_CHARACTER,
  damp,
  getCharacterPose,
  getJumpShadowHeightRatio,
  getRunCyclePhase,
} from '../.control-test-build/playerCharacterModel.js'

assert.equal(PLAYER_CHARACTER.visualHeight, PLAYER_CHARACTER.authoredHeight * PLAYER_CHARACTER.visualScale)
assert.deepEqual(
  [0.1, 1.7, 3.3, 4.9].map(getRunCyclePhase),
  ['contact', 'down', 'passing', 'flight'],
)

const base = {
  elapsed: 0.1,
  speed: 19,
  crouch: 0,
  airborne: false,
  jumpVelocity: 0,
  landing: 0,
  laneLean: 0,
  rampLean: 0,
}
const run = getCharacterPose(base)
assert.ok(Math.sign(run.leftArm) === -Math.sign(run.leftHip), 'arms oppose the same-side leg')
assert.ok(Math.sign(run.rightArm) === -Math.sign(run.rightHip), 'arms oppose the same-side leg')
assert.ok(run.leftKnee >= 0 && run.rightKnee >= 0, 'knees only flex anatomically')

const crouch = getCharacterPose({ ...base, crouch: 1 })
assert.ok(crouch.pelvisY < run.pelvisY - 0.8)
assert.ok(crouch.leftKnee > run.leftKnee + 0.8)
assert.ok(crouch.torsoPitch > run.torsoPitch + 0.65)
assert.ok(crouch.headPitch > run.headPitch, 'the head folds with the torso instead of cancelling its crouch')

const jump = getCharacterPose({ ...base, airborne: true, jumpVelocity: 6 })
assert.ok(jump.leftKnee > 0.8 && jump.rightKnee > 0.6)
assert.ok(jump.leftArm < -0.7 && jump.rightArm < -0.5)

const landing = getCharacterPose({ ...base, landing: 1 })
assert.ok(landing.pelvisY < run.pelvisY - 0.1)
assert.ok(landing.leftKnee > run.leftKnee + 0.4)

const reused = getCharacterPose(base)
assert.equal(getCharacterPose({ ...base, laneLean: 1 }, reused), reused, 'pose output is reusable')
assert.ok(reused.torsoRoll < -0.15, 'lane switching produces a bounded cosmetic lean')

let at30 = 0
for (let index = 0; index < 30; index += 1) at30 = damp(at30, 1, 20, 1 / 30)
let at60 = 0
for (let index = 0; index < 60; index += 1) at60 = damp(at60, 1, 20, 1 / 60)
assert.ok(Math.abs(at30 - at60) < 1e-9, 'exponential blends agree at 30 and 60 FPS')
assert.ok(damp(0, 1, 20, 1) < 0.64, 'resume spikes are capped to the maximum frame delta')
assert.equal(getJumpShadowHeightRatio(-0.5), 0, 'sub-surface displacement cannot enlarge the contact shadow')
assert.equal(getJumpShadowHeightRatio(Number.NaN), 0, 'invalid displacement cannot corrupt the contact shadow')
assert.equal(getJumpShadowHeightRatio(4), 1)

let releasedCrouch = 1
for (let index = 0; index < 30; index += 1) {
  releasedCrouch = damp(releasedCrouch, 0, PLAYER_CHARACTER.crouchBlendRate, 1 / 60)
}
assert.ok(releasedCrouch < 0.00001, 'the avatar smoothly returns to its standing pose after crouch release')
const releasedPose = getCharacterPose({ ...base, crouch: releasedCrouch })
assert.ok(Math.abs(releasedPose.pelvisY - run.pelvisY) < 0.00001)
assert.ok(Math.abs(releasedPose.torsoPitch - run.torsoPitch) < 0.00001)

console.log('player character model tests passed')
