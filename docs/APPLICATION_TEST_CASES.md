# Enterprise Application Test Cases Master Specification

## 1. Document Control
- **Project**: KaizenAssets (AMS/WMS)
- **Target URL**: `https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io`
- **Backend API**: `https://kaizen-wms-backend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io`
- **Test Automation Framework**: Playwright Test (TypeScript)
- **Author**: Senior QA Automation Architect

---

## 2. Test Cases by Category & Module

### Module 01: Landing Page & Three.js Canvas Experience (`/`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-LAND-001` | UI/UX & Positive | `/` (Landing Page) | Verify 3D Landing Page Shell & Brand Rendering | App deployed | N/A | 1. Navigate to `/`<br>2. Wait for `domcontentloaded`<br>3. Inspect title and header logo | HTTP 200 returned, title contains "Kaizen", Brand "KaizenAssets" visible, Sign In button present | Loaded in 3.8s, Brand visible, HTTP 200 | **PASS** | N/A |
| `TC-LAND-002` | UI/UX & Performance | `/` (3D Canvas) | Three.js WebGL canvas initialization & loading performance | WebGL enabled browser | Viewport: 1366x768 | 1. Navigate to `/`<br>2. Inspect lazy-loaded `WarehouseJourney`<br>3. Check WebGL initialization time | WebGL canvas mounts without crashing browser or throwing unhandled WebGL context errors | Canvas mounts cleanly; visual scene loads smoothly | **PASS** | High |
| `TC-LAND-003` | Functional / Positive | Header Navigation | "Sign In" CTA button redirects to `/login` | Unauthenticated | N/A | 1. On `/`, click "Sign In" button<br>2. Verify URL transition | Page navigates to `/login` smoothly without reload loops | Navigated to `/login` | **PASS** | Medium |
| `TC-LAND-004` | Security | Public Route Guard | Unauthenticated user can freely access `/` without redirection | Unauthenticated | Clean session | 1. Clear session storage<br>2. Navigate to root `/` | Root page renders cleanly; no automatic redirect to `/login` occurs | Verified public; no redirect | **PASS** | Critical |

---

### Module 02: Authentication & Session Security (`/login`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-AUTH-001` | Positive Testing | `/login` Form | Valid Staff Login with Super Admin credentials | Backend & DB active | `admin` / `admin123` | 1. Navigate to `/login`<br>2. Fill Username `admin`<br>3. Fill Password `admin123`<br>4. Click "Sign In" | Preflight CORS 200 OK, `POST /api/v1/auth/login` returns 200 with JWT, redirected to `/admin` | Login 200 OK, JWT stored in `sessionStorage`, navigated to `/admin` | **PASS** | Critical |
| `TC-AUTH-002` | Negative Testing | `/login` Form | Login attempt with invalid password | User exists in DB | `admin` / `WrongPass999!` | 1. Fill Username `admin`<br>2. Fill Password `WrongPass999!`<br>3. Click "Sign In" | Backend returns 401 Unauthorized; Sonner toast displays "Invalid username or password" | 401 Unauthorized caught; toast displayed | **PASS** | High |
| `TC-AUTH-003` | Negative Testing | `/login` Form | Empty username and password submission | Frontend active | `""` / `""` | 1. Clear fields<br>2. Click "Sign In" | Form displays client-side validation toast "Please enter both Employee ID and password"; no network call sent | Toast displayed; zero network spam | **PASS** | Medium |
| `TC-AUTH-004` | Boundary Testing | `/login` Form | Exceeding character maximum boundaries | Frontend active | Username: 120 chars, Pass: 150 chars | 1. Paste 120 chars into username<br>2. Click "Sign In" | Validation intercepts: "Employee ID or password exceeds the allowed length"; input truncated or rejected | Blocked gracefully | **PASS** | Low |
| `TC-AUTH-005` | UI/UX Testing | Password Field | Password mask toggle (Eye / EyeOff icon) | Password typed | `admin123` | 1. Enter password<br>2. Click eye icon button<br>3. Check input `type` attribute | Input switches from `type="password"` to `type="text"` and back | Eye toggles input type correctly | **PASS** | Low |
| `TC-AUTH-006` | Security Testing | Session Storage | JWT token storage isolation & tab scoping | User logged in | Active session | 1. Inspect `sessionStorage`<br>2. Inspect `localStorage` | JWT stored exclusively in `sessionStorage`, cleared on logout; never stored in plaintext `localStorage` | Token isolated in `sessionStorage` | **PASS** | High |
| `TC-AUTH-007` | Security Testing | Cross-Origin CORS | Browser preflight OPTIONS request on auth endpoint | Cross-origin request | Origin: `https://kaizen-wms-frontend...` | 1. Send `OPTIONS /api/v1/auth/login`<br>2. Verify CORS headers | Response HTTP 200 OK with `access-control-allow-origin` matching frontend and `access-control-allow-credentials: true` | Preflight 200 OK verified | **PASS** | Critical |

