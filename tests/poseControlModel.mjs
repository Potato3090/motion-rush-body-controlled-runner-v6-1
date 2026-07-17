import assert from 'node:assert/strict'
import {
  HORIZONTAL_SENSITIVITY,
  adaptivePoseSmooth,
  applyHorizontalSensitivity,
  normalizeHorizontalSensitivity,
  resolveAbsoluteLane,
} from '../.control-test-build/poseControlModel.js'
import {
  VERTICAL_INTENT_TUNING,
  createVerticalIntentState,
  normalizeVerticalDisplacement,
  sanitizeTorsoSize,
  updateVerticalIntent,
} from '../.control-test-build/verticalIntentModel.js'

// Fine-step sensitivity, clamping, center preservation, and shared processed
// signal behavior for both the tracking dot and absolute lane model.
assert.equal(normalizeHorizontalSensitivity(0.9), 0.9)
assert.equal(normalizeHorizontalSensitivity(1.1), 1.1)
assert.equal(normalizeHorizontalSensitivity(1.35), 1.35)
assert.equal(normalizeHorizontalSensitivity(1.95), 1.95)
assert.equal(normalizeHorizontalSensitivity(0.1), HORIZONTAL_SENSITIVITY.min)
assert.equal(normalizeHorizontalSensitivity(4), HORIZONTAL_SENSITIVITY.max)
assert.equal(applyHorizontalSensitivity(0, 2), 0)
assert.equal(applyHorizontalSensitivity(0.04, 0.5), 0.02)
assert.equal(applyHorizontalSensitivity(0.04, 1), 0.04)
assert.equal(applyHorizontalSensitivity(0.04, 2), 0.08)
assert.equal(applyHorizontalSensitivity(0.2, 2), HORIZONTAL_SENSITIVITY.maxProcessedOffset)
assert.equal(applyHorizontalSensitivity(-0.2, 2), -HORIZONTAL_SENSITIVITY.maxProcessedOffset)
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(0.04, 0.5), 1), 1)
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(0.04, 2), 1), 2)
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(0.12, 0.5), 1), 2, 'minimum sensitivity must still reach the right lane')
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(-0.12, 0.5), 1), 0, 'minimum sensitivity must still reach the left lane')
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(-0.04, 2), 2), 0)
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(0.02, 2), 1), 1, 'high-sensitivity jitter must stay inside the center zone')

// The local persistence adapter restores saved fine-step values and normalizes
// invalid/out-of-range storage without affecting runtime availability.
const fakeStorage = new Map()
globalThis.localStorage = {
  getItem: (key) => fakeStorage.has(key) ? fakeStorage.get(key) : null,
  setItem: (key, value) => fakeStorage.set(key, String(value)),
}
const {
  HORIZONTAL_SENSITIVITY_STORAGE_KEY,
  loadHorizontalSensitivity,
  saveHorizontalSensitivity,
} = await import('../.control-test-build/settings.js')
assert.equal(loadHorizontalSensitivity(), 1)
assert.equal(saveHorizontalSensitivity(1.35), 1.35)
assert.equal(fakeStorage.get(HORIZONTAL_SENSITIVITY_STORAGE_KEY), '1.35')
assert.equal(loadHorizontalSensitivity(), 1.35)
fakeStorage.set(HORIZONTAL_SENSITIVITY_STORAGE_KEY, '99')
assert.equal(loadHorizontalSensitivity(), 2)
delete globalThis.localStorage

// Absolute lane selection, including direct opposite-side retargeting.
assert.equal(resolveAbsoluteLane(0, 1), 1)
assert.equal(resolveAbsoluteLane(0.056, 1), 2)
assert.equal(resolveAbsoluteLane(-0.08, 2), 0)
assert.equal(resolveAbsoluteLane(0.08, 0), 2)

// Narrow hysteresis holds a lane at its edge but releases promptly to center.
assert.equal(resolveAbsoluteLane(0.04, 2), 2)
assert.equal(resolveAbsoluteLane(0.036, 2), 1)
assert.equal(resolveAbsoluteLane(-0.04, 0), 0)
assert.equal(resolveAbsoluteLane(-0.036, 0), 1)

// Fast intentional movement receives the newest frame almost immediately.
const fastMove = adaptivePoseSmooth(0, 0.09, 1 / 30, {
  minAlpha: 0.46,
  maxAlpha: 0.9,
  fullSpeed: 0.72,
  deadband: 0.0014,
})
assert.ok(fastMove > 0.055, 'intentional movement should cross the lane threshold in one frame')
assert.equal(adaptivePoseSmooth(0, 0.001, 1 / 30, {
  minAlpha: 0.46,
  maxAlpha: 0.9,
  fullSpeed: 0.72,
  deadband: 0.0014,
}), 0, 'sub-deadband jitter should be ignored')

function createVerticalDriver(frameMs = 1000 / 30) {
  let now = 0
  let state = createVerticalIntentState(now)
  const events = { jumps: 0, crouchStarts: 0, crouchEnds: 0, phases: [], crouching: [] }
  return {
    events,
    feed(values) {
      for (const value of values) {
        now += frameMs
        const next = updateVerticalIntent(value, now, state)
        state = next.state
        if (next.jumpTriggered) events.jumps += 1
        if (next.crouchStarted) events.crouchStarts += 1
        if (next.crouchEnded) events.crouchEnds += 1
        events.phases.push(next.state.phase)
        events.crouching.push(next.crouching)
      }
      return state
    },
    get state() { return state },
  }
}

