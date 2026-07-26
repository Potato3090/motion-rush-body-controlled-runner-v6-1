export const JUMP_INITIAL_VELOCITY = 11.6
export const JUMP_ASCENT_GRAVITY = 34.5
export const JUMP_DESCENT_GRAVITY = 45
export const MAX_FALL_SPEED = 16.5
export const JUMP_CLEARANCE_HEIGHT = 1
export const TAKEOFF_POSE_DURATION = 0.08
export const LANDING_SQUASH_DURATION = 0.075
export const LANDING_RECOVERY_DURATION = 0.135
export const LANDING_TOTAL_DURATION = LANDING_SQUASH_DURATION + LANDING_RECOVERY_DURATION

const MAX_PHYSICS_STEP = 1 / 120

export type JumpPhase = 'grounded' | 'takeoff' | 'rising' | 'apex' | 'falling'

export interface JumpMotionState {
  /** World-space height of the runner's feet at the instant of takeoff. */
  takeoffHeight: number
  /** Vertical displacement from takeoffHeight. */
  height: number
  velocity: number
  airborne: boolean
  elapsed: number
}

export interface JumpRequestResult {
  state: JumpMotionState
  started: boolean
}

export interface JumpStepResult {
  state: JumpMotionState
  landed: boolean
}

export function createGroundedJumpMotion(): JumpMotionState {
  return { takeoffHeight: 0, height: 0, velocity: 0, airborne: false, elapsed: 0 }
}

export function tryStartJump(state: JumpMotionState, takeoffHeight = 0): JumpRequestResult {
  if (state.airborne) return { state, started: false }
  return {
    state: {
      takeoffHeight: Number.isFinite(takeoffHeight) ? takeoffHeight : 0,
      height: 0,
      velocity: JUMP_INITIAL_VELOCITY,
      airborne: true,
      elapsed: 0,
    },
    started: true,
  }
}

/**
 * Advances the independent game jump using small fixed substeps. The bounded
 * substeps keep the arc stable across 30/60/120 FPS and short frame stalls.
 */
export function stepJumpMotion(
  state: JumpMotionState,
  deltaSeconds: number,
  landingSurfaceHeight = 0,
): JumpStepResult {
  if (!state.airborne || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return { state, landed: false }
  }

  let height = state.height
  let velocity = state.velocity
  let elapsed = state.elapsed
  let remaining = Math.min(deltaSeconds, 0.05)
  const safeLandingSurfaceHeight = Number.isFinite(landingSurfaceHeight)
    ? landingSurfaceHeight
    : 0

  while (remaining > 0) {
    const step = Math.min(MAX_PHYSICS_STEP, remaining)
    const gravity = velocity > 0 ? JUMP_ASCENT_GRAVITY : JUMP_DESCENT_GRAVITY
    const nextVelocity = Math.max(-MAX_FALL_SPEED, velocity - gravity * step)
    const previousWorldHeight = state.takeoffHeight + height
    const nextHeight = height + (velocity + nextVelocity) * 0.5 * step
    const nextWorldHeight = state.takeoffHeight + nextHeight
    height = nextHeight
    velocity = nextVelocity
    elapsed += step
    remaining -= step

    if (
      velocity < 0 &&
      previousWorldHeight >= safeLandingSurfaceHeight &&
      nextWorldHeight <= safeLandingSurfaceHeight
    ) {
      return { state: createGroundedJumpMotion(), landed: true }
    }
  }

  return {
    state: { takeoffHeight: state.takeoffHeight, height, velocity, airborne: true, elapsed },
    landed: false,
  }
}

export function getJumpPhase(state: JumpMotionState): JumpPhase {
  if (!state.airborne) return 'grounded'
  if (state.elapsed <= TAKEOFF_POSE_DURATION) return 'takeoff'
  if (state.velocity > 1.8) return 'rising'
  if (state.velocity >= -2.3) return 'apex'
  return 'falling'
}

export function getLandingCompression(landingElapsed: number): number {
  if (!Number.isFinite(landingElapsed) || landingElapsed < 0 || landingElapsed >= LANDING_TOTAL_DURATION) {
    return 0
  }
  if (landingElapsed < LANDING_SQUASH_DURATION) {
    const progress = landingElapsed / LANDING_SQUASH_DURATION
    return Math.sin(progress * Math.PI * 0.5)
  }
  const recovery = (landingElapsed - LANDING_SQUASH_DURATION) / LANDING_RECOVERY_DURATION
  return Math.max(0, (1 - recovery) ** 2)
}
