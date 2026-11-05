# Application Testing Inventory & Functional Map

## 1. Inventory Overview
This inventory provides a comprehensive breakdown of all discoverable functional modules, submodules, pages, UI elements, API touchpoints, workflows, and role permissions for **KaizenAssets (AMS/WMS)**.

---

## 2. Module & Page Hierarchy

```
KaizenAssets Application
│
├── 1. Landing & Marketing Experience
│   └── Route: `/` (Landing Page)
│       ├── Sub-components: 3D Warehouse Canvas (Three.js), Hero section, Feature highlights, Floating header, Scroll journey
│       └── Actions: "Sign In" CTA, Replay journey, Dark/Light mode toggle, Smooth scroll
│
├── 2. Authentication & Session Module
│   └── Route: `/login` (Staff Login & Magic Link)
│       ├── Forms: Staff Login Form (Employee ID/Username, Password, Remember Me)
│       ├── Workflows: Standard JWT authentication, Magic Link verification (`?token=...`), Password visibility toggle, IT reset alert
│       └── Roles Supported: SUPER_ADMIN, ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_OPERATOR, GATE_SECURITY, GATE_OPERATOR, ASSEMBLY_MANAGER, ASSEMBLY_OPERATOR, DISPATCH_MANAGER, DISPATCH_OPERATOR, QC, SUPPLIER
│
├── 3. Admin & Executive Management Module
│   ├── Route: `/admin` (Executive Operations Dashboard)
│   │   ├── Metrics: Total Warehouses, Total Materials, Active Docks, Total Inbound ASNs, Active Users, System Health
│   │   ├── Data Grids: Audit Activity Logs (limit 500), Active Warehouses Card Grid, Quick Action Navigation Pills
│   │   └── API Touchpoints: `GET /api/v1/admin/overview`, `GET /api/v1/admin/audit-logs`
│   ├── Route: `/admin/users` (User Management)
│   │   ├── Features: User creation modal, Role assignment, Status toggle (ACTIVE/INACTIVE), Password reset
│   │   └── Data Grids: User Accounts table, Search by username/emp ID, Filter by role
│   ├── Route: `/admin/suppliers` (Vendor & Supplier Management)
│   │   ├── Features: Onboard vendor, Supplier contact info, Approved category assignment
│   │   └── Data Grids: Registered Suppliers table, Status filter
│   ├── Route: `/admin/audit` (System Security & Audit Trail)
│   │   ├── Features: Date-range filter, Event action filtering (LOGIN, CREATE, UPDATE, DELETE)
│   │   └── Data Grids: Full audit log table with timestamps, IP address, user, and payload diff
│   └── Route: `/admin/operations` (System Operations Configuration)
│       └── Features: Environment flags, Warehouse facility configurations, Maintenance mode toggle
│
├── 4. Gate & Security Module
│   ├── Route: `/gate-dashboard` (Gate Security Command Center)
│   │   ├── Metrics: Expected Trucks Today, Vehicles in Yard, Completed Exits, Overdue Docks
│   │   └── Workflows: Rapid vehicle arrival check-in, Driver verification
│   ├── Route: `/vehicle-queue` (Live Inbound Vehicle Queue)
│   │   ├── Features: Truck status board (Waiting / Docked / Loading / Departing), Manual dock assignment override
│   │   └── Data Grids: Inbound ASN Trucks table with Driver Name, Vehicle Number, PO/ASN reference, Status
│   ├── Route: `/vehicle-exit` (Vehicle Inspection & Exit Clearance)
│   │   ├── Features: Exit Gate Pass validation, Physical security checklist, Driver signature confirmation, Gate-out clearance
│   │   └── Dialogs: Confirmation modal, Security discrepancy flag dialog
│   ├── Route: `/gate/finished-goods-pickup` (Outbound Finished Goods Entry)
│   │   └── Features: Customer dispatch vehicle check-in, Pickup order verification
│   └── Route: `/gate/finished-goods-pickup-exit` (Outbound Finished Goods Exit)
│       └── Features: Outbound cargo manifest verification, Final gate pass issuance
│
├── 5. Dock & Yard Management Module
│   ├── Route: `/dock-management` (Dock Bay Live Board)
│   │   ├── Features: Interactive Dock Bay Grid (Bay 1..N), Bay Status (Available, Occupied, Maintenance, Reserved)
│   │   ├── Actions: Assign truck to dock, Release dock, Mark maintenance, View dock turnaround time
│   │   └── API Touchpoints: `GET /api/docks`, `POST /api/docks/assign`, `POST /api/docks/release`
│   └── Route: `/dock-master` (Dock Configuration Master)
│       └── Features: Add new dock bay, Configure dock bay capabilities (Cold Storage, Hazardous, Standard)
│
├── 6. Inbound Receiving & GRN Module
│   ├── Route: `/receiving` (Material Receiving Dock)
│   │   ├── Features: Physical shipment intake, PO/ASN matching, Packaging damage inspection, Initial quantity verification
│   │   └── Forms: Inbound Receipt Form, Damage inspection checklist
│   └── Route: `/grn` (Goods Receipt Note & Batch Labeling)
│       ├── Features: Comprehensive GRN generation (PO line matching, accepted vs. rejected counts), Barcode & QR Code generation (JsBarcode / QRCode)
│       ├── Dialogs: Print QR/Barcode labels modal, Inspection certificate attachment
│       └── API Touchpoints: `GET /api/grn`, `POST /api/grn`, `POST /api/grn/batches/labels`
│
├── 7. Warehouse & Inventory Storage Module
│   ├── Route: `/warehouse-dashboard` (Warehouse Overview)
│   │   └── Metrics: Total Bin Utilization %, Fast-moving items, Reorder threshold alerts, Open putaway tasks
│   ├── Route: `/inventory` (Enterprise Real-Time Inventory Grid)
│   │   ├── Features: Material search, Category filter, Warehouse location selector (Aisle, Rack, Shelf, Bin)
│   │   ├── Data Grids: SKU, Material Name, Category, In-Stock Qty, Reserved Qty, Available Qty, UOM, Reorder Level
│   │   └── Modals: Stock adjustment modal, Transfer between bins modal, Stock history ledger
│   └── Route: `/putaway-tasks` (Putaway Task Queue)
│       ├── Features: System-recommended putaway bin assignments, Operator confirmation, Scan-to-bin validation
│       └── Data Grids: Open putaway tasks with Source Receiving Area, Target Bin, Batch ID
│
├── 8. Assembly & Manufacturing Module
│   ├── Route: `/assembly-dashboard` (Assembly Operations Center)
│   │   └── Metrics: Active production orders, Material shortage alerts, Finished goods produced today
│   ├── Route: `/assembly/material-requests` (Warehouse Material Requisitions)
│   │   ├── Forms: Create Material Request (Select Assembly Line, Material SKU, Required Quantity, Priority)
│   │   └── Data Grids: Requisition status (PENDING, APPROVED, PICKED, ISSUED)
│   ├── Route: `/assembly/production` (Manufacturing Assembly Line)
│   │   ├── Features: Assembly stages, Component tracking, Pump/Unit assembly serial number generation
│   │   └── Actions: Start Assembly, Complete Stage, Report Defect
│   ├── Route: `/assembly/quality` (In-Line Quality Assurance)
│   │   ├── Forms: Quality checklist (Tolerance checks, pressure tests, visual inspection)
│   │   └── Actions: Pass QC, Fail QC (Quarantine routing), Issue rework ticket
│   ├── Route: `/assembly/finished-goods` (Finished Goods Staging)
│   │   └── Features: Packaged finished goods inventory, Serial number tagging, Ready for dispatch mark
│   └── Route: `/assembly/dispatch` (Assembly Dispatch Handoff)
│       └── Features: Move finished goods from production cell to outbound dispatch staging
│
├── 9. Outbound Dispatch & Fulfillment Module
│   ├── Route: `/dispatch-orders` (Sales Dispatch Orders)
│   │   ├── Data Grids: Order ID, Customer Name, Destination, Items, Required Delivery Date, Status
│   │   └── Actions: Create pick list, Assign to dispatch officer
│   ├── Route: `/dispatch-picking-packing` (Pick & Pack Operations)
│   │   ├── Features: Order item picking from finished goods, Carton packaging, Packing slip print
│   │   └── Verification: Barcode scan verification before sealing
│   ├── Route: `/dispatch-loading` (Vehicle Loading & Verification)
│   │   ├── Features: Truck loading checklist, Cargo weight balance verification, Seal number recording
│   │   └── Actions: Confirm loading completion, Issue outbound manifest
│   ├── Route: `/dispatch-gate-out` (Dispatch Gate Outward Clearance)
│   │   └── Features: Final security seal check, Dispatch gate pass generation
│   └── Route: `/dispatch-exceptions` (Delivery Discrepancies & Returns)
│       └── Features: Short-shipment recording, Damaged packaging claims, Return-to-origin processing
│
├── 10. Supplier Portal Module
│   ├── Route: `/supplier-dashboard` (Vendor Portal)
│   │   ├── Metrics: Pending Purchase Orders, In-Transit ASNs, Delivered Goods, Quality Rating %
│   │   └── Navigation: Direct link to ASN generation, Materials catalog, Damage claim responses
│   ├── Route: `/supplier/asns` & `/supplier/asns/new` (Advance Shipping Notice Creation)
│   │   ├── Forms: Vehicle number, Driver name & contact, Expected delivery date/time, PO line item selection, Quantity shipped
│   │   └── Actions: Generate ASN, Print Inbound Barcode, Notify Warehouse Gate
│   ├── Route: `/supplier/dispatch` (Supplier Outbound Shipment Tracking)
│   │   └── Data Grids: In-transit shipments, Estimated Time of Arrival (ETA), Gate check-in status
│   ├── Route: `/supplier-materials` (Approved Raw Materials Catalog)
│   │   └── Data Grids: Supplier-contracted materials, Contract price, Lead time (days), Min order qty (MOQ)
│   └── Route: `/damage-claims` (Supplier Rejection & Damage Claims)
│       └── Features: Detailed view of damaged batches rejected at GRN/QC, Evidence photos, Credit note submission
│
└── 11. Cross-Cutting Reporting & Alerts Module
    ├── Route: `/reports` (Consolidated Executive & Operational Reports)
    │   ├── Reports: Inventory Aging Report, Dock Turnaround Time Report, Supplier On-Time In-Full (OTIF) Report, Assembly Yield Report
    │   └── Export Actions: CSV download, PDF print
    └── Route: `/notifications` (Enterprise Notification Center)
        ├── Features: Role-filtered notifications, Filter by unread, Mark individual read, "Mark All as Read"
        └── Categories: Dock allocations, Quality failures, Low stock warnings, ASN arrival notices
```

