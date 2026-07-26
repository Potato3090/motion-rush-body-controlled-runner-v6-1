import * as THREE from 'three'

export interface SectionedFrontShellOptions {
  backWidth: number
  frontBottomWidth: number
  frontTopWidth: number
  height: number
  depth: number
  cornerCut: number
  topRake: number
}

interface TrainComponentGeometryStats {
  templates: number
  vertices: number
  triangles: number
}

type Point = readonly [number, number, number]

function appendTriangle(positions: number[], a: Point, b: Point, c: Point) {
  positions.push(...a, ...b, ...c)
}

function appendQuad(positions: number[], a: Point, b: Point, c: Point, d: Point) {
  appendTriangle(positions, a, b, c)
  appendTriangle(positions, a, c, d)
}

function appendCap(positions: number[], points: Point[], forward: boolean) {
  const center: Point = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
    points.reduce((sum, point) => sum + point[2], 0) / points.length,
  ]
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    if (forward) appendTriangle(positions, center, points[index], next)
    else appendTriangle(positions, center, next, points[index])
  }
}

function sectionPoints(
  bottomWidth: number,
  topWidth: number,
  height: number,
  cornerCut: number,
  zForY: (y: number) => number,
): Point[] {
  const halfBottomWidth = bottomWidth / 2
  const halfTopWidth = topWidth / 2
  const halfHeight = height / 2
  const cut = Math.min(cornerCut, halfTopWidth * 0.35, halfHeight * 0.35)
  const xy: [number, number][] = [
    [-halfBottomWidth + cut, -halfHeight],
    [halfBottomWidth - cut, -halfHeight],
    [halfBottomWidth, -halfHeight + cut],
    [halfTopWidth, halfHeight - cut],
    [halfTopWidth - cut, halfHeight],
    [-halfTopWidth + cut, halfHeight],
    [-halfTopWidth, halfHeight - cut],
    [-halfBottomWidth, -halfHeight + cut],
  ]
  return xy.map(([x, y]) => [x, y, zForY(y)])
}

/** A compact two-section shell with controlled shoulder taper and front rake. */
export function createSectionedFrontShellGeometry(options: SectionedFrontShellOptions) {
  const backZ = -options.depth / 2
  const frontBaseZ = options.depth / 2
  const back = sectionPoints(
    options.backWidth,
    options.backWidth,
    options.height,
    options.cornerCut,
    () => backZ,
  )
  const front = sectionPoints(
    options.frontBottomWidth,
    options.frontTopWidth,
    options.height,
    options.cornerCut,
    (y) => frontBaseZ - ((y / options.height) + 0.5) * options.topRake,
  )
  const positions: number[] = []
  appendCap(positions, back, false)
  appendCap(positions, front, true)
  for (let index = 0; index < back.length; index += 1) {
    const next = (index + 1) % back.length
    appendQuad(positions, back[index], back[next], front[next], front[index])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.name = 'stage-14r-sectioned-train-front-shell'
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2).fill(0.5), 2),
  )
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export class TrainComponentGeometryCache {
  private readonly templates = new Map<string, THREE.BufferGeometry>()

  clone(key: string, factory: () => THREE.BufferGeometry) {
    let template = this.templates.get(key)
    if (!template) {
      template = factory()
      template.userData.stage14rComponentKey = key
      this.templates.set(key, template)
    }
    return template.clone()
  }

  getStats(): TrainComponentGeometryStats {
    let vertices = 0
    let triangles = 0
    for (const geometry of this.templates.values()) {
      const positionCount = geometry.getAttribute('position').count
      vertices += positionCount
      triangles += (geometry.index?.count ?? positionCount) / 3
    }
    return { templates: this.templates.size, vertices, triangles }
  }

  dispose() {
    this.templates.forEach((geometry) => geometry.dispose())
    this.templates.clear()
  }
}
