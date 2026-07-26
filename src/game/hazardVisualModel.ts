export type StaticHazardKind = 'jump' | 'slide'

export interface HazardVisualFamily {
  movement: 'jump' | 'slide'
  mounting: 'ground'
  panel: {
    width: number
    height: number
    depth: number
    centerY: number
    faceInset: number
  }
  support: {
    centerX: number
    postWidth: number
    postDepth: number
    footWidth: number
    footHeight: number
    footDepth: number
    footBottomY: number
  }
  openingHeight: number
  stripeCount: number
  colliderHalfWidth: number
  colliderHalfDepth: number
}

/**
 * Stage 21 keeps mechanics independent from presentation, but gives the two
 * static mechanics intentionally different silhouettes. Both assemblies fit
 * one 3.15 m lane and land their feet on the sleeper outside the rail heads.
 */
export const HAZARD_VISUAL_FAMILIES: Record<StaticHazardKind, HazardVisualFamily> = {
  jump: {
    movement: 'jump',
    mounting: 'ground',
    panel: {
      width: 2.72,
      height: 0.82,
      depth: 0.46,
      centerY: 0.88,
      faceInset: 0.1,
    },
    support: {
      centerX: 1.21,
      postWidth: 0.2,
      postDepth: 0.34,
      footWidth: 0.5,
      footHeight: 0.16,
      footDepth: 1.18,
      footBottomY: 0.045,
    },
    openingHeight: 0,
    stripeCount: 4,
    colliderHalfWidth: 1.08,
    colliderHalfDepth: 0.62,
  },
  slide: {
    movement: 'slide',
    mounting: 'ground',
    panel: {
      width: 2.76,
      height: 1.02,
      depth: 0.5,
      centerY: 2.3,
      faceInset: 0.1,
    },
    support: {
      centerX: 1.21,
      postWidth: 0.24,
      postDepth: 0.38,
      footWidth: 0.52,
      footHeight: 0.16,
      footDepth: 1.18,
      footBottomY: 0.045,
    },
    openingHeight: 1.72,
    stripeCount: 4,
    colliderHalfWidth: 1.08,
    colliderHalfDepth: 0.62,
  },
} as const

export function getHazardVisualFamily(kind: StaticHazardKind) {
  return HAZARD_VISUAL_FAMILIES[kind]
}