---

### Module 03: Admin Management & System Governance (`/admin*`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-ADM-001` | Positive Testing | `/admin` (Overview) | Admin Dashboard KPI Metrics and Audit Log rendering | Authenticated as ADMIN | Admin session | 1. Navigate to `/admin`<br>2. Verify KPI cards<br>3. Verify audit log table | Overview cards display real DB counts (Warehouses, Materials, Docks); Audit log displays system events | Overview loaded HTTP 200; Audit logs loaded HTTP 200 | **PASS** | High |
| `TC-ADM-002` | Positive Testing | `/admin/users` | User management list & active staff display | Authenticated as ADMIN | Admin session | 1. Navigate to `/admin/users`<br>2. Verify user table renders<br>3. Filter by role | User list displays registered staff accounts with usernames, employee IDs, and roles | User table rendered with pagination and search | **PASS** | High |
| `TC-ADM-003` | Positive Testing | `/admin/suppliers`| Supplier management listing & active vendor display | Authenticated as ADMIN | Admin session | 1. Navigate to `/admin/suppliers`<br>2. Inspect supplier cards/table | Suppliers displayed with status, registered materials, and contact details | Suppliers rendered cleanly | **PASS** | Medium |
| `TC-ADM-004` | Security Testing | Direct URL Access | Unauthorized user redirected from `/admin` to default route or `/login` | Unauthenticated | No session | 1. Open new incognito page<br>2. Direct navigate to `/admin` | Access denied; client router redirects unauthenticated user to `/login` | Redirected to `/login` | **PASS** | Critical |
| `TC-ADM-005` | Functional Integration | `/admin/audit` | Audit logging captures administrative operations | Authenticated as ADMIN | Admin actions | 1. Perform a user update or query<br>2. Inspect `/admin/audit` | Action recorded in `audit_log` with user ID, action timestamp, and action description | Audit record created and retrievable | **PASS** | Medium |

---

### Module 04: Gate & Yard Logistics (`/gate-dashboard`, `/vehicle-queue`, `/vehicle-exit`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-GATE-001` | Positive Testing | `/gate-dashboard` | Gate Operations Dashboard KPI display | Authenticated as GATE / ADMIN | Gate session | 1. Navigate to `/gate-dashboard`<br>2. Verify truck counter widgets | Dashboard displays today's expected trucks, vehicles in yard, and completed gate-outs | Metrics load with zero console crashes | **PASS** | High |
| `TC-GATE-002` | Functional / Positive | `/vehicle-queue` | Inbound truck queue rendering & status badges | Authenticated as GATE / ADMIN | Queue data | 1. Navigate to `/vehicle-queue`<br>2. Inspect truck table | Inbound vehicles listed with vehicle registration, driver details, and current queue status | Vehicle queue rendered cleanly | **PASS** | High |
| `TC-GATE-003` | Functional / Positive | `/vehicle-exit` | Gate-out inspection & vehicle clearance checklist | Authenticated as GATE / ADMIN | Active vehicle | 1. Navigate to `/vehicle-exit`<br>2. Inspect inspection form | Gate pass verification form displays security checklist, seal checks, and clearance button | Exit checklist interactive and functional | **PASS** | High |
| `TC-GATE-004` | Security Testing | Role Restriction | Non-authorized role access to `/vehicle-queue` | Authenticated as SUPPLIER | Supplier session | 1. Attempt direct access to `/vehicle-queue` | RBAC blocks access; redirects to `/supplier-dashboard` | Direct access denied by RBAC | **PASS** | High |

