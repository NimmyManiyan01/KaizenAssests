import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import warehouseUrl from "../../../assets/3d-jutsu-KaizenX-Warehouse-Reference-Cutaway-2026-11-13-05-53-59.glb?url";

interface LogisticsTruckProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  doorsOpenProgress?: number;
  wheelRotation?: number;
  isReversing?: boolean;
  animRef?: React.MutableRefObject<{
    doorsOpenProgress: number;
    wheelRotation: number;
    isReversing: boolean;
  }>;
}

export function LogisticsTruck({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  doorsOpenProgress = 0,
  wheelRotation = 0,
  isReversing = false,
  animRef,
}: LogisticsTruckProps) {
  const { scene } = useGLTF(warehouseUrl);

  const leftDoorRef = useRef<THREE.Object3D | null>(null);
  const rightDoorRef = useRef<THREE.Object3D | null>(null);

  const clonedTruck = useMemo(() => {
    let truckObj: THREE.Object3D | null = null;

    scene.traverse((child) => {
      if (!truckObj && child.name.startsWith("Orange_delivery_truck")) {
        truckObj = child;
      }
    });

    if (!truckObj) {
      truckObj = scene;
    }

    const clone = truckObj.clone(true);

    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        if (!/^(Tread_block|Wheel_lug|Rim_ventilation|Alternating_reflector|Radiator_fins)/.test(child.name)) {
          child.castShadow = true;
        }
        child.receiveShadow = true;
      }

      if (child.name === "Rear_cargo_door") {
        leftDoorRef.current = child;
      } else if (child.name === "Rear_cargo_door001") {
        rightDoorRef.current = child;
      }
    });

    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const center = bounds.getCenter(new THREE.Vector3());
    // Rebase the parked warehouse truck before applying route coordinates.
    const normalized = new THREE.Group();
    clone.position.x -= center.x;
    clone.position.y -= bounds.min.y;
    clone.position.z -= center.z;
    normalized.add(clone);
    return normalized;
  }, [scene]);

  useFrame(() => {
    const dop = animRef?.current ? animRef.current.doorsOpenProgress : doorsOpenProgress;
    const angle = Math.max(0, Math.min(1, dop)) * 2.2;

    if (leftDoorRef.current) leftDoorRef.current.rotation.y = -angle;
    if (rightDoorRef.current) rightDoorRef.current.rotation.y = angle;
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <primitive object={clonedTruck} />
    </group>
  );
}

useGLTF.preload(warehouseUrl);
