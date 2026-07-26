export type TreeFamilyId = 'rounded' | 'upright' | 'spreading' | 'ornamental' | 'flowering'
export type TreeSizeId = 'short' | 'medium' | 'tall'
export type ShrubFamilyId = 'compact' | 'spreading' | 'layered'
export type PlantingCompositionId =
  | 'hero-tree'
  | 'medium-tree'
  | 'flowering-bed'
  | 'shrub-group'
  | 'background-greenery'

export interface FoliageMassPreset {
  offset: readonly [number, number, number]
  scale: readonly [number, number, number]
  tone: 'dark' | 'mid' | 'light' | 'blossom'
}

export interface TreeFamilyPreset {
  id: TreeFamilyId
  label: string
  masses: readonly FoliageMassPreset[]
}

export interface TreeSizePreset {
  id: TreeSizeId
  trunkHeight: number
  trunkRadiusBottom: number
  trunkRadiusTop: number
  canopyRadius: number
}

export interface PlantingLayout {
  composition: PlantingCompositionId
  side: -1 | 1
  treeFamily?: TreeFamilyId
  treeSize?: TreeSizeId
  treeZ: number
  shrubFamily: ShrubFamilyId
  flowering: boolean
}

export const TREE_FAMILIES: Record<TreeFamilyId, TreeFamilyPreset> = {
  rounded: {
    id: 'rounded',
    label: 'Rounded layered canopy',
    masses: [
      { offset: [-0.08, -0.12, 0.06], scale: [0.72, 0.58, 0.68], tone: 'mid' },
      { offset: [-0.74, -0.18, 0.16], scale: [0.66, 0.5, 0.6], tone: 'dark' },
      { offset: [0.7, 0.02, -0.18], scale: [0.64, 0.52, 0.66], tone: 'mid' },
      { offset: [0.12, 0.62, 0], scale: [0.54, 0.48, 0.54], tone: 'light' },
    ],
  },
  upright: {
    id: 'upright',
    label: 'Upright narrow canopy',
    masses: [
      { offset: [-0.08, -0.06, 0.05], scale: [0.46, 0.78, 0.52], tone: 'mid' },
      { offset: [-0.52, -0.32, 0.12], scale: [0.42, 0.62, 0.46], tone: 'dark' },
      { offset: [0.46, 0.44, -0.08], scale: [0.4, 0.58, 0.45], tone: 'light' },
      { offset: [0.02, 0.92, 0.08], scale: [0.34, 0.44, 0.38], tone: 'mid' },
    ],
  },
  spreading: {
    id: 'spreading',
    label: 'Broad spreading canopy',
    masses: [
      { offset: [-0.04, -0.14, 0.04], scale: [0.78, 0.52, 0.68], tone: 'mid' },
      { offset: [-0.86, -0.18, 0.14], scale: [0.7, 0.46, 0.62], tone: 'dark' },
      { offset: [0.84, -0.02, -0.14], scale: [0.7, 0.44, 0.6], tone: 'mid' },
      { offset: [0.16, 0.48, 0.02], scale: [0.56, 0.44, 0.52], tone: 'light' },
    ],
  },
  ornamental: {
    id: 'ornamental',
    label: 'Compact ornamental canopy',
    masses: [
      { offset: [-0.06, -0.08, 0.04], scale: [0.58, 0.52, 0.62], tone: 'mid' },
      { offset: [-0.56, -0.12, 0.1], scale: [0.5, 0.42, 0.52], tone: 'dark' },
      { offset: [0.5, 0.28, -0.1], scale: [0.48, 0.42, 0.5], tone: 'light' },
      { offset: [0.08, 0.62, 0.04], scale: [0.4, 0.36, 0.42], tone: 'mid' },
    ],
  },
  flowering: {
    id: 'flowering',
    label: 'Rare flowering accent tree',
    masses: [
      { offset: [-0.06, -0.1, 0.04], scale: [0.62, 0.52, 0.62], tone: 'mid' },
      { offset: [-0.68, -0.14, 0.14], scale: [0.56, 0.46, 0.54], tone: 'blossom' },
      { offset: [0.66, 0.1, -0.14], scale: [0.54, 0.45, 0.52], tone: 'blossom' },
      { offset: [0.08, 0.62, 0], scale: [0.5, 0.42, 0.48], tone: 'light' },
    ],
  },
} as const

