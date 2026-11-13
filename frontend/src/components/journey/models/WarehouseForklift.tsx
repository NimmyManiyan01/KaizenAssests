import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import forkliftUrl from "../../../assets/FORKLIFT.glb?url";
import { StaticBatch } from "../StaticBatch";

interface WarehouseForkliftProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  liftProgress?: number;
  liftProgressRef?: React.MutableRefObject<number>;
}

export function WarehouseForklift({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  liftProgress = 0,
  liftProgressRef,
}: WarehouseForkliftProps) {
  const { scene } = useGLTF(forkliftUrl);
  const mastRef = useRef<THREE.Object3D | null>(null);

  const clonedForklift = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
      if (child.name === "Lift_carriage" || child.name.toLowerCase().includes("mast")) {
        mastRef.current = child;
      }
    });
    if (mastRef.current) mastRef.current.userData.journeyAnimated = true;
    return clone;
  }, [scene]);

  useFrame(() => {
    const lift = liftProgressRef ? liftProgressRef.current : liftProgress;
    if (mastRef.current) {
      mastRef.current.position.y = lift * 2.2;
    }
  });

  return (
    <group position={position} rotation={rotation}>
      <StaticBatch><primitive object={clonedForklift} /></StaticBatch>
    </group>
  );
}

useGLTF.preload(forkliftUrl);
