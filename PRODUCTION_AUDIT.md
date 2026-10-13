# KaizenX Production Readiness Audit — Phase 1

**Audit date:** 2026-10-13 (Asia/Calcutta)  
**Scope:** read-only source, configuration, migration, test, and repository inspection.  
**Change policy:** no application code, database record, migration, or table was modified.

## Executive summary

The repository is a multi-client WMS/AMS implementation: a Vite/React/TypeScript web client (`frontend`), a React Native client (`kaizenX`), and a FastAPI/SQLAlchemy/PostgreSQL business service (`backend/business-service`). The primary production blockers are database migration reproducibility, unsafe test-database targeting/cleanup, a large known failing test/lint baseline, broad/duplicated API surface, and security/configuration paths that appear development-oriented.

The listed business workflows are represented in source across gate, dock, receiving, storage, assembly, dispatch, and supplier modules. No Purchase Order or Sales Order dependency is introduced by this audit. Procurement and customer-order modules do exist and are active code paths for some screens; they should not be removed without consumer confirmation.

## 1. Repository architecture

| Area | Evidence | Assessment |
|---|---|---|
| Web frontend | `frontend/src/routes` (61 route files), `frontend/src/lib/api-client.ts`, `frontend/src/components` | Large client with centralized API wrapper and multiple WMS screens. |
| Mobile frontend | `kaizenX/src`, `kaizenX/App.tsx`, native `android`/`ios` projects | Separate API client and endpoint constants; contains hardcoded LAN defaults. |
| Backend | `backend/business-service/app/main.py` and `app/modules/*` | FastAPI application registering 19 router files/modules. |
| Persistence | `app/common/persistence/models.py` plus module persistence models | SQLAlchemy models are distributed between common, gate, and domain modules. |
| Migrations | `backend/business-service/alembic/versions` (127 files) | Long, branched history with merge revisions and legacy/backup files. |
| Async/background work | `app/workers`, `app/events`, `app/kafka` | Outbox, notification consumer, Kafka producer/consumer are backend consumers beyond the browser. |
| Tests | `backend/business-service/tests` (66 files found), `kaizenX/__tests__` | Backend unit/integration/E2E-style tests and mobile tests; browser E2E is not evidenced. |

Also present: `backend/common` Java/Maven code, a checked-in `backend/business-service/wms.db`, scripts including destructive wipe/drop/truncate utilities, Docker files, and multiple historical audit/test reports.

## 2. Active workflows traced

| Workflow | Frontend evidence | Backend/database evidence | Audit status |
|---|---|---|---|
| Supplier ASN creation | `frontend/src/routes/supplier.asns.new.tsx`; `api-client.ts` ASN methods | Gate/procurement router and ASN/ASN-line models | Implemented path found; end-to-end runtime proof not completed. |
| Gate entry / pass | `supplier.dispatch.tsx`, `vehicle-queue.tsx`, `vehicle-exit.tsx` | `app/modules/gate/infrastructure/api/router.py` gate-entry, pass, verify, exit endpoints | Implemented; duplicate QR routes identified below. |
| Dock allocation | `dock-management.tsx`, `dock-master.tsx` | `app/modules/dock/.../router.py`; gate dock endpoints | Implemented; requires integration coverage. |
| Vehicle check-in | `receiving.tsx`, `vehicle-queue.tsx` | gate router dock-check-in/start movement/unloading | Implemented. |
| GRN / quality | `grn.tsx`, receiving routes | `app/modules/receiving/...`, gate quality/GRN endpoints, receiving models | Implemented; quantity/quality invariants need isolated E2E tests. |
| Material QR | receiving/QR routes and `api-client.ts` QR methods | receiving/gate models and QR endpoints | Implemented; traceability needs test data and persistence verification. |
| Rack assignment / putaway | `putaway-tasks.tsx`, warehouse routes | storage router, store/bin/zone modules, putaway models | Implemented. |
| Warehouse inventory | `inventory.tsx`, warehouse routes | storage inventory router and inventory models | Implemented; ledger/concurrency controls need production validation. |
| Raw material request / issue | `warehouse.material-requests.tsx`, assembly material request screens | assembly and storage inventory routers | Implemented; backend tests exist but full suite is not green. |
| Assembly production / QC | `assembly.production.tsx`, `assembly.quality.tsx` | `app/modules/assembly/infrastructure/api/router.py` | Implemented with BOM, production, QC, receipt paths. |
| Finished goods QR / stock | `assembly.finished-goods.tsx`, warehouse finished-goods routes | assembly finished-goods and QR endpoints | Implemented; FIFO allocation path also exists. |
| Finished goods dispatch | dispatch and supplier dispatch routes | assembly dispatch plus dispatch module/customer-order module | Implemented; multiple dispatch models/route families require contract review. |
| Gate exit | `dispatch-gate-exit.tsx`, `vehicle-exit.tsx`, pickup exit routes | gate and dispatch gate-exit endpoints | Implemented; audit timestamp/persistence coverage is missing. |

