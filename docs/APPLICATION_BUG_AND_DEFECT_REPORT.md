# Application Bug and Defect Report: KaizenAssets (WMS)

**Target Environment**: Microsoft Azure Container Apps (`centralindia`)  
**Assessment Date**: November 05-06, 2026  
**Audit Team**: Senior QA Automation Architect, Performance Engineer & Full-Stack Developer  
**Status**: All Critical and High Priority Defects Resolved  

---

## 1. Defect Classification Matrix

| Defect ID | Title | Component | Severity | Resolution Status |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | Cross-Origin Preflight (CORS) Rejection on Staff Login | Backend API / Azure Container App | **CRITICAL** | **RESOLVED & VERIFIED** |
| **BUG-002** | Undefined Table `notification` Causing HTTP 500 on Dashboard | Database Schema / Inventory Router | **HIGH** | **RESOLVED & VERIFIED** |
| **BUG-003** | Unauthenticated Fallback Cascade to Protected Route `/inventory` | Frontend Router / Auth Utilities | **MEDIUM** | **RESOLVED & VERIFIED** |
| **BUG-004** | Three.js Excessive Draw Calls, Shadow Acne & Telemetry Stall | Frontend 3D Canvas / Landing Page | **MEDIUM** | **RESOLVED & VERIFIED** |

---

## 2. Comprehensive Defect Analysis & Root Cause Breakdown

### BUG-001: Cross-Origin Preflight (CORS) Rejection on Staff Login
- **Component**: Backend Service / Azure Container App Configuration
- **Symptom**: Browser network interception during authentication displayed:
  ```
  Access to fetch at 'https://kaizen-wms-backend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io/api/v1/auth/login'
  from origin 'https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io' has been blocked by CORS policy:
  Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present.
  ```
  Frontend showed red banner: `Failed to fetch`.
- **Root Cause**:
  1. Azure Container App environment variable `CORS_ALLOW_ALL="true"` was not mapped to any Pydantic model field in FastAPI.
  2. `CORS_ALLOW_ORIGINS` was omitted in the deployment template, defaulting Starlette CORSMiddleware to `["http://localhost:8080"]`.
  3. Starlette CORSMiddleware rejected `OPTIONS` preflight requests from the Azure frontend container domain, responding with `HTTP 400 Bad Request` without CORS headers.
- **Remediation & Fix**:
  1. Configured valid JSON origin array in Azure Container Apps:
     ```json
     ["https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io", "http://localhost:8080"]
     ```
  2. Enhanced `backend/business-service/app/main.py` with custom origin cleaning and dynamic regex matching:
     ```python
     allow_origin_regex=r"https://.*\.azurecontainerapps\.io|https?://(localhost|127\.0\.0\.1)(:\d+)?"
     ```
- **Verification**: Preflight `OPTIONS` request returns `HTTP 200 OK` with:
  ```http
  access-control-allow-origin: https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io
  access-control-allow-credentials: true
  access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
  ```

---

### BUG-002: Undefined Table `notification` Causing HTTP 500 on Dashboard
- **Component**: Azure PostgreSQL Flexible Server / Backend Inventory Router
- **Symptom**: Navigating to Admin or Warehouse dashboards triggered `GET /api/storage/inventory/notifications?role=WAREHOUSE` returning `HTTP 500 Internal Server Error`.
- **Root Cause**:
  Container stdout/stderr inspection revealed:
  ```
  asyncpg.exceptions.UndefinedTableError: relation "notification" does not exist
  LINE 2: FROM notification
  ```
  While the legacy model defined `__tablename__ = "notification"`, Alembic migration history only created table `notification_log`.
- **Remediation & Fix**:
  1. Authored Alembic database migration `backend/business-service/alembic/versions/20261106_ensure_notification_table.py` (`Revises: 20261105_perf_indexes`).
  2. Executed live migration on Azure PostgreSQL:
     ```bash
     alembic upgrade head
     ```
  3. Added exception fallback handling in `inventory_router.py` to prevent dashboard crashes in the event of notification service degradation.
- **Verification**: `GET /api/storage/inventory/notifications?role=WAREHOUSE` returns `HTTP 200 OK` with payload `[]`.

---

### BUG-003: Unauthenticated Fallback Cascade to Protected Route `/inventory`
- **Component**: `frontend/src/lib/auth-utils.ts`
- **Symptom**: When `redirectToDefault(null)` was called for an unauthenticated user without a session token, `getDefaultRouteForUser(null)` defaulted to `"/inventory"` instead of immediately terminating navigation to `"/login"`.
- **Root Cause**: Missing null check for `user?.token` inside `redirectToDefault()`.
- **Remediation & Fix**:
  Patched `redirectToDefault()` in `frontend/src/lib/auth-utils.ts`:
  ```typescript
  function redirectToDefault(user: UserInfo | null, pathname: string, search = ""): never {
    if (!user || !user.token) {
      clearAuthSession();
      throw redirect({ to: "/login" });
    }
    const target = getDefaultRouteForUser(user);
    // ...
  }
  ```
- **Verification**: Playwright automated security tests confirm unauthenticated sessions attempting direct route entry are intercepted and safely routed to `/login`.

---

### BUG-004: Three.js Excessive Draw Calls, Shadow Acne & Telemetry Stall
- **Component**: Three.js WebGL Scene (`JourneyCanvas.tsx`, `NatureEnvironment.tsx`, `WarehouseForklift.tsx`)
- **Symptom**: Initial landing page load exhibited frame drops, high Task Duration (>7.7s), and visible shadow striping artifacts.
- **Root Cause**:
  1. Redundant `castShadow={true}` on 2,200 individual grass blade mesh instances.
  2. Forklift model instantiated dynamic omnidirectional `pointLight` beacons calculating real-time light decay.
  3. Directional light shadow bias was `0`, resulting in shadow acne on wide surfaces.
  4. Public telemetry API `GET /api/storage/inventory/notifications` was executed synchronously on mount, competing for CPU time during Three.js shader compilation.
- **Remediation & Fix**:
  1. `NatureEnvironment.tsx`: Kept `receiveShadow={true}` on ground flora; disabled `castShadow={true}`.
  2. `WarehouseForklift.tsx`: Replaced dynamic point light with emissive strobe mesh and ambient glow.
  3. `JourneyCanvas.tsx`: Configured directional light shadow bias to `-0.0005`.
  4. `WarehouseJourney.tsx`: Wrapped telemetry fetch in `window.requestIdleCallback`.
- **Verification**: JavaScript heap reduced from `60.06 MB` to `56.73 MB`, First Contentful Paint improved to `1372 ms`, and shadow acne artifacts eliminated.

---

## 3. Defect Prevention Recommendations
1. **Automated Preflight Integration**: Incorporate an automated CORS preflight integration test into CI/CD pipelines before container deployments.
2. **Schema Verification Gate**: Implement `alembic check` in container startup scripts to ensure database migrations match SQLAlchemy models before opening port 8000.
3. **Route Guard Linter**: Add an ESLint rule requiring every TanStack route file to define a `beforeLoad` authentication check unless explicitly marked as a public route.

