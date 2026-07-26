export interface TrackProfilePoint {
  x: number
  y: number
}

export const TRACK_SYSTEM = {
  segmentLength: 18,
  segmentCount: 18,
  gauge: 1.66,
  rail: {
    headWidth: 0.225,
    webWidth: 0.1,
    footWidth: 0.34,
    totalHeight: 0.152,
    headHeight: 0.052,
    footHeight: 0.032,
    headChamfer: 0.014,
    transitionChamfer: 0.016,
  },
  sleeper: {
    length: 3,
    depth: 0.43,
    height: 0.13,
    spacing: 1.5,
    phaseOrigin: -9,
  },
  plate: {
    width: 0.48,
    depth: 0.66,
    height: 0.028,
  },
  fastener: {
    width: 0.105,
    depth: 0.24,
    height: 0.068,
    railClearance: 0.012,
  },
  ballast: {
    tileLength: 4.5,
    columns: 9,
    rows: 4,
    stoneRadiusMin: 0.15,
    stoneRadiusMax: 0.235,
    stoneHalfHeightMin: 0.032,
    stoneHalfHeightMax: 0.048,
    trackHalfWidth: 1.43,
  },
  bed: {
    halfWidth: 5.68,
    shoulderLowerHalfWidth: 5.5,
    shoulderUpperHalfWidth: 5.18,
    supportHalfWidth: 4.7,
    interTrackSupportInner: 1.41,
    valleyInner: 1.48,
    valleyOuter: 1.68,
    interTrackSupportOuter: 1.75,
  },
  vertical: {
    foundationTop: -0.22,
    bedShoulderBottom: -0.22,
    bedShoulderMid: -0.17,
    bedValleyTop: -0.14,
    bedSupportTop: -0.085,
    ballastBottom: -0.09,
    ballastTop: 0.006,
    sleeperBottom: -0.085,
    sleeperTop: 0.045,
    plateBottom: 0.045,
    plateTop: 0.073,
    railFootBottom: 0.073,
    railHeadTop: 0.225,
  },
  detailBands: {
    plateFarZ: -108,
    fastenerFarZ: -48,
    ballastFarZ: -72,
    visibleNearZ: 18,
  },
  exclusionRules: {
    rampPadding: 0.18,
    hazardPadding: 0.16,
  },
} as const

export function getRailCenterlines(trackCenter: number) {
  return [
    trackCenter - TRACK_SYSTEM.gauge / 2,
    trackCenter + TRACK_SYSTEM.gauge / 2,
  ] as const
}

/** Returns a half-open, deterministic logical-world sleeper sequence. */
export function getSleeperPositions(segmentStart: number, segmentEnd: number) {
  const { spacing, phaseOrigin } = TRACK_SYSTEM.sleeper
  const firstIndex = Math.ceil((segmentStart - phaseOrigin) / spacing - 1e-9)
  const positions: number[] = []
  for (
    let index = firstIndex, position = phaseOrigin + firstIndex * spacing;
    position < segmentEnd - 1e-9;
    index += 1, position = phaseOrigin + index * spacing
  ) {
    positions.push(position)
  }
  return positions
}

export type TrackDetailBand = 'plate' | 'fastener' | 'ballast'

export function trackDetailIsVisible(worldCenterZ: number, band: TrackDetailBand) {
  const farZ = band === 'plate'
    ? TRACK_SYSTEM.detailBands.plateFarZ
    : band === 'fastener'
      ? TRACK_SYSTEM.detailBands.fastenerFarZ
      : TRACK_SYSTEM.detailBands.ballastFarZ
  const halfLength = TRACK_SYSTEM.ballast.tileLength / 2
  return worldCenterZ + halfLength >= farZ &&
    worldCenterZ - halfLength < TRACK_SYSTEM.detailBands.visibleNearZ
}

export function segmentUsesConnectionDetail(segmentCenterZ: number) {
  const segmentHalfLength = TRACK_SYSTEM.segmentLength / 2
  return segmentCenterZ + segmentHalfLength >= TRACK_SYSTEM.detailBands.plateFarZ &&
    segmentCenterZ - segmentHalfLength < TRACK_SYSTEM.detailBands.visibleNearZ
}

