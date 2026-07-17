export type VerticalIntentPhase =
  | 'neutral'
  | 'possibleCrouch'
  | 'jumpPreparation'
  | 'crouched'
  | 'crouchJumpPreparation'
  | 'postJumpCrouchPreparation'
  | 'rearming'
  | 'jumpCooldown'

export type VerticalDirection = 'up' | 'down' | 'steady'

export const VERTICAL_INTENT_TUNING = {
  torsoFallback: 0.22,
  torsoMinimum: 0.08,
  torsoMaximum: 0.55,
  neutralRearmThreshold: 0.08,
  neutralConfirmationMs: 80,
  jumpUpwardDisplacementThreshold: -0.14,
  jumpUpwardVelocityThreshold: -0.85,
  shallowPreparatoryDipMin: 0.1,
  shallowPreparatoryDipMax: 0.3,
  deliberateCrouchDepth: 0.34,
  crouchExitThreshold: 0.15,
  crouchConfirmationMs: 120,
  maximumJumpPreparationMs: 280,
  directionReversalVelocity: -0.5,
  directionReversalRise: 0.09,
  reversalJumpDisplacement: -0.04,
  jumpActionLockoutMs: 260,
  postJumpCrouchEntryThreshold: 0.14,
  postJumpCrouchMinimumDownwardVelocity: 0.45,
  postJumpCrouchConfirmationMs: 65,
  postJumpCrouchMaximumPreparationMs: 320,
  postJumpCrouchCancelThreshold: 0.1,
  crouchRearmConfirmationMs: 80,
  crouchToJumpMinimumRise: 0.22,
  crouchToJumpUpwardVelocity: -1.05,
  crouchToJumpTriggerDisplacement: -0.045,
  crouchToJumpWindowMs: 240,
  crouchToJumpCancelVelocity: -0.35,
  crouchToJumpReturnDepth: 0.18,
  velocityDeadzone: 0.16,
} as const

export interface VerticalIntentState {
  phase: VerticalIntentPhase
  previousDisplacement: number
  previousAt: number
  velocity: number
  movementStartedAt: number | null
  deepSince: number | null
  maxDownwardDepth: number
  neutralSince: number | null
  lastActionAt: number
  reversalDetected: boolean
}

export interface VerticalIntentResult {
  state: VerticalIntentState
  jumpTriggered: boolean
  crouching: boolean
  crouchStarted: boolean
  crouchEnded: boolean
  velocity: number
  direction: VerticalDirection
}

export function sanitizeTorsoSize(torsoSize: number): number {
  if (!Number.isFinite(torsoSize) || torsoSize < VERTICAL_INTENT_TUNING.torsoMinimum) {
    return VERTICAL_INTENT_TUNING.torsoFallback
  }
  return Math.min(VERTICAL_INTENT_TUNING.torsoMaximum, torsoSize)
}

export function normalizeVerticalDisplacement(
  rawShoulderDisplacement: number,
  torsoSize: number,
): number {
  if (!Number.isFinite(rawShoulderDisplacement)) return 0
  return rawShoulderDisplacement / sanitizeTorsoSize(torsoSize)
}

export function createVerticalIntentState(now = 0): VerticalIntentState {
  return {
    phase: 'neutral',
    previousDisplacement: 0,
    previousAt: now,
    velocity: 0,
    movementStartedAt: null,
    deepSince: null,
    maxDownwardDepth: 0,
    neutralSince: now,
    lastActionAt: Number.NEGATIVE_INFINITY,
    reversalDetected: false,
  }
}

function directionFromVelocity(velocity: number): VerticalDirection {
  if (velocity <= -VERTICAL_INTENT_TUNING.velocityDeadzone) return 'up'
  if (velocity >= VERTICAL_INTENT_TUNING.velocityDeadzone) return 'down'
  return 'steady'
}

function sampledState(
  state: VerticalIntentState,
  displacement: number,
  now: number,
): { state: VerticalIntentState; direction: VerticalDirection } {
  const elapsedMs = state.previousAt > 0 ? now - state.previousAt : 1000 / 30
  const deltaSeconds = Math.max(1 / 120, Math.min(0.12, elapsedMs / 1000))
  const rawVelocity = (displacement - state.previousDisplacement) / deltaSeconds
  // A single-pole velocity blend suppresses landmark spikes while retaining
  // 75% of the newest frame, so reversals remain low latency.
  const velocity = Math.max(-8, Math.min(8, state.velocity * 0.25 + rawVelocity * 0.75))
  return {
    state: {
      ...state,
      previousDisplacement: displacement,
      previousAt: now,
      velocity,
    },
    direction: directionFromVelocity(velocity),
  }
}

