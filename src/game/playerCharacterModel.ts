export const PLAYER_CHARACTER = {
  authoredHeight: 4.46,
  authoredFootLevel: 0,
  visualScale: 0.53,
  visualHeight: 4.46 * 0.53,
  visualFootOffset: 0.075,
  neutralWidth: 1.78,
  runStrideRadians: 0.78,
  runCadenceBase: 9.5,
  runCadenceSpeedFactor: 0.08,
  maxFrameDelta: 0.05,
  crouchBlendRate: 24,
  crouchPelvisDrop: 0.85,
  crouchTorsoPitch: 0.82,
  crouchHeadPitch: 0.08,
  actionBlendRate: 20,
} as const

export type RunCyclePhase = 'contact' | 'down' | 'passing' | 'flight'

export interface CharacterPoseInput {
  elapsed: number
  speed: number
  crouch: number
  airborne: boolean
  jumpVelocity: number
  landing: number
  laneLean: number
  rampLean: number
}

export interface CharacterPose {
  phase: number
  runPhase: RunCyclePhase
  pelvisY: number
  pelvisX: number
  pelvisYaw: number
  torsoPitch: number
  torsoYaw: number
  torsoRoll: number
  headPitch: number
  leftArm: number
  rightArm: number
  leftElbow: number
  rightElbow: number
  leftHip: number
  rightHip: number
  leftKnee: number
  rightKnee: number
  leftFoot: number
  rightFoot: number
  leftFootLift: number
  rightFootLift: number
}

export function damp(current: number, target: number, rate: number, delta: number): number {
  const safeDelta = Math.min(PLAYER_CHARACTER.maxFrameDelta, Math.max(0, delta))
  return current + (target - current) * (1 - Math.exp(-rate * safeDelta))
}

export function getJumpShadowHeightRatio(jumpHeight: number): number {
  if (!Number.isFinite(jumpHeight)) return 0
  return Math.min(1, Math.max(0, jumpHeight / 2))
}

export function getRunCyclePhase(phase: number): RunCyclePhase {
  const wrapped = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  if (wrapped < Math.PI * 0.5) return 'contact'
  if (wrapped < Math.PI) return 'down'
  if (wrapped < Math.PI * 1.5) return 'passing'
  return 'flight'
}

/**
 * Returns a bounded procedural pose. The gameplay root is intentionally absent
 * from this contract: every value is consumed by the cosmetic hierarchy only.
 */
export function getCharacterPose(input: CharacterPoseInput, out?: CharacterPose): CharacterPose {
  const cadence = PLAYER_CHARACTER.runCadenceBase + input.speed * PLAYER_CHARACTER.runCadenceSpeedFactor
  const phase = input.elapsed * cadence
  const stride = Math.sin(phase)
  const cross = Math.cos(phase)
  const crouch = Math.min(1, Math.max(0, input.crouch))
  const landing = Math.min(1, Math.max(0, input.landing))
  const grounded = input.airborne ? 0 : 1
  const rising = input.airborne && input.jumpVelocity > 1.8
  const falling = input.airborne && input.jumpVelocity < -2.3

  let leftHip = stride * PLAYER_CHARACTER.runStrideRadians * grounded
  let rightHip = -leftHip
  let leftKnee = (0.14 + Math.max(0, -stride) * 0.86 + Math.max(0, cross) * 0.12) * grounded
  let rightKnee = (0.14 + Math.max(0, stride) * 0.86 + Math.max(0, -cross) * 0.12) * grounded
  let leftFoot = (-stride * 0.24 - leftKnee * 0.28) * grounded
  let rightFoot = (stride * 0.24 - rightKnee * 0.28) * grounded
  let leftArm = -stride * 0.72 * grounded
  let rightArm = stride * 0.72 * grounded
  let leftElbow = 0.48 + Math.max(0, stride) * 0.34
  let rightElbow = 0.48 + Math.max(0, -stride) * 0.34

  if (input.airborne) {
    const tuck = rising ? 1 : falling ? 0.46 : 0.88
    leftHip = 0.58 * tuck
    rightHip = -0.32 * tuck
    leftKnee = 0.92 * tuck
    rightKnee = 0.68 * tuck
    leftFoot = -0.38 * tuck
    rightFoot = -0.22 * tuck
    leftArm = rising ? -0.82 : 0.18
    rightArm = rising ? -0.64 : 0.08
    leftElbow = 0.7
    rightElbow = 0.62
  }

  leftHip += crouch * 0.5 - landing * 0.18
  rightHip += crouch * 0.5 + landing * 0.18
  leftKnee += crouch * 1.02 + landing * 0.54
  rightKnee += crouch * 1.02 + landing * 0.54
  leftFoot -= crouch * 0.34
  rightFoot -= crouch * 0.34
  leftArm = leftArm * (1 - crouch) + crouch * 0.42
  rightArm = rightArm * (1 - crouch) - crouch * 0.18
  leftElbow += crouch * 0.48
  rightElbow += crouch * 0.48

  const result = out ?? {} as CharacterPose
  result.phase = phase
  result.runPhase = getRunCyclePhase(phase)
  result.pelvisY = grounded * Math.abs(cross) * 0.045 -
    crouch * PLAYER_CHARACTER.crouchPelvisDrop - landing * 0.13
  result.pelvisX = grounded * stride * 0.025 + input.laneLean * 0.035
  result.pelvisYaw = grounded * stride * 0.07
  result.torsoPitch = 0.095 + input.rampLean + crouch * PLAYER_CHARACTER.crouchTorsoPitch +
    (falling ? -0.035 : input.airborne ? 0.035 : 0)
  result.torsoYaw = grounded * -stride * 0.1
  result.torsoRoll = -input.laneLean * 0.18 + grounded * stride * 0.018
  result.headPitch = -0.035 - input.rampLean * 0.45 + crouch * PLAYER_CHARACTER.crouchHeadPitch
  result.leftArm = leftArm
  result.rightArm = rightArm
  result.leftElbow = leftElbow
  result.rightElbow = rightElbow
  result.leftHip = leftHip
  result.rightHip = rightHip
  result.leftKnee = leftKnee
  result.rightKnee = rightKnee
  result.leftFoot = leftFoot
  result.rightFoot = rightFoot
  result.leftFootLift = grounded * Math.max(0, -stride) * 0.075
  result.rightFootLift = grounded * Math.max(0, stride) * 0.075
  return result
}