---

## 3. UI Component Inventory Matrix
| Component Type | Count | Key Examples |
| :--- | :---: | :--- |
| **Pages & Screens** | 35+ | Landing, Login, Admin, Dock, GRN, Inventory, Assembly, Dispatch, Supplier |
| **Interactive Forms** | 22 | Staff Login, User Registration, Material Request, ASN Creation, GRN Receipt, Stock Adjust |
| **Data Grids & Tables** | 18 | Inventory Stock Ledger, Audit Logs, Inbound Truck Queue, Dispatch Orders, Supplier Catalog |
| **Modals & Dialogs** | 16 | QR Label Generator, Dock Assignment, Quality Check Failure, Security Gate Discrepancy |
| **Primary Action Buttons**| 85+ | Sign In, Assign Dock, Generate GRN, Mark Completed, Dispatch Truck, Export CSV |
| **Charts & Visualizations**| 8 | KPI Cards, Recharts Area & Pie Charts, 3D Logistics Canvas (Three.js/Fiber) |

---

## 4. Role-Based Access Control (RBAC) Permitted Matrix
| Role | Landing (`/`) | Login (`/login`) | Admin (`/admin*`) | Gate (`/gate*`, `/vehicle*`) | Dock (`/dock*`) | GRN (`/grn`, `/receiving`) | Warehouse (`/inventory*`) | Assembly (`/assembly*`) | Dispatch (`/dispatch*`) | Supplier (`/supplier*`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **SUPER_ADMIN / ADMIN** | Yes | Yes | **Full** | **Full** | **Full** | **Full** | **Full** | **Full** | **Full** | **Full** |
| **GATE_SECURITY** | Yes | Yes | No | **Full** | View | No | No | No | Outbound Gate | No |
| **WAREHOUSE_MANAGER** | Yes | Yes | No | View | **Full** | **Full** | **Full** | Requisitions | Pick/Pack | No |
| **GRN / RECEIVING** | Yes | Yes | No | View | View | **Full** | View | No | No | No |
| **ASSEMBLY_MANAGER**| Yes | Yes | No | No | No | No | View | **Full** | Handoff | No |
| **DISPATCH_MANAGER**| Yes | Yes | No | View | View | No | View | View | **Full** | No |
| **SUPPLIER** | Yes | Yes | No | No | No | No | No | No | No | **Full** |

