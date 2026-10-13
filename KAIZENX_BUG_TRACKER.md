# KaizenX Bug Tracker

## Critical

### BUG-001 — Full backend suite uses unsafe cleanup ordering

- Severity: CRITICAL
- Reproduction: Run python -m pytest -q and reach tests/unit/test_finished_goods_requests_flow.py:25.
- Actual: DELETE FROM finished_goods_request fails because assembly_finished_goods_allocation still references the request.
- Evidence: PostgreSQL ForeignKeyViolationError, constraint fk_assembly_finished_goods_allocation_finished_goods_re_a7cb.
- Impact: Finished-goods request tests cannot start and test isolation is unreliable.
- Recommended correction: Use a dedicated rollback-isolated test database and delete child allocations before parent requests in test cleanup.

## High

### BUG-002 — Requested test transaction does not match existing ASN data

- Severity: HIGH
- Actual: ASN-2026-1 exists for MAT-STEEL-7809, while the requested scenario requires MAT-STEEL-21C5.
- Impact: The specified E2E transaction cannot be safely continued.
- Recommended correction: Provide isolated seed data for the exact scenario.

### BUG-003 — Full backend suite has 63 failures

- Severity: HIGH
- Evidence: pytest -q completed with 63 failed and 5 setup errors.
- Impact: Multiple gate, ASN, assembly, inventory, dispatch, and E2E workflows are not verified.
- Recommended correction: Repair test isolation first, then repair stale endpoint expectations.

### BUG-004 — Frontend lint is not clean

- Severity: HIGH
- Actual: 2,594 errors and 33 warnings from npm.cmd run lint.
- Impact: Frontend quality gate fails.
- Recommended correction: Resolve lint errors in a separate frontend task.

## Medium

### BUG-005 — Requested gate pass is unavailable

- Severity: MEDIUM
- Actual: Gate pass 32CGRL was not found in finished_goods_pickup_gate_visit.
- Impact: Gate-pass reuse and outbound audit linkage cannot be tested.

### BUG-006 — Material code is unavailable

- Severity: MEDIUM
- Actual: MAT-STEEL-21C5 is absent from material.
- Impact: Material dropdown, QR, GRN, and inventory linkage cannot be tested for the requested scenario.

### BUG-007 — Fresh isolated database cannot complete Alembic migration

- Severity: CRITICAL for isolated E2E testing
- Actual: `alembic upgrade head` against `ams_business_e2e_20261013` fails at `246123db4a01_add_notification_details.py` with `sqlalchemy.exc.NoSuchTableError: notification`.
- Evidence: The new database had zero public tables before migration; the failure occurs while the migration inspects `notification` on a branch where that table has not yet been created.
- Impact: Safe fixture creation, isolated API startup, transaction commit checks, and cleanup preflight are blocked.
- Recommended correction: Repair the migration dependency/order or provide a reviewed schema bootstrap that still uses the current migrations. Do not run the existing autouse `tests/conftest.py` fixture against `ams_business`.

### BUG-008 — Existing pytest autouse fixture is not database-isolated

- Severity: HIGH
- Actual: `backend/business-service/tests/conftest.py` executes `ALTER TABLE` statements through the configured application session and does not reject `ams_business`.
- Impact: Running tests with the normal `.env` can modify the existing development database schema.
- Recommended correction: Add an explicit isolated-database guard and dedicated test configuration before running integration tests.

### Investigation update — database identity and persistence trace (2026-10-13)

- The backend service configuration resolves to PostgreSQL database `ams_business`, schema `public`, server port `5432`; the live identity query returned database `ams_business`, schema `public`, user `ams_business`, port `5432`.
- `backend/business-service/app/database/session.py:20-26` creates the SQLAlchemy engine from `get_settings().database_url`; `backend/business-service/app/config/settings.py:14-32` loads `.env` and defaults to the same `ams_business`/5432 target. The checked-in backend `.env` also specifies that target. The frontend uses `http://localhost:8000` through `frontend/.env` and `frontend/src/lib/api-client.ts` (the API client’s business-service base URL), so the browser and backend are intended to use the same running business service. The audit queries used the backend SQLAlchemy target directly.
- The repository’s `.env.example` advertises a different PostgreSQL port (5433), but it is not the active `.env`; this is a configuration drift risk, not evidence that the current audit used 5433.

