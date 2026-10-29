# KAIZENX Finished Goods Traceability - Phase 5

Phase 5 adds original material QR preview, individual printing/downloading, and bulk printing inside the existing Phase 4 Material Traceability view. All output uses the stored original GRN payload from the Phase 3 response. Phase 6 is not implemented.

## Files modified or added

- `frontend/src/routes/assembly.finished-goods.tsx`: View Original QR action in verified material rows; preview selection resets with traceability context; Print All Material QRs within Consumed Materials.
- `frontend/src/components/wms/original-material-qr.tsx` (new): compact original-QR preview dialog and bulk-print controls, loading/disabled states, context, and operator messages.
- `frontend/src/lib/original-material-qr.ts` (new): exact-payload rendering, eligibility checks, identity deduplication, filename sanitization, PNG download, safe print document and image readiness handling.
- `frontend/tests/assembly/original-material-qr.test.tsx` (new): 21 output and component tests, including parameterized missing-data cases and real QR scanner round-trip.
- `frontend/tests/assembly/finished-goods-traceability.test.tsx`: table-to-preview integration test and assertions that API failures/unauthorized responses expose no material QR output controls. Existing FG QR regression test remains intact.
- This report.

Unrelated existing workspace changes were preserved. No backend source, API contract, database schema, GRN generation, FG generation, picking, consumption, or Dispatch implementation was modified during Phase 5. No configured application/production database was accessed or changed.

## Inspection and reuse

Read the Phase 4 report and inspected the Phase 4 traceability UI, actual API response types and endpoint authorization, GRN QR canvas/PNG generation and individual/bulk print implementations, existing FG QR actions, and PackageQrActions.

Reused existing Button and Radix Dialog components, the installed `qrcode` library, the authorized Phase 3 traceability response, and Phase 4 batch/context selection. GRN print functions are local closures within `grn.tsx`; calling them directly would require changing that workflow. Phase 5 instead follows the existing GRN white bordered 380px label / 260px image dimensions in an isolated output helper, using textContent for safe dynamic label text. Existing GRN rendering and payload builders remain untouched.

## QR rendering and payload preservation

The sole rendering source is `consumed_materials[].original_qr_payload`. The QR identity, material and original batch relationships also come from that verified response array. No material-code lookup, substitute payload, alternate identity, or new backend endpoint is used.

`QRCode.toDataURL` receives the original stored string verbatim, including whitespace and line breaks. The presence check uses trim only to reject blank payloads; rendering never trims or rebuilds them. Consumed quantities appear only as preview context and are never appended to QR contents.

Output is PNG at 768px, error correction M, black modules, white background, and a four-module quiet zone. The preview states that the QR originated from the GRN batch and that encoded content is unchanged. It shows material name/code, original batch, GRN reference, consumed quantity with API precision, UOM and original QR identity.

## Individual output

View Original QR opens the compact preview within the existing Finished Goods workflow. Print QR and Download QR stay disabled until the original image renders successfully. Missing payload, QR identity or batch relationship displays exactly:

> Original material QR is unavailable for this batch.

Download QR saves the rendered PNG as `MATERIALCODE_GRNBATCH_ORIGINAL_QR.png`. Components are normalized, restricted to letters/digits/underscore/hyphen, and length-limited; path separators and unsafe filename characters are removed. The temporary download link is removed even on failure.

Print QR opens a dedicated label window during the click gesture, before asynchronous rendering. Labels show KAIZENX - ORIGINAL MATERIAL QR, material name/code, GRN batch/reference, original QR identity and QR image. Only label content enters the print document; application navigation/sidebar content is absent.

## Bulk printing and duplicates

Print All Material QRs uses only verified `consumed_materials` from the loaded response. It never reads the unlinked history to create labels. Missing payload/batch/identity entries are excluded. A Map keyed by the exact original QR identity produces one label per identity, regardless of repeated event references. Different identities and batches retain separate labels. An identity reused with inconsistent material, batch or payload is excluded and produces an incomplete-set warning rather than being merged.

PARTIAL, UNLINKED, NOT_AVAILABLE, unavailable entries, conflicting identities, or unlinked records trigger an explicit incomplete-set warning in the UI and print document. The frontend does not recalculate backend completeness. Empty eligible sets disable bulk printing.

