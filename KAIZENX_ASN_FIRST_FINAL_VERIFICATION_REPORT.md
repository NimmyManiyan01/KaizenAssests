# KAIZENX — Final ASN-first verification

Date: 2026-10-29. Result: **ASN-FIRST VERIFIED** for the requested regression and ASN-to-GRN verification scope.

## Remaining failure investigation and coverage disposition

### Backend regression failure

Former test: `tests/unit/test_asn_supplier_e2e.py::test_asn_creation_sends_email_to_correct_supplier`.

Exact initial cause:

```text
with patch("app.modules.procurement.infrastructure.api.router.send_email", ...):
AttributeError: module 'app.modules.procurement.infrastructure.api' has no attribute 'router'
```

Its intended coverage was examined before removal: it created a PO/supplier/contact, called `/api/v1/procurement/asns`, supplied its own ASN number and old fixed dates, then asserted a supplier email's recipient, subject, greeting, ASN/PO references, material quantity and transport details. The application no longer registers that procurement router or ASN endpoint. The active ASN implementation generates the ASN number, authenticates supplier ownership, validates active materials and transport, and persists operational notifications for Gate Security and Warehouse. It does not send the former procurement ASN email. Merely changing the patch import would therefore preserve a test of removed behavior, not fix its intended endpoint coverage.

The old test was removed and replaced by:

`tests/integration/test_asn_first_receiving_api.py::test_asn_dispatch_notifies_operational_roles_with_persisted_shipment[False/True]`

Both cases execute the supported ASN API and assert **exactly two** persisted notifications, the exact operational recipients, authenticated supplier, generated ASN reference, optional historical PO reference, material code/quantity/UOM, vehicle, driver and contact. Assertions were replaced around the active notification contract, not loosened around the removed email contract. No email or procurement API was recreated.

### Backend collection error

Former file: `tests/unit/test_rfq_response.py`; its two tests were:

- `test_to_rfq_response_with_null_rfq_date`
- `test_to_rfq_response_with_valid_rfq_date`

Exact initial cause:

```text
from app.modules.procurement.infrastructure.api.router import _to_rfq_response
ModuleNotFoundError: No module named 'app.modules.procurement.infrastructure.api.router'
```

These tests covered only a removed RFQ response serializer: falling back from null RFQ date and preserving an explicit date. The router, serializer and imported `RfqResponse` schema are absent from the active application, and no replacement RFQ API is registered in `app/main.py`. The file was removed as demonstrably retired RFQ API coverage. There is no corresponding active ASN-first requirement to replace with a fake serializer. Historical PO/RFQ data and shared persistence models were not deleted or altered.

Historical PO coverage remains: supplier ownership/reference validation, historical PO-linked ASN reads/Gate Entry, invalid/mismatched/off-PO references, and `test_phase6d_po_prerequisite.py` all remain. The latter was executed separately and passed.

## Verified operational defects and minimal corrections

The new API execution exposed three defects that prepared-record regressions had not detected:

1. **Dock assignment notification read a nonexistent attribute.** `assign_arrival_dock` used `GateEntryModel.asn_number`, which does not exist. It now reads the linked ASN's number. Original exception: `AttributeError: 'GateEntryModel' object has no attribute 'asn_number'`.
2. **Gate-side assignment left the warehouse request pending.** The vehicle queue uses `/api/gate-entries/{id}/assign-dock`; it created a gate assignment but left its existing warehouse allocation at `AWAITING_DOCK`. Dock check-in correctly rejected it with HTTP 409: `Dock allocation is AWAITING_DOCK, expected DOCK_ASSIGNED`. The assignment now locks and transitions the existing pending request to `DOCK_ASSIGNED`, with matching store, operator and timestamp; a corresponding Dock Master is synchronized when present. Non-pending requests remain rejected. The check-in validation was not relaxed.
3. **Legacy PostgreSQL uniqueness disagreed with the existing batch-aware model.** The database still enforced `uq_putaway_task_grn_item(grn_id,item_code)`, while the current ORM and posting code use separate tasks for each batch. Posting a valid 10/15 batch split raised `asyncpg.exceptions.UniqueViolationError` and HTTP 500. Migration `20261035_putaway_batch_uniqueness` replaces that old constraint with the model's existing `(grn_id,item_code,batch_number)` constraint. It changes no quantities, PO fields, foreign keys or QR identities. Downgrade refuses to collapse actual multiple batch tasks.

No changes were made to original material QR generation/payload code, Assembly consumption, historical PO ownership rules, or unrelated business logic.

## Exact implementation files changed in this cleanup

