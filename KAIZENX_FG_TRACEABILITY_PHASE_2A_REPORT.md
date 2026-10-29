# KAIZENX AMS/WMS — Phase 2A Report

**Status:** COMPLETE — actual material consumption API and production completion integration implemented and verified against an isolated PostgreSQL database. Phase 2B was not started.

## Files modified

- `backend/business-service/app/modules/assembly/infrastructure/api/router.py`
- `backend/business-service/app/modules/assembly/infrastructure/persistence/models.py`
- `backend/business-service/alembic/versions/20261030_assembly_consumption_api.py`
- `backend/business-service/tests/integration/test_fg_consumption_traceability.py`
- `backend/business-service/tests/unit/test_assembly_bom_quantities.py`
- `KAIZENX_FG_TRACEABILITY_PHASE_2A_REPORT.md` (this report)

No frontend, GRN QR generation, Finished Goods QR generation, Dispatch, authentication implementation, or production data was changed.

## Database models reused

- Reused `AssemblyMaterialConsumptionEventModel` and its Phase 1 append-only event table. No duplicate event/allocation table was created.
- Reused `GrnBatchQrModel`, `grn_batch`, and `grn_line` to resolve the original QR code to its authoritative GRN batch and material.
- Reused `AssemblyMaterialReceiptModel`, the Assembly order's linked `PickTaskModel`/`MaterialIssueModel`, and `InventoryMovementHistoryModel` to verify order, receipt, and batch-specific issue evidence.
- Added `AssemblyOrderModel.traceability_required`, default false, with Alembic revision `20261030_assembly_consumption_api`. Existing orders retain the legacy default. The flag is enabled when production starts from an Assembly receipt that resolves to an original GRN batch QR, and when an event is first recorded.
- Existing aggregate consumption and Finished Goods relationships were preserved.

## API created

`POST /api/v1/assembly/orders/{order_id}/material-consumption`

Request fields: `material_code`, `grn_batch_id`, `material_qr`, `actual_consumed`, `uom`, and `idempotency_key`. The authenticated Assembly operator is recorded by the server. The response includes event/order IDs, material and GRN batch, the original QR reference, consumed quantity, remaining quantity, operator, idempotency key, and `VERIFIED` status.

## Validation and transaction handling

- Requires an authorized Assembly, Assembly Manager, Admin, or Superuser role.
- Requires an existing production order in an in-production status, a material present on its order lines, linked Warehouse pick and issue records, and an Assembly receipt for the same order, issue, and material.
- Requires the submitted QR code to resolve to the exact submitted GRN batch and material. Requires batch-specific TAKEAWAY movements to Assembly on that order's linked pick task; UOM must match.
- Checks requested quantity against both the confirmed Assembly receipt balance and the verified batch issue balance. Phase 1 database triggers remain the final guard for issue quantity, returns, QR/batch matching, referential integrity, and event immutability.
- The order row is locked for the transaction. The Phase 1 trigger also locks it while checking cumulative consumption, serializing concurrent event writes for an order. The idempotency key returns the original event on an identical retry and conflicts if reused for different transaction data.
- Event insertion and enabling traceability are committed in the same unit of work. Rejected writes roll back. Consumption does not create another Warehouse deduction or an automatic return movement; remaining Assembly quantity is reported as the minimum of the still-received material and still-issued batch balance after consumption.

## Production completion and legacy compatibility

- Orders marked `traceability_required` cannot complete until each material line has at least one verified positive consumption event. Their legacy aggregate consumption row is populated from the sum of verified event quantities, rather than assuming all issued quantity was consumed.
- Orders that predate or do not enter the QR-backed workflow retain the existing completion behavior. They remain unlinked in the Phase 1 view; no QR/batch history is fabricated.
- Existing production status transitions are preserved: successful completion still moves the order to `QC_PENDING`. The relevant Assembly QC authorization, completion-date, and status tests passed.

## Test and migration results

Executed against the disposable PostgreSQL database `kaizenassests_test_fg_b978662c` (Assembly BOM unit tests use their own SQLite fixture):

```text
tests/integration/test_fg_consumption_traceability.py
tests/unit/test_assembly_bom_quantities.py
tests/unit/test_assembly_qc_authorization.py
tests/unit/test_assembly_completion_date.py
tests/unit/test_assembly_status_consistency.py

70 passed in 58.95s
```

Coverage includes valid/invalid QR and batch references, material membership, wrong/unissued batch, missing Assembly receipt, partial consumption and remaining balance, multiple batches, duplicate/replayed idempotency keys, concurrent over-consumption, no extra Warehouse deduction, original QR payload preservation, completion gating, actual aggregate quantity, legacy order completion, and existing QC/status compatibility.

Migration `20261030_assembly_consumption_api` upgraded successfully. With traceability flags false in the disposable database, downgrade to `20261029_fg_consumption_traceability` and re-upgrade succeeded; the 46 Phase 1 consumption test rows were unchanged, and the flag column was restored. No migration was run against `ams_business` or any production database.

## Corrective test-only change

`tests/unit/test_assembly_bom_quantities.py` now seeds warehouse stock expected by the current Assembly availability checks and asserts shortages against that fixture stock. This resolves the earlier fixture-only 409 failures without changing production business rules. Its tests passed in the 70-test run.

## Remaining limitations and risks

- `AssemblyMaterialReceiptModel` stores one optional QR string per order/material, while event rows support multiple batches. The endpoint verifies the material's receipt quantity and independently validates each event QR against its issued GRN batch. The receipt schema does not provide batch-specific receipt quantities.
- Authorized substitution is represented by the actual material code on the Assembly order's item lines; there is no separate substitution authorization entity in the inspected schema.
- Assembly line remaining quantity is derived from the received quantity, issue movements, and event history; this endpoint does not create or update a separate Assembly-bin balance record.
- The legacy direct-issue path without batch-specific movement evidence cannot create verified events. Such orders must remain on the legacy path until a trusted source of batch allocations exists.
- The Phase 2A API is backend-only; no frontend integration was requested or made.

## Phase 2B readiness

**READY FOR REVIEW** — the backend can accept and return verified batch/QR consumption genealogy, and tested production completion now requires those events for traceability-enabled orders. Phase 2B may proceed only after this report is reviewed and approved; it should consume this API and preserve the existing QR label design. No Phase 2B changes were made.
