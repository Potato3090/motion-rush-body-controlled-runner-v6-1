import * as THREE from 'three'

/** Shared source primitives are cloned before merged transforms mutate them. */
export class VegetationGeometryCache {
  private readonly templates = new Map<string, THREE.BufferGeometry>()

  clone(key: string, create: () => THREE.BufferGeometry) {
    let template = this.templates.get(key)
    if (!template) {
      template = create()
      template.name = `stage-17-vegetation-template-${key}`
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