The mobile client independently calls gate, dock, procurement, assembly, and notification paths from `kaizenX/src/services/api.ts` and `kaizenX/src/constants/index.ts`; it is therefore a confirmed API consumer even where the web client does not call a route.

## 3. API inventory and contract findings

### Active API families

Registered families include gate (`/api/gate-entries`, `/api/gate`, `/api/dashboard`), dock, receiving, returns, storage/inventory, quarantine, store/zones/bins, assembly, dispatch, customer orders, procurement, suppliers/master data, notifications, and authentication. The web API wrapper is concentrated in `frontend/src/lib/api-client.ts`; the mobile wrapper is `kaizenX/src/services/api.ts`.

### Confirmed duplicate or inconsistent implementations

| Finding | Exact location | Evidence / consumers checked | Risk | Recommendation |
|---|---|---|---|---|
| Duplicate gate QR lookup/approval declarations | `backend/business-service/app/modules/gate/infrastructure/api/router.py:3819-3905` | Same `GET /qr/{gate_entry_number}` and `POST /qr/{gate_entry_number}/approve` patterns appear twice in one router. | High | Investigate route registration/order and consolidate only after contract tests. |
| Parallel gate URL families | `kaizenX/src/services/api.ts:285-316`, `kaizenX/src/constants/index.ts:6-22`, gate router | Mobile contains `/api/v1/gate/...` constants but fallback tries `/api/gate-entries/...`; backend primarily registers `/api/gate-entries` and `/api/gate`. | High | Keep compatibility only if proven required; document canonical paths and test mobile/web contracts. |
| Parallel authentication families | `app/security/router.py`, `app/security/auth_router.py`, frontend/mobile API clients | `/api/v1/auth`, `/api/v1/procurement/auth`, `/api/v1/auth/login`, supplier-login, magic-login, and dev-login paths coexist. | High | Map role/auth consumers and define production auth policy before cleanup. |
| Dispatch/order overlap | `app/modules/dispatch/.../router.py`, `customer_orders/.../router.py`, assembly dispatch routes | Customer orders, generic dispatches, assembly dispatch, and supplier FG dispatch all have separate route families. | Medium | Preserve until service/integration consumers are inventoried; add contract matrix. |
| Development reset endpoint exposed | `app/modules/gate/infrastructure/api/router.py:1605`, `frontend/src/lib/api-client.ts:885` | Route is registered and client-callable. | High | Keep for now for audit scope; production exposure must be disabled or strongly restricted. |

### Unused/deprecated API status

No endpoint is classified as confirmed unused from static inspection alone. Backend workers, mobile client, tests, and integrations are consumers beyond web route calls. Candidates requiring investigation are the debug endpoint in `app/main.py:1672`, the dev reset endpoint above, and compatibility route families. `q/{code}` and `po/{code}` in `app/main.py:1690-1699` have matching frontend route files (`q.$code.tsx`, `po.$code.tsx`), so they are not confirmed unused.

