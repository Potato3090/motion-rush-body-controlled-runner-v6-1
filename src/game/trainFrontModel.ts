import { TRACK_SYSTEM } from './trackSystemModel.js'

export type TrainFrontFamily = 'squared-metro' | 'rounded-commuter'
export type TrainDirection = 1 | -1

export const TRAIN_FRONT_SYSTEM = {
  maxForwardProjection: 0.36,
  rearProjection: 0.07,
  shell: {
    'squared-metro': {
      depth: 0.34,
      frontBottomWidthScale: 0.95,
      frontTopWidthScale: 0.82,
      cornerCut: 0.24,
      topRake: 0.055,
    },
    'rounded-commuter': {
      depth: 0.36,
      frontBottomWidthScale: 0.88,
      frontTopWidthScale: 0.66,
      cornerCut: 0.33,
      topRake: 0.15,
    },
  },
  windshield: {
    'squared-metro': {
      maskWidthScale: 0.84,
      maskHeightScale: 0.77,
      centerHeightScale: 0.61,
      glassWidthScale: 0.16,
      glassHeightScale: 0.52,
      rake: -0.025,
    },
    'rounded-commuter': {
      maskWidthScale: 0.76,
      maskHeightScale: 0.62,
      centerHeightScale: 0.66,
      glassWidthScale: 0.66,
      glassHeightScale: 0.5,
      rake: -0.1,
    },
  },
  lowerBody: {
    skirtWidthScale: 0.92,
    skirtHeight: 0.4,
    crashBandWidthScale: 0.72,
    chassisWidth: 2.28,
    chassisHeight: 0.22,
    couplerWidth: 0.42,
    couplerHeight: 0.16,
  },
  runningGear: {
    gauge: TRACK_SYSTEM.gauge,
    railHeadTop: TRACK_SYSTEM.vertical.railHeadTop,
    wheelRadius: 0.25,
    wheelWidth: 0.16,
    wheelRailOverlap: 0.03,
    bogieLongitudinalRatio: 0.31,
    bogieWidth: 2,
    bogieHeight: 0.3,
    bogieLength: 0.78,
  },
} as const

export interface TrainWheelPlacement {
  x: number
  y: number
  z: number
}

export function getTrainFrontFamily(themeIndex: number): TrainFrontFamily {
  const normalizedTheme = ((themeIndex % 4) + 4) % 4
  return normalizedTheme % 2 === 1 ? 'rounded-commuter' : 'squared-metro'
}

export function getTrainDirectionYaw(direction: TrainDirection) {
  return direction === 1 ? 0 : Math.PI
}

export function getTrainBogieCenters(length: number) {
  const halfLength = length / 2
  const centerOffset = Math.min(
    length * TRAIN_FRONT_SYSTEM.runningGear.bogieLongitudinalRatio,
    halfLength - TRAIN_FRONT_SYSTEM.runningGear.bogieLength / 2 - 0.18,
  )
  return [-centerOffset, centerOffset] as const
}

/**
 * Wheel centers use the locked Stage 13 gauge. The small vertical overlap is
 * the visible flange/contact allowance, not a gameplay or rail change.
 */
export function getTrainWheelPlacements(length: number): TrainWheelPlacement[] {
  const runningGear = TRAIN_FRONT_SYSTEM.runningGear
  const wheelCenterY = runningGear.railHeadTop + runningGear.wheelRadius -
    runningGear.wheelRailOverlap
  const railCenters = [-runningGear.gauge / 2, runningGear.gauge / 2]
  return getTrainBogieCenters(length).flatMap((z) => railCenters.map((x) => ({
    x,
    y: wheelCenterY,
    z,
  })))
}
