export const TRAIN_FORM = {
  // Stage 14R narrows only the rendered envelope. Gameplay still uses the
  // independent 2.16 m collision proxy and 2.58 m roof/ramp safety width.
  maxBodyWidth: 2.6,
  lowerBandWidth: 2.5,
  lowerBaseWidth: 2.38,
  visualBaseY: 0.02,
  bodyBottom: 0.18,
  lowerBaseHeight: 0.3,
  lowerBandHeightRatio: 0.2,
  upperShoulderHeightRatio: 0.12,
  roofDeckWidth: 2.58,
  roofDeckThickness: 0.18,
  frontWidthScale: 0.99,
  frontWindowWidth: 1.88,
  frontWindowHeightRatio: 0.43,
  frontLowerWidthScale: 0.92,
  frontLowerHeight: 0.4,
  sideDetailMaxDepth: 0.04,
  sideDetailGap: 0.003,
} as const

// Measured in the neutral authored pose. These values only control the visual
// player/train hierarchy; gameplay roots, collisions, and traversal stay in
// their original world units.
export const PLAYER_TRAIN_SCALE = {
  authoredHeight: 4.09,
  authoredNeutralWidth: 2.129342355714245,
  visualScale: 0.48,
  contactShadowRadius: 0.53,
  trainDoorHeight: 1.68,
  buildingDoorHeight: 1.95,
  railingHeight: 1.78,
} as const

export interface TrainFormDimensions {
  roofSurfaceHeight: number
  totalVisualHeight: number
  lowerBandHeight: number
  lowerBandBottomY: number
  lowerBandTopY: number
  mainBodyHeight: number
  mainBodyBottomY: number
  mainBodyTopY: number
  upperShoulderHeight: number
  upperShoulderBottomY: number
  upperShoulderTopY: number
  roofDeckBottomY: number
  roofDeckCenterY: number
  frontWidth: number
  maxVisualWidth: number
  widthHeightRatio: number
}

/**
 * Resolves every gameplay train from the same low-poly cross-section. The
 * caller supplies only the already-approved roof traversal height; train
 * length is deliberately absent so short and long variants cannot deform it.
 */
export function getTrainFormDimensions(roofSurfaceHeight: number): TrainFormDimensions {
  const totalVisualHeight = roofSurfaceHeight - TRAIN_FORM.visualBaseY
  const lowerBandHeight = totalVisualHeight * TRAIN_FORM.lowerBandHeightRatio
  const upperShoulderHeight = totalVisualHeight * TRAIN_FORM.upperShoulderHeightRatio
  const roofDeckBottomY = roofSurfaceHeight - TRAIN_FORM.roofDeckThickness
  const upperShoulderTopY = roofDeckBottomY
  const upperShoulderBottomY = upperShoulderTopY - upperShoulderHeight
  const lowerBandBottomY = TRAIN_FORM.bodyBottom
  const lowerBandTopY = lowerBandBottomY + lowerBandHeight
  const mainBodyBottomY = lowerBandTopY
  const mainBodyTopY = upperShoulderBottomY

  return {
    roofSurfaceHeight,
    totalVisualHeight,
    lowerBandHeight,
    lowerBandBottomY,
    lowerBandTopY,
    mainBodyHeight: mainBodyTopY - mainBodyBottomY,
    mainBodyBottomY,
    mainBodyTopY,
    upperShoulderHeight,
    upperShoulderBottomY,
    upperShoulderTopY,
    roofDeckBottomY,
    roofDeckCenterY: roofSurfaceHeight - TRAIN_FORM.roofDeckThickness / 2,
    frontWidth: TRAIN_FORM.maxBodyWidth * TRAIN_FORM.frontWidthScale,
    maxVisualWidth: TRAIN_FORM.maxBodyWidth + 2 * (
      TRAIN_FORM.sideDetailMaxDepth + TRAIN_FORM.sideDetailGap
    ),
    widthHeightRatio: TRAIN_FORM.maxBodyWidth / totalVisualHeight,
  }
}
