import { useLayoutEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Only wrap immutable scenery. Actors, shutters and animated text stay outside. */
export function StaticBatch({ children }: { children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const group = root.current;
    if (!group) return;
    group.updateWorldMatrix(true, true);
    const inverse = group.matrixWorld.clone().invert();
    const transform = new THREE.Matrix4();
    const center = new THREE.Vector3();
    const keys = new Map<THREE.Material, string>();
    const tintable = (mesh: THREE.Mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      return !material.map && !material.vertexColors && !!material.color;
    };
    const buckets = new Map<string, THREE.Mesh[]>();
    group.traverseVisible((object) => {
      for (let node: THREE.Object3D | null = object; node && node !== group; node = node.parent) {
        if (node.userData.journeyAnimated) return;
      }
      if (object.type !== "Mesh" || object.children.length) return;
      const mesh = object as THREE.Mesh;
      if (Array.isArray(mesh.material) || mesh.material.transparent ||
          !(mesh.material instanceof THREE.MeshStandardMaterial || mesh.material instanceof THREE.MeshBasicMaterial) ||
          Object.keys(mesh.geometry.morphAttributes).length) return;
      let materialKey = keys.get(mesh.material);
      if (!materialKey) {
        const json = (mesh.material as any).toJSON() as Record<string, unknown>;
        delete json.uuid; delete json.metadata; delete json.name;
        if (tintable(mesh)) { delete json.color; json.vertexColors = true; }
        materialKey = JSON.stringify(json);
        keys.set(mesh.material, materialKey);
      }
      mesh.getWorldPosition(center);
      // Small spatial buckets preserve frustum culling throughout the long site.
      const attributes = Object.entries(mesh.geometry.attributes)
        .map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}`).sort().join(";");
      const key = `${Math.floor(center.x / 32)},${Math.floor(center.z / 32)}:${materialKey}:${attributes}:${!!mesh.geometry.index}:${mesh.castShadow}:${mesh.receiveShadow}`;
      const bucket = buckets.get(key) || [];
      bucket.push(mesh); buckets.set(key, bucket);
    });
    const created: THREE.Mesh[] = [];
    const materials: THREE.Material[] = [];
    const detached: { mesh: THREE.Mesh; parent: THREE.Object3D }[] = [];
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const parts = meshes.map(mesh => {
        // Preserve existing indices instead of expanding every triangle and
        // hashing all its vertices back together on the browser's main thread.
        const geometry = mesh.geometry.clone();
        transform.multiplyMatrices(inverse, mesh.matrixWorld);
        geometry.applyMatrix4(transform);
        if (tintable(mesh)) {
          const tint = (mesh.material as THREE.MeshStandardMaterial).color;
          const colors = new Float32Array(geometry.attributes.position!.count * 3);
          for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
          geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        }
        return geometry;
      });
      const geometry = mergeGeometries(parts, false);
      parts.forEach(part => part.dispose());
      if (!geometry) continue;
      geometry.computeBoundingSphere();
      const first = meshes[0]!;
      let material = first.material;
      if (tintable(first)) {
        const colored = (first.material as THREE.MeshStandardMaterial).clone();
        colored.color.set(0xffffff);
        colored.vertexColors = true;
        material = colored;
        materials.push(colored);
      }
      const batched = new THREE.Mesh(geometry, material);
      batched.castShadow = first.castShadow;
      batched.receiveShadow = first.receiveShadow;
      batched.name = "static-scenery-batch";
      batched.matrixAutoUpdate = false;
      group.add(batched); created.push(batched);
      meshes.forEach(mesh => {
        if (mesh.parent) detached.push({ mesh, parent: mesh.parent });
        mesh.removeFromParent();
      });
    }
    return () => {
      detached.forEach(({ mesh, parent }) => parent.add(mesh));
      created.forEach(mesh => { group.remove(mesh); mesh.geometry.dispose(); });
      materials.forEach(material => material.dispose());
    };
  }, []);
  return <group ref={root}>{children}</group>;
}