## 4. Code cleanup candidates

### Confirmed or strongly evidenced candidates

| Path / symbol | Evidence and checks | Risk | Action |
|---|---|---|---|
| `backend/business-service/tests/legacy_archive/obsolete_procurement_tests/*.txt` | Explicitly archived `.txt` test files, not executable Python tests. | Low | Keep until ownership confirms archival policy; then Remove from active tree. |
| `backend/business-service/wms.db` | Checked-in SQLite database exists alongside PostgreSQL configuration. Static inspection cannot prove runtime use. | Medium | Investigate; Keep only if a documented local/demo/mobile use exists. |
| `backend/business-service/scripts/drop_all_tables.py`, `truncate_database.py`, `wipe_*.py`, `clean_*.py` | Destructive operational scripts are present in the repository. | High | Keep outside production artifact or require explicit environment guards; do not execute during audit. |
| `backend/business-service/app/main.py` broad `except Exception` blocks | Many broad catches, including silent `except Exception: pass`, across startup/seed/compatibility code. | High | Investigate each block; replace with typed handling and structured logging in a later phase. |
| `backend/business-service/app/modules/gate/infrastructure/api/router.py` duplicate QR routes | Same route patterns occur twice. | High | Investigate, add route-registration tests, then consolidate if confirmed duplicate. |

### Potentially unused / requiring investigation

| Path / symbol | Evidence | Dependencies/consumers checked | Risk | Action |
|---|---|---|---|---|
| `backend/common/src/main/java/...` Java common service | Maven project is present, but FastAPI is the registered business service in `main.py`. | Repository structure and backend startup inspected; no safe proof of deployment consumer. | Medium | Investigate deployment manifests/CI before removal. |
| Gate preview/debug routes in `app/main.py` | Explicit debug endpoint and preview router are registered. | Backend router registration; web/mobile API searches. | High | Investigate external operational use; restrict in production. |
| Duplicate/legacy schema modules under gate and common persistence | Models exist in multiple persistence locations and raw SQL schema files exist. | Model/file inventory; no DB schema diff executed against live data. | Medium | Investigate ownership and migration/model parity. |
| Broad `any` usage in `frontend/src/lib/api-client.ts` | API wrapper contains many `request<any>` calls. | Frontend call sites are centralized; no generated OpenAPI client found. | Medium | Investigate response typing gaps; add typed contracts before refactor. |

No file is recommended for immediate deletion in Phase 1.

## 5. Database audit

- PostgreSQL is the configured production database; SQLAlchemy session is created in `app/database/session.py` from `app/config/settings.py`.
- Models and relationships are distributed across common, gate, assembly, dispatch, storage, store, receiving, procurement, notification, returns, quarantine, and customer-order modules.
- There are 127 Alembic version files, including merge revisions and backup/non-`.py` migration artifacts. This is a material migration-governance risk.
- Prior isolated validation documented that a fresh database fails at `246123db4a01_add_notification_details.py` with `sqlalchemy.exc.NoSuchTableError: notification`; therefore a clean zero-to-head provisioning path is not currently proven.
- Prior validation also documented that the current database was at `0023_allow_supplier_fg_allocations`, while a fresh migration path failed before fixture creation. No business data was changed by this audit.
- Existing test cleanup failed on a foreign-key dependency from `assembly_finished_goods_allocation` to finished-goods requests. Test isolation and deletion ordering are unsafe.
- `backend/business-service/tests/conftest.py` contains schema-altering setup and does not enforce a test database name. This is a high-risk data-integrity issue.
- Index/foreign-key correctness cannot be fully certified without a schema introspection snapshot and migration replay on an isolated database. Do not run destructive or fixture transactions against the configured business database.

## 6. Security and production configuration risks