- Modified: `backend/business-service/app/modules/gate/infrastructure/api/router.py` — the two verified Dock assignment defects above.
- Added: `backend/business-service/alembic/versions/20261035_putaway_batch_uniqueness.py` — schema alignment with the existing batch-aware model.
- Added: `backend/business-service/tests/integration/test_asn_first_receiving_api.py` — notification replacement, actual API flow, posting/QR retry integrity and migration integrity coverage.
- Added: `backend/business-service/scripts/run_asn_final_tests.py` — explicit disposable-target/head/schema gates for migration and pytest execution.
- Removed: `backend/business-service/tests/unit/test_asn_supplier_e2e.py` — removed email API coverage, replaced as documented above.
- Removed: `backend/business-service/tests/unit/test_rfq_response.py` — removed RFQ serializer coverage, disposition documented above.
- Added: `KAIZENX_ASN_FIRST_FINAL_VERIFICATION_REPORT.md`.

No frontend source/configuration was changed in this cleanup. Existing uncommitted work from previous phases was preserved. Validation artifacts include the `final-*.log`/XML files and `backend/business-service/final-backend-selection.txt`.

## PostgreSQL isolation and migration evidence

Configured application database: `ams_business`.

Verified disposable target: `kaizenassests_test_fg_b978662c`.

The tracked runner derives only that named disposable target from the configured connection, verifies `current_database()` and a distinct application database name before importing application tests or running Alembic, and rejects unexpected revisions. It checks all five nullable PO fields and the retained `vehicle_exit_approval → purchase_order` foreign key. No configured application database was modified.

Only the disposable database was upgraded:

```text
before=20261034_optional_handling_unit_po
after=20261035_putaway_batch_uniqueness
nullable_PO_fields=5
historical_PO_FK=True
```

Evidence: `backend/business-service/final-migration.log` and the subsequent guarded test runs.

`test_putaway_batch_migration_preserves_rows_and_guards_downgrade` executes the actual migration functions against a transaction-local schema on PostgreSQL. It verifies preservation of a historical task, acceptance of two different batches, rejection of a duplicate identical batch, refusal to downgrade multiple batch tasks, and a safe downgrade/re-upgrade after removing only the synthetic second task. The schema is rolled back. The populated public schema was not downgraded, and no production migration ran.

The operational fixture seeds only supplier/material/store master data. Its optional PO fixture is used only by the historical notification case. Actual operational records use application APIs and the normal UnitOfWork commit/rollback code on sessions joined through savepoints to an outer transaction. All new operational test data is rolled back after the test. Uploads use a workspace-local pytest temporary directory. No authorization dependency, quantity validation or QR generator is mocked.

## PO-free ASN → Gate → Dock → GRN execution

Test: `test_po_free_asn_gate_dock_grn_posting_and_original_batch_qr`.

Final full-regression evidence from `backend/business-service/final-backend.log`:

- ASN: `ASN-2026-8684`
- Gate Entry ID: `d1297c82-ca25-4d83-92cf-d54d4f8ce5ff`
- GRN ID: `1f6e192b-2f41-4564-865b-ffa73d4bc3b0`
- Material: `MAT-FINAL-739F53E4A9`, received/accepted quantity **25 PCS**, split into **10 PCS and 15 PCS**.
- No PO is submitted. ASN, Dock assignment, GRN and receipt posting retain null PO references. Supplier ownership and another supplier's HTTP 404 are asserted.

| Supported API | Final outcome |
|---|---|
| `POST /api/gate/asns` | 201; authenticated supplier, null PO |
| `GET /api/gate/asn/{id}` as another supplier | 404, as required |
| `POST /api/gate-entries` | 201; accepts the ASN, null PO |
| `POST /api/gate-entries/docks` | 201; creates test receiving dock |
| `POST /api/gate-entries/{id}/assign-dock` | 200; assigned store/dock and null PO |
| `POST .../{id}/start-dock-movement` | 200 |
| `POST .../{id}/dock-check-in` | 200 |
| `POST .../{id}/start-unloading` | 200 |
| `PUT .../{id}/receiving-quantities` | 200; 25 received |
| `PUT .../{id}/material-conditions` | 200; 25 good, required inspection |
| `POST .../{id}/quality-inspection` | 200; PASS |
| `POST .../{id}/handling-units` | 200; API-generated receiving labels |
| `POST /api/receiving/grn/header` | 200; `ASN_RECEIPT`, null PO |
| `PUT /api/receiving/grn/{id}/lines` | 200; good quantity 25 |
| `GET /api/receiving/grn/{id}` | 200; actual persisted line ID |
| `POST /api/receiving/grn/{id}/quality` | 200; accepted/approved quantity 25 |
| `POST /api/receiving/grn/lines/{id}/batches` | 200; two original batch QRs |
| `GET /api/gate/asns/{id}/pdf` | 200; real generated supplier ASN PDF |
| `POST /api/receiving/grn/{id}/documents` | 200; uploads that ASN PDF |
| `POST /api/receiving/grn/{id}/complete` | 200; COMPLETED with `posted_at` |
| Repeat `POST .../{id}/complete` | 200; remains one posting and two batch tasks |