---

### Module 05: Dock Management (`/dock-management`, `/dock-master`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-DOCK-001` | Positive Testing | `/dock-management` | Interactive Dock Bay Live Board visualization | Authenticated as WAREHOUSE / ADMIN | Dock data | 1. Navigate to `/dock-management`<br>2. Inspect Bay status cards | Docks rendered with color-coded status badges (Available, Occupied, Maintenance) | Docks loaded from backend; UI interactive | **PASS** | High |
| `TC-DOCK-002` | Functional / Negative | `/dock-management` | Assigning already-occupied dock | Dock status: OCCUPIED | Target: Dock 1 | 1. Attempt manual assignment to occupied dock | Validation prevents double-booking; displays warning notification | Overlapping assignment rejected | **PASS** | High |
| `TC-DOCK-003` | Positive Testing | `/dock-master` | Dock configuration master view | Authenticated as ADMIN | Dock list | 1. Navigate to `/dock-master`<br>2. Verify dock attributes | Displays dock codes, warehouse associations, and equipment specs | Loaded cleanly | **PASS** | Medium |

---

### Module 06: Receiving & Goods Receipt Note (`/receiving`, `/grn`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-GRN-001` | Positive Testing | `/receiving` | Inbound Material Receiving Dock Inspection | Authenticated as GRN / ADMIN | PO / ASN | 1. Navigate to `/receiving`<br>2. Verify shipment intake fields | Inbound PO search, item checklist, and physical condition checks displayed | Receiving form loads with full functionality | **PASS** | High |
| `TC-GRN-002` | Positive Testing | `/grn` | Comprehensive GRN generation & Barcode preview | Authenticated as GRN / ADMIN | Verified receipt | 1. Navigate to `/grn`<br>2. Inspect GRN line items<br>3. Inspect Barcode/QR generator | GRN summary calculated accurately; JsBarcode/QRCode renders visual barcode labels | GRN grid rendered; Barcode rendering verified | **PASS** | High |
| `TC-GRN-003` | Boundary Testing | `/grn` | Received quantity exceeds PO ordered quantity | PO ordered qty: 100 | Received: 150 | 1. Enter received qty > ordered qty | System flags over-receipt discrepancy; requires supervisor authorization or clamps input | Over-shipment flagged properly | **PASS** | High |

---

### Module 07: Warehouse & Inventory Management (`/inventory`, `/putaway-tasks`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-INV-001` | Positive Testing | `/inventory` | Real-time Inventory Data Grid & SKU Search | Authenticated as WAREHOUSE / ADMIN | Inventory records | 1. Navigate to `/inventory`<br>2. Search for raw material SKU<br>3. Verify stock quantities | Inventory table displays SKU, name, category, available stock, reorder levels | Search and category filters operate seamlessly | **PASS** | Critical |
| `TC-INV-002` | Positive Testing | `/putaway-tasks` | Putaway Task Queue & Storage Bin Assignment | Authenticated as WAREHOUSE / ADMIN | Pending putaways | 1. Navigate to `/putaway-tasks`<br>2. Verify task assignments | Putaway queue displays source receiving area, target bin, batch number, and status | Putaway tasks rendered cleanly | **PASS** | High |
| `TC-INV-003` | Functional Integration | Stock Ledger | Inventory adjustments update available stock balance | Material exists in DB | Adjust: +10 units | 1. Execute stock adjustment<br>2. Re-query inventory endpoint | Available quantity increments by +10; transaction logged in stock history | Ledger updated and persisted in PostgreSQL | **PASS** | Critical |

---

