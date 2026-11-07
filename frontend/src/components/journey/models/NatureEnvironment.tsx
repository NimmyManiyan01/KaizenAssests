import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CityBuildings } from "./CityBuildings";

// Continuous terrain remains below the entire facility and both vehicle approaches.
function landscapeHeight(x: number, z: number) {
  void x;
  void z;
  return -0.12;
}

export function NatureEnvironment() {
  const terrain = useMemo(() => {
    // 4x4 subdivision is optimal for a perfectly flat planar ground, saving ~57,000 vertices
    const geometry = new THREE.PlaneGeometry(600, 700, 4, 4);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -170);
    const vertices = geometry.attributes.position;
    const colors = new Float32Array(vertices.count * 3);
    const asphalt = new THREE.Color("#46515b");
    const color = new THREE.Color();
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i),
        z = vertices.getZ(i);
      const y = landscapeHeight(x, z);
      vertices.setY(i, y);
      color.copy(asphalt);
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, []);

  useEffect(() => () => terrain.dispose(), [terrain]);

  return (
    <group>
      <mesh geometry={terrain} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.98} metalness={0} />
      </mesh>
      <CityBuildings />
    </group>
  );
}
