# KAIZENX — Step 4B Final GRN/QC Validation and Performance Diagnosis

## Scope and result

Step 4B continued from Step 4A without starting Step 5. A lightweight, deterministic QC inspection mode was added so the existing receiving demonstration can visibly inspect all four outcomes without changing backend state, adding journey stages, or altering production QR actions.

## Exact files changed

- `frontend/src/components/journey/models/ReceivingInspectionStation.tsx` — added deterministic `#qc=` inspection selection, distinct outcome colors, non-accepted zero-putaway treatment, accepted-only demo QR gating, and corrected the demo QR label encoding.
- `KAIZENX_3D_ENVIRONMENT_STEP_4B_REPORT.md` — this report.

No backend, authentication, database, operational GRN API, inventory API, camera architecture, stage data, dock logic, or production QR action was changed.

## QC outcome verification

The original station exposed four labels but only activated the accepted result. The correction makes the demonstration inspectable with a URL hash, for example `#qc=REJECTED`, while preserving the existing journey progress and stage count.

| Outcome | Browser result | Quantity / downstream treatment | Accepted demo QR |
|---|---|---|---|
| ACCEPTED | PASS — green active indicator and `GRN ACCEPTED` | `480 UNITS`; eligible demonstration path | Visible after QC completion |
| REJECTED | PASS — red active indicator and `GRN REJECTED` | `0 PUTAWAY`; not eligible | Hidden |
| DAMAGED | PASS — orange active indicator and `GRN DAMAGED` | `0 PUTAWAY`; not eligible | Hidden |
| HELD | PASS — yellow active indicator and `GRN HELD` | `0 PUTAWAY`; not eligible | Hidden |

The four states were loaded in Chromium at the receiving/QC position and screenshot-captured independently. Screenshots:

- [Accepted](frontend/output/playwright/step4b-qc-accepted.png)
- [Rejected](frontend/output/playwright/step4b-qc-rejected.png)
- [Damaged](frontend/output/playwright/step4b-qc-damaged.png)
- [Held](frontend/output/playwright/step4b-qc-held.png)

This is a visual demonstration fixture only. It does not create inventory or authorization records. Backend-dependent proof that rejected, damaged, and held quantities cannot enter accepted inventory remains NOT TESTED because `localhost:8000` is unavailable.

## QR validation

- PASS: QR is rendered only when the journey reaches QC completion and the selected demonstration outcome is `ACCEPTED`.
- PASS: QR is associated with the visible accepted batch label `QR · MAT-1001` and is explicitly labelled `DEMO BATCH QR - MAT-1001` in source.
- PASS: Rejected, damaged, and held screenshots show no accepted QR reveal.
- PASS: Existing production QR generation/download/print/scan components were not changed.
- PARTIAL: Reverse-scroll restoration was exercised through the journey but not instrumented with a DOM-level QR assertion.
- PARTIAL: Replay was clicked through the exact toolbar button and reset scroll to `0`; a full visual capture after the reset was not repeated for every outcome hash.

## Full journey regression

- 16 stages: PASS by source inspection; 16 stage declarations remain.
- Guided mode: PARTIAL; default journey loaded and forward/backward scroll exercised, but a complete timed beginning-to-completion audit was not completed.
- Explore mode: PASS from the existing browser control.
- Replay: PASS for exact toolbar control click; scroll returned to `0`.
- Forward scrolling: PASS for reaching receiving/QC positions and completing multiple scroll increments.
- Reverse scrolling: PASS for returning toward the beginning during the regression loop.
- Gate and dock sequence: PARTIAL; rendered in earlier Step 4A/Step 4B browser captures, not continuously frame-audited here.
- Forklift unloading: NOT FULLY TESTED in this final pass.
- Receiving station: PASS.
- QC transitions: PASS for controller progress plus all four deterministic inspection outcomes.
- QR reveal: PASS for accepted-only gating; reverse/replay visual reset remains PARTIAL.
- Transition toward putaway: NOT FULLY TESTED.
- Desktop layout: PASS at `1280×720`.
- Mobile layout: PASS from the Step 4A browser capture at `390×844`.

## Matched performance conditions

Browser instrumentation was run in the same local Chromium session and at the same desktop viewport, with the receiving/QC camera position held at `scrollY=3400` before quality-profile sampling.