export const TREE_SIZES: Record<TreeSizeId, TreeSizePreset> = {
  short: { id: 'short', trunkHeight: 2.78, trunkRadiusBottom: 0.35, trunkRadiusTop: 0.24, canopyRadius: 1.24 },
  medium: { id: 'medium', trunkHeight: 3.42, trunkRadiusBottom: 0.43, trunkRadiusTop: 0.3, canopyRadius: 1.5 },
  tall: { id: 'tall', trunkHeight: 4.02, trunkRadiusBottom: 0.51, trunkRadiusTop: 0.36, canopyRadius: 1.76 },
} as const

export const SHRUB_FAMILIES: Record<ShrubFamilyId, readonly FoliageMassPreset[]> = {
  compact: [
    { offset: [0, 0, 0], scale: [0.78, 0.52, 0.72], tone: 'mid' },
    { offset: [0.34, 0.08, -0.05], scale: [0.48, 0.38, 0.46], tone: 'light' },
  ],
  spreading: [
    { offset: [0, 0, 0], scale: [1.05, 0.38, 0.66], tone: 'dark' },
    { offset: [-0.48, 0.03, 0.05], scale: [0.62, 0.33, 0.5], tone: 'mid' },
    { offset: [0.5, 0.06, -0.04], scale: [0.58, 0.34, 0.48], tone: 'mid' },
  ],
  layered: [
    { offset: [0, 0, 0], scale: [0.82, 0.46, 0.7], tone: 'dark' },
    { offset: [-0.34, 0.14, 0.04], scale: [0.5, 0.4, 0.48], tone: 'mid' },
    { offset: [0.38, 0.18, -0.03], scale: [0.48, 0.38, 0.46], tone: 'light' },
  ],
} as const

const COMPOSITION_RHYTHM: readonly PlantingCompositionId[] = [
  'hero-tree',
  'shrub-group',
  'medium-tree',
  'background-greenery',
  'flowering-bed',
  'shrub-group',
  'medium-tree',
  'hero-tree',
] as const

const PRIMARY_TREE_RHYTHM: readonly TreeFamilyId[] = [
  'rounded', 'upright', 'spreading', 'ornamental', 'rounded', 'spreading',
] as const

const SHRUB_RHYTHM: readonly ShrubFamilyId[] = ['compact', 'spreading', 'layered'] as const

/** Deterministic city-planning rhythm; tall planting is excluded from bridge segments. */
export function getPlantingLayout(index: number, buildingSide: -1 | 1, hasBridge: boolean): PlantingLayout {
  const safeIndex = ((index % COMPOSITION_RHYTHM.length) + COMPOSITION_RHYTHM.length) % COMPOSITION_RHYTHM.length
  let composition = COMPOSITION_RHYTHM[safeIndex]
  if (hasBridge) composition = 'shrub-group'
  const flowering = composition === 'flowering-bed' && index % 16 === 4
  const treeFamily = flowering
    ? 'flowering'
    : PRIMARY_TREE_RHYTHM[((index % PRIMARY_TREE_RHYTHM.length) + PRIMARY_TREE_RHYTHM.length) % PRIMARY_TREE_RHYTHM.length]
  const treeSize: TreeSizeId = composition === 'hero-tree'
    ? 'tall'
    : treeFamily === 'ornamental' || flowering
      ? 'short'
      : 'medium'
  return {
    composition,
    side: buildingSide === 1 ? -1 : 1,
    treeFamily,
    treeSize,
    treeZ: 1.75 + ((index * 37) % 5) * 0.28,
    shrubFamily: SHRUB_RHYTHM[index % SHRUB_RHYTHM.length],
    flowering,
  }
}

export function compositionHasTree(composition: PlantingCompositionId) {
  return composition === 'hero-tree' || composition === 'medium-tree' || composition === 'flowering-bed'
}
