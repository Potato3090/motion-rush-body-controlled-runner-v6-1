export type MaterialFamilyId =
  | 'paintedMetal'
  | 'bareMetal'
  | 'darkCoatedMetal'
  | 'rawConcrete'
  | 'paintedPlaster'
  | 'architecturalPanel'
  | 'stylizedGlass'
  | 'asphalt'
  | 'trackBed'
  | 'wood'
  | 'hardPlastic'
  | 'paintedComposite'
  | 'rubber'
  | 'foliage'
  | 'treeTrunk'
  | 'fabric'
  | 'skin'
  | 'hair'
  | 'emissiveAccent'
  | 'rewardMetal'

export type MaterialResponseTier = 1 | 2 | 3 | 4

export interface MaterialFamilyPreset {
  id: MaterialFamilyId
  label: string
  tier: MaterialResponseTier
  roughness: number
  metalness: number
  /** Multiplier applied only to indirect environment response. */
  environmentResponse: number
  /** Base-color-proportional emissive contribution for bounded accents. */
  emissiveIntensity: number
  shading: 'geometry' | 'faceted'
}

/**
 * Stage 11 surface-response envelopes. Colors remain authored by the Stage 6
 * palette; these presets describe only how each surface reacts to light.
 */
export const MATERIAL_FAMILIES = {
  paintedMetal: {
    id: 'paintedMetal',
    label: 'Painted metal',
    tier: 2,
    roughness: 0.4,
    metalness: 0.06,
    environmentResponse: 0.68,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  bareMetal: {
    id: 'bareMetal',
    label: 'Bare metal',
    tier: 1,
    roughness: 0.31,
    metalness: 0.88,
    environmentResponse: 1,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  darkCoatedMetal: {
    id: 'darkCoatedMetal',
    label: 'Dark coated metal',
    tier: 2,
    roughness: 0.56,
    metalness: 0.16,
    environmentResponse: 0.48,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  rawConcrete: {
    id: 'rawConcrete',
    label: 'Raw concrete and stone',
    tier: 4,
    roughness: 0.91,
    metalness: 0,
    environmentResponse: 0.1,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  paintedPlaster: {
    id: 'paintedPlaster',
    label: 'Painted plaster',
    tier: 3,
    roughness: 0.72,
    metalness: 0,
    environmentResponse: 0.2,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  architecturalPanel: {
    id: 'architecturalPanel',
    label: 'Architectural panel',
    tier: 3,
    roughness: 0.59,
    metalness: 0.03,
    environmentResponse: 0.34,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  stylizedGlass: {
    id: 'stylizedGlass',
    label: 'Opaque stylized glass',
    tier: 1,
    roughness: 0.18,
    metalness: 0.08,
    environmentResponse: 1.12,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  asphalt: {
    id: 'asphalt',
    label: 'Asphalt and compacted ground',
    tier: 4,
    roughness: 0.97,
    metalness: 0,
    environmentResponse: 0.04,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  trackBed: {
    id: 'trackBed',
    label: 'Track bed',
    tier: 4,
    roughness: 0.94,
    metalness: 0,
    environmentResponse: 0.05,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  wood: {
    id: 'wood',
    label: 'Wood',
    tier: 4,
    roughness: 0.82,
    metalness: 0,
    environmentResponse: 0.09,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  hardPlastic: {
    id: 'hardPlastic',
    label: 'Hard plastic',
    tier: 2,
    roughness: 0.55,
    metalness: 0,
    environmentResponse: 0.28,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  paintedComposite: {
    id: 'paintedComposite',
    label: 'Painted composite',
    tier: 2,
    roughness: 0.45,
    metalness: 0,
    environmentResponse: 0.48,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  rubber: {
    id: 'rubber',
    label: 'Rubber and dark structure',
    tier: 4,
    roughness: 0.96,
    metalness: 0,
    environmentResponse: 0.03,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  foliage: {
    id: 'foliage',
    label: 'Foliage',
    tier: 4,
    roughness: 0.88,
    metalness: 0,
    environmentResponse: 0.06,
    emissiveIntensity: 0,
    shading: 'faceted',
  },
  treeTrunk: {
    id: 'treeTrunk',
    label: 'Tree trunk',
    tier: 4,
    roughness: 0.9,
    metalness: 0,
    environmentResponse: 0.05,
    emissiveIntensity: 0,
    shading: 'faceted',
  },
  fabric: {
    id: 'fabric',
    label: 'Fabric',
    tier: 4,
    roughness: 0.9,
    metalness: 0,
    environmentResponse: 0.05,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  skin: {
    id: 'skin',
    label: 'Skin',
    tier: 3,
    roughness: 0.66,
    metalness: 0,
    environmentResponse: 0.18,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  hair: {
    id: 'hair',
    label: 'Hair',
    tier: 4,
    roughness: 0.84,
    metalness: 0,
    environmentResponse: 0.08,
    emissiveIntensity: 0,
    shading: 'geometry',
  },
  emissiveAccent: {
    id: 'emissiveAccent',
    label: 'Emissive accent',
    tier: 2,
    roughness: 0.46,
    metalness: 0,
    environmentResponse: 0.24,
    emissiveIntensity: 0.32,
    shading: 'geometry',
  },
  rewardMetal: {
    id: 'rewardMetal',
    label: 'Reward metal',
    tier: 1,
    roughness: 0.3,
    metalness: 0.72,
    environmentResponse: 0.92,
    emissiveIntensity: 0.045,
    shading: 'geometry',
  },
} as const satisfies Record<MaterialFamilyId, MaterialFamilyPreset>

export const MATERIAL_RESPONSE_ATTRIBUTE = 'materialResponse'
export const MATERIAL_ENVIRONMENT_RESPONSE_MAX = 1.2

export function getMaterialFamily(id: MaterialFamilyId): MaterialFamilyPreset {
  return MATERIAL_FAMILIES[id]
}

export function getMaterialResponseTuple(id: MaterialFamilyId): readonly [number, number, number, number] {
  const family = getMaterialFamily(id)
  return [
    family.roughness,
    family.metalness,
    family.environmentResponse,
    family.emissiveIntensity,
  ]
}
