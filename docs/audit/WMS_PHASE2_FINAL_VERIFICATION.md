# WMS Phase 2 Remediation Verification and Deployment Readiness Review

**Audit Target**: Warehouse Management System (WMS) Production Architecture  
**Assessment Type**: Independent Remediation Verification, Cloud Infrastructure Audit & Deployment Readiness Gate  
**Date**: November 13, 2026  
**Environment**: Azure Container Apps (`rg-kaizenx-dev`), Azure Database for PostgreSQL Flexible Server (`kaizen-wms-psql`), WareHub Custom Domain (`warehub.kaizentrixglobal.com`)  
**Overall Verdict**: **CONDITIONAL GO / BLOCKED ON CLOUD INFRASTRUCTURE (R01, R03, R06)**  

---

## 1. Executive Summary & Verification Matrix

An exhaustive, independent, read-only verification was conducted on the WMS codebase, live Azure Container Apps, Azure PostgreSQL Flexible Server, and public domain routing. 

The investigation confirmed that **software-level remediation changes (R02, R04, R05, FE-01, and INC-01) are structurally complete and verified by automated testing and live telemetry**. However, **cloud infrastructure items (R01, R03, and R06) require specific prerequisites, resource provisioning, and explicit administrator approvals before they can be executed safely**.

### Verification Status Dashboard

| Item | Focus Area | Code Readiness | Cloud State | Verification Verdict | Critical Risks / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **R01** | PostgreSQL Public Firewall Exposure | N/A | `AllowAllIPs` (`0.0.0.0/0`) active; `AllowAllAzureServices` active | **BLOCKED** | Removing `AllowAllIPs` without whitelisting developer IP (`103.164.196.26`) will immediately lock out local migrations and administration. |
| **R02** | Production Authentication | COMPLETE | Revision 42 live with `ENVIRONMENT=dev` | **PASS (with warnings)** | DB-backed auth enabled across all environments. Dual-write/dual-read preserves zero-downtime rolling deploys. Opaque token prefix `mock-jwt-db-user-` used in lieu of asymmetric RS256 JWTs. |
| **R03** | Blob Storage for Business Documents | INCOMPLETE | Zero Azure Storage Accounts in subscription; No Managed Identity | **BLOCKED / NOT PROVISIONED** | Cloud infrastructure absent. Factory `get_storage_service()` still falls back to ephemeral container disk (`media_uploads/`). Uploads are lost upon container restart. |
| **R04** | Asynchronous Audit Logging | COMPLETE | Uncommitted in working tree | **PASS (Functional) / WARN (Reliability)** | Read requests (GET, HEAD, OPTIONS) excluded (90%+ DB write reduction). `asyncio.create_task` lacks graceful shutdown task draining; in-flight logs lost during pod scaling. |
| **R05** | Runtime Startup DDL Elimination | COMPLETE | Azure DB has schema columns; Alembic version is 4 revisions behind head | **PASS (Existing DB) / BLOCKED (New DB)** | Startup DDL safely bypassed for current DB. However, Azure PostgreSQL `alembic_version` is at `20261106_add_user_session_table`, not codebase head `20261110_fix_putaway_task_and_rack_occupancy`. |
| **R06** | Database Capacity & Auto-Grow | N/A | Burstable `Standard_B2s`, 32GB P4, Auto-grow `Disabled` | **BLOCKED** | DB is 38 MB (<0.15% full). Auto-grow in Azure PostgreSQL is an irreversible one-way ratchet (storage cannot be downscaled). B2s burstable tier vulnerable to CPU exhaustion. |
| **FE-01** | Frontend Security Headers & CSP | COMPLETE | Uncommitted in working tree; SSR build passed | **PASS** | Strict HSTS, X-Frame-Options: DENY, nosniff, and comprehensive CSP verified against Vite/Nitro SSR production build. |
| **INC-01** | GoDaddy Custom Domain Login Rejection | COMPLETE | Revision 42 deployed and live | **PASS (VERIFIED)** | CORS preflight `OPTIONS` and credentialed `POST` return `HTTP 200/401` with `Access-Control-Allow-Origin: https://warehub.kaizentrixglobal.com` and credentials enabled. |

---

## 2. Git Working Tree & Code Integrity Review (Item 1 & 2)

