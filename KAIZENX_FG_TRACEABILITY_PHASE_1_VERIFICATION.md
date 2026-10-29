# KAIZENX — Phase 1 Finished Goods QR Traceability Verification

**Verification status:** Phase 1 database foundation verified in an isolated PostgreSQL test database. No Phase 2 implementation was started.

## Database integrity results

- `AssemblyMaterialConsumptionEventModel` maps to `assembly_material_consumption_event`. Its required `grn_batch_id` references `grn_batch.id` with `RESTRICT`; `assembly_order_id` also uses `RESTRICT`. Optional `grn_batch_qr_id` references the original `grn_batch_qr.id`, also with `RESTRICT`.
- PostgreSQL validation checks that the GRN batch belongs to the event's material, the optional QR belongs to the same batch/material and its exact original QR code, and there is sufficient batch-specific warehouse TAKEAWAY quantity to Assembly, net of supported processed returns.
- Quantity must be positive; the QR ID/code pair must be both present or both absent; the idempotency key is unique. There is no order/material/batch uniqueness that would prohibit repeated legitimate consumption events.
- Event records are immutable. Database foreign keys and protection triggers prevent silent destruction or mutation of source batch, QR, material identity, and supporting issue identity after consumption is recorded.
- `assembly_material_consumption` and `uq_assembly_consumption_order_material` remain unchanged. The migration does not update or delete legacy consumption quantities. The traceability view exposes legacy records as `UNLINKED` rather than fabricating a source batch.
- `assembly_finished_goods.assembly_order_id` remains intact. Integration coverage inserts and reads finished goods through this relationship.
- Original QR identity preservation is covered by an integration test that attempts to change a referenced GRN QR payload, expects the database to reject the update, and verifies the stored original payload remains unchanged.

## Migration safety

Reviewed `backend/business-service/alembic/versions/20261029_fg_consumption_traceability.py`:

- Upgrade creates the event table only if it is absent. If present, it validates the expected columns, idempotency uniqueness, required foreign keys, and optional QR foreign key before proceeding.
- It does not drop or rewrite legacy consumption records, finished goods, GRN batches, or QR records. It adds indexes, integrity functions/triggers, and a traceability view. Recreating the view does not alter source-table data.
- Downgrade refuses to drop the event table if it contains any event rows; when empty, it removes the view, triggers, functions, and new event table. It does not remove the legacy consumption table or its unique constraint.
- The migration tolerates installations without the optional `material_return` relation; return-specific trigger installation is conditional.
- On the disposable PostgreSQL database, migration upgrade succeeded, downgrade to `20261028_multiple_pickup_gate_visits` succeeded while the event table was empty, and re-upgrade succeeded. These commands did not target the configured `ams_business` database.

## Assembly BOM test failures and correction

The prior run had three failures returning HTTP 409/400:

1. Adding `MAT-NEW` failed the current warehouse-availability check because its fixture created a material master record but no stock.
2. Creating a 10-unit material request failed the current insufficient-stock check because its three BOM components had no stock rows.
3. Creating a 100-unit material request failed for the same missing fixture stock.

The current test fixture now seeds ample `MaterialStockModel` rows for the BOM components and `MAT-NEW`, and its BOM preview asserts shortages against that seeded availability. No production route or business rule was changed. The guards causing these responses are in the current Assembly router working-tree diff and are separate from the Phase 1 event model/migration. Because the router and tests are uncommitted workspace changes and no pre-Phase-1 test run is available, the exact historical timing of those guards cannot be proven; the failures are attributable to missing test stock, not the traceability schema.

Corrective change: `backend/business-service/tests/unit/test_assembly_bom_quantities.py` only. The fixtures now model the warehouse stock required by the existing route behavior.

## Test results

Executed together against the isolated PostgreSQL test database for integration coverage (the BOM tests use their own SQLite fixture):

```text
pytest -p no:cacheprovider -q \
  tests/integration/test_fg_consumption_traceability.py \
  tests/unit/test_assembly_bom_quantities.py

10 passed in 55.96s
```

The passing set includes the five PostgreSQL traceability integration tests and all five Assembly BOM tests. Pytest emitted dependency deprecation/collection warnings; none were test failures.

## Production completion handler integration assessment

The current `complete-production` handler still upserts one aggregate consumption row per order/material using issued/required quantity. It does not create event rows and does not itself resolve actual consumption by GRN batch or original QR. The event schema can support an atomic Phase 2 write within the handler's existing unit of work, but only after the application has verified batch-specific actual-consumption allocations and stable idempotency keys. Warehouse issue paths without batch-specific evidence cannot be safely split or assigned to a GRN batch by material code alone.

Therefore the handler is **not ready to write verified events as-is**. It can be integrated safely in Phase 2 once the application has a trusted source for the consumed quantity per verified batch/QR and an explicit policy for legacy or direct issues without such evidence. Do not backfill those allocations from aggregate material quantities.

## Remaining risks

- The application currently does not populate the event table; database guarantees cannot supply missing point-of-use allocation evidence.
- Direct/legacy warehouse issue records without verified batch-specific movements cannot support verified event insertion under current validation.
- A live PostgreSQL test schema validated the migration path, but the configured `ams_business` database was deliberately not modified or used for migration testing.
- The three test failures cannot be dated relative to the Phase 1 start because the relevant router/test changes are uncommitted. Their current root cause and fixture-only correction are verified.

## Phase 2 readiness

**PHASE 2 BLOCKED**

Evidence: Phase 1 database structures, integrity constraints, migration upgrade/downgrade behavior, QR identity preservation, and relevant tests are verified. However, the production completion handler only records aggregate consumption, and the current application does not capture actual consumption allocations by verified batch/QR. Starting end-to-end traceability without first resolving that evidence source would risk fabricating batch genealogy. Phase 2 should remain stopped until its allocation capture and no-batch-evidence policy are reviewed and approved.
