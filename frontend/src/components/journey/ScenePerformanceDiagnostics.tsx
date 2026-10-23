import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

type PerfSample = {
  fps: number;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  dpr: number;
  width: number;
  height: number;
  shadowMaps: number;
};

declare global {
  interface Window {
    __KAIZENX_PERF__?: {
      samples: PerfSample[];
      reset: () => void;
    };
  }
}

/** Dev-only renderer counters. It is intentionally not rendered into the UI. */
export function ScenePerformanceDiagnostics() {
  const { gl, size } = useThree();
  const samples = useRef<PerfSample[]>([]);
  const previous = useRef(performance.now());

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const reset = () => {
      samples.current = [];
      gl.info.reset();
      previous.current = performance.now();
    };
    window.__KAIZENX_PERF__ = { samples: samples.current, reset };
    return () => {
      delete window.__KAIZENX_PERF__;
    };
  }, [gl]);

  useFrame(() => {
    if (!import.meta.env.DEV) return;
    const now = performance.now();
    const delta = Math.max(0.1, now - previous.current);
    previous.current = now;
    const info = gl.info;
    samples.current.push({
      fps: 1000 / delta,
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      dpr: gl.getPixelRatio(),
      width: size.width,
      height: size.height,
      shadowMaps: gl.shadowMap.enabled ? 1 : 0,
    });
    if (samples.current.length > 600) samples.current.shift();
    info.reset();
  });

  return null;
}
