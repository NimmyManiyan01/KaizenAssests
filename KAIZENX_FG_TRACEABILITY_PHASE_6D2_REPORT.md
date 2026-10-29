# KAIZENX AMS/WMS — Phase 6D.2 Report

## Decision

**ASN AUTHORIZATION VERIFIED**

The Supplier ASN route now requires a resolvable PO, requires any provided PO ID and number to identify the same record, and requires the authenticated supplier to own that PO. Existing ASN cancellation and deletion writes are now scoped to the authenticated ASN supplier. Isolated PostgreSQL security tests prove authorized ASN creation works and cross-supplier, unresolved, missing, malformed, or mismatched references do not create an ASN.

Phase 6D.3 readiness is **BLOCKED pending unrelated backend regression collection/failures** listed below. No downstream Gate, Dock, or GRN workflow was run.

## Root cause and relationship model

- `_authenticated_supplier_id` resolves the logged-in supplier from `SupplierUserModel.supplier_id` (which references `supplier.id`) or a validated supplier claim. If both mapped and claimed IDs exist, they must agree.
- `PurchaseOrderModel.supplier_id` independently references `supplier.id`. This is the ownership key compared by the ASN handler. Supplier user ID, supplier ID, and PO ID are distinct values.
- No organization or tenant ID exists on the inspected Supplier, SupplierUser, or Purchase Order models; no additional organization boundary is available to check in this workflow.
- Before this change, the ASN handler looked up a PO with an OR across PO ID and number, accepted a missing PO, and did not compare its supplier ID to the authenticated supplier. That allowed cross-supplier or unresolved PO references to proceed.
- The current handler has no PO status eligibility rule. Since no existing ASN-specific status policy was found, this change does not invent one. PO material membership, quantity, Material Master, UOM, and transport validation remain in place.

## Authorization changes

In `app/modules/gate/infrastructure/api/router.py`, `POST /api/gate/asns` now:

1. Requires at least one PO number or PO ID.
2. Rejects a malformed PO ID with HTTP 422.
3. Resolves the PO, applying both supplied identifiers together when both are present (AND semantics).
4. Returns the same generic HTTP 404 response, `Purchase order not found or unavailable`, for nonexistent, mismatched, or other-supplier POs; this avoids disclosing another supplier’s PO details.
5. Persists the canonical database PO ID and number on the ASN.

The request body’s supplier ID is not used as proof of ownership. Existing material, quantity, UOM, active Material Master, shipment, and transport checks run after the authorization gate. The existing cancellation and deletion routes now resolve the authenticated supplier and include `AsnModel.supplier_id` in the lookup. Other suppliers receive a generic 404 and cannot cancel/delete the ASN.

ASN write path inspection found no implemented edit or PO reassignment route. The current supplier ASN write route is `POST /api/gate/asns`; `/api/gate/asns/{reference}/cancel` and `DELETE /api/gate/asns/{reference}` do not change PO references. Their separate authorization behavior was not changed in this focused task. No procurement source package was present in the checkout; a legacy test references one, as detailed below.

## Automated security tests

Added `tests/integration/test_supplier_asn_po_authorization.py`. It uses the real app dependency chain and test supplier bearer token against PostgreSQL. Its test fixture creates two suppliers, two POs, and three active materials (two PO materials plus one active material not on either PO); cleanup removes exact ASN/notification/master rows in teardown.

The tests cover:

- Authorized ASN creation using the supplier’s PO number and ID, PO number only, and PO ID only.
- Persisted PO ID, PO number, authenticated supplier ID, both PO materials, and ordered quantities.
- Supplier A attempting Supplier B’s PO, including a spoofed body supplier ID.
- Missing, nonexistent, malformed, and mismatched PO references.
- A valid active Material Master item that does not belong to the selected PO.
- Cross-supplier attempts to cancel or delete an ASN, with database state unchanged.
- Unauthenticated/non-supplier ASN creation.
- No ASN row created for rejected references.

Dedicated run:

```text
.venv\Scripts\python.exe scratch/phase6a_relevant_regressions.py tests/integration/test_supplier_asn_po_authorization.py
```