### 2.1 Branch & Working Tree State
- **Active Branch**: `main` (tracked to `origin/main`, commit `f76f89b`).
- **Remediation Branching**: A dedicated branch (`remediation`) was previously attempted but failed due to file locking on `.git/refs/heads/remediation.lock`. Consequently, **all remediation changes currently reside directly as uncommitted working tree modifications on `main`**.
- **Working Tree Cleanliness**:
  ```text
  Modified files (7):
    M backend/business-service/app/main.py
    M backend/business-service/app/middleware/audit_log.py
    M backend/business-service/app/security/dependencies.py
    M backend/business-service/app/security/router.py
    M backend/business-service/app/services/storage.py
    M backend/business-service/tests/test_health_and_security.py
    M frontend/src/server.ts

  Untracked directories (1):
    ?? docs/audit/
  ```

### 2.2 File-by-File Code Review

1. **[`backend/business-service/app/middleware/audit_log.py`](file:///c:/Users/Admin/Desktop/KaizenAssests/backend/business-service/app/middleware/audit_log.py)**:
   - **Correctness**: Excludes `GET`, `OPTIONS`, `HEAD`, `/api/health`, and non-API routes. Extracts actor identity from `request.state`.
   - **Performance**: Schedules persistence via `asyncio.create_task(_persist_audit_log_entry(entry_data))`, returning the HTTP response immediately to the client without waiting for database I/O.
   - **Backward Compatibility**: Preserves all existing `SystemAuditLogModel` database columns.

2. **[`backend/business-service/app/security/router.py`](file:///c:/Users/Admin/Desktop/KaizenAssests/backend/business-service/app/security/router.py)**:
   - **Correctness**: Removed hardcoded dev-only environment check in `dev_login()`. Replaced with `disable_db_login` flag.
   - **Session Tracking**: Generates high-entropy random token (`secrets.token_urlsafe(48)`), hashes with SHA-256, and inserts structured record into `UserSessionModel`.
   - **Session Invalidation**: Dedicated endpoints `/logout`, `/logout-others`, and `/logout-all` update `UserSessionModel.is_active = False` and record `revoked_at`.
   - **Backward Compatibility**: Dual-writes active SHA-256 hash to `user_account.auth_token_hash` CSV column (keeping up to 10 concurrent sessions), ensuring existing nodes during a rolling deploy recognize newly authenticated sessions.

3. **[`backend/business-service/app/security/dependencies.py`](file:///c:/Users/Admin/Desktop/KaizenAssests/backend/business-service/app/security/dependencies.py)**:
   - **Correctness**: Decoupled database session token validation (`mock-jwt-db-user-`, `db-session-`, `staff-db-token-`) from `is_local`.
   - **Security Rules**: Queries `UserSessionModel` with compound filter:
     `token_hash == token_hash AND is_active == True AND expires_at > now_utc AND revoked_at IS NULL`.
   - **Account Verification**: Validates `user_account.status == "ACTIVE"`. Inactive accounts are immediately rejected (`HTTP 401`).
   - **Role Mapping**: Reconciles legacy database roles (`SUPER_ADMIN`, `ADMIN_OFFICER`, `PROCUREMENT_MANAGER`) to unified canonical authorization roles (`ADMIN`, `MANAGER`, `SUPPLIER`, `WAREHOUSE_OPERATOR`, `ASSEMBLY`, `DISPATCH`) and attaches granular permission scopes.

4. **[`backend/business-service/app/services/storage.py`](file:///c:/Users/Admin/Desktop/KaizenAssests/backend/business-service/app/services/storage.py)**:
   - **Correctness**: Refactored `AzureBlobStorageService` to support both connection strings and Managed Identity (`DefaultAzureCredential`).
   - **Legacy Compatibility**: Intercepts `read_file`, `file_exists`, and `delete_file` to check local disk (`media_uploads/`) first. Historical files remain accessible even after switching to Azure Blob Storage.
   - **Defect Identified**: Factory function `get_storage_service()` checks `if azure_conn and is_prod:`. It does not support `account_url` without a connection string, and falls back to `LocalStorageService` when `ENVIRONMENT=dev`.

5. **[`backend/business-service/app/main.py`](file:///c:/Users/Admin/Desktop/KaizenAssests/backend/business-service/app/main.py)**:
   - **Correctness**: Extracted 200+ lines of raw startup `ALTER TABLE` DDL into `_run_dev_startup_schema_compatibility`. Gated execution behind `settings.startup_schema_compatibility`.
   - **CORS Defense-in-Depth**: Line 407 updated to include `https://.*\.kaizentrixglobal\.com` in `allow_origin_regex`.

6. **[`frontend/src/server.ts`](file:///c:/Users/Admin/Desktop/KaizenAssests/frontend/src/server.ts)**:
   - **Correctness**: Intercepts Nitro SSR responses and error pages to inject `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, and `Content-Security-Policy`.

---

## 3. Production Authentication Deep-Dive (Item 3)

| Dimension | Implementation Mechanism | Production Readiness Evaluation |
| :--- | :--- | :--- |
| **Primary Login** | `POST /api/v1/auth/dev-login` validates credentials against `user_account` via PBKDF2/SHA256 (`passlib`). | **PASS** — Supports brute-force lockout (`login_max_failures=5`, `login_lockout_minutes=15`). |
| **Token Mechanics** | Generates opaque 48-byte URL-safe string, SHA-256 hashed into database. Sent via `Authorization: Bearer mock-jwt-db-user-<token>`. | **WARNING** — Functionally secure and DB-backed, but uses pseudo-JWT naming prefix rather than true signed RS256/Ed25519 JSON Web Tokens. |
| **Session Lifetime** | Governed by `settings.local_session_lifetime_minutes` (default 480 min / 8 hours). Checked on every request. | **PASS** — Enforced via `UserSessionModel.expires_at > now_utc`. |
| **Session Revocation** | `/logout` marks `is_active=False` and timestamps `revoked_at`. Multi-device endpoints `/logout-others` and `/logout-all` supported. | **PASS** — Instant revocation effective across all nodes immediately. |
| **Inactive / Suspended Users** | Token resolution joins `user_account` and asserts `status == "ACTIVE"`. | **PASS** — Deactivating a user in admin UI takes effect on the next HTTP call without waiting for token expiry. |
| **Role-Based Access** | Hierarchical permission arrays dynamically populated into `CurrentUser.permissions`. | **PASS** — Route dependencies (`require_permission`, `require_role`) enforce granular scopes. |

---

## 4. Asynchronous Audit Logging & Reliability Review (Item 4)

### 4.1 Strengths
- **Write Amplification Eliminated**: High-frequency read queries (`GET /api/v1/warehouse/...`, `GET /api/v1/notifications`, polling checks) no longer execute synchronous `INSERT INTO system_audit_log`.
- **Database Decoupling**: Database slowdowns or locking contention during audit inserts cannot block or degrade the user's primary business transaction.
- **Exception Isolation**: All internal database exceptions in `_persist_audit_log_entry` are wrapped in `try...except Exception` and logged as warnings; client requests never fail due to an audit logging error.

### 4.2 Identified Vulnerabilities & Reliability Risks
- **Garbage Collection Risk**: `asyncio.create_task` creates an unreferenced background task. While tasks usually complete in milliseconds, under high Python GC pressure, unreferenced tasks can theoretically be finalized prematurely.
- **Graceful Shutdown Task Loss**: When an Azure Container App scales in or restarts (SIGTERM), pending background tasks scheduled via `asyncio.create_task` are immediately killed. There is no TaskGroup or lifespan shutdown drain mechanism (e.g. `await asyncio.gather(*pending_tasks)`).
- **Recommendation for Hardening**: Implement an in-memory `asyncio.Queue` with a bounded worker pool managed by the FastAPI lifespan context, ensuring all queued logs are flushed before the container terminates.

---

## 5. Cloud Storage & Blob Infrastructure Audit (Item 5)

### 5.1 Verification of Live Azure Resources
An inspection was executed via Azure CLI across resource group `rg-kaizenx-dev` and the active subscription:
```powershell
az storage account list --resource-group rg-kaizenx-dev
# Result: [] (Zero storage accounts)
```
- **Storage Account Presence**: **NONE**. No Azure Storage Account exists in the subscription.
- **Managed Identity Presence**: Azure Container App `kaizen-wms-backend` has `"identity": { "type": "None" }`.
- **Active Backend Container Environment**:
  ```json
  [
    { "name": "ENVIRONMENT", "value": "dev" },
    { "name": "DATABASE_URL", "value": "postgresql+asyncpg://..." },
    { "name": "CORS_ALLOW_ORIGINS", "value": "[\"https://kaizen-wms-frontend...\",\"https://warehub.kaizentrixglobal.com\",...]" }
  ]
  ```
  `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_ACCOUNT_URL` are completely absent.

### 5.2 Real-World Impact
Because no cloud storage is configured and `ENVIRONMENT=dev`, **the running backend continues to write all document, photo, and proof uploads to the ephemeral container filesystem (`media_uploads/`)**. 
- When the container restarts, updates revision, or scales out, **all uploaded files are permanently destroyed**.
- **Verdict**: **R03 is BLOCKED at the cloud infrastructure layer**. Code is prepared, but cloud provisioning is mandatory.

---

## 6. Database Migrations & Runtime DDL Analysis (Item 6)

### 6.1 Live Database State vs Codebase Schema
A live SQL query against Azure PostgreSQL (`ams_business`) revealed:
```text
Current DB alembic_version: '20261106_add_user_session_table'
Codebase Alembic Head:     '20261110_fix_putaway_task_and_rack_occupancy'
```

Four Alembic migrations are pending in the repository:
1. `20261110_allow_nullable_batch_id_in_grn_batch_qr`
2. `20261110_grn_posting_constraint_resilience`
3. `20261110_fix_rack_occupancy_and_bin_uniqueness`
4. `20261110_fix_putaway_task_and_rack_occupancy`

### 6.2 Schema Compatibility Check
Inspection of table schemas in the live PostgreSQL server confirmed:
- `grn_batch_qr.batch_id` $\rightarrow$ `is_nullable = YES`
- `putaway_task.destination_warehouse_ref_id` $\rightarrow$ Column exists
- `putaway_location_assignment.destination_warehouse_ref_id` $\rightarrow$ Column exists
- `rack_occupancy_event.balance_id` $\rightarrow$ `is_nullable = YES`

**Explanation**: The legacy development server previously executed startup DDL against `kaizen-wms-psql`, which created these columns directly.  
- **Safety Assessment**: Disabling runtime DDL (`startup_schema_compatibility=False`) **WILL NOT cause missing-schema failures on this specific database instance**.
- **Migration Prerequisite**: All four migration scripts were reviewed and found to be idempotent (they check `inspector.has_table` and column existence before altering). Running `alembic upgrade head` is completely safe and will align the `alembic_version` table with the codebase head.

---

## 7. Frontend Security Headers & CSP (Item 7)

### 7.1 Security Policy Configuration
In [`frontend/src/server.ts`](file:///c:/Users/Admin/Desktop/KaizenAssests/frontend/src/server.ts):
- **HSTS**: `max-age=31536000; includeSubDomains; preload`
- **Clickjacking Protection**: `X-Frame-Options: DENY`
- **MIME Protection**: `X-Content-Type-Options: nosniff`
- **Referrer Policy**: `Referrer-Policy: strict-origin-when-cross-origin`
- **CSP**:
  ```text
  default-src 'self'; 
  script-src 'self' 'unsafe-inline' 'unsafe-eval'; 
  style-src 'self' 'unsafe-inline' https:; 
  img-src 'self' data: blob: https:; 
  font-src 'self' data: https:; 
  connect-src 'self' https: wss:;
  ```

### 7.2 Compatibility Verification
- **QR Codes**: `img-src data:` allows inline Base64 QR code rendering without console violations.
- **Camera Captures**: `img-src blob:` enables local camera and image preview blobs during gate entry and receiving inspection.
- **Hydration**: `script-src 'unsafe-inline' 'unsafe-eval'` ensures Vite/Nitro and TanStack Router hydration bundles execute without blocking.
- **SSR Build**: Production build (`npm run build`) succeeded in 9.06s with zero errors.

---

## 8. Test Execution Verification (Item 8)

Both backend and frontend test suites were independently executed in clean test runs:

### 8.1 Backend Test Results
- **Command**: `backend\.venv\Scripts\python.exe -m pytest backend/business-service/tests/ -v`
- **Environment**: Python 3.12.10, Pytest 8.3.4, AnyIO 4.15.1
- **Duration**: 7.57 seconds
- **Result**: **31 passed, 0 failed, 0 skipped**
  - ASN status resolution: 11 tests passed
  - Default dock policy: 6 tests passed
  - Gate metrics & security: 3 tests passed
  - Health & security (tokens, hashing, audit filtering): 5 tests passed
  - Replacement claims & damage workflow: 6 tests passed
- **Note on Global Python**: Attempting to run `python -m pytest` with the global Python executable fails during test collection due to missing `cv2` (opencv-python). The project virtualenv (`backend/.venv`) contains all required C-extensions and dependencies.

### 8.2 Frontend Test Results
- **Command**: `cd frontend; npm.cmd test`
- **Environment**: Vitest v5.0.5, Node.js 22.11.0
- **Duration**: 1.91 seconds
- **Result**: **6 passed across 2 test files**
  - `tests/journey-kinematics.test.tsx`: 3 passed (14ms)
  - `tests/auth.test.tsx`: 3 passed (8ms)

---

## 9. Custom Domain vs Azure Default URL Verification (Item 9)

A live, side-by-side probe was executed comparing the Azure Container App default URL and the GoDaddy custom domain:

### 9.1 Live Probe Telemetry Evidence

| Test Vector | Azure Default URL (`kaizen-wms-frontend...`) | GoDaddy Custom Domain (`warehub.kaizentrixglobal.com`) | Parity Status |
| :--- | :--- | :--- | :--- |
| **Page Fetch (`GET /`)** | `HTTP 200 OK` (`text/html; charset=utf-8`) | `HTTP 200 OK` (`text/html; charset=utf-8`) | **IDENTICAL** |
| **API Preflight (`OPTIONS`)** | `HTTP 200 OK` | `HTTP 200 OK` | **IDENTICAL** |
| **Allow-Origin Header** | `https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io` | `https://warehub.kaizentrixglobal.com` | **EXACT MATCH** |
| **Allow-Credentials** | `true` | `true` | **IDENTICAL** |
| **Allow-Methods** | `DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT` | `DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT` | **IDENTICAL** |
| **Credentialed POST** | `HTTP 401` with `CORS Allow-Origin: https://kaizen-wms-frontend...` | `HTTP 401` with `CORS Allow-Origin: https://warehub.kaizentrixglobal.com` | **IDENTICAL** |

**Conclusion**: The custom-domain login failure is **fully resolved**. The browser preflight is accepted and credentialed authentication payloads now reach the backend API handler.

---

## 10. PostgreSQL Firewall Lockdown Review (Item 10)

### 10.1 Active Firewall Rules on `kaizen-wms-psql`
```powershell
az postgres flexible-server firewall-rule list --resource-group rg-kaizenx-dev --server-name kaizen-wms-psql
```
- **Rule 1 (`AllowAllIPs`)**: `startIpAddress: 0.0.0.0`, `endIpAddress: 255.255.255.255` (Public exposure to the entire internet).
- **Rule 2 (`AllowAllAzureServicesAndResourcesWithinAzureIps_...`)**: `startIpAddress: 0.0.0.0`, `endIpAddress: 0.0.0.0` (Permits traffic from any Azure service).

### 10.2 Connectivity Analysis & Prerequisite Gate
- **Backend Outbound Path**: Azure Container Apps runs on a shared Consumption infrastructure with 170+ outbound IP addresses. The internal Azure rule (`0.0.0.0/0.0.0.0`) **already allows `kaizen-wms-backend` to connect to `kaizen-wms-psql`**.
- **Admin / Developer Access Risk**: The local host machine's public IP is currently `103.164.196.26`.
- **CRITICAL PREREQUISITE**: If `AllowAllIPs` is deleted without first creating an explicit rule for the developer/office public IP (`103.164.196.26`), **local administration, database debugging, and local Alembic migration runs will be immediately severed**.
- **Remediation Plan**:
  1. Add firewall rule `DeveloperWorkstation`: `startIpAddress: 103.164.196.26`, `endIpAddress: 103.164.196.26`.
  2. Verify connection from local workstation.
  3. Delete `AllowAllIPs`.

---

## 11. Database Capacity, Disk Usage & Auto-Grow Review (Item 11)

### 11.1 Infrastructure Specs
- **Server Name**: `kaizen-wms-psql` (PostgreSQL 16)
- **SKU**: `Standard_B2s` (Burstable tier, 2 vCPUs, 4 GiB memory, 120 baseline IOPS)
- **Storage**: 32 GiB (Tier: `P4`, Type: `Premium_LRS`)
- **Auto-Grow**: **`Disabled`**
- **High Availability**: `Disabled`

### 11.2 Current Disk Consumption
A live internal PostgreSQL query revealed:
- **Total Database Size (`ams_business`)**: **38 MB**
- **`system_audit_log` Table Size**: **21 MB** (55% of total database volume)
- **Current Disk Utilization**: **< 0.15% of provisioned 32 GB**

### 11.3 Cost & Rollback Constraints
- **One-Way Ratchet Limitation**: In Azure Database for PostgreSQL Flexible Server, **storage can only be scaled up, never scaled down**. Once expanded (e.g. to 64 GB or 128 GB), storage costs cannot be reduced without a full dump and restore to a newly provisioned instance.
- **Auto-Grow Recommendation**: Because disk utilization is only 38 MB, there is no immediate storage exhaustion risk. Enabling auto-grow is recommended as a safety backstop before production volume spikes, but should be paired with an audit log retention purge policy to prevent unnecessary auto-expansion.
- **Burstable Tier Warning**: The `Standard_B2s` burstable tier is suitable for development and pilot testing, but will suffer severe latency spikes if continuous CPU credit exhaustion occurs under heavy production shifts.

---

## 12. Deployment Sequence & Rollback Procedures

### Phase 1: Git Staging & Code Commit
```powershell
git add backend/business-service/app/main.py `
        backend/business-service/app/middleware/audit_log.py `
        backend/business-service/app/security/dependencies.py `
        backend/business-service/app/security/router.py `
        backend/business-service/app/services/storage.py `
        backend/business-service/tests/test_health_and_security.py `
        frontend/src/server.ts `
        docs/audit/

git commit -m "feat(enterprise-readiness): implement R02, R04, R05, FE-01, and custom domain CORS hardening"
git push origin main
```

### Phase 2: Database Migration Alignment
```powershell
cd backend/business-service
..\.venv\Scripts\python.exe -m alembic upgrade head
```

### Phase 3: Cloud Infrastructure Provisioning (Requires User Authorization)
1. **Azure Blob Storage (R03)**:
   ```powershell
   az storage account create `
     --name kaizenwmsstorage `
     --resource-group rg-kaizenx-dev `
     --location centralindia `
     --sku Standard_LRS `
     --kind StorageV2

   az storage container create `
     --account-name kaizenwmsstorage `
     --name kaizen-wms-media `
     --auth-mode login
   ```
2. **PostgreSQL Firewall Lockdown (R01)**:
   ```powershell
   # 1. Whitelist administrator IP first
   az postgres flexible-server firewall-rule create `
     --resource-group rg-kaizenx-dev `
     --server-name kaizen-wms-psql `
     --rule-name DeveloperWorkstation `
     --start-ip-address 103.164.196.26 `
     --end-ip-address 103.164.196.26

   # 2. Delete public wildcard rule
   az postgres flexible-server firewall-rule delete `
     --resource-group rg-kaizenx-dev `
     --server-name kaizen-wms-psql `
     --rule-name AllowAllIPs `
     --yes
   ```
3. **Storage Auto-Grow (R06)**:
   ```powershell
   az postgres flexible-server update `
     --resource-group rg-kaizenx-dev `
     --name kaizen-wms-psql `
     --auto-grow Enabled
   ```

### Rollback Strategy
- **Code Rollback**: `git revert HEAD` and push to redeploy the previous container revisions.
- **Firewall Rollback**: Re-add `AllowAllIPs` via `az postgres flexible-server firewall-rule create --rule-name AllowAllIPs --start-ip-address 0.0.0.0 --end-ip-address 255.255.255.255`.
- **Database Rollback**: Migrations were written with no-op downgrades to preserve data. Existing columns remain intact without breaking legacy code.

---

## 13. Remaining High-Risk Defects & Recommendations

1. **Ephemeral Local Storage on Live Container (High Severity)**:  
   Until an Azure Storage Account is created and configured, file uploads in production will continue to be lost upon container restarts.
2. **Audit Logging Graceful Shutdown (Medium Severity)**:  
   Pending audit entries in `asyncio.create_task` will be dropped during rapid pod autoscaling. Implement a graceful queue flush in FastAPI lifespan.
3. **Database Alembic Version Out of Sync (Medium Severity)**:  
   The Azure database is 4 migrations behind the repository head. Run `alembic upgrade head` before deploying the code changes.
4. **Opaque Tokens Named as Mock JWTs (Low/Medium Severity)**:  
   Production authentication works and is secure, but returns tokens prefixed with `mock-jwt-db-user-`. Transitioning to authentic asymmetric RS256 JWTs or clean Bearer tokens will eliminate confusion during external compliance audits.

