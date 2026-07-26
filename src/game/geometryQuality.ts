import * as THREE from 'three'
import {
  resolveEdgeRadius,
  type EdgeStandardId,
  type GeometryDistanceBand,
} from './geometryQualityModel.js'

export type ChamferAxis = 'x' | 'y' | 'z'

interface EdgeGeometryOptions {
  distanceBand?: GeometryDistanceBand
  referenceDimension?: number
}

interface EdgeGeometryStats {
  templates: number
  vertices: number
  triangles: number
}

type Point = readonly [number, number, number]

function createFacetedGeometry() {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()
  const expected = new THREE.Vector3()

  const addPolygon = (points: Point[], expectedNormal: Point) => {
    edgeA.fromArray(points[1]).sub(new THREE.Vector3().fromArray(points[0]))
    edgeB.fromArray(points[2]).sub(new THREE.Vector3().fromArray(points[0]))
    faceNormal.crossVectors(edgeA, edgeB)
    expected.fromArray(expectedNormal).normalize()
    const ordered = faceNormal.dot(expected) < 0 ? [...points].reverse() : points
    for (let index = 1; index < ordered.length - 1; index += 1) {
      for (const point of [ordered[0], ordered[index], ordered[index + 1]]) {
        positions.push(...point)
        normals.push(expected.x, expected.y, expected.z)
        // Stage 12 geometry is vertex-color driven. A stable placeholder UV keeps
        // merge compatibility without introducing a texture/decal system.
        uvs.push(0.5, 0.5)
      }
    }
  }

  const finish = (name: string) => {
    const geometry = new THREE.BufferGeometry()
    geometry.name = name
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }

  return { addPolygon, finish }
}

function buildChamferedBox(width: number, height: number, depth: number, radius: number) {
  const hx = width / 2
  const hy = height / 2
  const hz = depth / 2
  const ix = hx - radius
  const iy = hy - radius
  const iz = hz - radius
  const { addPolygon, finish } = createFacetedGeometry()

  addPolygon([[hx, -iy, -iz], [hx, iy, -iz], [hx, iy, iz], [hx, -iy, iz]], [1, 0, 0])
  addPolygon([[-hx, -iy, iz], [-hx, iy, iz], [-hx, iy, -iz], [-hx, -iy, -iz]], [-1, 0, 0])
  addPolygon([[-ix, hy, iz], [ix, hy, iz], [ix, hy, -iz], [-ix, hy, -iz]], [0, 1, 0])
  addPolygon([[-ix, -hy, -iz], [ix, -hy, -iz], [ix, -hy, iz], [-ix, -hy, iz]], [0, -1, 0])
  addPolygon([[-ix, -iy, hz], [ix, -iy, hz], [ix, iy, hz], [-ix, iy, hz]], [0, 0, 1])
  addPolygon([[ix, -iy, -hz], [-ix, -iy, -hz], [-ix, iy, -hz], [ix, iy, -hz]], [0, 0, -1])

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      addPolygon([
        [sx * ix, sy * hy, -iz],
        [sx * hx, sy * iy, -iz],
        [sx * hx, sy * iy, iz],
        [sx * ix, sy * hy, iz],
      ], [sx, sy, 0])
    }
    for (const sz of [-1, 1]) {
      addPolygon([
        [sx * ix, -iy, sz * hz],
        [sx * hx, -iy, sz * iz],
        [sx * hx, iy, sz * iz],
        [sx * ix, iy, sz * hz],
      ], [sx, 0, sz])
    }
  }
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addPolygon([
        [-ix, sy * iy, sz * hz],
        [-ix, sy * hy, sz * iz],
        [ix, sy * hy, sz * iz],
        [ix, sy * iy, sz * hz],
      ], [0, sy, sz])
    }
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addPolygon([
          [sx * hx, sy * iy, sz * iz],
          [sx * ix, sy * hy, sz * iz],
          [sx * ix, sy * iy, sz * hz],
        ], [sx, sy, sz])
      }
    }
  }
  return finish('stage-12-chamfered-box')
}

