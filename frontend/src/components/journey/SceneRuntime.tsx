import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Object3D } from "three";

export function SceneRuntime() {
  const { gl, scene, camera } = useThree();
  const shadow = useRef({ elapsed: 0 });
  useEffect(() => {
    // Render moving-actor shadows at 30 Hz independently of the main frame rate.
    const previous = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => { gl.shadowMap.autoUpdate = previous; };
  }, [gl]);
  useEffect(() => {
    // Warm the entire scene's shaders before scrolling reveals new materials.
    // compileAsync uses parallel shader compilation where the driver supports it.
    let cancelled = false;
    const prepare = () => {
      const states: { object: Object3D; visible: boolean; culled: boolean }[] = [];
      scene.traverse(object => {
        states.push({ object, visible: object.visible, culled: object.frustumCulled });
        object.visible = true;
        object.frustumCulled = false;
      });
      return () => states.forEach(({ object, visible, culled }) => {
        object.visible = visible;
        object.frustumCulled = culled;
      });
    };
    // Include initially hidden pallets, scanner and dispatch actors as well.
    const restoreCompilation = prepare();
    const compilation = gl.compileAsync(scene, camera);
    restoreCompilation();
    void compilation.then(() => {
      if (cancelled) return;
      // Shader compilation alone does not upload offscreen geometry or prepare
      // shadow programs. Draw the complete scene once before the journey starts
      // so entering the warehouse cannot trigger a large first-use GPU stall.
      const restore = prepare();
      try {
        gl.shadowMap.needsUpdate = true;
        gl.render(scene, camera);
      } finally {
        restore();
      }
      gl.shadowMap.needsUpdate = true;
      gl.render(scene, camera);
      gl.domElement.dataset.sceneReady = "true";
    }).catch(() => {
      if (!cancelled) gl.domElement.dataset.sceneReady = "true";
    });
    return () => { cancelled = true; delete gl.domElement.dataset.sceneReady; };
  }, [gl, scene, camera]);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("journeyDebug")) return;
    const target = window as Window & { __journeyDebug?: unknown };
    target.__journeyDebug = { gl, scene, camera };
    return () => { delete target.__journeyDebug; };
  }, [gl, scene, camera]);
  useFrame((_, delta) => {
    shadow.current.elapsed += delta;
    if (shadow.current.elapsed >= 1 / 30) {
      gl.shadowMap.needsUpdate = true;
      shadow.current.elapsed = 0;
    }
  });
  return null;
}