Persisted assertions confirm exactly one receipt posting of 25 PCS, two batch-specific putaway tasks of 10/15 PCS, and unchanged QR identities/payloads after posting and retry. No GRN, batch or QR records were manually inserted.

The verified GRN path uses the supported receiving wizard header/lines/quality/batches/documents/complete APIs. An exploratory attempt to combine wizard QC with the alternative gate-posting endpoint was rejected by its receiving/quality reconciliation. That validation remains intact; no claim is made that every combination of the two receiving interfaces is interchangeable. Missing label/document prerequisites encountered while constructing the test were satisfied through their APIs rather than bypassed.

## Original batch QR generation evidence

Both QRs were created by `POST /api/receiving/grn/lines/{id}/batches`, then read from PostgreSQL and compared byte-for-byte with the API output before and after posting/retry:

| Batch / original QR identity | Quantity | Stored payload SHA-256 |
|---|---:|---|
| `LOT-MAT-FINAL-739F53E4A9-20261029-19A2` / `QR-BATCH-LOT-MAT-FINAL-739F53E4A9-20261029-19A2` | 10 PCS | `280f1e74d6cb793c3f24ab7bcfa39753f0ee4cdc324df30e708c3c6aa35db37a` |
| `LOT-MAT-FINAL-739F53E4A9-20261029-F848` / `QR-BATCH-LOT-MAT-FINAL-739F53E4A9-20261029-F848` | 15 PCS | `2c1b36e3d4b256b4dd7c6045b633bb5577159e308232bc3730b301c3c216677d` |

These IDs/hashes identify rolled-back test artifacts recorded in the log; they are not retained production records. Existing historical QR identities were not regenerated.

## Regression results

All figures below are executed results, not inherited claims from the prior report.

| Selection | Passed | Failed/errors | Skipped | Evidence |
|---|---:|---:|---:|---|
| Relevant backend suite, 25 files | **138** | **0** | **0** | `backend/business-service/final-backend.log`, `final-backend.xml` |
| Additional historical PO prerequisite / supplier transport, 2 files | **4** | **0** | **0** | `backend/business-service/final-historical-transport.log`, XML |
| Complete backend collection | **424 collected** | **0 collection errors** | N/A, collection only | `backend/business-service/final-collection.log` |
| Focused frontend traceability, 3 files | **44** | **0** | **0** | `frontend/final-traceability.log` |
| Complete Assembly frontend, 23 files | **264** | **0** | **0** | `frontend/final-assembly.log` |
| Scoped ESLint, 6 files | 0 errors, 0 warnings | 0 | N/A | `frontend/final-eslint.log`, exit 0 |
| Production build | passed | 0 | N/A | `frontend/final-build-confirmed.log`, exit 0 |

The 138-test backend run includes these non-overlapping groups:

- Supplier ASN/Gate API and new operational/migration tests: **32 passed**.
- Dock/GRN/Receiving QR regressions: **39 passed**.
- Warehouse/Putaway regressions: **19 passed**.
- PostgreSQL consumption traceability: **22 passed**.
- Gate domain/ASN transport/Assembly validation and FG inventory: **26 passed**.

The exact 25-file selection is saved in `backend/business-service/final-backend-selection.txt`. Together with the four additional tests, **142 distinct backend tests executed**. Full-tree collection has **zero uncollected tests due to errors**; the other **282 collected tests were not executed in this scoped verification**. This is not a claim that all 424 backend tests passed. No tests were marked skipped, xfailed or excluded to suppress a failure. The three retired test functions and their coverage disposition are explicitly documented above.

Backend warnings: 8 Pydantic/reportlab deprecations in the relevant run, plus an asyncio fixture-scope configuration warning emitted before pytest startup. Collection also reports an existing helper class with a constructor that is not a test class. Frontend build emits Vite/Nitro/chunk advisories; no lint rules or test timeouts were disabled/increased.

The initial PowerShell build redirection reported a shell error for warning output despite completing the build; the final build was repeated through `cmd /c` to capture the native process status, which was **0**. Backend JUnit explicitly records `tests=138, failures=0, errors=0, skipped=0`; PowerShell warning wrapping is not treated as a failed pytest assertion. A pytest system-temp permission issue was resolved using an allowed workspace-local base directory for final runs.

## Remaining blockers and verification limits

No remaining blocker was observed in the requested ASN-to-GRN/QR sequence or the executed relevant regression selections. The removed procurement imports no longer prevent collection, and neither mandatory PO validation nor a fake procurement module was introduced.

This verification does not execute a complete operational warehouse putaway → Assembly consumption → Finished Goods sequence using these newly received batches. Those areas have passing focused regressions, including PostgreSQL traceability, but this is not a new end-to-end Finished Goods run. The other 282 collected backend tests were not run. Earlier unrelated startup-DDL/damage-resolution changes identified by the stabilization report were preserved and are outside this cleanup's verification claim.

No production data was modified, no production migration ran, and nothing was deployed. Work stops after this verification/report.

**ASN-FIRST VERIFIED**
