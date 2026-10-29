# KAIZENX AMS/WMS — Phase 6D.1 Report

## Decision

**PHASE 6E BLOCKED**

The integration sequence stopped before ASN creation because code inspection found that an authenticated supplier can reference a PO belonging to another supplier. This violates the explicit Phase 6D.1 ownership gate. No ASN, Gate Entry, Dock assignment, GRN, batch, QR, or inventory data was created in this run.

## API routes, authentication, and implementation reviewed

| Operation | Route | Authentication / permission | Result in this run |
|---|---|---|---|
| Supplier ASN create | `POST /api/gate/asns` | Supplier bearer token; `get_current_user` and `_authenticated_supplier_id` require role `SUPPLIER` and resolve the supplier identity | Not called; stopped at ownership defect |
| Gate PO lookup | `GET /api/gate/purchase-orders/{po_number}` | Gate route; source inspected | Not called |
| Gate Entry create | `POST /api/gate-entries` | `gate:write`; test harness can grant it with the WAREHOUSE role | Not called |
| Dock create | `POST /api/gate-entries/docks` | `gate:verify` | Not called |
| Dock assignment | `POST /api/gate-entries/{entry_id}/assign-dock` | `gate:verify` | Not called |
| Gate movement/check-in/unloading | `POST /api/gate-entries/{entry_id}/start-dock-movement`, `/dock-check-in`, `/start-unloading` | `gate:verify` | Not called |
| Gate receiving quantities/conditions | `PUT /api/gate-entries/{entry_id}/receiving-quantities`, `/material-conditions` | `gate:verify` | Not called |
| Gate completion and GRN posting | `POST /api/gate-entries/{entry_id}/complete-receiving`; `POST /api/gate-entries/grns/{grn_id}/post` | `gate:verify` | Not called |
| GRN header/line/QC/batches | `POST /api/receiving/grn/header`, `PUT /api/receiving/grn/{grn_id}/lines`, `POST /api/receiving/grn/{grn_id}/quality`, `POST /api/receiving/grn/lines/{grn_line_id}/batches` | `receiving:write` | Not called |

Supplier local test authentication accepts a bearer token in the `supplier-mock-token-{user UUID}-{supplier UUID}` format in local/test/development environments. Gate and receiving test calls can use the WAREHOUSE role header, which maps to the relevant permissions. No endpoint was invented or invoked in this verification.

## Supplier ownership result

`_authenticated_supplier_id` resolves the authenticated supplier and rejects users without a valid supplier identity. `create_supplier_asn` then resolves a PO by submitted PO number or ID. It validates active Material Master records and, when a PO is found, checks material membership and remaining quantities.

However, the ASN handler does not compare `po_model.supplier_id` with the authenticated `supplier_id`. It also does not reject a missing `po_model` before proceeding into ASN line validation and persistence. The inspected handler stores the authenticated supplier on the ASN while retaining the submitted PO reference. Consequently, neither cross-supplier PO ownership nor an invalid/nonexistent PO is demonstrably rejected by the implementation. This is a source-code finding; no unauthorized or invalid ASN request was sent because the required ownership gate failed inspection and the instructions require stopping the affected scenario.

The Phase 6D fixture structure contains one supplier, two active materials, and an approved PO with two lines. Its assertions establish the supplier ID relationship, material IDs, 25 PCS for Material A, and 20 PCS for Material B (planned split A1 10 + A2 15; B1 20). The test fixture commits these rows for its assertions and removes the exact PO lines, PO, materials, and supplier in `finally` cleanup.

## Database isolation evidence

Read-only audit command: `backend/business-service/.venv/Scripts/python.exe scratch/phase6c_isolation_audit.py`.

```text
configured_database=ams_business
test_database=kaizenassests_test_fg_b978662c
database_names_differ=True
server=::1/128:5432
database_role=ams_business
alembic_revision=20261032_nonunique_putaway_movement_index
existing_supplier_count=35
```

`alembic heads` reports `20261032_nonunique_putaway_movement_index (head)`, matching the connected test database revision. The test harness allowlists disposable database names and overrides `DATABASE_URL` with `KAIZENASSESTS_TEST_DATABASE_URL`; the fixture checks `current_database()` against that URL before inserts. Cleanup is available in the fixture. The configured application database was not targeted, and no migrations were run.

## API execution results

No Phase 6D.1 operational scenario API calls were executed. The existing Gate integration suite did make its own API calls, as reflected in the test result below. There are no Phase 6D.1 ASN IDs, Gate Passes, Gate statuses, dock allocations, GRN IDs, posted inventory results, or QR payloads to report. Duplicate Gate Entry, invalid dock, invalid GRN quantity, duplicate posting, QR linkage, payload preservation, and QR uniqueness remain untested. They are not marked passed.

Original batch QR generation is implemented in the receiving workflow after batches are created through the receiving API; this run did not reach those routes and did not retrieve or modify any QR payload.

## Tests

Executed on the isolated PostgreSQL test database:

```text
.venv\Scripts\python.exe scratch/phase6a_relevant_regressions.py tests/integration/test_phase6d_po_prerequisite.py tests/integration/test_gate_api.py tests/unit/test_grn_number_sequence.py tests/unit/test_grn_putaway_quantity_limit.py tests/unit/test_dock_completion_reconciliation.py
```

Result: **26 passed, 0 failed, 8 warnings** in 11.11 seconds. Warnings: seven Pydantic v2 class-config deprecations and one ReportLab `ast.NameConstant` deprecation. These are the PO fixture and existing regression tests; they are not the requested end-to-end API sequence. Supplier ownership, invalid PO/ASN, duplicate Gate, dock, GRN, and QR cases were not executed.

## Remaining blockers

1. Enforce authenticated supplier ownership against the PO in the existing ASN workflow and reject unresolved PO references. This is an application security/business validation correction; no change was made in Phase 6D.1.
2. Add/run API-level ownership, missing PO, invalid material, and PO quantity rejection cases after the correction.
3. Execute and record the complete ASN → Gate Entry → Dock → receiving/QC → GRN post → original batch QR sequence, then verify original payload, batch linkage, quantities, and uniqueness.
4. Run negative and duplicate-operation cases and relevant Supplier regressions after the ownership gate is corrected.

**PHASE 6E BLOCKED** — supplier-to-PO ownership enforcement is missing in the inspected ASN handler, so the operational scenario was deliberately stopped before creating supplier transaction data.
