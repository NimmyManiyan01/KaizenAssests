import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";

// Small deterministic, linear-data maps: no network assets or color-space conversion.
function surfaceMap(cladding: boolean) {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 7391;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = seed / 4294967296;
      const value = cladding
        ? 180 + Math.round(Math.cos((x / 16) * Math.PI * 2) * 26 + grain * 8)
        : 160 + Math.round(grain * 80);
      const offset = (y * size + x) * 4;
      pixels.set([value, value, value, 255], offset);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(cladding ? 8 : 12, cladding ? 2 : 12);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Limits material changes to the static environment; operational models are siblings. */
export function CampusSurfaceFinish({ children }: { children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  useEffect(() => {
    const mineral = surfaceMap(false);
    const cladding = surfaceMap(true);
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const geometries = new Map<THREE.Mesh, THREE.BufferGeometry>();
    const sharedGeometry = new Map<string, THREE.BufferGeometry>();
    const replacements = new Map<THREE.Material, THREE.Material>();
    root.current?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      const parameters = (geometry as THREE.BufferGeometry & { parameters?: object }).parameters;
      if (parameters && !geometry.getAttribute("instanceColor")) {
        const key = `${geometry.type}:${JSON.stringify(parameters)}`;
        const shared = sharedGeometry.get(key);
        if (shared) {
          geometries.set(object, geometry);
          object.geometry = shared;
        } else sharedGeometry.set(key, geometry);
      }
      originals.set(object, object.material);
      const finish = (source: THREE.Material) => {
        const cached = replacements.get(source);
        if (cached) return cached;
        if (!(source instanceof THREE.MeshStandardMaterial)) return source;
        const glass =
          (source.transparent && source.opacity < 0.8 && source.roughness < 0.4) ||
          (object instanceof THREE.InstancedMesh && source.roughness === 0.24);
        const material = glass
          ? new THREE.MeshPhysicalMaterial({
              color: "#b8c9cf",
              roughness: 0.22,
              metalness: 0,
              transparent: true,
              opacity: 0.42,
              ior: 1.5,
              clearcoat: 1,
              clearcoatRoughness: 0.16,
              depthWrite: false,
              side: source.side,
            })
          : source.clone();
        if (!glass && !source.map) {
          const metal = source.metalness > 0.14;
          material.roughnessMap = metal ? cladding : mineral;
          material.bumpMap = metal ? cladding : mineral;
          material.bumpScale = metal ? 0.018 : 0.025;
          material.roughness = metal ? 0.78 : 0.98;
          material.metalness = metal ? 0.25 : 0;
          if (metal && material.color && material.color.g > material.color.r * 1.4) {
            material.color.set("#243747");
          }
        }
        // Retain useful white luminaires but remove decorative cyan roof emission.
        if (material.emissive && material.emissive.b > material.emissive.r * 1.2) {
          material.emissive.set("#dce5ea");
          material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.12);
        }
        replacements.set(source, material);
        return material;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(finish)
        : finish(object.material);
    });
    return () => {
      originals.forEach((material, mesh) => {
        mesh.material = material;
      });
      replacements.forEach((material) => material.dispose());
      geometries.forEach((geometry, mesh) => {
        mesh.geometry = geometry;
      });
      mineral.dispose();
      cladding.dispose();
    };
  }, []);
  return <group ref={root}>{children}</group>;
}