Labels use white backgrounds, black text, high contrast QR images, a responsive print grid, page margins, and break-inside/page-break-inside avoidance. The document can span multiple pages. Every QR image must load before the browser print call; any render/load error aborts the entire requested job and closes its window, rather than silently printing fewer labels. Image loading has a 15-second timeout with handler/timer cleanup.

## Errors and authorization

Handled states include absent/blank payloads, missing original relationships, rendering errors/oversized data, unexpected non-PNG renderer output, image-load failures, blocked print windows, closed print windows, browser print exceptions, download exceptions, incomplete history, and empty verified sets. No substitute QR is created.

Phase 4's existing shared-client authentication and backend authorization remain the gate for obtaining traceability data. HTTP 401/403 and other failed traceability responses do not render material output controls. Output itself is local to the browser and performs no API mutation. Physical label printing and browser file delivery do not create database records.

## Test results

Focused command:

`npm.cmd run test -- tests/assembly/original-material-qr.test.tsx tests/assembly/finished-goods-traceability.test.tsx tests/assembly/finished-goods-traceability-api.test.tsx tests/assembly/grn-qr-record.test.tsx --pool=threads --maxWorkers=1 --testTimeout=15000`

**48 passed across 4 files**, 20.89 seconds.

Coverage includes preview action/modal/context, exact whitespace-preserving payload, PNG options, consumed quantity precision, individual print/download, sanitized filenames, image readiness, popup/render/image/print/download failures, original-identity deduplication, multiple batches/QRs, inconsistent identity rejection, missing data, partial and unlinked history, empty output, authorization errors, Phase 4 behavior, existing saved-GRN retrieval and unchanged FG payload generation.

Scanner compatibility uses the real `qrcode.create` encoder and existing `jsQR` decoder: pixels generated from the encoded module matrix decode to the exact original stored payload, including whitespace/newlines. Browser output/download tests mock PNG delivery and browser dialogs.

Initial focused runs exposed test assertion issues (jest-dom matchers on a separate print document and a style-selector scope); assertions were corrected to inspect print document text and body scope. Final focused tests pass.

Backend command, from `backend/business-service`:

`.venv\Scripts\python.exe scripts/verify_fg_traceability_phase4.py`

This runs the Phase 3 consumption traceability integration suite and Assembly QC authorization, completion-date and status-consistency unit regressions against the existing disposable PostgreSQL database `kaizenassests_test_fg_b978662c`, never the configured application database.

**73 passed, 8 warnings**, 17.96 seconds. Existing Pydantic/reportlab deprecations and the pytest-asyncio loop-scope advisory remain.

Complete Assembly suite:

`npm.cmd run test:assembly -- --pool=threads --maxWorkers=1 --testTimeout=15000`

**264 passed across 23 files**, 105.32 seconds.

Production build: `npm.cmd run build`. **Passed** for client, SSR and Nitro output. Existing Vite tsconfig-paths and chunk-size advisories were emitted; no build errors.

Scoped lint was attempted with ESLint on the Phase 5 UI/helper and related traceability tests. It reported 126 Prettier formatting errors and one warning across those files, including substantial existing formatting in the touched Phase 4 route/tests. No auto-format was applied to avoid unrelated churn. Focused functional tests and the production build pass.

## Remaining limitations and Phase 6 readiness

- Physical printer margins, stock sizes, browser page pagination, camera permissions and hardware scanner operation still require operator acceptance testing. Automated scanner coverage validates encoded module content; it does not claim a physical printed-label scan.
- Browsers do not reliably report print cancellation, spooler/paper failures, or silently blocked downloads. The UI catches observable exceptions, popup blocking and image failures, but cannot confirm physical output or final file delivery.
- Payload validity is determined by original relationship availability and QR encoder success, without imposing a new payload format on historical GRN strings. Extremely large or otherwise unrenderable payloads display errors and are not replaced.
- Existing backend allocation and historical/supplier-snapshot limitations remain. Phase 5 preserves the backend status and original data.
- Phase 5 provides view/print/download evidence for future Phase 6 planning. Phase 6 remains unimplemented and requires its own scope. No deployment or production-data operation was performed.
