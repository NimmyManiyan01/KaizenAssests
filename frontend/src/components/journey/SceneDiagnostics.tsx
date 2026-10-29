import { Profiler, useCallback } from "react";
import type { ReactNode } from "react";
import { useThree } from "@react-three/fiber";

/** Dev-only evidence for idle versus scrolling reconciliation; never drives business behavior. */
export function SceneDiagnostics({ children }: { children: ReactNode }) {
  const scene = useThree((state) => state.scene);
  const record = useCallback(
    (_id: string, _phase: string, duration: number) => {
      const stats = scene.userData.reactProfile ?? { commits: 0, durationMs: 0 };
      stats.commits++;
      stats.durationMs += duration;
      scene.userData.reactProfile = stats;
    },
    [scene],
  );
  return import.meta.env.DEV ? (
    <Profiler id="journey-scene" onRender={record}>
      {children}
    </Profiler>
  ) : (
    children
  );
}
