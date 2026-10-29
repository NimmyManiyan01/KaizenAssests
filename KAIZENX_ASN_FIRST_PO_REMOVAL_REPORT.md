# KAIZENX AMS/WMS — ASN-First PO Removal Report

**Status: E2E BLOCKED**

## Previous PO dependencies

The inbound flow already had a PO-optional ASN schema and the ASN form did not display a PO selector, but several runtime paths still depended on PO data:

- Supplier dashboard and ASN forms retained dead PO lookup/fetch logic and the supplier dashboard fetched POs during page load.
- Gate Entry required a PO number when no ASN PO was present and the ASN path could treat its ASN number as a PO reference. `gate_entry.po_number` and `gate_entry.po_document_path` were database `NOT NULL`.
- Receiving quantity comparison used PO lines as its only expected-quantity source.
- Warehouse handling-unit creation also required `handling_unit.po_number` to be non-null.
- Vehicle-exit approval required a PO record and persisted a non-null `vehicle_exit_approval.po_id`; its queue also used an inner join to PO.
- GRN posting required PO fields even though GRN and dock assignment PO references were nullable.
- `damage_report.po_number` was also `NOT NULL`.
- The separate legacy `PO_RECEIPT` GRN mode remains PO-based. The ASN receipt mode is PO-free and was retained.

## Updated ASN-first architecture

Supplier identity continues to come from the authenticated supplier session. Supplier ASN creation accepts no PO reference. When a supplier elects to include a PO for a legacy receipt, the existing PO ownership validation remains active. ASN material lines continue to be checked against active Material Master records, canonical code/name/UOM, positive quantities, and supplier ownership.

Gate Entry uses the ASN as its receiving source. It persists no invented PO number for an ASN without a PO, derives supplier identity from the ASN supplier record, and continues duplicate vehicle/Gate Entry checks. Dock allocation continues to link to Gate Entry and ASN and only sets `po_id` when a real PO exists. Receiving uses PO line quantities when a valid PO is linked and otherwise uses ASN shipped quantities. GRN posting requires the ASN, supplier, vehicle, warehouse, and dock context, not a PO. Vehicle-exit approval permits a null PO while retaining the PO verification check for receipts that have one.

The original GRN batch QR generator, its payload construction, and Finished Goods QR generation were not edited. Reports continue to expose PO references as nullable historical context.

## Backend and migration changes

Migrations `20261033_asn_first_po_optional` and `20261034_optional_handling_unit_po` make these columns nullable:

- `gate_entry.po_number`
- `gate_entry.po_document_path`
- `damage_report.po_number`
- `vehicle_exit_approval.po_id`
- `handling_unit.po_number`

The existing `vehicle_exit_approval.po_id → purchase_order.id` foreign key remains. Historical PO records and values are preserved. The downgrade checks for null values and refuses to restore `NOT NULL` if ASN-first records exist.

Both migrations were applied only to `kaizenassests_test_fg_b978662c`. The safety runner verified the target differs from the configured `ams_business` application database, checked the expected pre-migration revisions, and verified the new Alembic head afterward. Schema inspection reported five expected nullable columns and confirmed the historical PO foreign key remains.

## Frontend changes

The Supplier ASN screens no longer submit a PO placeholder, load supplier POs, or contain a PO-selection helper. ASN list search safely handles records without a PO number. The inbound vehicle registration screen no longer carries a hidden PO field. Existing GRN PO receipt support and optional historical PO display remain.

## Security and focused API results

Executed against the verified disposable PostgreSQL database:

- Supplier ASN authorization and Gate API integration suites: **21 passed**, **0 failed**, **0 skipped**, **10 warnings**.
- The PO-free ASN case verifies authenticated supplier ownership, persisted null PO references, two valid Material Master lines, Gate Entry creation using the ASN, a null Gate Entry PO, and rejection of a duplicate active Gate Entry.
- Existing tests also verify cross-supplier PO reference rejection, invalid PO references, off-PO materials on a PO-linked ASN, and cross-supplier ASN mutation rejection.

