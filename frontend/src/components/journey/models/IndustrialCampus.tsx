import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Part = { p: [number, number, number]; s: [number, number, number]; color: string };

// Static campus furniture shares one geometry/material and one draw call.
export function IndustrialCampus() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    const result: Part[] = [];
    const box = (p: Part["p"], s: Part["s"], color: string) => result.push({ p, s, color });
    for (const side of [-1, 1]) {
      const x = side * 28;
      box([x, 0.018, -118], [5, 0.025, 258], "#2f373d");
      box([side * 25.4, 0.1, -118], [0.22, 0.2, 258], "#8c989d");
      box([side * 30.6, 0.1, -118], [0.22, 0.2, 258], "#8c989d");
      for (let z = 6; z > -245; z -= 12) {
        box([x, 0.037, z], [0.12, 0.012, 3], "#e3e2d8");
        box([side * 30, 3.8, z], [0.12, 7.6, 0.12], "#243747");
        box([side * 29.4, 7.55, z], [1.3, 0.12, 0.32], "#101923");
        box([side * 29.4, 7.48, z], [0.9, 0.025, 0.23], "#f4f7fa");
        box([side * 25.8, 0.045, z], [0.3, 0.06, 1.2], "#101923");
      }
    }
    // Visitor parking on the entrance forecourt, clear of the security cabin.
    box([19, 0.005, 31], [23, 0.025, 19], "#3b4247");
    for (let i = 0; i < 8; i++) {
      box([9 + i * 2.8, 0.025, 32], [0.1, 0.012, 5.2], "#f4f7fa");
      box([10.3 + i * 2.8, 0.13, 29.5], [1.7, 0.24, 0.16], "#aab3bc");
    }
    // Expansion joints and drainage remain outside all operational aisles.
    for (let z = -15; z > -245; z -= 9) {
      for (const x of [-20, 20]) box([x, 0.006, z], [6, 0.008, 0.025], "#737d83");
    }
    return result;
  }, []);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    parts.forEach((part, i) => {
      transform.position.set(...part.p);
      transform.scale.set(...part.s);
      transform.updateMatrix();
      mesh.current!.setMatrixAt(i, transform.matrix);
      mesh.current!.setColorAt(i, color.set(part.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [parts]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, parts.length]} receiveShadow>
      <boxGeometry />
      <meshStandardMaterial roughness={0.86} metalness={0.12} />
    </instancedMesh>
  );
}
