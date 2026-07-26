import assert from 'node:assert/strict'
import {
  getTrainFormDimensions,
  PLAYER_TRAIN_SCALE,
  TRAIN_FORM,
} from '../.control-test-build/trainFormModel.js'

const LANE_CENTER_SPACING = 3.15
const RAMP_AND_TRAVERSAL_WIDTH = 2.58
const GAMEPLAY_COLLIDER_WIDTH = 2.16
const REJECTED_STAGE_14 = {
  bodyWidth: 3.02,
  maxVisualWidth: 3.106,
  roofDeckWidth: 2.92,
}

const bodyWidthReduction = 1 - TRAIN_FORM.maxBodyWidth / REJECTED_STAGE_14.bodyWidth
const visualWidthReduction = 1 - (
  TRAIN_FORM.maxBodyWidth + 2 * (TRAIN_FORM.sideDetailMaxDepth + TRAIN_FORM.sideDetailGap)
) / REJECTED_STAGE_14.maxVisualWidth

assert.ok(
  TRAIN_FORM.maxBodyWidth < LANE_CENTER_SPACING,
  'the primary shell preserves visible separation between adjacent lane centers',
)
assert.ok(
  TRAIN_FORM.roofDeckWidth >= RAMP_AND_TRAVERSAL_WIDTH,
  'the narrowed visual deck still contains the unchanged ramp and traversal proxy',
)
assert.ok(
  TRAIN_FORM.roofDeckWidth - RAMP_AND_TRAVERSAL_WIDTH <= 0.1,
  'the Stage 14R roof removes excess width while retaining a bounded safety margin',
)
assert.ok(
  TRAIN_FORM.maxBodyWidth >= GAMEPLAY_COLLIDER_WIDTH,
  'the visual shell still contains the independent gameplay collision proxy',
)
assert.ok(
  bodyWidthReduction >= 0.1 && bodyWidthReduction <= 0.18,
  'Stage 14R applies the requested bounded body-width correction',
)
assert.ok(
  visualWidthReduction >= 0.1 && visualWidthReduction <= 0.18,
  'reattached side details remain inside the corrected maximum visual envelope',
)
assert.ok(
  TRAIN_FORM.maxBodyWidth * TRAIN_FORM.frontWidthScale < 2.7,
  'the corrected front no longer inherits the rejected three-metre-wide face',
)

const routeTrain = getTrainFormDimensions(2.5)
const obstacleTrain = getTrainFormDimensions(3)

for (const form of [routeTrain, obstacleTrain]) {
  assert.ok(form.mainBodyHeight > 0, 'the main passenger body remains a positive volume')
  assert.ok(form.lowerBandTopY < form.mainBodyTopY, 'the lower band stays below the shoulder')
  assert.ok(form.mainBodyTopY < form.roofDeckBottomY, 'the faceted shoulder separates wall and deck')
  assert.ok(
    form.maxVisualWidth < LANE_CENTER_SPACING,
    'reattached side details remain inside the fixed lane-center spacing',
  )
  assert.ok(
    Math.abs(
      form.lowerBandHeight / form.totalVisualHeight - TRAIN_FORM.lowerBandHeightRatio
    ) < Number.EPSILON,
    'every roof-height variant uses the same lower-body proportion',
  )
  assert.ok(
    Math.abs(
      form.upperShoulderHeight / form.totalVisualHeight -
      TRAIN_FORM.upperShoulderHeightRatio,
    ) < Number.EPSILON,
    'every roof-height variant uses the same upper-shoulder proportion',
  )
  const combinedUpperRatio = (
    form.upperShoulderHeight + TRAIN_FORM.roofDeckThickness
  ) / form.totalVisualHeight
  assert.ok(
    combinedUpperRatio >= 0.14 && combinedUpperRatio <= 0.23,
    'the shoulder and roof stay inside the bounded macro-form range',
  )
}

const playerVisualHeight = PLAYER_TRAIN_SCALE.authoredHeight *
  PLAYER_TRAIN_SCALE.visualScale
const playerNeutralWidth = PLAYER_TRAIN_SCALE.authoredNeutralWidth *
  PLAYER_TRAIN_SCALE.visualScale
const playerRoofShare = playerNeutralWidth / TRAIN_FORM.roofDeckWidth

assert.ok(
  Math.abs(playerVisualHeight - PLAYER_TRAIN_SCALE.buildingDoorHeight) < 0.08,
  'the corrected player visual height is independently anchored to a building door',
)
assert.ok(
  playerVisualHeight > PLAYER_TRAIN_SCALE.trainDoorHeight &&
  playerVisualHeight > PLAYER_TRAIN_SCALE.railingHeight,
  'the corrected player remains coherently taller than train doors and railings',
)
assert.ok(
  playerRoofShare >= 0.3 && playerRoofShare <= 0.45,
  'the centered player occupies the requested 30–45% of the flat roof deck',
)
assert.ok(
  obstacleTrain.maxVisualWidth / playerVisualHeight >= 1.3 &&
  obstacleTrain.maxVisualWidth / playerVisualHeight <= 1.45,
  'the corrected train-to-player width relationship removes the obese Stage 14 silhouette',
)

assert.equal(
  routeTrain.frontWidth,
  obstacleTrain.frontWidth,
  'moving, stationary, short, and long trains share the same front width',
)
assert.ok(
  Math.abs(
    routeTrain.lowerBandHeight / routeTrain.totalVisualHeight -
    obstacleTrain.lowerBandHeight / obstacleTrain.totalVisualHeight
  ) < Number.EPSILON,
  'length-independent cross-section values remain stable across train builders',
)

console.log('Train silhouette model: all Stage 14R acceptance checks passed.')