function buildChamferedPrism(
  width: number,
  height: number,
  depth: number,
  radius: number,
  axis: ChamferAxis,
) {
  const dimensions = { x: width, y: height, z: depth }
  const crossAxes: readonly [ChamferAxis, ChamferAxis] = axis === 'x'
    ? ['y', 'z']
    : axis === 'y'
      ? ['x', 'z']
      : ['x', 'y']
  const [uAxis, vAxis] = crossAxes
  const halfU = dimensions[uAxis] / 2
  const halfV = dimensions[vAxis] / 2
  const halfLength = dimensions[axis] / 2
  const crossSection: [number, number][] = [
    [-halfU + radius, -halfV],
    [halfU - radius, -halfV],
    [halfU, -halfV + radius],
    [halfU, halfV - radius],
    [halfU - radius, halfV],
    [-halfU + radius, halfV],
    [-halfU, halfV - radius],
    [-halfU, -halfV + radius],
  ]
  const point = (u: number, v: number, longitudinal: number): Point => {
    const result: Record<ChamferAxis, number> = { x: 0, y: 0, z: 0 }
    result[uAxis] = u
    result[vAxis] = v
    result[axis] = longitudinal
    return [result.x, result.y, result.z]
  }
  const vector = (u: number, v: number, longitudinal: number): Point => {
    const result: Record<ChamferAxis, number> = { x: 0, y: 0, z: 0 }
    result[uAxis] = u
    result[vAxis] = v
    result[axis] = longitudinal
    return [result.x, result.y, result.z]
  }
  const { addPolygon, finish } = createFacetedGeometry()
  addPolygon(crossSection.map(([u, v]) => point(u, v, -halfLength)), vector(0, 0, -1))
  addPolygon(crossSection.map(([u, v]) => point(u, v, halfLength)), vector(0, 0, 1))
  for (let index = 0; index < crossSection.length; index += 1) {
    const [u0, v0] = crossSection[index]
    const [u1, v1] = crossSection[(index + 1) % crossSection.length]
    const du = u1 - u0
    const dv = v1 - v0
    const normalLength = Math.hypot(du, dv)
    addPolygon([
      point(u0, v0, -halfLength),
      point(u1, v1, -halfLength),
      point(u1, v1, halfLength),
      point(u0, v0, halfLength),
    ], vector(dv / normalLength, -du / normalLength, 0))
  }
  return finish(`stage-12-chamfered-${axis}-prism`)
}

function buildTopChamferedPrism(
  width: number,
  height: number,
  depth: number,
  radius: number,
  axis: Exclude<ChamferAxis, 'y'>,
  includeCaps = true,
) {
  const halfHorizontal = (axis === 'x' ? depth : width) / 2
  const halfHeight = height / 2
  const halfLength = (axis === 'x' ? width : depth) / 2
  const crossSection: [number, number][] = [
    [-halfHorizontal, -halfHeight],
    [halfHorizontal, -halfHeight],
    [halfHorizontal, halfHeight - radius],
    [halfHorizontal - radius, halfHeight],
    [-halfHorizontal + radius, halfHeight],
    [-halfHorizontal, halfHeight - radius],
  ]
  const point = (horizontal: number, y: number, longitudinal: number): Point => (
    axis === 'x'
      ? [longitudinal, y, horizontal]
      : [horizontal, y, longitudinal]
  )
  const vector = (horizontal: number, y: number, longitudinal: number): Point => (
    axis === 'x'
      ? [longitudinal, y, horizontal]
      : [horizontal, y, longitudinal]
  )
  const { addPolygon, finish } = createFacetedGeometry()
  if (includeCaps) {
    addPolygon(crossSection.map(([u, v]) => point(u, v, -halfLength)), vector(0, 0, -1))
    addPolygon(crossSection.map(([u, v]) => point(u, v, halfLength)), vector(0, 0, 1))
  }
  for (let index = 0; index < crossSection.length; index += 1) {
    const [u0, v0] = crossSection[index]
    const [u1, v1] = crossSection[(index + 1) % crossSection.length]
    const du = u1 - u0
    const dv = v1 - v0
    const normalLength = Math.hypot(du, dv)
    addPolygon([
      point(u0, v0, -halfLength),
      point(u1, v1, -halfLength),
      point(u1, v1, halfLength),
      point(u0, v0, halfLength),
    ], vector(dv / normalLength, -du / normalLength, 0))
  }
  return finish(`stage-12-${includeCaps ? '' : 'open-'}top-chamfered-${axis}-prism`)
}

