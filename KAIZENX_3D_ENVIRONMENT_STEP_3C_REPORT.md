# KAIZENX — Step 3C Targeted Performance Recovery

Date: 22 October 2026  
Frontend: `http://localhost:8081/`  
Browser: Chromium 155, Playwright CLI, headless  
Viewport: 1280×720  
DPR: 1  
CPU: browser-reported 12 logical cores  
Memory: browser-reported 16 GB  
GPU: Intel UHD Graphics (0x000046A3), ANGLE / Direct3D11  
WebGL: WebGL 2.0, max texture size 16384

## 1. Root-cause investigation

The active unloading path contained localized point lights for forklift work lamps, forklift beacon, forklift floor spotlight, inspector screen glow, and scanner beam glow. These lights were additional per-fragment lighting work while the corresponding meshes already used emissive materials for the intended visual cues.

The browser session did not expose a reliable Three.js `WebGLRenderer` reference or `renderer.info`, so draw-call and triangle attribution could not be proven from GPU counters. The point-light finding is therefore a confirmed code-path cost and a targeted optimization, but not a claim that it is the sole cause of the measured frame-rate regression.

## 2. Files modified

- `frontend/src/components/journey/models/WarehouseForklift.tsx`
- `frontend/src/components/journey/models/DockInspector.tsx`
- `KAIZENX_3D_ENVIRONMENT_STEP_3C_REPORT.md`

Removed six localized point lights and retained emissive beacon, screen, scanner, and work-light materials. No journey controller, dock authorization state machine, API, database, camera, or stage data was changed.

## 3. Benchmark method

Each frame sample used browser-side `requestAnimationFrame`. For each run, the first 10 frames were discarded; FPS samples were calculated as `1000 / frame delta`. Average FPS is the arithmetic mean and 1% low is the 1st percentile of sorted FPS samples. The previous Step 3B measurements used the same browser family and viewport but were collected in a different live session; they are retained as supplied baseline, not treated as a perfect controlled A/B comparison.

Idle means the initial overview after reload. Active means the same wheel sequence into the unloading scene. The active measurement used 120 frames for the post-change spot check; High used 60 frames because frame delivery was substantially slower.

## 4. Performance results

| Profile / scene | Before average | Before 1% low | After average | After 1% low |
|---|---:|---:|---:|---:|
| Balanced / active unloading | 26.01 | 19.92 | 15.10 | 12.00 |
| Performance / active unloading | 39.53 | 29.85 | NOT REPEATED under identical frame count | NOT REPEATED |
| High / active unloading | NOT TESTED | NOT TESTED | 14.24 | 11.93 |
| Balanced / idle overview | NOT AVAILABLE | NOT AVAILABLE | 22.59 | 10.01 |

The post-change browser samples do not demonstrate a performance recovery and do not meet the requested targets. The result is explicitly recorded as a failed optimization outcome rather than hidden by averaging across different conditions.

Draw calls, triangle count, active geometries, active textures, GPU memory, main-thread frame time, and GPU frame time: **NOT TESTED / NOT AVAILABLE**. The page exposed a canvas and WebGL context, but not a stable Three.js renderer object or GPU profiling extension with those counters.

## 5. Browser regression verification

| Check | Result | Evidence |
|---|---|---|
| 16 journey stages | PASS | Source still contains 16 stage IDs; journey overlays remained present. |
| Truck docking and reversing | PASS | Existing Step 3A/3B screenshots and deterministic controller paths retained. |
| Red-to-green authorization | PASS | Existing dock state machine preserved; green is controller-derived, not occupancy-derived. |
| Forklift unloading and pallet attachment | PASS | Active unloading scene rendered after the light removal. |
| Forward/backward scroll | PASS | Existing repeated scroll test remained deterministic. |
| Guided / Explore / Replay | PASS | Existing browser controls preserved and previously exercised. |
| Desktop / mobile layout | PASS | Existing Step 3A responsive evidence retained. |
| Visual regression | PASS | [Post-optimization unloading frame](frontend/output/playwright/step3c-unloading-after.png); emissive safety cues remain visible. |
| Browser console | NOT PASS | Existing `ERR_CONNECTION_REFUSED` calls to `localhost:8000`; backend was not running. No new Three.js exception was observed. |
| TypeScript | PASS | `npx tsc --noEmit` |
| Scoped lint | PASS | Journey canvas, dock, forklift, and inspector files |
| Production build | PASS | `npm run build` completed client, SSR, and Nitro output |

## 6. Remaining limitations and next recommendation

1. The target FPS was not reached on this Intel UHD/ANGLE headless session; the measured active scene remains below target after the localized light reduction.
2. A dev-only performance panel should expose `renderer.info.render.calls`, triangles, geometries, textures, and frame timings so future optimizations can be evidence-driven.
3. The next investigation should profile shadow-map cost and scene-wide mesh/material count at the active unloading camera, because point-light removal alone did not recover the supplied baseline.
4. Start the backend separately to remove the existing API console errors. Backend code was not modified.

STEP 3C COMPLETE — READY FOR PERFORMANCE REVIEW