- Browser: HeadlessChrome 155.0.0.0.
- GPU renderer: `ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
- Vendor: Google/Intel.
- Viewport: `1280×720`.
- Page DPR: 1.
- Renderer DPR: 0.8 in the sampled canvas.
- Warm-up: approximately 1.8 seconds after each profile switch.
- Samples: three consecutive 90-frame windows per profile.
- Approximate 1% low: lowest sorted sample at the 1% index in each 90-frame window; this is not a statistically robust hardware 1% low.
- Instrumentation: existing `window.__KAIZENX_PERF__`; it reports renderer FPS, calls, triangles, geometries, textures, DPR, and viewport.
- GPU frame time, GPU memory, and CPU frame time: NOT AVAILABLE.

### Three-sample results at the receiving/QC position

| Profile | Sample | Avg FPS | Approx. 1% low | Calls | Triangles | Geometries | Textures |
|---|---:|---:|---:|---:|---:|---:|---:|
| HIGH | 1 | 23.96 | 4.18 | 376 | 65,240 | 359 | 7 |
| HIGH | 2 | 21.26 | 4.18 | 376 | 65,240 | 359 | 7 |
| HIGH | 3 | 16.87 | 14.77 | 376 | 65,240 | 359 | 7 |
| BALANCED | 1 | 19.29 | 4.98 | 376 | 65,240 | 359 | 7 |
| BALANCED | 2 | 19.78 | 4.98 | 376 | 65,240 | 359 | 7 |
| BALANCED | 3 | 18.28 | 15.41 | 376 | 65,240 | 359 | 7 |
| PERFORMANCE | 1 | 24.40 | 3.13 | 376 | 65,240 | 359 | 7 |
| PERFORMANCE | 2 | 26.32 | 16.37 | 376 | 65,240 | 359 | 7 |
| PERFORMANCE | 3 | 26.24 | 16.37 | 376 | 65,240 | 359 | 7 |

The renderer reported a real Intel ANGLE D3D11 GPU path, not a software renderer. However, automatic quality adaptation was active in the page and the browser instrumentation is frame-sample based, so the low values include warm-up/profile-transition outliers.

## Explanation of the 42.45 FPS versus 17.13 FPS discrepancy

The two earlier numbers were not matched benchmarks:

- `42.45 FPS` was collected at approximately `scrollY=3678`, after a different scroll history, with the page in the Performance quality state and a different active scene composition.
- `17.13 FPS` was collected at `scrollY=3400`, the receiving/QC position, with a different quality/profile transition history and a different renderer sample window.

The matched Step 4B sample shows the receiving/QC position settling around 18–26 FPS depending on profile, rather than reproducing 42 FPS. The evidence therefore indicates scene-position and measurement-window differences, compounded by adaptive quality/profile transitions, rather than proof of a single new geometry regression. At the matched position, renderer calls and triangles remain stable across profiles; profile selection primarily changes render scale/quality rather than scene complexity.

No targeted performance correction was made in this pass because the available instrumentation does not isolate CPU versus GPU bottleneck or identify a single confirmed component culprit. Essential scene quality was not reduced merely to improve the number.

## Technical regression checks

- TypeScript: PASS (`npx.cmd tsc --noEmit`).
- Scoped lint: PASS for the modified receiving station and journey canvas.
- Production build: PASS (`npm.cmd run build`). Existing large-chunk warnings remain.
- Browser console: NOT CLEAN because existing `localhost:8000` connection-refused API errors continue; no new Three.js exception was identified during the QC captures.
- Backend/API/database behavior: PRESERVED; not modified.
- Journey stage count: PASS, 16.
- Stage-aware visibility, Explore mode, dock authorization, truck/forklift animation architecture, camera architecture, and existing QR operations: PRESERVED.

## Remaining blockers

1. Complete a dedicated full-duration Guided-mode run with visual assertions at every stage.
2. Add automated assertions for QR removal after reverse scroll and after Replay for each outcome fixture.
3. Complete forklift unloading and QC-to-putaway continuous motion review.
4. Obtain CPU/GPU frame timing and repeat benchmarks on the target review hardware if final performance sign-off requires hardware-level profiling.
5. Start or provide the backend environment before claiming backend-dependent inventory and GRN authorization tests.

STEP 4B COMPLETE — READY FOR FINAL STEP 4 SIGN-OFF
