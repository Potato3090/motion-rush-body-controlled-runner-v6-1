export type EdgeClass =
  | 'silhouette-hard'
  | 'softened-structural'
  | 'contact'
  | 'thin-mechanical'
  | 'plastic-composite'
  | 'hidden'

export type GeometryDistanceBand = 'near' | 'mid' | 'far'

export type EdgeStandardId =
  | 'largeArchitectural'
  | 'vehicleBody'
  | 'concretePlatform'
  | 'paintedMetal'
  | 'plasticComposite'
  | 'smallCityProp'
  | 'thinMechanical'
  | 'intentionalHard'
  | 'hidden'
  | 'distantProxy'

export interface EdgeStandard {
  id: EdgeStandardId
  edgeClass: EdgeClass
  bevelRatioEnvelope: readonly [number, number]
  defaultBevelRatio: number
  segments: 0 | 1 | 2
  hardMainFaces: boolean
  normalPolicy: 'flat' | 'flat-main-flat-chamfer' | 'preserve-source'
  distanceBands: readonly GeometryDistanceBand[]
  separateCollider: boolean
  reuse: 'cached-family' | 'source-primitive'
}
// Stage 12 keeps the target's thin highlight bands semantic and bounded. Values
// are ratios of a relevant family dimension, never independent per-object radii.
export const EDGE_STANDARDS: Readonly<Record<EdgeStandardId, EdgeStandard>> = {
  largeArchitectural: {
    id: 'largeArchitectural',
    edgeClass: 'softened-structural',
    bevelRatioEnvelope: [0.003, 0.012],
    defaultBevelRatio: 0.008,
    segments: 1,
    hardMainFaces: true,
    normalPolicy: 'flat-main-flat-chamfer',
    distanceBands: ['near', 'mid'],
    separateCollider: false,
    reuse: 'cached-family',
  },
  vehicleBody: {
    id: 'vehicleBody',
    edgeClass: 'softened-structural',
    bevelRatioEnvelope: [0.008, 0.025],
    defaultBevelRatio: 0.02,
    segments: 1,
    hardMainFaces: true,
    normalPolicy: 'flat-main-flat-chamfer',
    distanceBands: ['near', 'mid'],
    separateCollider: true,
    reuse: 'cached-family',
  },
  concretePlatform: {
    id: 'concretePlatform',
    edgeClass: 'contact',
    bevelRatioEnvelope: [0.003, 0.012],
    defaultBevelRatio: 0.011,
    segments: 1,
    hardMainFaces: true,
    normalPolicy: 'flat-main-flat-chamfer',
    distanceBands: ['near'],
    separateCollider: true,
    reuse: 'cached-family',
  },
  paintedMetal: {
    id: 'paintedMetal',
    edgeClass: 'thin-mechanical',
    bevelRatioEnvelope: [0, 0.008],
    defaultBevelRatio: 0.007,
    segments: 1,
    hardMainFaces: true,
    normalPolicy: 'flat-main-flat-chamfer',
    distanceBands: ['near'],
    separateCollider: false,
    reuse: 'cached-family',
  },
  plasticComposite: {
    id: 'plasticComposite',
    edgeClass: 'plastic-composite',
    bevelRatioEnvelope: [0.01, 0.035],
    defaultBevelRatio: 0.03,
    segments: 1,
    hardMainFaces: true,
    normalPolicy: 'flat-main-flat-chamfer',
    distanceBands: ['near', 'mid'],
    separateCollider: true,
    reuse: 'cached-family',
  },
  smallCityProp: {
    id: 'smallCityProp',
    edgeClass: 'softened-structural',
    bevelRatioEnvelope: [0, 0.018],
    defaultBevelRatio: 0.014,
    segments: 1,
    hardMainFaces: true,
    normalPolicy: 'flat-main-flat-chamfer',
    distanceBands: ['near'],
    separateCollider: false,
    reuse: 'cached-family',
  },
  thinMechanical: {
    id: 'thinMechanical',
    edgeClass: 'thin-mechanical',
    bevelRatioEnvelope: [0, 0.008],
    defaultBevelRatio: 0.006,
    segments: 1,
    hardMainFaces: true,
    normalPolicy: 'flat-main-flat-chamfer',
    distanceBands: ['near'],
    separateCollider: false,
    reuse: 'cached-family',
  },
  intentionalHard: {
    id: 'intentionalHard',
    edgeClass: 'silhouette-hard',
    bevelRatioEnvelope: [0, 0],
    defaultBevelRatio: 0,
    segments: 0,
    hardMainFaces: true,
    normalPolicy: 'preserve-source',
    distanceBands: ['near', 'mid', 'far'],
    separateCollider: false,
    reuse: 'source-primitive',
  },
  hidden: {
    id: 'hidden',
    edgeClass: 'hidden',
    bevelRatioEnvelope: [0, 0],
    defaultBevelRatio: 0,
    segments: 0,
    hardMainFaces: true,
    normalPolicy: 'preserve-source',
    distanceBands: ['near', 'mid', 'far'],
    separateCollider: false,
    reuse: 'source-primitive',
  },
  distantProxy: {
    id: 'distantProxy',
    edgeClass: 'hidden',
    bevelRatioEnvelope: [0, 0],
    defaultBevelRatio: 0,
    segments: 0,
    hardMainFaces: true,
    normalPolicy: 'flat',
    distanceBands: ['far'],
    separateCollider: false,
    reuse: 'source-primitive',
  },
}

const DISTANCE_RADIUS_SCALE: Readonly<Record<GeometryDistanceBand, number>> = {
  near: 1,
  mid: 0.68,
  far: 0,
}

export function resolveEdgeRadius(
  dimensions: readonly [number, number, number],
  standardId: EdgeStandardId,
  distanceBand: GeometryDistanceBand,
  referenceDimension?: number,
) {
  const standard = EDGE_STANDARDS[standardId]
  if (standard.segments === 0 || !standard.distanceBands.includes(distanceBand)) return 0
  const minimumDimension = Math.min(...dimensions.map(Math.abs))
  if (!Number.isFinite(minimumDimension) || minimumDimension <= 0) return 0
  const relevantDimension = referenceDimension === undefined
    ? minimumDimension
    : Math.abs(referenceDimension)
  const relativeRadius = relevantDimension * standard.defaultBevelRatio *
    DISTANCE_RADIUS_SCALE[distanceBand]
  return Math.min(relativeRadius, minimumDimension * 0.22)
}
