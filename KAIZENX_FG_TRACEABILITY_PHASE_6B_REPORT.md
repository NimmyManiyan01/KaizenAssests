# KAIZENX AMS/WMS — Phase 6B Report

## 1. Gate API root cause

Phase 6A reported six Gate API failures with PostgreSQL `asyncpg.exceptions.UndefinedColumnError: column purchase_order.payment_terms does not exist` (surfaced to SQLAlchemy as `sqlalchemy.exc.ProgrammingError`). The failing SQL was the ORM purchase-order lookup issued by the Gate purchase-order endpoint; its selected `purchase_order` columns included `payment_terms`. The exception path was asyncpg protocol execution → `sqlalchemy/dialects/postgresql/asyncpg.py` prepare/execute adapter → SQLAlchemy async session execution → Gate route request. The tests do not run the application lifespan, so optional startup compatibility DDL did not run.

`PurchaseOrderModel` already mapped `payment_terms` as nullable `VARCHAR(128)`. No Alembic revision added that mapped field. The disposable database was initially at `20261030_assembly_consumption_api (head)`, while the schema was missing the column. The verified root cause was a migration gap, not incorrect production business behavior or a production connection.

Added `20261030_purchase_order_payment_terms.py`. It checks PostgreSQL and table/type compatibility and adds the column only when it is missing. It ran against the disposable database only. The final schema audit reports `payment_terms_present=True`.

The stale Gate tests also targeted a removed route, did not seed referenced PO/supplier records, omitted required payload fields, expected obsolete status/identifier formats, and called a broad reset endpoint. Their fixture now creates deterministic PO/supplier records, calls the current endpoint, and uses unique vehicle identifiers. Broad reset calls were removed to avoid deleting unrelated test data. A real ORM mismatch in Gate approval was fixed in `gate/infrastructure/api/router.py`: the adapter now reads supplier/material/quantity fields that exist on `GateEntryModel` and uses OCR values when available.

## 2. Warehouse collection and runtime causes

The three Phase 6A modules imported from the deleted path `app.modules.procurement.infrastructure.persistence.models`. The referenced model classes still live in `app.common.persistence.models`; this was a stale import path, not a missing dependency or deleted functionality. Imports now point to the existing model module. All three suites collect.

Running the collected tests exposed stale fixture assumptions: missing GRN accepted quantities/material masters, missing batch identity in a synthetic batch QR, missing assigned bin/location data, and obsolete status expectations. Those test fixtures/assertions now represent the active workflows. No tests were skipped.

The QR putaway test also revealed a schema defect: an old unique constraint/index on `putaway_movement.putaway_task_id` rejected the second movement in a partial-then-final putaway. This contradicts the application's multiple-movement history and partial-putaway flow. Added forward migrations `20261031_multiple_putaway_movements.py` and `20261032_nonunique_putaway_movement_index.py` to remove the obsolete one-to-one uniqueness while retaining a non-unique lookup index. The downgrade guards refuse to restore uniqueness if multiple movement rows exist.

## 3. Files changed for Phase 6B

- `backend/business-service/alembic/versions/20261030_purchase_order_payment_terms.py`
- `backend/business-service/alembic/versions/20261031_multiple_putaway_movements.py`
- `backend/business-service/alembic/versions/20261032_nonunique_putaway_movement_index.py`
- `backend/business-service/app/modules/gate/infrastructure/api/router.py`
- `backend/business-service/tests/integration/test_gate_api.py`
- `backend/business-service/tests/unit/test_qr_putaway_flow.py`
- `backend/business-service/tests/unit/test_putaway_store_zone_integration.py`
- `backend/business-service/tests/unit/test_phase3_dock_release_and_putaway.py`

## 4. Database initialization and safety

Tests and Alembic use `kaizenassests_test_fg_b978662c`. The runners derive the PostgreSQL connection settings from `.env`, replace the database path with this explicit disposable database, and set `KAIZENASSESTS_TEST_DATABASE_URL`. The test `conftest.py` enforces test-database naming/allowlisting. The migration runner first checks `SELECT current_database()` against the exact disposable database name before invoking Alembic. The read-only schema audit independently made the same assertion.

Final migration state: `20261032_nonunique_putaway_movement_index (head)`. Schema audit: database `kaizenassests_test_fg_b978662c`; `purchase_order` exists; `payment_terms` is present; the putaway task lookup index exists and is non-unique. No configured application database was modified, no production URL was used for tests or migrations, and no deployment was performed.

## 5. Focused test results

| Suite | Result | Skipped | Collection errors | Warnings |
|---|---:|---:|---:|---:|
| Gate API | 9 passed | 0 | 0 | Included in 8 warnings below |
| Warehouse/Putaway modules | 6 passed | 0 | 0 | Included in 8 warnings below |
| GRN number, GRN putaway quantity, Dock completion | 16 passed | 0 | 0 | Included in 8 warnings below |
| Combined requested backend focus | **31 passed** | **0** | **0** | **8** |

The 8 warnings are existing Pydantic v2 class-config deprecations and ReportLab's `ast.NameConstant` deprecation. The separate GRN/Dock invocation also reports 16 existing coroutine warnings from the async schema-compatibility autouse fixture being collected by synchronous tests.

## 6. Regression results

- Focused frontend traceability/GRN/putaway/Assembly selection tests: **69 passed across 7 files**.
- Complete Assembly frontend suite: **264 passed across 23 files**. One initial run had a 5-second timeout in a test that passed when isolated; the final complete rerun passed all tests.
- PostgreSQL FG traceability + Assembly QC/completion/status regressions: **73 passed, 8 warnings** after the new migrations.
- Scoped ESLint: **passed, 0 errors, 0 warnings**.
- Frontend production build: **passed** for client, SSR and Nitro. Existing Vite tsconfig-paths and large-chunk advisories remain.

## 7. Remaining blockers and scope

No Gate, GRN, Dock, Warehouse, Putaway or traceability test failures remain in the requested test matrix. No collection errors remain in the three reported Warehouse/Putaway modules. Browser-based operator workflow and physical camera/printer acceptance were not executed; Phase 6A found no browser automation dependency/executable or connected camera/printer. Those checks remain outside this infrastructure repair and must be run where those facilities are available.

## 8. End-to-end test readiness

**E2E TESTING READY**

Evidence: all 31 requested backend Gate/GRN/Dock/Warehouse/Putaway tests pass on the allowlisted disposable PostgreSQL database; all 73 PostgreSQL traceability regressions pass; the focused frontend set and full Assembly suite pass; schema and migration state were verified on the disposable database. Browser/hardware acceptance remains unperformed, so this readiness statement covers the repaired automated test infrastructure, not physical UAT or production release approval.
