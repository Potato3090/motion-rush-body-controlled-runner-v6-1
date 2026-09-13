import type { ControlMode, GameStatus } from './types'

export type CameraViewMode = 'third-person' | 'runner-pov'

export const DEFAULT_CAMERA_VIEW_MODE: CameraViewMode = 'third-person'
export const DEFAULT_SHOW_BODY_TRACKING = false

export function resolveCameraViewMode(
  controlMode: ControlMode,
  selectedMode: CameraViewMode,
): CameraViewMode {
  return controlMode === 'camera' ? selectedMode : DEFAULT_CAMERA_VIEW_MODE
}

export function isCameraDockVisible(
  status: GameStatus,
  controlMode: ControlMode,
  cameraIsOn: boolean,
  showBodyTracking: boolean,
) {
  if (status === 'menu') return controlMode === 'camera' || cameraIsOn
  if (status === 'countdown' || status === 'playing' || status === 'paused') {
    return controlMode === 'camera' && cameraIsOn && showBodyTracking
  }
  return false
}