#### BUG-002 confirmed — persisted ASN line is different data, not a proven ID remapping

- Evidence: `public.asn` contains `ASN-2026-1`; its `public.asn_line` contains `item_code=MAT-STEEL-7809`, `material_name=steel`, `shipped_quantity=100`, `uom=PCS`. `public.material` contains `MAT-STEEL-7809` and does not contain `MAT-STEEL-21C5`.
- Persistence path: `frontend/src/lib/api-client.ts:1494-1499` posts the ASN payload to `/api/gate/asns`; `frontend/src/routes/supplier.asns.new.tsx:294-314` sends both `material_id` and the selected `item_code` unchanged. The current database row is therefore a persisted MAT-STEEL-7809 line. No evidence was found in the inspected path that converts MAT-STEEL-21C5 to MAT-STEEL-7809.
- Root cause: the audited database was seeded/persisted with a different material scenario. The requested MAT-STEEL-21C5 record was never present in this database. Smallest safe correction: use an isolated, explicitly seeded test fixture containing MAT-STEEL-21C5 and a matching ASN; do not rewrite this existing ASN.

#### BUG-005 confirmed — gate pass 32CGRL is absent from all inspected persistence paths

- Evidence: `public.finished_goods_pickup_gate_visit`, `public.gate_entry`, and `public.notification` all returned zero rows for `32CGRL`.
- Persistence path: `backend/business-service/app/modules/gate/infrastructure/api/router.py:94-130` creates and commits a `FinishedGoodsPickupGateVisitModel` with a generated `gate_pass_number`; `frontend/src/lib/api-client.ts:324-328` calls that endpoint. The UI must therefore display the API response or a locally retained response. The audited database has no corresponding persisted pickup visit, inbound gate entry, or notification.
- Root cause: unresolved between a different running backend/database at the time the UI displayed 32CGRL, an optimistic/stale UI result, or a transaction/request that did not commit. The current source path does not prove which occurred, and no matching row remains to distinguish them. Smallest safe correction: capture the exact POST response and verify the same database immediately after the request; then repair the runtime/configuration or transaction boundary indicated by that evidence.

#### BUG-006 confirmed — material dropdown and audited material master disagree

- Evidence: `public.material` has no `MAT-STEEL-21C5` row. The supplier ASN screen loads material data from the live API (`frontend/src/routes/supplier.asns.new.tsx:111-124`); the supplier dashboard loads `getMaterialComponents()` (`frontend/src/routes/supplier-dashboard.tsx:83-88`). `frontend/src/lib/api-client.ts:1845` calls `/api/gate/materials`, while `frontend/src/lib/api-client.ts:1849-1867` uses `/api/v1/materials` for other material operations. The backend route `backend/business-service/app/modules/gate/infrastructure/api/router.py:242-260` exposes the `/api/gate/materials` path.
- Root cause: the UI value came from a runtime response/cache/seed state that is not represented in the audited `public.material` table, or from a different runtime target. The current source uses API responses and has no `INITIAL_MATERIALS` fallback in the inspected supplier ASN screen; the database evidence rules out a currently persisted material-master record. Exact historical source of the stale value is unresolved without browser network/storage capture from the original session.
- Smallest safe correction: make the material-master API, browser session, and audit use the same runtime/database target, then seed/maintain MAT-STEEL-21C5 through the normal material-master workflow if that code is required. Do not hardcode it in the frontend.

## Low

No new cosmetic issue was classified because browser execution was not completed.
