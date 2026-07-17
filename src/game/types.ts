export type GameStatus = 'menu' | 'countdown' | 'playing' | 'paused' | 'gameover'

export type RunnerAction = 'left' | 'right' | 'jump' | 'slide'

export type RunnerLane = 0 | 1 | 2

export type ControlMode = 'touch' | 'camera'

export interface GameSnapshot {
  score: number
  coins: number
  distance: number
  speed: number
  multiplier: number
}

export interface PoseSignal {
  x: number
  y: number
  confidence: number
  lane: RunnerLane
  crouching: boolean
  jumpTriggered: boolean
}

export interface CalibrationBaseline {
  centerX: number
  shoulderY: number
  torsoSize: number
}