export function getTrackDetailTileCenters() {
  const { segmentLength } = TRACK_SYSTEM
  const { tileLength } = TRACK_SYSTEM.ballast
  const tileCount = Math.round(segmentLength / tileLength)
  return Array.from(
    { length: tileCount },
    (_, index) => -segmentLength / 2 + tileLength * (index + 0.5),
  )
}

export function getTrackDetailSleeperOffsets() {
  const { tileLength } = TRACK_SYSTEM.ballast
  const { spacing } = TRACK_SYSTEM.sleeper
  const sleeperCount = Math.round(tileLength / spacing)
  return Array.from(
    { length: sleeperCount },
    (_, index) => -tileLength / 2 + spacing * index,
  )
}

export function trackDetailOverlapsFootprint(
  detailCenterZ: number,
  detailHalfLength: number,
  footprintCenterZ: number,
  footprintHalfLength: number,
  padding = 0,
) {
  return Math.abs(detailCenterZ - footprintCenterZ) <=
    detailHalfLength + footprintHalfLength + padding
}

export function getRailProfile(): TrackProfilePoint[] {
  const rail = TRACK_SYSTEM.rail
  const footHalf = rail.footWidth / 2
  const webHalf = rail.webWidth / 2
  const headHalf = rail.headWidth / 2
  const headBottom = rail.totalHeight - rail.headHeight
  const footShoulderY = rail.footHeight * 0.64
  return [
    { x: -footHalf, y: 0 },
    { x: footHalf, y: 0 },
    { x: footHalf, y: footShoulderY },
    { x: footHalf - rail.transitionChamfer, y: rail.footHeight },
    { x: webHalf, y: rail.footHeight },
    { x: webHalf, y: headBottom },
    { x: headHalf - rail.transitionChamfer, y: headBottom },
    { x: headHalf, y: headBottom + rail.transitionChamfer },
    { x: headHalf, y: rail.totalHeight - rail.headChamfer },
    { x: headHalf - rail.headChamfer, y: rail.totalHeight },
    { x: -headHalf + rail.headChamfer, y: rail.totalHeight },
    { x: -headHalf, y: rail.totalHeight - rail.headChamfer },
    { x: -headHalf, y: headBottom + rail.transitionChamfer },
    { x: -headHalf + rail.transitionChamfer, y: headBottom },
    { x: -webHalf, y: headBottom },
    { x: -webHalf, y: rail.footHeight },
    { x: -footHalf + rail.transitionChamfer, y: rail.footHeight },
    { x: -footHalf, y: footShoulderY },
  ]
}

export function getTrackBedProfile(): TrackProfilePoint[] {
  const bed = TRACK_SYSTEM.bed
  const vertical = TRACK_SYSTEM.vertical
  return [
    { x: -bed.halfWidth, y: vertical.bedShoulderBottom },
    { x: bed.halfWidth, y: vertical.bedShoulderBottom },
    { x: bed.shoulderLowerHalfWidth, y: vertical.bedShoulderMid },
    { x: bed.shoulderUpperHalfWidth, y: vertical.bedValleyTop },
    { x: bed.supportHalfWidth, y: vertical.bedSupportTop },
    { x: bed.interTrackSupportOuter, y: vertical.bedSupportTop },
    { x: bed.valleyOuter, y: vertical.bedValleyTop },
    { x: bed.valleyInner, y: vertical.bedValleyTop },
    { x: bed.interTrackSupportInner, y: vertical.bedSupportTop },
    { x: -bed.interTrackSupportInner, y: vertical.bedSupportTop },
    { x: -bed.valleyInner, y: vertical.bedValleyTop },
    { x: -bed.valleyOuter, y: vertical.bedValleyTop },
    { x: -bed.interTrackSupportOuter, y: vertical.bedSupportTop },
    { x: -bed.supportHalfWidth, y: vertical.bedSupportTop },
    { x: -bed.shoulderUpperHalfWidth, y: vertical.bedValleyTop },
    { x: -bed.shoulderLowerHalfWidth, y: vertical.bedShoulderMid },
  ]
}
