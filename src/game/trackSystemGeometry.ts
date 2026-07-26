import * as THREE from 'three'
import {
  TRACK_SYSTEM,
  getRailProfile,
  getTrackBedProfile,
  type TrackProfilePoint,
} from './trackSystemModel.js'

function createOpenProfileGeometry(
  profile: readonly TrackProfilePoint[],
  length: number,
  longitudinalOffsets: readonly number[] = [0, 0],
  reliefWeight: (point: TrackProfilePoint) => number = () => 0,
) {
  const longitudinalSegments = longitudinalOffsets.length - 1
  const vertexCount = profile.length * longitudinalSegments * 6
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  let vertexCursor = 0

  const appendTriangle = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    triangleUvs: readonly [number, number, number, number, number, number],
  ) => {
    const edgeABX = b[0] - a[0]
    const edgeABY = b[1] - a[1]
    const edgeABZ = b[2] - a[2]
    const edgeACX = c[0] - a[0]
    const edgeACY = c[1] - a[1]
    const edgeACZ = c[2] - a[2]
    const normalX = edgeABY * edgeACZ - edgeABZ * edgeACY
    const normalY = edgeABZ * edgeACX - edgeABX * edgeACZ
    const normalZ = edgeABX * edgeACY - edgeABY * edgeACX
    const inverseNormalLength = 1 / Math.hypot(normalX, normalY, normalZ)
    for (const vertex of [a, b, c]) {
      const positionOffset = vertexCursor * 3
      const uvOffset = vertexCursor * 2
      positions.set(vertex, positionOffset)
      normals[positionOffset] = normalX * inverseNormalLength
      normals[positionOffset + 1] = normalY * inverseNormalLength
      normals[positionOffset + 2] = normalZ * inverseNormalLength
      const triangleVertex = vertexCursor % 3
      uvs[uvOffset] = triangleUvs[triangleVertex * 2]
      uvs[uvOffset + 1] = triangleUvs[triangleVertex * 2 + 1]
      vertexCursor += 1
    }
  }

  for (let profileIndex = 0; profileIndex < profile.length; profileIndex += 1) {
    const current = profile[profileIndex]
    const next = profile[(profileIndex + 1) % profile.length]
    for (let zIndex = 0; zIndex < longitudinalSegments; zIndex += 1) {
      const startZ = -length / 2 + length * zIndex / longitudinalSegments
      const endZ = -length / 2 + length * (zIndex + 1) / longitudinalSegments
      const currentStart: [number, number, number] = [
        current.x,
        current.y + longitudinalOffsets[zIndex] * reliefWeight(current),
        startZ,
      ]
      const nextStart: [number, number, number] = [
        next.x,
        next.y + longitudinalOffsets[zIndex] * reliefWeight(next),
        startZ,
      ]
      const currentEnd: [number, number, number] = [
        current.x,
        current.y + longitudinalOffsets[zIndex + 1] * reliefWeight(current),
        endZ,
      ]
      const nextEnd: [number, number, number] = [
        next.x,
        next.y + longitudinalOffsets[zIndex + 1] * reliefWeight(next),
        endZ,
      ]
      appendTriangle(currentStart, nextStart, nextEnd, [0, 0, 1, 0, 1, 1])
      appendTriangle(currentStart, nextEnd, currentEnd, [0, 0, 1, 1, 0, 1])
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function createRailProfileGeometry(length = TRACK_SYSTEM.segmentLength) {
  const geometry = createOpenProfileGeometry(getRailProfile(), length)
  geometry.name = 'stage-13r-open-rail-profile'
  geometry.userData.stage13r = {
    component: 'rail',
    openEnds: true,
    headWidth: TRACK_SYSTEM.rail.headWidth,
    webWidth: TRACK_SYSTEM.rail.webWidth,
    footWidth: TRACK_SYSTEM.rail.footWidth,
  }
  return geometry
}

export function createTrackBedGeometry(length = TRACK_SYSTEM.segmentLength) {
  const vertical = TRACK_SYSTEM.vertical
  const reliefRange = vertical.bedSupportTop - vertical.bedShoulderBottom
  const geometry = createOpenProfileGeometry(
    getTrackBedProfile(),
    length,
    [0, 0.018, -0.014, 0.026, -0.012, 0.016, 0],
    (point) => THREE.MathUtils.clamp(
      (vertical.bedSupportTop - point.y) / reliefRange,
      0,
      1,
    ),
  )
  geometry.name = 'stage-13r-open-track-bed-shell'
  geometry.userData.stage13r = {
    component: 'track-bed',
    openEnds: true,
    supportBands: 3,
    shoulderWidth: TRACK_SYSTEM.bed.halfWidth - TRACK_SYSTEM.bed.supportHalfWidth,
    longitudinalFacets: 6,
    maximumRelief: 0.026,
  }
  return geometry
}

/** One hard-edged, mobile-readable clamp wedge; callers mirror it around a rail foot. */
export function createFastenerClipGeometry() {
  const { width, depth, height } = TRACK_SYSTEM.fastener
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const vertices = [
    -halfWidth, 0, -halfDepth,
    halfWidth, 0, -halfDepth,
    halfWidth, height, -halfDepth,
    -halfWidth, 0, halfDepth,
    halfWidth, 0, halfDepth,
    halfWidth, height, halfDepth,
  ]
  const indices = [
    0, 2, 1,
    3, 4, 5,
    0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4,
    0, 5, 2, 0, 3, 5,
  ]
  const indexed = new THREE.BufferGeometry()
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  indexed.setIndex(indices)
  const geometry = indexed.toNonIndexed()
  indexed.dispose()
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.name = 'stage-13r-fastener-clip-wedge'
  geometry.userData.stage13r = {
    component: 'fastener-clip',
    hardEdges: true,
    mobileSilhouette: true,
  }
  return geometry
}

export class TrackGeometryCache {
  private readonly templates = new Map<string, THREE.BufferGeometry>()

  clone(key: string, create: () => THREE.BufferGeometry) {
    let template = this.templates.get(key)
    if (!template) {
      template = create()
      this.templates.set(key, template)
    }
    return template.clone()
  }

  getStats() {
    let vertices = 0
    let triangles = 0
    for (const geometry of this.templates.values()) {
      const positionCount = geometry.getAttribute('position')?.count ?? 0
      vertices += positionCount
      triangles += (geometry.index ? geometry.index.count : positionCount) / 3
    }
    return { templates: this.templates.size, vertices, triangles }
  }

  dispose() {
    this.templates.forEach((geometry) => geometry.dispose())
    this.templates.clear()
  }
}
