# KAIZENX FG Traceability Phase 2B Report

## Status

**IMPLEMENTED.** The Assembly Production page now records and displays actual material consumption through the existing Phase 2A write API. No Phase 3 work was started.

## Files changed for Phase 2B

- `frontend/src/routes/assembly.production.tsx` — contextual action, QR verification and consumption dialog, quantity validation, idempotent retry, separate batch event history, and completion pre-check.
- `frontend/src/components/wms/fg-qr-input.tsx` — optional label/input ID parameters. Existing Finished Goods / Dispatch defaults remain unchanged.
- `frontend/src/lib/api-client.ts` — typed Assembly read/write calls, response types, and nested API error message extraction.
- `backend/business-service/app/modules/assembly/infrastructure/api/router.py` — Assembly-authorized QR verification and event history GET endpoints; exposes `traceability_required` in production order rows.
- `backend/business-service/tests/integration/test_fg_consumption_traceability.py` — PostgreSQL integration coverage for GRN QR resolution and distinct batch event history.
- `frontend/tests/assembly/pages.test.tsx` — UI test for opening the consumption dialog and showing verified batch details.

## Existing components and API integration

The existing `FgQrInput` scanner is reused for camera, image upload, and manual QR entry. GRN QR generation and Dispatch usage were not changed. The existing Phase 2A write contract remains authoritative:

`POST /api/v1/assembly/orders/{order_id}/material-consumption`

It receives `material_code`, `grn_batch_id`, persisted canonical `material_qr`, `actual_consumed`, `uom`, and `idempotency_key`. Failed requests retain the same key for an identical retry; changing the transaction quantity creates a new key. Phase 2A remains responsible for issue, receipt, batch, quantity, status, permission, and duplicate-request checks.

Assembly-only read endpoints support the UI:

- `GET /api/v1/assembly/orders/{order_id}/material-consumption/verify?scanned_qr=...`
- `GET /api/v1/assembly/orders/{order_id}/material-consumption`

Verification resolves either a canonical QR code or the existing GRN label payload's `Material Code` and `Batch Number` fields to an already persisted `grn_batch_qr` row. It then checks order material membership, linked Warehouse pick/issue evidence, and Assembly receipt. The canonical persisted QR identity is returned for the Phase 2A POST. No identity is generated or rewritten.

## UI behavior

- `Record Material Consumption` appears only for in-production orders with `traceability_required`.
- The dialog displays order/product/status, material and batch details, original QR, issued/received/already-consumed/remaining quantities, UOM, quantity entry, and event history.
- Quantity must be positive and no greater than the verified remaining balance. The field accepts up to four decimal places; the backend rechecks remaining quantity for concurrent consumption.
- Event history keeps each consumption event and batch as separate rows with QR/batch, quantity, UOM, time, operator, and status.
- For traceability-required orders, the frontend reloads readiness before opening completion and displays missing material codes. The existing backend completion guard remains authoritative. Legacy orders retain their existing path.
- API errors are surfaced in the dialog, including invalid or unassigned QR, missing issue/receipt, insufficient balance, duplicate/conflicting retries, unauthorized access, and network failures.

## Verification results

- Python syntax compilation of the Assembly router: passed.
- PostgreSQL integration suite against the isolated database `kaizenassests_test_fg_b978662c`: **16 passed**. This includes original QR resolution from canonical code and existing GRN label payload, order/batch checks, and separate events for two batches.
- Focused frontend production-page test: **1 passed** (`opens verified consumption`; 33 other page tests skipped by name filter).
- Full frontend `test:assembly`: **55 passed, 3 failed, 10 worker errors**. The failures were in unrelated dock setup, pickup date validation, and supplier material rendering tests; Vitest also reported worker startup timeouts for other files. The focused production page test passes.
- Final Vite production build after all implementation edits: passed (`npm.cmd run build`, exit code 0). Existing chunk-size and Vite plugin timing warnings were emitted.
- No migration or configured application database was touched.

## Known limitations

- The existing Assembly receipt schema does not store a received quantity per batch. Availability is bounded by total order/material receipt and batch-specific issue evidence.
- Verification is not a reservation. Another event can reduce the available quantity after the QR check; the write API rejects stale over-consumption.
- Legacy orders without `traceability_required` remain unlinked and retain the legacy completion flow.
- The unrelated frontend suite timeouts/worker errors need a stable CI rerun before release sign-off.

## Phase 3 readiness

The Phase 2B UI and read API integration are implemented. Phase 3 can use the append-only verified consumption events to connect finished goods output to original material QR references. Re-run the full frontend suite and final production build in CI before release approval. Phase 3 has not been started.