function result(
  state: VerticalIntentState,
  direction: VerticalDirection,
  flags: Partial<Pick<VerticalIntentResult, 'jumpTriggered' | 'crouchStarted' | 'crouchEnded'>> = {},
): VerticalIntentResult {
  return {
    state,
    jumpTriggered: flags.jumpTriggered ?? false,
    crouching: state.phase === 'crouched',
    crouchStarted: flags.crouchStarted ?? false,
    crouchEnded: flags.crouchEnded ?? false,
    velocity: state.velocity,
    direction,
  }
}

function neutralState(
  sampled: VerticalIntentState,
  now: number,
): VerticalIntentState {
  return {
    ...sampled,
    phase: 'neutral',
    movementStartedAt: null,
    deepSince: null,
    maxDownwardDepth: 0,
    neutralSince: now,
    reversalDetected: false,
  }
}

function triggerJump(
  sampled: VerticalIntentState,
  now: number,
  direction: VerticalDirection,
  flags: { crouchEnded?: boolean } = {},
): VerticalIntentResult {
  return result({
    ...sampled,
    phase: 'jumpCooldown',
    movementStartedAt: null,
    deepSince: null,
    maxDownwardDepth: 0,
    neutralSince: null,
    lastActionAt: now,
    reversalDetected: true,
  }, direction, { jumpTriggered: true, crouchEnded: flags.crouchEnded })
}

/**
 * Classifies one torso-normalized shoulder sample. Image Y grows downward, so
 * positive displacement/velocity means moving down and negative means up.
 */
