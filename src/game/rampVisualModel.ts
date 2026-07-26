import { ROUTE_RAMP_LENGTH, ROUTE_ROOF_HEIGHT } from './runnerRouteModel.js'

/** Stage 22 organizes a visual shell around the unchanged route surface. */
export const RAMP_VISUAL_SHELL = {
  width: 2.58,
  length: ROUTE_RAMP_LENGTH,
  roofHeight: ROUTE_ROOF_HEIGHT,
  deckThickness: 0.24,
  centerPanelWidth: 1.78,
  edgeBandWidth: 0.2,
  edgeRailWidth: 0.14,
  edgeRailHeight: 0.18,
  edgeRailEndClearance: 0.34,
  sidePanelThickness: 0.16,
  sidePanelGroundClearance: 0.035,
  sidePanelDeckOverlap: 0.12,
  entryNoseLength: 0.34,
  entryNoseHeight: 0.055,
  reinforcementDepth: 0.16,
  chevronCount: 3,
  chevronWidth: 1.42,
  chevronDepth: 0.66,
  chevronBand: 0.18,
  supportPostWidth: 0.17,
  supportInset: 0.18,
  supportLongitudinalInset: 0.34,
  supportFootWidth: 0.36,
  supportFootHeight: 0.08,
  supportFootDepth: 0.42,
} as const

export const RAMP_VISUAL_SLOPE_LENGTH = Math.hypot(
  RAMP_VISUAL_SHELL.length,
  RAMP_VISUAL_SHELL.roofHeight,
)

export const RAMP_VISUAL_ANGLE_RADIANS = Math.atan(
  RAMP_VISUAL_SHELL.roofHeight / RAMP_VISUAL_SHELL.length,
)

export function getRampVisualSurfaceHeight(localZ: number, descending: boolean) {
  const progress = Math.max(0, Math.min(
    1,
    (RAMP_VISUAL_SHELL.length / 2 - localZ) / RAMP_VISUAL_SHELL.length,
  ))
  return descending
    ? RAMP_VISUAL_SHELL.roofHeight * (1 - progress)
    : RAMP_VISUAL_SHELL.roofHeight * progress
}

export function getRampVisualShellBounds() {
  return {
    minX: -RAMP_VISUAL_SHELL.width / 2,
    maxX: RAMP_VISUAL_SHELL.width / 2,
    minZ: -RAMP_VISUAL_SHELL.length / 2,
    maxZ: RAMP_VISUAL_SHELL.length / 2,
    minY: 0,
    maxY: RAMP_VISUAL_SHELL.roofHeight + RAMP_VISUAL_SHELL.edgeRailHeight,
  }
}
