import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/** Batch only explicitly static subtrees. Moving parent transforms remain untouched. */
export function StaticMeshBatch({
  children,
  revision = "",
  dynamic = false,
}: {
  children: ReactNode;
  revision?: string;
  dynamic?: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const updates = useRef<(() => void)[]>([]);

  useFrame(() => {
    if (!dynamic || !root.current) return;
    root.current.updateWorldMatrix(true, true);
    updates.current.forEach((update) => update());
  });

  useLayoutEffect(() => {
    const group = root.current;
    if (!group) return;
    group.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const batches = new Map<string, THREE.Mesh[]>();

    group.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        object instanceof THREE.InstancedMesh ||
        !object.visible ||
        Array.isArray(object.material)
      )
        return;

      const material = object.material as THREE.MeshStandardMaterial;
      if (
        !(material instanceof THREE.MeshStandardMaterial) ||
        material.transparent ||
        !material.color ||
        (dynamic && material.emissive && material.emissive.getHex() !== 0) ||
        !["BoxGeometry", "CylinderGeometry", "TorusGeometry", "SphereGeometry"].includes(
          object.geometry.type,
        )
      )
        return;

      const emissiveHex = material.emissive ? material.emissive.getHex() : 0;
      const key = [
        object.geometry.type,
        object.geometry.type === "BoxGeometry"
          ? "unit-box"
          : JSON.stringify((object.geometry as THREE.CylinderGeometry).parameters),
        material.roughness ?? 0.5,
        material.metalness ?? 0,
        emissiveHex,
        material.emissiveIntensity ?? 1,
        material.map?.uuid ?? "",
        material.roughnessMap?.uuid ?? "",
        material.bumpMap?.uuid ?? "",
        material.bumpScale ?? 0,
        material.side,
        object.castShadow,
        object.receiveShadow,
      ].join(":");

      const meshes = batches.get(key) ?? [];
      meshes.push(object);
      batches.set(key, meshes);
    });

    const cleanup: (() => void)[] = [];
    const fallbackColor = new THREE.Color("white");

    for (const meshes of batches.values()) {
      if (meshes.length < 3) continue;
      const first = meshes[0]!;
      const firstMaterial = first.material as THREE.MeshStandardMaterial;
      const material = firstMaterial.clone();
      if (material.color) {
        material.color.set("white");
      }

      const geometry =
        first.geometry.type === "BoxGeometry" ? new THREE.BoxGeometry() : first.geometry.clone();
      const instance = new THREE.InstancedMesh(geometry, material, meshes.length);
      instance.castShadow = first.castShadow;
      instance.receiveShadow = first.receiveShadow;

      const transform = new THREE.Matrix4();
      const dimensions = new THREE.Matrix4();

      const update = () => {
        if (dynamic) inverse.copy(group.matrixWorld).invert();
        meshes.forEach((mesh, i) => {
          dimensions.identity();
          if (mesh.geometry.type === "BoxGeometry") {
            const p = (mesh.geometry as THREE.BoxGeometry).parameters;
            dimensions.makeScale(p.width, p.height, p.depth);
          }
          transform.copy(inverse).multiply(mesh.matrixWorld).multiply(dimensions);
          instance.setMatrixAt(i, transform);

          const meshMat = mesh.material as THREE.MeshStandardMaterial;
          const targetColor =
            meshMat && !Array.isArray(meshMat) && meshMat.color ? meshMat.color : fallbackColor;
          instance.setColorAt(i, targetColor);
          mesh.visible = false;
        });
        instance.instanceMatrix.needsUpdate = true;
        if (instance.instanceColor) instance.instanceColor.needsUpdate = true;
        instance.computeBoundingSphere();
      };

      update();
      if (dynamic) updates.current.push(update);
      group.add(instance);

      cleanup.push(() => {
        group.remove(instance);
        meshes.forEach((mesh) => {
          mesh.visible = true;
        });
        instance.dispose();
        geometry.dispose();
        material.dispose();
      });
    }

    return () => {
      updates.current = [];
      cleanup.forEach((dispose) => dispose());
    };
  }, [revision, dynamic]);

  return <group ref={root}>{children}</group>;
}
