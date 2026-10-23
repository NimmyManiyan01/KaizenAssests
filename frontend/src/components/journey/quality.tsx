import { createContext, useContext, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

export type Quality = "HIGH" | "BALANCED" | "PERFORMANCE";

export const QUALITY = {
  HIGH: { dpr: 1.25, shadow: 2048, foliageCards: 1, distantShadow: 100 },
  BALANCED: { dpr: 1.0, shadow: 1024, foliageCards: 0.7, distantShadow: 65 },
  PERFORMANCE: { dpr: 0.8, shadow: 512, foliageCards: 0.4, distantShadow: 40 },
} as const;

export const QualityContext = createContext<Quality>("HIGH");
export const useQuality = () => useContext(QualityContext);

export function AdaptiveQuality({
  automatic,
  onChange,
}: {
  automatic: boolean;
  onChange: (quality: Quality) => void;
}) {
  const quality = useQuality();
  const { setDpr, gl } = useThree();
  const sample = useRef({ elapsed: 0, frames: 0, slow: 0, fast: 0, cooldown: 0 });

  useEffect(() => {
    const maxDeviceDpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    setDpr(Math.min(maxDeviceDpr, QUALITY[quality].dpr));
    gl.domElement.dataset.quality = quality;
    sample.current = { elapsed: 0, frames: 0, slow: 0, fast: 0, cooldown: 10 };
  }, [quality, automatic, setDpr, gl]);

  useEffect(() => {
    const reset = () => {
      sample.current.elapsed = 0;
      sample.current.frames = 0;
    };
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);

  useFrame((_, delta) => {
    if (
      !automatic ||
      document.hidden ||
      delta > 1 ||
      (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    )
      return;

    const s = sample.current;
    s.cooldown = Math.max(0, s.cooldown - delta);
    s.elapsed += delta;
    s.frames++;

    if (s.elapsed < 3) return;

    const fps = s.frames / s.elapsed;
    s.elapsed = 0;
    s.frames = 0;

    s.slow = fps < 30 ? s.slow + 1 : 0;
    s.fast = fps > 56 ? s.fast + 1 : 0;

    if (s.cooldown > 0) return;

    if (s.slow >= 2 && quality !== "PERFORMANCE") {
      onChange(quality === "HIGH" ? "BALANCED" : "PERFORMANCE");
      s.slow = 0;
    } else if (s.fast >= 3 && quality !== "HIGH") {
      onChange(quality === "PERFORMANCE" ? "BALANCED" : "HIGH");
      s.fast = 0;
    }

    gl.domElement.dataset.quality = quality;
  });

  return null;
}