Result after all authorization changes: **12 passed, 0 failed, 8 warnings** in 33.17 seconds. The valid API request returned HTTP 201, and the persisted ASN had the authenticated supplier, the canonical PO ID/number, and both requested material lines. Negative requests returned 404, 422, or 403 as appropriate and left no ASN for the tested PO. Cross-supplier cancel/delete calls returned 404 and left the ASN in `SUBMITTED` status. Warnings were seven Pydantic v2 class-config deprecations and one ReportLab `ast.NameConstant` deprecation.

The authorization suite plus the Phase 6D prerequisite test was also run together after the cancel/delete changes: **13 passed, 0 failed, 8 warnings** in 61.40 seconds.

## Database isolation

Before integration tests, the read-only isolation audit reported:

```text
configured_database=ams_business
test_database=kaizenassests_test_fg_b978662c
database_names_differ=True
server=::1/128:5432
database_role=ams_business
alembic_revision=20261032_nonunique_putaway_movement_index
```

`alembic heads` reported `20261032_nonunique_putaway_movement_index (head)`, matching the test database. The shared test runner redirects `DATABASE_URL` to the allowlisted `KAIZENASSESTS_TEST_DATABASE_URL`; the new fixture independently verifies `current_database()` is disposable. No production database writes or migrations occurred. The fixture cleans its test data.

## Regression results

### Backend focused batch

The combined relevant backend run, including Supplier ASN authorization, Phase 6D PO prerequisite, Gate API, PostgreSQL traceability, supplier, dock, GRN, warehouse, and putaway tests, produced **125 passed, 3 failed, 8 warnings**.

The three failures were existing unrelated cases:

- `tests/unit/test_gate_module.py::test_active_duplicate_entry_prevention` — expected `DomainRuleViolationException`, but no exception was raised.
- `tests/unit/test_dock_release_store_manager_auth.py::test_dock_release_store_manager_authorization` — fixture insert failed on `fk_dock_masters_store_id_store` because its Store rows were not persisted before DockMaster rows.
- `tests/unit/test_warehouse_authorization_regression.py::test_manager_mock_token_has_explicit_approval_permissions_only` — expected `procurement:approve`; current local user permissions did not contain it.

Relevant additional suite runs had collection errors in six existing test files because they import the absent module `app.modules.procurement.infrastructure.persistence.models`:

- `tests/unit/test_asn_supplier_e2e.py`
- `tests/unit/test_dock_allocation.py`
- `tests/unit/test_end_to_end_dock_store_movement_flow.py`
- `tests/unit/test_comprehensive_putaway_verification.py`
- `tests/unit/test_store_keeper_putaway_lifecycle.py`
- `tests/unit/test_putaway_auth_and_zone_scan.py`

The supplier ASNs and PO prerequisite suites were also run separately: **25 passed, 8 warnings**. The collection failures above were not hidden or marked as passes.

### Frontend and build

- Focused Finished Goods traceability and original material QR tests: **44 passed** across 3 files.
- Complete Assembly frontend suite: **264 passed** across 23 files.
- Scoped ESLint on the relevant QR/Finished Goods files: passed.
- `npm.cmd run build`: passed for client, SSR, and Nitro bundles. Build emitted existing advisory warnings about a chunk above 500 kB and Vite/Nitro configuration/performance notices.

## Exact files modified

- `backend/business-service/app/modules/gate/infrastructure/api/router.py` — supplier-to-PO authorization and strict PO resolution in the ASN creation route.
- `backend/business-service/tests/integration/test_supplier_asn_po_authorization.py` — isolated API security and authorized-creation tests.
- `KAIZENX_FG_TRACEABILITY_PHASE_6D2_REPORT.md` — this report.

## Remaining blockers and readiness

- The security defect is fixed and the targeted authorization behavior is verified, including ASN creation, cancellation, and deletion ownership.
- Existing backend regression failures and missing procurement-module imports remain. They are outside this focused change and prevent claiming a clean full backend regression run.
- No ASN editing/reassignment endpoint was found. No downstream Gate, Dock, or GRN calls were made, per Phase 6D.2 scope.
- Do not proceed to Phase 6D.3 until the backend suite collection and unrelated failures are triaged. Phase 6E was not started.
