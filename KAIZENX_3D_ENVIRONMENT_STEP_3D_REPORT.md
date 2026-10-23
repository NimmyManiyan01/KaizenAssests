# KAIZENX — Step 3D Scene-Wide Rendering Audit and Performance Optimization

Date: 22 October 2026  
Browser: Chromium 155 via Playwright CLI, headless  
Viewport: 1280×720  
DPR: 1  
CPU: 12 logical cores reported by the browser  
Memory: 16 GB reported by the browser  
GPU: Intel UHD Graphics (0x000046A3), ANGLE / Direct3D11  
WebGL: WebGL 2.0, max texture size 16384

## Summary

Step 3D added development-only renderer instrumentation and a stage-aware visibility optimization. Guided mode now avoids drawing distant storage, production, outbound, and city-environment sections when they are outside the active journey area. Explore mode keeps all sections visible.

The optimization materially reduced renderer workload in the measured overview scene. The browser session remained below the requested 45–60 FPS target on Balanced, so this is a targeted improvement rather than a full performance sign-off.

## Root-cause findings

The renderer was carrying the complete 16-stage environment at once. Before stage-aware visibility, the measured scene reported approximately 1,025 draw calls, 519k triangles, and 892 resident geometries at DPR 1. The dominant confirmed issue was scene-wide rendering of distant sections, not only the six redundant lights removed in Step 3C.

Six localized point lights were already removed in Step 3C. Step 3D did not add further light changes. Renderer counters confirmed that scene visibility was a higher-impact lever than those individual lights.

## Files changed

- `frontend/src/components/journey/ScenePerformanceDiagnostics.tsx` — development-only `renderer.info` and frame sampling bridge exposed as `window.__KAIZENX_PERF__`; no production overlay.
- `frontend/src/components/journey/JourneyCanvas.tsx` — stage-aware visibility groups for city environment, storage/inventory/forklift, production, and outbound scenes; instrumentation mounted inside the R3F scene.
- `KAIZENX_3D_ENVIRONMENT_STEP_3D_REPORT.md` — this report.

## Instrumentation

The diagnostic samples `renderer.info.render.calls`, triangles, points, lines, memory geometries/textures, renderer DPR, canvas size, shadow-map enabled state, and requestAnimationFrame timing. It keeps a bounded 600-sample buffer and resets `renderer.info` after each sample. It is guarded by `import.meta.env.DEV` and is not rendered in production.

## Baseline and after measurements

| Scene | FPS average | 1% low | Draw calls | Triangles | Geometries | Textures | DPR |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pre-optimization overview | 22.94 | 18.21 | 1,024.9 | 519,110.9 | 892 | 12 | 1.0 |
| Post-optimization overview | 30.79 | 3.71 | 387.1 | 460,085.7 | 252 | 11 | 1.0 |

The post-optimization 1% low is unstable because the headless session experienced intermittent long frames; average FPS and renderer counters are the more stable comparison in this run. The draw-call reduction was approximately 62%, and resident geometry count fell approximately 72%.

## Quality profile results

The quality selector was exercised for High, Balanced, and Performance. In this browser session, automatic quality management and a DPR-1 device cap caused the measured renderer DPR/counters to converge, so the following values are not a clean controlled profile comparison:

| Profile | Average FPS | 1% low | Calls | Triangles | Result |
|---|---:|---:|---:|---:|---|
| High | 30.60 | 3.71 | 387.3 | 460,088.8 | Measured, unstable low percentile |
| Balanced | 30.60 | 3.71 | 387.3 | 460,088.8 | Measured, unstable low percentile |
| Performance | 30.60 | 3.71 | 387.3 | 460,088.8 | Measured, unstable low percentile |

These identical readings must not be interpreted as proof that the profiles are visually identical. A follow-up should disable automatic quality before profile comparison or add an explicit dev-only fixed-profile harness.

## Controlled experiments

| Experiment | Result |
|---|---|
| Stage-aware visibility groups | Implemented and measured: calls 1,025 → 387; geometries 892 → 252; triangles 519k → 460k. |
| Remove redundant local point lights | Completed in Step 3C; no isolated FPS recovery demonstrated. |
| Disable shadows | NOT TESTED in this pass. |
| Reduce shadow-map resolution | NOT TESTED in this pass. |
| Reduce DPR | NOT TESTED as an isolated experiment; profile runs were affected by automatic quality. |
| Disable transparency | NOT TESTED. |
| Disable secondary vehicles | NOT TESTED. |
| Geometry/material deduplication | Not changed; no reliable attribution beyond scene visibility was available. |

## Visual regression evidence

- [Stage-aware scene after optimization](frontend/output/playwright/step3d-stage-aware-after.png)
- Existing Step 3A/3B dock, unloading, mobile, and authorization screenshots remain under `frontend/output/playwright/`.

Explore mode retains distant environment sections because the visibility groups use `isFreeOrbit || ...`. Guided mode changes visibility at section boundaries only; truck, gate, dock, forklift, pallet, and authorization animations remain controller-derived.

## Functional and build validation

- 16 stages: PASS — source still contains 16 stage IDs.
- Guided mode: PASS — existing guided journey remains wired.
- Explore mode: PASS — visibility groups explicitly preserve all content in free orbit.
- Replay: PASS — no replay/controller changes.
- Forward/backward scroll: PASS by preserved deterministic controller logic.
- Truck approach/reverse/alignment: PASS by preserved controller logic.
- Dock authorization: PASS by preserved Step 3B state machine.
- Forklift/pallet attachment: PASS by preserved controller logic.
- Mobile layout: PASS by existing responsive browser evidence; no layout code changed.
- Browser console: NOT PASS — existing API calls to `localhost:8000` still produce connection-refused errors. No new Three.js exception was observed.
- TypeScript: PASS — `npx tsc --noEmit`.
- Scoped lint: PASS — JourneyCanvas and ScenePerformanceDiagnostics.
- Production build: PASS — `npm run build` completed client, SSR, and Nitro output.

## Remaining limitations

1. GPU frame time, GPU memory, shadow-map resolution, visible mesh count, and active `useFrame` callback count remain unavailable from this page session.
2. The 1% low contains intermittent headless-browser stalls and should be repeated in a headed, stable GPU session before final hardware sign-off.
3. Quality profile comparison needs a fixed-profile harness with automatic quality disabled.
4. Backend connection errors are a separate environment issue; no backend code was changed.

**STEP 3D COMPLETE — READY FOR PERFORMANCE REVIEW**
