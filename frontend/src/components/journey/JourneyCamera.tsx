import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { journeyStore } from "./journeyStore";
import { cameraPositionPath, cameraTargetPath } from "./cameraPath";
import type { JourneyStage } from "./data/journeyStages";

export function JourneyCamera({ mouseOffset }: {
  stages?: JourneyStage[];
  mouseOffset: { x: number; y: number };
}) {
  const { camera, size } = useThree();
  const initialized = useRef(false);
  const scratch = useMemo(() => ({
    position: new THREE.Vector3(), target: new THREE.Vector3(), lookAt: new THREE.Vector3(),
  }), []);
  useFrame((_, delta) => {
    const p = THREE.MathUtils.clamp(journeyStore.progress, 0, 1);
    cameraPositionPath.getPoint(p, scratch.position);
    cameraTargetPath.getPoint(p, scratch.target);
    if (size.width < 768) scratch.position.sub(scratch.target).multiplyScalar(1.35).add(scratch.target);
    scratch.position.x += mouseOffset.x * 0.35;
    scratch.position.y += mouseOffset.y * 0.25;
    const damping = initialized.current ? 1 - Math.exp(-18 * Math.min(delta, 0.1)) : 1;
    camera.position.lerp(scratch.position, damping);
    scratch.lookAt.lerp(scratch.target, damping);
    camera.lookAt(scratch.lookAt);
    initialized.current = true;
  });
  return null;
}
