import assert from 'node:assert/strict'
import {
  DEFAULT_CAMERA_VIEW_MODE,
  DEFAULT_SHOW_BODY_TRACKING,
  isCameraDockVisible,
  resolveCameraViewMode,
} from '../.control-test-build/presentationSettings.js'

assert.equal(DEFAULT_CAMERA_VIEW_MODE, 'third-person')
assert.equal(DEFAULT_SHOW_BODY_TRACKING, false)

assert.equal(resolveCameraViewMode('camera', 'runner-pov'), 'runner-pov')
assert.equal(resolveCameraViewMode('touch', 'runner-pov'), 'third-person')

assert.equal(isCameraDockVisible('menu', 'camera', false, false), true)
assert.equal(isCameraDockVisible('menu', 'touch', true, false), true)
assert.equal(isCameraDockVisible('countdown', 'camera', true, true), true)
assert.equal(isCameraDockVisible('playing', 'camera', true, false), false)
assert.equal(isCameraDockVisible('playing', 'camera', true, true), true)
assert.equal(isCameraDockVisible('paused', 'camera', true, true), true)
assert.equal(isCameraDockVisible('playing', 'touch', true, true), false)
assert.equal(isCameraDockVisible('gameover', 'camera', true, true), false)

console.log('Presentation settings tests passed')
