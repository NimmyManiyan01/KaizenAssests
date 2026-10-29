# KAIZENX AMS/WMS — Finished Goods QR Traceability Phase 1 Report

**Status:** COMPLETE — database foundation and PostgreSQL validation are complete. Application event capture and end-user traceability are outside Phase 1.

## 1. Existing database analysis

- `grn_batch_qr` stores the original batch QR code and payload and points to `grn_batch`.
- `assembly_material_receipt.material_qr` is nullable and has no authoritative GRN batch foreign key.
- `assembly_material_consumption` stores aggregate quantities by assembly order and material code. Its unique constraint, `uq_assembly_consumption_order_material`, permits only one row for a material per order; it has no GRN batch or QR identity relationship.
- `assembly_finished_goods.assembly_order_id` already links finished goods to their assembly order and is preserved.
- Read-only inspection of the configured `ams_business` database found Alembic revision `20261028_multiple_pickup_gate_visits`; the Phase 1 traceability revision had not been applied there. The event table was present but empty from ORM schema creation, so the migration validates its shape before installing database integrity objects. No migration was run against this database.
- The existing migration `0016_add_finished_goods_qr_traceability.py` covers finished goods QR fields; Phase 1 does not duplicate or replace it.

## 2. Root cause of missing material traceability

The legacy consumption record has no reference to the source GRN batch or its original QR identity. Consumption is recorded as an aggregate at production completion, so the database cannot determine which of potentially several batches of the same material were actually consumed. The unique order/material constraint also prevents representing separate batch allocations.

## 3. Database design decisions

- Kept the legacy aggregate table and its uniqueness rule for backward compatibility.
- Added `assembly_material_consumption_event` as an append-only event/allocation table. Each row represents a consumption allocation from one GRN batch; multiple rows for the same order and material, including repeated rows from one batch, are allowed.
- `grn_batch_id` is required and is the authoritative source-batch link. The optional QR pair references the existing `grn_batch_qr` row and preserves its original code; no replacement QR identity is generated.
- Added `assembly_material_consumption_traceability`, which reports legacy aggregate rows as `UNLINKED` and event rows as `VERIFIED` only when the stored QR ID, exact QR code, GRN batch, and material code match. Event rows without a matching QR are `INCOMPLETE`.

## 4. Exact Phase 1 files modified

- `backend/business-service/alembic/versions/20261029_fg_consumption_traceability.py`
- `backend/business-service/app/modules/assembly/infrastructure/persistence/models.py`
- `backend/business-service/tests/integration/test_fg_consumption_traceability.py`
- `KAIZENX_FG_TRACEABILITY_PHASE_1_REPORT.md` (this report)

The shared workspace contains other modified files outside this Phase 1 change set. They were not included in the Phase 1 implementation and were left untouched for this report task.

## 5. Migration created or reused

Created Alembic revision `20261029_fg_consumption_traceability`, descending from `20261028_multiple_pickup_gate_visits`. Existing revision `0016_add_finished_goods_qr_traceability.py` was inspected and reused as-is for its existing finished goods QR schema; no duplicate finished goods table or QR migration was added.

## 6. New or modified fields

The new event table contains:

- `id`, `assembly_order_id`, `material_code`
- `grn_batch_id`, optional `grn_batch_qr_id`, optional `material_qr`
- `idempotency_key`, `actual_consumed`, `uom`, `consumed_at`, `recorded_by`

No legacy consumption quantity or historical field was rewritten.

## 7. New relationships

- Event → `assembly_order.id` (`RESTRICT`)
- Event → `grn_batch.id` (`RESTRICT`)
- Optional event QR → `grn_batch_qr.id` (`RESTRICT`)
- Existing `assembly_finished_goods.assembly_order_id` relationship remains intact.

Database triggers verify that the batch belongs to the event material, the optional original QR belongs to that same batch/material and has the exact stored QR code, and a batch-specific warehouse TAKEAWAY movement to Assembly supports the consumption. Events cannot be updated or deleted. Referenced batch, QR, GRN material identity, and supporting warehouse issue identity are protected from destructive changes. Where `material_return` exists, return integrity is also enforced; the migration tolerates installations where that optional table is absent.

## 8. Constraint changes

- The legacy `uq_assembly_consumption_order_material` constraint was not removed or altered.
- New event-table constraints require positive consumption, a nonblank idempotency key, and either both QR fields or neither.
- A unique idempotency key prevents the same transaction from being recorded twice. There is deliberately no uniqueness on order/material/batch, allowing multiple legitimate events from a batch.
- Foreign keys use restrictive deletion behavior to preserve manufacturing history.
- Indexes cover order, order/time, material, batch, and QR references.

## 9. Historical data compatibility

Existing aggregate records remain readable and retain their original quantities and assembly-order links. The traceability view labels them `UNLINKED`; it does not fabricate a batch or QR relationship from material code alone. No original GRN QR payload or identity was regenerated. The migration refuses downgrade when event records exist, because dropping those records would erase traceability history.

## 10. Automated test results

Added PostgreSQL integration tests against the isolated database `kaizenassests_test_fg_b978662c`. The tests cover verified original batch/QR linkage, multiple same-material batches, invalid batch references, material mismatch, zero/negative and over-issued quantities, duplicate idempotency keys, immutable original QR payload, legacy unlinked consumption, finished goods order linkage, indexes, and preservation of the legacy uniqueness constraint.

## 11. Migration validation results

- Alembic upgrade to `20261029_fg_consumption_traceability`: **succeeded** on the isolated database.
- Downgrade to `20261028_multiple_pickup_gate_visits` while the event table was empty: **succeeded**.
- Re-upgrade to head: **succeeded**.
- The configured `ams_business` database was not migrated or modified.

## 12. Known limitations

- This phase provides the database foundation, not end-to-end QR traceability. The existing production completion handler still writes the legacy aggregate consumption table; no application flow currently creates rows in the new event table.
- The current quantity guard uses verified batch-specific TAKEAWAY movements and processed returns as the available-quantity basis. Adjustment workflows and unverified/direct aggregate issues do not establish verified availability for these events.
- Assembly material QR scanning, receipt-to-batch validation, finished goods QR lookup to raw material QR display, printing, and downloads remain unimplemented in this phase.
- Existing `tests/unit/test_assembly_bom_quantities.py` fixtures omit stock data: run result was **2 passed, 3 failed**. The failures returned 409 for insufficient warehouse stock / unavailable material. The focused BOM quantity preview case passed. These failures are recorded rather than reported as passing compatibility coverage.

## 13. Phase 2 prerequisites

After this report is reviewed and approved, Phase 2 will need an explicitly authorized implementation plan for:

1. Capturing actual consumption allocations with the scanned original QR and GRN batch, and writing idempotent event rows.
2. Defining how legacy/direct warehouse issues without verified batch identities are handled.
3. Implementing the finished goods QR lookup that traverses finished goods → assembly order → verified consumption events → original GRN material QRs.
4. Adding the requested raw material QR view, print, download, and print-all operations without regenerating QR identities or changing the existing label design.
5. Providing integration coverage for the end-to-end production and traceability flow.

**Phase 2 readiness: NOT READY — pending Phase 1 report review and approval.** No Phase 2 work was started.