Warnings included Pydantic deprecations and pytest cache write warnings. No production database was used.

## End-to-end and traceability results

The 13-step flow was **not** executed as one operational sequence. In particular, this verification did not create and post a GRN from the PO-free Gate Entry, complete QC, generate original material QRs from that receipt, complete warehouse putaway, receive material in assembly, record consumption from those QRs, or generate a Finished Goods QR linked to those same original QRs.

The specified no-PO three-batch quantities (Material A A1=10 PCS, A2=15 PCS; Material B B1=20 PCS) were not exercised through the operational APIs. Existing PostgreSQL Finished Goods traceability tests passed within the broader run, but they build their own prepared test records and do not prove the new inbound path. Therefore they do not satisfy the requested byte-for-byte verification of original QR payloads from a PO-free GRN.

Frontend traceability/QR tests: **51 passed**. The complete Assembly frontend suite was **263 passed, 1 failed** on a 5-second timeout in `pages.test.tsx` (“searches material details and keeps global totals when filtering”). That test passed when `pages.test.tsx` was run alone (34/34); the traceability test file also passed alone (18/18). The initial full suite run had two timeouts, both passing when rerun individually, then the final complete rerun retained only the single `pages.test.tsx` timeout.

Production frontend build: **passed**. Existing large-chunk and Vite/Nitro advisories were emitted.

Scoped ESLint on the three affected routes: standard run **failed** with 149 Prettier formatting errors and 3 React hook warnings in the files’ existing formatting/code. Re-running the same scope with the Prettier rule disabled produced **0 errors and 3 warnings**. The hook warnings concern existing effect dependency arrays.

## Regression test results and remaining blockers

The broad backend regression selection reported **132 passed, 18 failed, 0 skipped, 12 warnings**. Failures included the existing Gate duplicate-domain expectation, dock seeding/allocation assertions, a GRN QR constructor mismatch, Putaway/warehouse authorization and schema/fixture failures, an Assembly material-request payload failure, and two Finished Goods dispatch gate-exit assertions. These failures were not repaired because they are outside the verified PO dependency corrections and modifying their business behavior would exceed this change’s scope.

The 18 failing test IDs were:

- `test_gate_module.py::test_active_duplicate_entry_prevention`
- `test_dock_allocation.py::test_seed_and_get_overview_metrics`
- `test_dock_allocation.py::test_dock_type_filtering`
- `test_dock_allocation.py::test_auto_create_allocation_request_idempotent`
- `test_dock_allocation.py::test_dock_allocation_lifecycle`
- `test_dock_allocation.py::test_dock_notifications_on_allocation`
- `test_dock_allocation.py::test_conflict_on_already_reserved_dock`
- `test_dock_allocation.py::test_dock_reassignment`
- `test_receiving_qr.py::test_material_qr_model_initialization`
- `test_comprehensive_putaway_verification.py::test_full_putaway_end_to_end_verification`
- `test_store_keeper_putaway_lifecycle.py::test_complete_store_keeper_putaway_lifecycle_and_security`
- `test_putaway_auth_and_zone_scan.py::test_dev_login_case_insensitivity_and_auth_rules`
- `test_putaway_auth_and_zone_scan.py::test_dev_login_is_disabled_outside_authorized_environments`
- `test_putaway_auth_and_zone_scan.py::test_handling_unit_lookup_and_putaway_zone_uuid_completion`
- `test_warehouse_authorization_regression.py::test_manager_mock_token_has_explicit_approval_permissions_only`
- `test_assembly_reservation.py::test_material_request_payload_accepts_positive_production_target`
- `test_assembly_fg_inventory.py::test_supplier_dispatch_split_batch_loading_and_gate_exit[batch]`
- `test_assembly_fg_inventory.py::test_supplier_dispatch_split_batch_loading_and_gate_exit[package]`

