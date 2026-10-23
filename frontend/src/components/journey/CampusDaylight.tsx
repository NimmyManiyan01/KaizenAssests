import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { QUALITY, useQuality } from "./quality";

export function CampusDaylight() {
  const { gl, scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const quality = useQuality();
  const resolution = QUALITY[quality].shadow;
  useEffect(() => {
    if (!sun.current) return;
    sun.current.shadow.map?.dispose();
    sun.current.shadow.map = null;
    sun.current.shadow.needsUpdate = true;
  }, [resolution]);
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const reflection = generator.fromScene(room, 0.04);
    const previous = scene.environment;
    const intensity = scene.environmentIntensity;
    scene.environment = reflection.texture;
    scene.environmentIntensity = 0.25;
    room.dispose();
    generator.dispose();
    return () => {
      scene.environment = previous;
      scene.environmentIntensity = intensity;
      reflection.dispose();
    };
  }, [gl, scene]);
  useFrame(({ camera }) => {
    if (!sun.current) return;
    // Translate a constant daylight direction along the campus without changing camera anchors.
    const z = camera.position.z - 15;
    sun.current.position.set(25, 40, z + 25);
    sun.current.target.position.set(0, 0, z);
    sun.current.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={sun}
      intensity={2.2}
      color="#fff4df"
      castShadow
      shadow-mapSize={[resolution, resolution]}
      shadow-camera-near={1}
      shadow-camera-far={120}
      shadow-camera-left={-36}
      shadow-camera-right={36}
      shadow-camera-top={36}
      shadow-camera-bottom={-36}
      shadow-normalBias={0.035}
      shadow-bias={-0.0002}
    />
  );
}
