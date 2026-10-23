import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { JourneyStage } from "./data/journeyStages";

interface JourneyCameraProps {
  stages: JourneyStage[];
  scrollProgress: number; // 0 to 1
  overviewProgress?: number;
  supplierProgress?: number;
  mouseOffset: { x: number; y: number };
  resumeFromCurrent?: boolean;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

function smoothstep(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

export function JourneyCamera({
  stages,
  scrollProgress,
  overviewProgress = 1,
  supplierProgress = 1,
  mouseOffset,
  resumeFromCurrent = false,
}: JourneyCameraProps) {
  const { camera, scene, size } = useThree();
  const initialized = useRef(resumeFromCurrent);

  const keyframes = useMemo(() => {
    if (!stages || stages.length === 0) return [];
    const count = stages.length;
    return stages.map((stg, i) => ({
      p: count > 1 ? i / (count - 1) : 0,
      pos: stg.cameraPosition,
      target: stg.cameraTarget,
    }));
  }, [stages]);

  const scratch = useMemo(
    () => ({
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      front: new THREE.Vector3(),
      frontTarget: new THREE.Vector3(0, 4.8, 10),
      direction: new THREE.Vector3(),
    }),
    [],
  );
  const pointer = useRef({ x: 0, y: 0 });
  const currentLookAt = useRef(new THREE.Vector3(0.8, 1.8, 23.0));

  useFrame((_, delta) => {
    if (!keyframes || keyframes.length < 2) return;

    const p = clamp(scrollProgress, 0, 1);

    // Find bounding keyframe segment
    let idx = keyframes.length - 2;
    for (let i = 0; i < keyframes.length - 1; i++) {
      if (p >= keyframes[i]!.p && p <= keyframes[i + 1]!.p) {
        idx = i;
        break;
      }
    }
    const k1 = keyframes[idx];
    const k2 = keyframes[idx + 1] || k1;
    if (!k1 || !k2) return;
    const t = k2.p > k1.p ? smoothstep(k1.p, k2.p, p) : 0;

    const desiredPos = scratch.position.set(
      lerp(k1.pos[0], k2.pos[0], t),
      lerp(k1.pos[1], k2.pos[1], t),
      lerp(k1.pos[2], k2.pos[2], t),
    );

    const desiredTarget = scratch.target.set(
      lerp(k1.target[0], k2.target[0], t),
      lerp(k1.target[1], k2.target[1], t),
      lerp(k1.target[2], k2.target[2], t),
    );

    // ─── STARTING VIEW: WAREHOUSE OVERVIEW APPROACH ───
    const warehouseFrontTarget = scratch.frontTarget;
    const overviewHeight = clamp(17.5 * (size.width < 768 ? 1.25 : 1.0), 16.0, 24.0);
    const warehouseFrontPos = scratch.front.set(-6.5, overviewHeight, 43.5);

    const easeInOutCubic = (val: number) =>
      val < 0.5 ? 4 * val * val * val : 1 - Math.pow(-2 * val + 2, 3) / 2;

    const approach = easeInOutCubic(clamp(overviewProgress, 0, 1));

    desiredPos.lerp(warehouseFrontPos, 1 - approach);
    desiredTarget.lerp(warehouseFrontTarget, 1 - approach);

    // Responsive aspect ratio adjustments
    const aspect = size.width / Math.max(1, size.height);
    if (aspect < 1.0) {
      // Mobile portrait framing adjustment
      desiredPos
        .sub(desiredTarget)
        .multiplyScalar(clamp(1.0 + (1.0 - aspect) * 0.28, 1.0, 1.30))
        .add(desiredTarget);
      desiredPos.x += 0.8;
    }

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = aspect >= 1.5 ? 46 : aspect >= 1.0 ? 50 : 54;
      if (Math.abs(camera.fov - targetFov) > 0.1) {
        camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-8 * Math.min(delta, 0.1)));
        camera.updateProjectionMatrix();
      }
    }

    // Parallax mouse sway
    const pointerSmoothing = 1 - Math.exp(-12 * Math.min(delta, 0.1));
    pointer.current.x += (mouseOffset.x - pointer.current.x) * pointerSmoothing;
    pointer.current.y += (mouseOffset.y - pointer.current.y) * pointerSmoothing;

    desiredPos.x += pointer.current.x * 0.35 * approach;
    desiredPos.y += pointer.current.y * 0.25 * approach;

    // Smooth camera position & lookAt lerp
    const smoothing = 1 - Math.exp(-14 * Math.min(delta, 0.1));
    if (!initialized.current) {
      if (resumeFromCurrent) {
        camera.getWorldDirection(scratch.direction);
        currentLookAt.current.copy(camera.position).add(scratch.direction.multiplyScalar(20));
      } else {
        camera.position.copy(desiredPos);
        currentLookAt.current.copy(desiredTarget);
      }
      initialized.current = true;
    } else {
      camera.position.lerp(desiredPos, smoothing);
      currentLookAt.current.lerp(desiredTarget, smoothing);
    }
    camera.lookAt(currentLookAt.current);

    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = lerp(65, 45, approach);
      scene.fog.far = lerp(350, 280, approach);
    }
  });

  return null;
}