function geometryKey(
  kind: string,
  dimensions: readonly [number, number, number],
  radius: number,
  axis?: ChamferAxis,
  standardId?: EdgeStandardId,
) {
  return [kind, standardId ?? 'none', axis ?? 'all', ...dimensions, radius]
    .map((value) => typeof value === 'number' ? value.toFixed(5) : value)
    .join(':')
}

export class GeometryQualityFactory {
  private readonly templates = new Map<string, THREE.BufferGeometry>()

  box(
    width: number,
    height: number,
    depth: number,
    standardId: EdgeStandardId,
    options: EdgeGeometryOptions = {},
  ) {
    return this.create('box', width, height, depth, standardId, options)
  }

  prism(
    width: number,
    height: number,
    depth: number,
    axis: ChamferAxis,
    standardId: EdgeStandardId,
    options: EdgeGeometryOptions = {},
  ) {
    return this.create('prism', width, height, depth, standardId, options, axis)
  }

  topPrism(
    width: number,
    height: number,
    depth: number,
    axis: Exclude<ChamferAxis, 'y'>,
    standardId: EdgeStandardId,
    options: EdgeGeometryOptions = {},
  ) {
    return this.create('topPrism', width, height, depth, standardId, options, axis)
  }

  openTopPrism(
    width: number,
    height: number,
    depth: number,
    axis: Exclude<ChamferAxis, 'y'>,
    standardId: EdgeStandardId,
    options: EdgeGeometryOptions = {},
  ) {
    // Only continuous, end-to-end track/platform profiles use this variant. The
    // omitted caps are hidden at the repeated segment seams (and behind camera/fog
    // at the two terminal ends), saving triangles without exposing an open edge.
    return this.create('openTopPrism', width, height, depth, standardId, options, axis)
  }

  private create(
    kind: 'box' | 'prism' | 'topPrism' | 'openTopPrism',
    width: number,
    height: number,
    depth: number,
    standardId: EdgeStandardId,
    options: EdgeGeometryOptions,
    axis?: ChamferAxis,
  ) {
    const dimensions: [number, number, number] = [width, height, depth]
    const radius = resolveEdgeRadius(
      dimensions,
      standardId,
      options.distanceBand ?? 'near',
      options.referenceDimension,
    )
    if (radius <= 0) return new THREE.BoxGeometry(width, height, depth)
    const key = geometryKey(kind, dimensions, radius, axis, standardId)
    let template = this.templates.get(key)
    if (!template) {
      template = kind === 'box'
        ? buildChamferedBox(width, height, depth, radius)
        : kind === 'topPrism' || kind === 'openTopPrism'
          ? buildTopChamferedPrism(
            width,
            height,
            depth,
            radius,
            axis === 'x' ? 'x' : 'z',
            kind === 'topPrism',
          )
          : buildChamferedPrism(width, height, depth, radius, axis ?? 'z')
      template.userData.stage12 = { standardId, radius, kind, axis: axis ?? null }
      this.templates.set(key, template)
    }
    return template.clone()
  }

  getStats(): EdgeGeometryStats {
    let vertices = 0
    let triangles = 0
    for (const geometry of this.templates.values()) {
      vertices += geometry.getAttribute('position').count
      triangles += geometry.index
        ? geometry.index.count / 3
        : geometry.getAttribute('position').count / 3
    }
    return { templates: this.templates.size, vertices, triangles }
  }

  dispose() {
    this.templates.forEach((geometry) => geometry.dispose())
    this.templates.clear()
  }
}