The entire backend test tree was also attempted. Fixing stale test imports from the removed `app.modules.procurement.infrastructure.persistence.models` path to the existing `app.common.persistence.models` path cleared 19 collection errors. Collection now has one remaining error in `tests/unit/test_rfq_response.py`, which imports the deleted `app.modules.procurement.infrastructure.api.router` path; no replacement `_to_rfq_response` function exists in the application. The full backend suite therefore did not run to completion.

Remaining blockers:

1. Execute the actual PO-free ASN → Gate → Dock → GRN/QC/posting → original material QR workflow.
2. Complete warehouse putaway and assembly receipt/consumption using the batches created by that workflow.
3. Generate Finished Goods and verify its traceability resolves to the same original material QR payloads byte-for-byte, including the specified three-batch scenario.
4. Resolve or explicitly disposition the backend regression failures and the stale RFQ test import, then obtain a clean complete backend run.
5. Resolve the remaining Assembly frontend timeout and formatting warnings before treating all requested frontend verification as clean.

## Files changed for this work

Application and migration:

- `backend/business-service/app/modules/gate/infrastructure/api/router.py`
- `backend/business-service/app/modules/gate/infrastructure/persistence/models.py`
- `backend/business-service/alembic/versions/20261033_asn_first_po_optional.py`
- `backend/business-service/alembic/versions/20261034_optional_handling_unit_po.py`
- `backend/business-service/app/modules/storage/infrastructure/persistence/models.py`
- `backend/business-service/scratch/apply_asn_first_migration_to_disposable.py`
- `backend/business-service/scratch/run_isolated_pytest.py`
- `frontend/src/routes/supplier.asns.new.tsx`
- `frontend/src/routes/supplier-dashboard.tsx`
- `frontend/src/routes/vehicle-queue.tsx`

Integration test:

- `backend/business-service/tests/integration/test_supplier_asn_po_authorization.py`

Stale test import corrections to the canonical shared persistence module:

- `backend/business-service/tests/unit/test_asn_supplier_e2e.py`
- `backend/business-service/tests/unit/test_assembly_custom_material_workflow.py`
- `backend/business-service/tests/unit/test_assembly_store_pickup_workflow.py`
- `backend/business-service/tests/unit/test_comprehensive_putaway_verification.py`
- `backend/business-service/tests/unit/test_dock_allocation.py`
- `backend/business-service/tests/unit/test_e2e_prompt8_pytest.py`
- `backend/business-service/tests/unit/test_e2e_prompt9_pytest.py`
- `backend/business-service/tests/unit/test_e2e_prompt10_pytest.py`
- `backend/business-service/tests/unit/test_e2e_prompt11_pytest.py`
- `backend/business-service/tests/unit/test_e2e_prompt13_pytest.py`
- `backend/business-service/tests/unit/test_end_to_end_dock_store_movement_flow.py`
- `backend/business-service/tests/unit/test_finished_goods_requests_flow.py`
- `backend/business-service/tests/unit/test_material_master_and_requests_audit.py`
- `backend/business-service/tests/unit/test_phase2_post_arrival_store_assignment.py`
- `backend/business-service/tests/unit/test_phase8_store_pickup_material_issue.py`
- `backend/business-service/tests/unit/test_phase9_inventory_control_and_stock_ledger.py`
- `backend/business-service/tests/unit/test_putaway_auth_and_zone_scan.py`
- `backend/business-service/tests/unit/test_qr_scan_result.py`
- `backend/business-service/tests/unit/test_store_bins_and_hierarchy.py`
- `backend/business-service/tests/unit/test_store_keeper_putaway_lifecycle.py`

## Readiness

**E2E BLOCKED** — the PO-free Supplier ASN and Gate Entry are verified, but the operational GRN-to-Finished-Goods sequence and required three-batch, byte-for-byte QR trace are not yet executed. No deployment was started.
