import type { BuildingFamilyId } from './buildingMassingModel'

export type FacadeFamilyId = 'residential' | 'office' | 'mixed-use' | 'heavy-urban'
export type EntrancePresetId = 'recessed-single' | 'glazed-double' | 'canopy-entry' | 'framed-entry'
export type RoofDetailPresetId = 'none' | 'service-room' | 'hvac' | 'tank' | 'antenna'

export interface FacadeFamilyPreset {
  id: FacadeFamilyId
  windowHeight: number
  targetWindowWidth: number
  minWindowWidth: number
  maxWindowWidth: number
  targetBayWidth: number
  minColumns: number
  maxColumns: number
  cornerMargin: number
  frameWidth: number
  sill: boolean
  sideWindows: boolean
  entrance: EntrancePresetId
  entranceOffset: number
  groundWindowScale: number
  topBandHeight: number
  roofDetail: RoofDetailPresetId
}

export interface WindowGrid {
  columns: number
  windowWidth: number
  positions: readonly number[]
  cornerMargin: number
}

export const FACADE_FAMILIES = {
  residential: {
    id: 'residential',
    windowHeight: 1.02,
    targetWindowWidth: 0.76,
    minWindowWidth: 0.62,
    maxWindowWidth: 0.86,
    targetBayWidth: 1.45,
    minColumns: 2,
    maxColumns: 4,
    cornerMargin: 0.58,
    frameWidth: 0.1,
    sill: true,
    sideWindows: true,
    entrance: 'recessed-single',
    entranceOffset: -0.18,
    groundWindowScale: 0.88,
    topBandHeight: 0.28,
    roofDetail: 'tank',
  },
  office: {
    id: 'office',
    windowHeight: 1.16,
    targetWindowWidth: 1.02,
    minWindowWidth: 0.82,
    maxWindowWidth: 1.16,
    targetBayWidth: 1.55,
    minColumns: 2,
    maxColumns: 4,
    cornerMargin: 0.5,
    frameWidth: 0.08,
    sill: false,
    sideWindows: true,
    entrance: 'glazed-double',
    entranceOffset: 0,
    groundWindowScale: 1.05,
    topBandHeight: 0.22,
    roofDetail: 'hvac',
  },
  'mixed-use': {
    id: 'mixed-use',
    windowHeight: 1.06,
    targetWindowWidth: 0.86,
    minWindowWidth: 0.68,
    maxWindowWidth: 0.98,
    targetBayWidth: 1.48,
    minColumns: 2,
    maxColumns: 4,
    cornerMargin: 0.56,
    frameWidth: 0.09,
    sill: true,
    sideWindows: true,
    entrance: 'canopy-entry',
    entranceOffset: 0.2,
    groundWindowScale: 1.12,
    topBandHeight: 0.3,
    roofDetail: 'service-room',
  },
  'heavy-urban': {
    id: 'heavy-urban',
    windowHeight: 0.94,
    targetWindowWidth: 0.7,
    minWindowWidth: 0.58,
    maxWindowWidth: 0.8,
    targetBayWidth: 1.38,
    minColumns: 2,
    maxColumns: 4,
    cornerMargin: 0.68,
    frameWidth: 0.11,
    sill: true,
    sideWindows: false,
    entrance: 'framed-entry',
    entranceOffset: -0.28,
    groundWindowScale: 0.84,
    topBandHeight: 0.36,
    roofDetail: 'antenna',
  },
} as const satisfies Record<FacadeFamilyId, FacadeFamilyPreset>

const MASSING_TO_FACADE: Record<BuildingFamilyId, FacadeFamilyId> = {
  'broad-block': 'heavy-urban',
  'narrow-midrise': 'residential',
  'podium-block': 'mixed-use',
  'stepped-block': 'mixed-use',
  'compact-tower': 'office',
  'asymmetric-block': 'residential',
}

export function getFacadeFamily(buildingFamilyId: BuildingFamilyId) {
  return FACADE_FAMILIES[MASSING_TO_FACADE[buildingFamilyId]]
}

export function getWindowGrid(span: number, family: FacadeFamilyPreset): WindowGrid {
  const usableSpan = Math.max(0, span - family.cornerMargin * 2)
  const boundedColumns = Math.min(
    family.maxColumns,
    Math.max(family.minColumns, Math.round(usableSpan / family.targetBayWidth)),
  )
  const columns = usableSpan <= 0 ? 0 : boundedColumns
  if (columns === 0) return { columns, windowWidth: 0, positions: [], cornerMargin: family.cornerMargin }

  const bayWidth = usableSpan / columns
  const windowWidth = Math.min(
    family.maxWindowWidth,
    Math.max(family.minWindowWidth, Math.min(family.targetWindowWidth, bayWidth * 0.72)),
  )
  const start = -usableSpan / 2 + bayWidth / 2
  return {
    columns,
    windowWidth,
    positions: Array.from({ length: columns }, (_, index) => start + index * bayWidth),
    cornerMargin: family.cornerMargin,
  }
}

export function getEntranceCenter(span: number, family: FacadeFamilyPreset) {
  const safeHalfSpan = Math.max(0, span / 2 - family.cornerMargin - 0.68)
  return Math.max(-safeHalfSpan, Math.min(safeHalfSpan, family.entranceOffset * span))
}

export function getRoofDetailPreset(
  family: FacadeFamilyPreset,
  variationIndex: number,
  roofProfile: 'flat-cap' | 'step-cap' | 'angled-cap',
): RoofDetailPresetId {
  if (roofProfile === 'angled-cap' || variationIndex % 3 === 0) return 'none'
  return family.roofDetail
}