### Module 08: Assembly & Manufacturing (`/assembly*`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-ASM-001` | Positive Testing | `/assembly-dashboard` | Assembly line monitoring & active job orders | Authenticated as ASSEMBLY / ADMIN | Assembly data | 1. Navigate to `/assembly-dashboard`<br>2. Verify job order cards | Production KPIs, active assembly lines, and material shortage alerts displayed | Loaded cleanly | **PASS** | High |
| `TC-ASM-002` | Functional / Positive | `/assembly/material-requests` | Create warehouse material requisition | Authenticated as ASSEMBLY / ADMIN | Assembly line 1 | 1. Create request for raw materials<br>2. Submit requisition | Requisition created with status PENDING; visible in warehouse requisition queue | Requisition created and persisted | **PASS** | High |
| `TC-ASM-003` | Functional / Positive | `/assembly/quality` | In-line Quality Control inspection | Finished unit staged | Assembly serial # | 1. Navigate to `/assembly/quality`<br>2. Complete QC checklist<br>3. Submit Pass | Finished good marked QC_PASSED and routed to Finished Goods inventory | QC status updated cleanly | **PASS** | High |

---

### Module 09: Outbound Dispatch (`/dispatch*`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-DSP-001` | Positive Testing | `/dispatch-orders` | Outbound customer orders list & status | Authenticated as DISPATCH / ADMIN | Order records | 1. Navigate to `/dispatch-orders`<br>2. Verify dispatch orders table | Orders rendered with Order ID, customer, destination, line items, and fulfillment status | Orders table rendered with sorting/filtering | **PASS** | High |
| `TC-DSP-002` | Functional / Positive | `/dispatch-loading` | Truck loading & outbound security seal recording | Active dispatch order | Vehicle # | 1. Navigate to `/dispatch-loading`<br>2. Enter container seal number<br>3. Submit loading confirmation | Manifest updated; vehicle status moves to READY_FOR_EXIT | Loading checklist submitted successfully | **PASS** | High |

---

### Module 10: Supplier Portal (`/supplier*`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-SUP-001` | Positive Testing | `/supplier-dashboard` | Supplier Portal commitments & in-transit shipments | Authenticated as SUPPLIER | Supplier account | 1. Navigate to `/supplier-dashboard`<br>2. Inspect ASN cards and active orders | Supplier-specific commitments and metrics displayed | Loaded with supplier scoping | **PASS** | High |
| `TC-SUP-002` | Positive Testing | `/supplier/asns/new` | Advance Shipping Notice (ASN) Creation Form | Authenticated as SUPPLIER | Active PO | 1. Fill Vehicle number, driver name, delivery date<br>2. Select PO lines<br>3. Submit ASN | Inbound ASN created in DB; gate notified of incoming delivery | ASN generated with unique ASN reference | **PASS** | Critical |
| `TC-SUP-003` | Security Testing | Supplier Data Scoping | Supplier cannot view other suppliers' orders or financial data | Authenticated as SUPPLIER | Supplier A token | 1. Query supplier orders or materials endpoint | Backend filters strictly by `supplier_id` extracted from JWT; cross-supplier data blocked | Multi-tenant isolation verified | **PASS** | Critical |

---

### Module 11: Cross-Cutting Reports & Notifications (`/reports`, `/notifications`)

| Test Case ID | Scenario Category | Screen / Component | Scenario Description | Preconditions | Test Data | Execution Steps | Expected Result | Actual Result | Status | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-REP-001` | Positive Testing | `/reports` | Operations & Inventory Reports Generation | Authenticated as ADMIN / MANAGER | Reports access | 1. Navigate to `/reports`<br>2. Select report type<br>3. Trigger generation | Tabular and chart analytics render; export options available | Reports generated without client or server error | **PASS** | High |
| `TC-NOT-001` | Functional / Positive | `/notifications` | Role-filtered Notification Feed | Authenticated as staff | Active notifications | 1. Navigate to `/notifications`<br>2. Inspect notification feed | Displays alerts matching user's role (dock alerts, stock alerts, QC alerts) | Feed rendered cleanly | **PASS** | Medium |
| `TC-NOT-002` | Integration / Negative | Notification Fallback | Notification service resilience when table is absent | Database active | Missing table scenario | 1. Query `/api/storage/inventory/notifications` | Endpoint handles missing table gracefully without crashing frontend shell (500 handled) | Root cause identified & resolved | **PASS** | High |

