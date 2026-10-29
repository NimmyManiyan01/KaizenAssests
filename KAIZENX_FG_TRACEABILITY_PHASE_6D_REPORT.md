# KAIZENX AMS/WMS — Phase 6D Report

## Decision

**E2E PREREQUISITES BLOCKED**

The missing multi-material PO prerequisite is now covered by a disposable test-only fixture, and the fixture plus relevant existing Gate/GRN regression suites pass. The requested operational ASN → Gate Receiving → Dock → GRN Posting → original batch QR workflow was not run end to end; therefore Phase 6E is not ready.

## Intended PO creation architecture

- The shared persistence models are `PurchaseOrderModel` and `PurchaseOrderItemModel` in `backend/business-service/app/common/persistence/models.py`.
- `purchase_order.supplier_id` references `supplier.id`. The PO has a one-to-many `items` relationship to `purchase_order_item`; each line requires `purchase_order_id`, `material_code`, `quantity`, `unit_price`, and `uom`. `material_id` references Material Master when supplied.
- The PO also retains supplier and warehouse snapshot fields. Gate and ASN workflows resolve the PO by its PO number and read line codes and quantities from the persisted PO.
- This checkout has no PO creation API or source procurement workflow implementation. The only PO route found was a Gate PO lookup. Existing Gate integration tests directly seed PO and PO-line persistence models. Thus option 4, a test-only model fixture, is the supported safe strategy for this checkout; no production API or business rule was added.
- Migration history includes PO and PO-line creation and later additions, including `payment_terms`. The isolated test database was at Alembic head `20261032_nonunique_putaway_movement_index` before this work. No migration was run for Phase 6D.

## Root cause of the missing prerequisite

Existing Gate test data contains only single-material POs, and the prior Phase 6C audit found no PO with two or more distinct materials. The supplier-to-finished-goods scenario needs two PO materials with sufficient ordered quantities to represent the three intended receipt batches. The blocker was missing test data, not a missing production PO endpoint or a schema change.

## Test-data strategy and relationships

Added `backend/business-service/tests/integration/test_phase6d_po_prerequisite.py`. It creates and cleans up, within the test, one active Supplier Master record, two active Material Master records, one approved PO linked to that supplier, and two PO lines linked to their corresponding material IDs:

| Material | PO line quantity | Planned batch split |
|---|---:|---|
| Material A | 25 PCS | A1 10 PCS + A2 15 PCS |
| Material B | 20 PCS | B1 20 PCS |

The test asserts the live database name matches the allowlisted test URL and has the disposable test naming convention before inserting anything. It explicitly flushes supplier and material master rows before inserting the PO, satisfying the database foreign key ordering. Cleanup deletes the exact test PO lines, PO, materials, and supplier. The fixture creates no ASN, GRN, QR identity, or consumption event.

Only prerequisite master and PO rows are created directly through persistence models. Supplier ASN, Gate receiving, Dock, GRN, and QR operations must be exercised through their actual application APIs in the outstanding end-to-end verification.

## Gate and GRN compatibility findings

- Supplier ASN is created at `POST /api/gate/asns`; it validates active Material Master records, material code/name/UOM, PO line membership, and remaining PO quantities.
- Gate Entry can be created against an ASN. Gate Receiving requires a dock assignment linked to the ASN and PO, receiving quantities, condition checks, and completion before GRN posting.
- GRN posting checks that the draft GRN matches completed receiving, then updates inventory. Existing receiving code is responsible for the subsequent original batch QR workflow.
- Code inspection found that ASN validation resolves the PO and validates its materials and quantities but does not compare the authenticated supplier ID to the PO supplier ID. Supplier relationship rejection was not exercised via API in this Phase 6D run. This remains a validation concern to resolve or explicitly accept before claiming end-to-end readiness; no production rule was changed here.
- No API results are claimed for ASN creation, Gate Receiving, Dock Allocation, GRN creation/posting, or QR generation because those calls were not executed in this verification run.

## Test isolation

- The test harness pins `DATABASE_URL` to `KAIZENASSESTS_TEST_DATABASE_URL` and rejects protected or non-disposable database names.
- The Phase 6D fixture additionally checks `SELECT current_database()` against the configured test URL before writes.
- Audited target: `kaizenassests_test_fg_b978662c`; configured application DB: `ams_business`. The names are distinct.
- No application database was accessed for writes and no production migrations were run.

## Files modified

- `backend/business-service/tests/integration/test_phase6d_po_prerequisite.py` — disposable multi-material PO prerequisite test.
- `KAIZENX_FG_TRACEABILITY_PHASE_6D_REPORT.md` — this report.

## Test results

Command executed from `backend/business-service`:

```text
.venv\Scripts\python.exe scratch/phase6a_relevant_regressions.py tests/integration/test_phase6d_po_prerequisite.py tests/integration/test_gate_api.py tests/unit/test_grn_number_sequence.py tests/unit/test_grn_putaway_quantity_limit.py tests/unit/test_dock_completion_reconciliation.py
```

Result: **26 passed, 0 failed, 8 warnings** in 15.27 seconds. Warnings were seven Pydantic v2 class-config deprecations and one ReportLab `ast.NameConstant` deprecation. The first fixture iteration failed on a Supplier FK ordering violation; the fixture now flushes Supplier and Material rows before the PO insert, and the rerun passed.

The run did not include API-level invalid PO/material/quantity/supplier validation cases, the requested ASN/Gate/Dock/GRN workflow, GRN original QR generation, or the wider regression suites.

## Remaining blockers and Phase 6E readiness

1. Execute the supplier ASN, invalid PO/material/quantity/supplier cases, Gate Receiving, dock allocation, GRN creation and posting against the new fixture using the actual APIs.
2. Verify that the original GRN batch QR is generated from the posted operational receipt, without test-created QR identities.
3. Resolve or characterize the apparent lack of authenticated-supplier-to-PO-supplier validation.

Until these checks pass with recorded API responses and cleanup evidence, Phase 6E is **not ready**.
