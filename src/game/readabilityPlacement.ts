export const READABILITY_PLACEMENT = {
  laneCount: 3,
  overheadTrackPhase: 2,
  coinTrailLength: 11,
  coinTrailSpacing: 1.78,
  coinTrailGap: 3.5,
  coinTrailLaneOrder: [1, 1, 2, 0] as const,
  routeCoinClearance: 4.5,
  hazardCoinClearance: {
    block: 5.8,
    jump: 3.25,
    slide: 3.25,
  },
  criticalVisibleNearZ: -190,
  coinVisibleNearZ: -185,
  sceneryVisibleNearZ: -172,
  gameplayVisibleFarZ: 22,
  routeVisibleFarZ: 32,
  sceneryVisibleFarZ: 32,
  bridgeForegroundCullZ: -18,
  vegetationTreeLateralOffset: 9.45,
  vegetationShrubLateralOffset: 9.25,
  vegetationFullDetailNearZ: -105,
  vegetationLowDetailNearZ: -125,
  vegetationMidSupportFarZ: -118,
  vegetationMidSupportNearZ: 32,
  vegetationTreeVisibleFarZ: 32,
  vegetationForegroundCullZ: 8,
  planterLateralOffset: 7.35,
  lampPostLateralOffset: 7.75,
  lampArmLateralOffset: 7.28,
  lampGlobeLateralOffset: 6.8,
  lampBannerLateralOffset: 7.6,
} as const

export type CoinPlacementClearance = (lane: number, worldZ: number) => boolean

export function getCoinTrailPreferredLane(trailIndex: number) {
  const order = READABILITY_PLACEMENT.coinTrailLaneOrder
  return order[((trailIndex % order.length) + order.length) % order.length]
}

export function getCoinTrailStep(sequenceIndex: number) {
  return sequenceIndex > 0 && sequenceIndex % READABILITY_PLACEMENT.coinTrailLength === 0
    ? READABILITY_PLACEMENT.coinTrailGap
    : READABILITY_PLACEMENT.coinTrailSpacing
}

function candidateLane(preferredLane: number, offset: number) {
  if (offset === 0) return preferredLane
  if (preferredLane === 1) return offset === 1 ? 0 : 2
  if (preferredLane === 0) return offset === 1 ? 1 : 2
  return offset === 1 ? 1 : 0
}

/**
 * Chooses one lane for an entire coin trail at generation/recycle time. A lane
 * with a completely clear trail wins; otherwise the least-obstructed lane wins.
 * This keeps the runtime loop allocation-free and prevents individual coins
 * from scattering across all three lanes around a single decision point.
 */
export function chooseReadableCoinTrailLane(
  preferredLane: number,
  frontZ: number,
  coinCount: number,
  isClear: CoinPlacementClearance,
) {
  const clampedPreferredLane = Math.max(0, Math.min(READABILITY_PLACEMENT.laneCount - 1, preferredLane))
  let bestLane = clampedPreferredLane
  let bestBlockedCount = Number.POSITIVE_INFINITY

  for (let offset = 0; offset < READABILITY_PLACEMENT.laneCount; offset += 1) {
    const lane = candidateLane(clampedPreferredLane, offset)
    let blockedCount = 0
    for (let coinIndex = 0; coinIndex < coinCount; coinIndex += 1) {
      const worldZ = frontZ - coinIndex * READABILITY_PLACEMENT.coinTrailSpacing
      if (!isClear(lane, worldZ)) blockedCount += 1
    }
    if (blockedCount < bestBlockedCount) {
      bestBlockedCount = blockedCount
      bestLane = lane
    }
    if (blockedCount === 0) break
  }

  return bestLane
}
