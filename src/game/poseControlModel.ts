import type { RunnerLane } from './types'

export const POSE_TUNING = {
  laneEnter: 0.055,
  laneExit: 0.037,
} as const

export const HORIZONTAL_SENSITIVITY = {
  min: 0.5,
  max: 2,
  step: 0.05,
  default: 1,
  maxProcessedOffset: 0.1,
} as const

export function normalizeHorizontalSensitivity(value: number): number {
  if (!Number.isFinite(value)) return HORIZONTAL_SENSITIVITY.default
  const clamped = Math.max(HORIZONTAL_SENSITIVITY.min, Math.min(HORIZONTAL_SENSITIVITY.max, value))
  const stepped = Math.round(clamped / HORIZONTAL_SENSITIVITY.step) * HORIZONTAL_SENSITIVITY.step
  return Number(stepped.toFixed(2))
}

/**
 * Applies user sensitivity around the calibrated zero point and constrains the
 * shared UI/game signal to the physical tracking bar's valid range.
 */
export function applyHorizontalSensitivity(
  rawHorizontalOffset: number,
  sensitivity: number,
): number {
  const processed = rawHorizontalOffset * normalizeHorizontalSensitivity(sensitivity)
  return Math.max(
    -HORIZONTAL_SENSITIVITY.maxProcessedOffset,
    Math.min(HORIZONTAL_SENSITIVITY.maxProcessedOffset, processed),
  )
}

/**
 * Maps the current horizontal pose directly to a lane. The previous lane is
 * used only inside the narrow boundary hysteresis; it is never used as a
 * relative movement command or as a prerequisite for crossing the center.
 */
export function resolveAbsoluteLane(
  horizontalOffset: number,
  currentLane: RunnerLane,
): RunnerLane {
  if (horizontalOffset <= -POSE_TUNING.laneEnter) return 0
  if (horizontalOffset >= POSE_TUNING.laneEnter) return 2

  if (currentLane === 0 && horizontalOffset < -POSE_TUNING.laneExit) return 0
  if (currentLane === 2 && horizontalOffset > POSE_TUNING.laneExit) return 2
  return 1
}

/**
 * Adaptive EMA: steady landmarks are filtered lightly, while intentional fast
 * movement receives up to 90% of the newest frame immediately.
 */
export function adaptivePoseSmooth(
  previous: number,
  sample: number,
  deltaSeconds: number,
  options: { minAlpha: number; maxAlpha: number; fullSpeed: number; deadband: number },
): number {
  const difference = sample - previous
  if (Math.abs(difference) <= options.deadband) return previous

  const safeDelta = Math.max(1 / 120, Math.min(deltaSeconds, 0.1))
  const velocity = Math.abs(difference) / safeDelta
  const motionRatio = Math.min(1, velocity / options.fullSpeed)
  const alpha = options.minAlpha + (options.maxAlpha - options.minAlpha) * motionRatio
  return previous + difference * alpha
}