function sampleKeyframes(keyframes, fps) {
  const frameMs = 1000 / fps
  const values = []
  const end = keyframes[keyframes.length - 1][0]
  for (let time = 0; time <= end + 0.001; time += frameMs) {
    let segment = 0
    while (segment < keyframes.length - 2 && time > keyframes[segment + 1][0]) segment += 1
    const [startTime, startValue] = keyframes[segment]
    const [endTime, endValue] = keyframes[segment + 1]
    const progress = Math.max(0, Math.min(1, (time - startTime) / Math.max(1, endTime - startTime)))
    values.push(startValue + (endValue - startValue) * progress)
  }
  return values
}

// Torso normalization produces the same intent displacement at different
// calibrated camera distances and safely rejects invalid measurements.
assert.equal(sanitizeTorsoSize(0), VERTICAL_INTENT_TUNING.torsoFallback)
assert.equal(sanitizeTorsoSize(Number.NaN), VERTICAL_INTENT_TUNING.torsoFallback)
assert.equal(sanitizeTorsoSize(0.9), VERTICAL_INTENT_TUNING.torsoMaximum)
assert.ok(Math.abs(normalizeVerticalDisplacement(0.064, 0.2) - 0.32) < 1e-9)
assert.ok(Math.abs(normalizeVerticalDisplacement(0.096, 0.3) - 0.32) < 1e-9)

// 1. A shallow preparatory dip followed by a fast rise becomes exactly one
// jump, passes through jumpPreparation, and never emits crouch.
const preparatoryJump = createVerticalDriver()
preparatoryJump.feed([0, 0.06, 0.12, 0.19, 0.17, 0.09, -0.05, -0.16, -0.2])
assert.equal(preparatoryJump.events.jumps, 1)
assert.equal(preparatoryJump.events.crouchStarts, 0)
assert.ok(preparatoryJump.events.phases.includes('jumpPreparation'))

// 2. A shallow dip that merely returns to neutral produces no action.
const accidentalDip = createVerticalDriver()
accidentalDip.feed([0, 0.05, 0.12, 0.15, 0.11, 0.06, 0.02, 0, 0])
assert.equal(accidentalDip.events.jumps, 0)
assert.equal(accidentalDip.events.crouchStarts, 0)

// 3. A deep, sustained dip confirms one held crouch, then exits and rearms
// only after the player returns close to neutral.
const deliberateCrouch = createVerticalDriver()
deliberateCrouch.feed([0, 0.1, 0.22, 0.35, 0.39, 0.39, 0.39, 0.39, 0.39, 0.39])
assert.equal(deliberateCrouch.events.crouchStarts, 1)
assert.equal(deliberateCrouch.events.jumps, 0)
assert.equal(deliberateCrouch.state.phase, 'crouched')
deliberateCrouch.feed(Array(60).fill(0.4))
assert.equal(deliberateCrouch.events.crouchStarts, 1, 'holding must not repeat crouch')
deliberateCrouch.feed([0.27, 0.14, 0.07, 0.04, 0, 0])
assert.equal(deliberateCrouch.events.crouchEnds, 1)
assert.equal(deliberateCrouch.state.phase, 'neutral')

// 4. A direct fast upward takeoff works without requiring a preparatory dip.
const directJump = createVerticalDriver()
directJump.feed([0, -0.05, -0.15, -0.24])
assert.equal(directJump.events.jumps, 1)

// 5. Landmark-sized threshold noise never leaves neutral or emits actions.
const noise = createVerticalDriver()
noise.feed(Array.from({ length: 120 }, (_, index) => [0.035, -0.028, 0.018, -0.012][index % 4]))
assert.equal(noise.events.jumps, 0)
assert.equal(noise.events.crouchStarts, 0)
assert.equal(noise.state.phase, 'neutral')

// 6/7. One physical jump cannot retrigger while locked; neutral recovery rearms
// a later real jump.
const jumpRearm = createVerticalDriver()
jumpRearm.feed([0, -0.06, -0.16, -0.24, -0.22, -0.18, -0.24])
assert.equal(jumpRearm.events.jumps, 1)
jumpRearm.feed(Array(12).fill(0))
jumpRearm.feed([-0.05, -0.16, -0.24])
assert.equal(jumpRearm.events.jumps, 2)

// 8/9. Crouch enters once per hold and can enter again only after a full
// neutral rearm.
const crouchRearm = createVerticalDriver()
const deepHold = [0.12, 0.24, 0.35, 0.39, 0.39, 0.39, 0.39, 0.39]
crouchRearm.feed(deepHold)
crouchRearm.feed(Array(20).fill(0.4))
assert.equal(crouchRearm.events.crouchStarts, 1)
crouchRearm.feed([0.24, 0.14, 0.07, 0.03, 0, 0, 0])
crouchRearm.feed(deepHold)
assert.equal(crouchRearm.events.crouchStarts, 2)

// Millisecond timing and velocity normalization make intent classification
// consistent across realistic camera callback rates.
for (const fps of [24, 30, 60]) {
  const frameMs = 1000 / fps
  const jumpAtRate = createVerticalDriver(frameMs)
  jumpAtRate.feed(sampleKeyframes([
    [0, 0], [90, 0.18], [145, 0.16], [220, -0.08], [280, -0.18],
  ], fps))
  assert.equal(jumpAtRate.events.jumps, 1, `preparatory jump at ${fps} FPS`)
  assert.equal(jumpAtRate.events.crouchStarts, 0, `no preparatory slide at ${fps} FPS`)

  const crouchAtRate = createVerticalDriver(frameMs)
  crouchAtRate.feed(sampleKeyframes([
    [0, 0], [120, 0.38], [320, 0.4], [430, 0.4], [540, 0.04], [680, 0],
  ], fps))
  assert.equal(crouchAtRate.events.crouchStarts, 1, `deliberate crouch at ${fps} FPS`)
  assert.equal(crouchAtRate.events.jumps, 0, `no crouch jump at ${fps} FPS`)
}

console.log('Camera control model: all acceptance checks passed.')