export function updateVerticalIntent(
  normalizedDisplacement: number,
  now: number,
  currentState: VerticalIntentState,
): VerticalIntentResult {
  const displacement = Number.isFinite(normalizedDisplacement) ? normalizedDisplacement : 0
  const safeNow = Number.isFinite(now) ? Math.max(now, currentState.previousAt) : currentState.previousAt
  const sampled = sampledState(currentState, displacement, safeNow)
  const state = sampled.state
  const { direction } = sampled
  const nearNeutral = Math.abs(displacement) <= VERTICAL_INTENT_TUNING.neutralRearmThreshold

  if (state.phase === 'jumpCooldown') {
    const neutralSince = nearNeutral ? (state.neutralSince ?? safeNow) : null
    const lockoutComplete = safeNow - state.lastActionAt >= VERTICAL_INTENT_TUNING.jumpActionLockoutMs
    const neutralConfirmed = neutralSince !== null &&
      safeNow - neutralSince >= VERTICAL_INTENT_TUNING.neutralConfirmationMs

    // Jump retrigger protection and crouch availability are separate concerns.
    // A credible downward landing movement may begin crouch classification while
    // lastActionAt continues to protect the already-triggered jump.
    const postJumpCrouchEntry =
      direction === 'down' &&
      state.velocity >= VERTICAL_INTENT_TUNING.postJumpCrouchMinimumDownwardVelocity &&
      displacement >= VERTICAL_INTENT_TUNING.postJumpCrouchEntryThreshold
    if (postJumpCrouchEntry) {
      return result({
        ...state,
        phase: 'postJumpCrouchPreparation',
        movementStartedAt: safeNow,
        deepSince: displacement >= VERTICAL_INTENT_TUNING.deliberateCrouchDepth
          ? safeNow
          : null,
        maxDownwardDepth: displacement,
        neutralSince: null,
        reversalDetected: false,
      }, direction)
    }

    if (lockoutComplete && neutralConfirmed) {
      return result(neutralState({ ...state, neutralSince }, safeNow), direction)
    }
    return result({ ...state, neutralSince }, direction)
  }

  if (state.phase === 'postJumpCrouchPreparation') {
    const beganAt = state.movementStartedAt ?? safeNow
    const maxDownwardDepth = Math.max(state.maxDownwardDepth, displacement)
    const atDeliberateDepth =
      displacement >= VERTICAL_INTENT_TUNING.deliberateCrouchDepth
    const deepSince = atDeliberateDepth
      ? (state.deepSince ?? safeNow)
      : null

    if (
      deepSince !== null &&
      safeNow - deepSince >= VERTICAL_INTENT_TUNING.postJumpCrouchConfirmationMs
    ) {
      return result({
        ...state,
        phase: 'crouched',
        movementStartedAt: beganAt,
        deepSince,
        maxDownwardDepth,
        neutralSince: null,
        // Preserve lastActionAt: it still represents the preceding jump and
        // remains available to duplicate-jump protection during this chain.
        reversalDetected: false,
      }, direction, { crouchStarted: true })
    }

    const neutralSince = nearNeutral ? (state.neutralSince ?? safeNow) : null
    const lockoutComplete =
      safeNow - state.lastActionAt >= VERTICAL_INTENT_TUNING.jumpActionLockoutMs
    const neutralConfirmed = neutralSince !== null &&
      safeNow - neutralSince >= VERTICAL_INTENT_TUNING.neutralConfirmationMs
    const returnedTowardNeutral =
      displacement <= VERTICAL_INTENT_TUNING.postJumpCrouchCancelThreshold &&
      direction !== 'down'
    const transitionExpired =
      safeNow - beganAt > VERTICAL_INTENT_TUNING.postJumpCrouchMaximumPreparationMs

    if (returnedTowardNeutral || transitionExpired) {
      if (lockoutComplete && neutralConfirmed) {
        return result(neutralState({ ...state, neutralSince }, safeNow), direction)
      }
      return result({
        ...state,
        phase: 'jumpCooldown',
        movementStartedAt: null,
        deepSince: null,
        maxDownwardDepth: 0,
        neutralSince,
        reversalDetected: false,
      }, direction)
    }

    return result({
      ...state,
      deepSince,
      maxDownwardDepth,
      neutralSince,
    }, direction)
  }

  if (state.phase === 'crouchJumpPreparation') {
    const beganAt = state.movementStartedAt ?? safeNow
    const riseFromCrouch = state.maxDownwardDepth - displacement
    const neutralSince = nearNeutral ? (state.neutralSince ?? safeNow) : null
    const continuedTakeoff =
      direction === 'up' &&
      state.velocity <= VERTICAL_INTENT_TUNING.crouchToJumpUpwardVelocity &&
      riseFromCrouch >= VERTICAL_INTENT_TUNING.crouchToJumpMinimumRise &&
      displacement <= VERTICAL_INTENT_TUNING.crouchToJumpTriggerDisplacement
    if (continuedTakeoff) return triggerJump(state, safeNow, direction)

    const returnedToCrouch =
      displacement >= VERTICAL_INTENT_TUNING.crouchToJumpReturnDepth &&
      direction !== 'up'
    if (returnedToCrouch) {
      return result({
        ...state,
        phase: 'crouched',
        movementStartedAt: null,
        deepSince: null,
        maxDownwardDepth: Math.max(state.maxDownwardDepth, displacement),
        neutralSince: null,
        reversalDetected: false,
      }, direction)
    }

    const transitionExpired =
      safeNow - beganAt > VERTICAL_INTENT_TUNING.crouchToJumpWindowMs
    const upwardMotionCancelled =
      nearNeutral &&
      state.velocity >= VERTICAL_INTENT_TUNING.crouchToJumpCancelVelocity
    if (transitionExpired || upwardMotionCancelled) {
      const neutralConfirmed =
        neutralSince !== null &&
        safeNow - neutralSince >= VERTICAL_INTENT_TUNING.crouchRearmConfirmationMs
      if (neutralConfirmed) {
        return result(neutralState({ ...state, neutralSince }, safeNow), direction)
      }
      return result({
        ...state,
        phase: 'rearming',
        movementStartedAt: null,
        deepSince: null,
        maxDownwardDepth: 0,
        neutralSince,
        reversalDetected: false,
      }, direction)
    }
    return result({ ...state, neutralSince }, direction)
  }

  if (state.phase === 'rearming') {
    const neutralSince = nearNeutral ? (state.neutralSince ?? safeNow) : null
    if (
      neutralSince !== null &&
      safeNow - neutralSince >= VERTICAL_INTENT_TUNING.crouchRearmConfirmationMs
    ) {
      return result(neutralState({ ...state, neutralSince }, safeNow), direction)
    }
    return result({ ...state, neutralSince }, direction)
  }

  if (state.phase === 'crouched') {
    const maxDownwardDepth = Math.max(state.maxDownwardDepth, displacement)
    if (displacement <= VERTICAL_INTENT_TUNING.crouchExitThreshold) {
      const riseFromCrouch = maxDownwardDepth - displacement
      const explosiveExit =
        direction === 'up' &&
        state.velocity <= VERTICAL_INTENT_TUNING.crouchToJumpUpwardVelocity &&
        riseFromCrouch >= VERTICAL_INTENT_TUNING.crouchToJumpMinimumRise
      if (explosiveExit) {
        const preparationState: VerticalIntentState = {
          ...state,
          phase: 'crouchJumpPreparation',
          movementStartedAt: safeNow,
          deepSince: null,
          maxDownwardDepth,
          neutralSince: null,
          reversalDetected: true,
        }
        if (displacement <= VERTICAL_INTENT_TUNING.crouchToJumpTriggerDisplacement) {
          return triggerJump(preparationState, safeNow, direction, { crouchEnded: true })
        }
        return result(preparationState, direction, { crouchEnded: true })
      }
      return result({
        ...state,
        phase: 'rearming',
        movementStartedAt: null,
        deepSince: null,
        maxDownwardDepth: 0,
        neutralSince: nearNeutral ? safeNow : null,
        reversalDetected: direction === 'up',
      }, direction, { crouchEnded: true })
    }
    return result({ ...state, maxDownwardDepth }, direction)
  }

  const directJump =
    displacement <= VERTICAL_INTENT_TUNING.jumpUpwardDisplacementThreshold &&
    state.velocity <= VERTICAL_INTENT_TUNING.jumpUpwardVelocityThreshold
  if (directJump) return triggerJump(state, safeNow, direction)

  if (state.phase === 'neutral') {
    if (displacement >= VERTICAL_INTENT_TUNING.shallowPreparatoryDipMin) {
      return result({
        ...state,
        phase: 'possibleCrouch',
        movementStartedAt: safeNow,
        deepSince: displacement >= VERTICAL_INTENT_TUNING.deliberateCrouchDepth ? safeNow : null,
        maxDownwardDepth: displacement,
        neutralSince: null,
        reversalDetected: false,
      }, direction)
    }
    return result({ ...state, neutralSince: nearNeutral ? (state.neutralSince ?? safeNow) : null }, direction)
  }

  if (state.phase === 'jumpPreparation') {
    const beganAt = state.movementStartedAt ?? safeNow
    if (
      displacement <= VERTICAL_INTENT_TUNING.reversalJumpDisplacement &&
      state.velocity <= VERTICAL_INTENT_TUNING.jumpUpwardVelocityThreshold
    ) {
      return triggerJump(state, safeNow, direction)
    }
    if (displacement >= VERTICAL_INTENT_TUNING.deliberateCrouchDepth && direction === 'down') {
      return result({
        ...state,
        phase: 'possibleCrouch',
        movementStartedAt: safeNow,
        deepSince: safeNow,
        maxDownwardDepth: displacement,
        reversalDetected: false,
      }, direction)
    }
    if (
      safeNow - beganAt > VERTICAL_INTENT_TUNING.maximumJumpPreparationMs ||
      (nearNeutral && direction !== 'up')
    ) {
      return result(neutralState(state, safeNow), direction)
    }
    return result(state, direction)
  }

  const movementStartedAt = state.movementStartedAt ?? safeNow
  const maxDownwardDepth = Math.max(state.maxDownwardDepth, displacement)
  const deepSince = displacement >= VERTICAL_INTENT_TUNING.deliberateCrouchDepth
    ? (state.deepSince ?? safeNow)
    : state.deepSince
  const preparationAge = safeNow - movementStartedAt
  const preparatoryDepth = maxDownwardDepth <= VERTICAL_INTENT_TUNING.shallowPreparatoryDipMax
  const reversalVelocity = preparatoryDepth
    ? VERTICAL_INTENT_TUNING.directionReversalVelocity
    : VERTICAL_INTENT_TUNING.jumpUpwardVelocityThreshold
  const upwardReversal =
    preparationAge <= VERTICAL_INTENT_TUNING.maximumJumpPreparationMs &&
    maxDownwardDepth >= VERTICAL_INTENT_TUNING.shallowPreparatoryDipMin &&
    maxDownwardDepth - displacement >= VERTICAL_INTENT_TUNING.directionReversalRise &&
    state.velocity <= reversalVelocity

  // Reversal is evaluated before crouch confirmation. A fast pre-jump dip can
  // therefore never emit a one-frame slide immediately before the jump.
  if (upwardReversal) {
    const preparationState: VerticalIntentState = {
      ...state,
      phase: 'jumpPreparation',
      movementStartedAt,
      deepSince: null,
      maxDownwardDepth,
      reversalDetected: true,
    }
    if (
      displacement <= VERTICAL_INTENT_TUNING.reversalJumpDisplacement &&
      state.velocity <= VERTICAL_INTENT_TUNING.jumpUpwardVelocityThreshold
    ) {
      return triggerJump(preparationState, safeNow, direction)
    }
    return result(preparationState, direction)
  }

  if (
    deepSince !== null &&
    safeNow - deepSince >= VERTICAL_INTENT_TUNING.crouchConfirmationMs
  ) {
    return result({
      ...state,
      phase: 'crouched',
      movementStartedAt,
      deepSince,
      maxDownwardDepth,
      neutralSince: null,
      lastActionAt: safeNow,
      reversalDetected: false,
    }, direction, { crouchStarted: true })
  }

  if (nearNeutral && direction !== 'down') {
    return result(neutralState(state, safeNow), direction)
  }

  if (
    preparationAge > VERTICAL_INTENT_TUNING.maximumJumpPreparationMs &&
    deepSince === null
  ) {
    if (displacement < VERTICAL_INTENT_TUNING.shallowPreparatoryDipMin) {
      return result(neutralState(state, safeNow), direction)
    }
    return result({
      ...state,
      movementStartedAt: safeNow,
      maxDownwardDepth: displacement,
      reversalDetected: false,
    }, direction)
  }

  return result({
    ...state,
    movementStartedAt,
    deepSince,
    maxDownwardDepth,
  }, direction)
}