| Risk | Evidence | Severity |
|---|---|---|
| Development login/reset surface | `app/security/router.py` includes `/dev-login`; gate router includes `/reset-dev-entries`. | High |
| Hardcoded LAN/API defaults | `kaizenX/src/services/api.ts:6`, `kaizenX/src/constants/index.ts:1`, login placeholders; web uses environment configuration. | High |
| Password configuration defaults | `app/config/settings.py` defines role passwords with empty defaults; deployment must reject missing secrets. | High |
| CORS environment dependence | `app/config/settings.py:68` has localhost defaults; production origins must be explicit and reviewed. | High |
| Weak/legacy credential handling candidate | `app/modules/gate/infrastructure/api/quality.py:216` and related code use SHA-256 password hashing for supplier credentials. | High |
| Broad exception suppression | `app/main.py` and service/router modules contain many silent catches. | Medium/High |
| External service dependency | `frontend/src/routes/new-supplier.tsx:221` calls `api.postalpincode.in` directly from the browser. | Medium |
| Secret exposure check | No secret values were reproduced in this report. `.env` files and deployment secrets require a separate secret-scanning and CI review. | High until verified |

## 7. Testing and verification gaps

Existing backend tests cover many domains and there is at least one integration gate test, but the repository’s prior reports document 63 failed tests and 5 setup errors in the full backend suite, plus frontend lint failures (reported as 2,594–2,627 problems in the existing artifacts). These figures are historical repository evidence, not a new run in this audit.

Missing or unproven coverage:

- isolated full workflow from ASN through inbound gate exit and FG dispatch/gate exit;
- browser Playwright/UI workflow coverage;
- mobile API contract coverage against canonical backend paths;
- persistence verification after backend restart;
- migration replay from an empty PostgreSQL database;
- transaction rollback/concurrency tests for allocation, putaway, FIFO, inventory issue, and dispatch;
- authorization matrix for every mutating endpoint;
- responsive layout and production build smoke testing;
- observability, retry, outbox, Kafka, email, OCR, and external-service failure tests.

The attempted read-only frontend TypeScript check did not complete during this audit window. Python test collection could not be launched because the configured `python.exe` was inaccessible. No test result is inferred from either limitation.

## 8. Build and deployment blockers

1. Fresh Alembic provisioning is blocked by the documented `notification` migration failure.
2. Test configuration can target and alter the normal business database; production CI must enforce an isolated database identity.
3. Full test and lint baselines are not green according to existing reports.
4. Web/mobile API base URLs and route families are inconsistent and include development LAN defaults.
5. Authentication, CORS, role-password, and debug/reset settings require production-specific validation.
6. The repository contains destructive maintenance scripts and a checked-in SQLite database without an explicit packaging policy.
7. No production deployment manifest, CI release gate, secret-management policy, or complete health/readiness operating procedure was evidenced in the inspected files.

## 9. Recommended cleanup order

1. Establish a protected, isolated CI/test database and repair migration replay from zero; do not touch existing business data.
2. Make test fixtures rollback-safe and remove schema-altering autouse behavior from any path that can resolve to production/development databases.
3. Define the canonical API/auth contract, then test web, mobile, workers, scheduled jobs, and integrations against it.
4. Disable or protect dev-login, reset, debug, preview, and seed behavior in production configuration.
5. Resolve authentication/password hashing, CORS, secrets, logging, and exception-handling findings.
6. Add workflow-level integration tests for all 13 business workflows and quantity/traceability invariants.
7. Repair frontend type/lint/build gates and replace high-volume untyped API responses incrementally.
8. Review migration/model/FK/index parity and document deployment/rollback procedures.
9. Only after evidence is green, classify and remove confirmed dead code, duplicate routes, obsolete artifacts, and unnecessary dependencies.

## Audit limitations

This is a static/read-only audit. No application server was started, no API mutation was sent, no database transaction was created, and no business record was inserted, updated, deleted, truncated, or reset. Endpoint “unused” status is not asserted without checking the web client, mobile client, backend registrations, workers, tests, and integrations visible in the repository. External consumers not represented in the repository remain an explicit investigation item.
