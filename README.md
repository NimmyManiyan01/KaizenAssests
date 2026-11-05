# KaizenAssests (AMS) — Enterprise Warehouse & Assembly Management System

> **The Single Source of Truth for Platform Architecture, Operational Workflows, Local Engineering, and Production Deployment.**

---

## 1. Platform Overview & Architectural Mission

**KaizenAssests (AMS - Assets & Warehouse Management System)** is an enterprise-grade, end-to-end supply chain execution and manufacturing assembly platform. It coordinates the complete physical and digital lifecycle of materials—from initial Supplier Purchase Order dispatch and factory gate security check-in, through dock turnaround, quantitative receiving, damage claims, and high-density warehouse putaway, to Bill of Materials (BOM) manufacturing, serialized multi-section finished goods traceability, strict First-In-First-Out (FIFO) outbound dispatch, and tamper-evident audit logging.

```mermaid
flowchart LR
    subgraph Client Layer
        FE["React 19 SPA (Vite / TanStack Router)\nPort 8080"]
    end

    subgraph API & Domain Core
        BE["FastAPI Business Engine\n(Python 3.12 / Uvicorn)\nPort 8000"]
        MW["Security & Auth Middleware\n(RBAC / JWT / Rate Limits)"]
    end

    subgraph Data & Event Persistence
        PG[("PostgreSQL 16 (Primary DB)\n(SQLAlchemy 2.0 Async / asyncpg)\nPort 5432")]
        RD[("Redis (Cache & Locks)\nPort 6379")]
        KF[("Kafka Event Broker\n(Transactional Outbox Relay)\nPort 9092")]
    end

    FE -->|HTTP / REST / WebSocket| BE
    BE --> MW
    MW --> PG
    BE --> RD
    BE -->|Outbox Pattern| KF
```

---

## 2. Technology Stack & Specifications

| Layer / Domain | Technology | Version | Purpose / Responsibilities |
| :--- | :--- | :--- | :--- |
| **Web Frontend** | **React & TypeScript** | React 19, TS 5.x | High-performance desktop and tablet operator workstation UI. |
| **Routing & SSR** | **TanStack Router & Nitro** | Latest | Type-safe URL routing, search params validation, and SSR capability. |
| **Styling & Components**| **Tailwind CSS & Radix UI** | Tailwind v3, Radix UI | Accessible headless primitives, custom tooltips, responsive data tables. |
| **Visuals & QR** | **Lucide Icons & jsQR** | Latest | Hardware camera barcode/QR scanner and enterprise iconography. |
| **Backend Framework** | **FastAPI & Starlette** | FastAPI 0.115+ | 300+ asynchronous REST API routes, OpenAPI 3.1 documentation. |
| **Python Runtime** | **Python** | 3.12.x | High-performance async/await core execution engine. |
| **ORM & Data Layer** | **SQLAlchemy & Alembic** | SQLAlchemy 2.0 Async | Unit of Work (UoW) transaction scoping, automated schema migrations. |
| **Primary Database** | **PostgreSQL** | Version 16 | Relational data persistence, foreign key integrity, custom sequences. |
| **Database Driver** | **`asyncpg`** | Latest | Native async binary protocol driver for maximum throughput. |
| **Messaging & Events** | **Apache Kafka** | 3.x compatible | Transactional outbox pattern for asynchronous event broadcasting. |
| **Cache & Concurrency**| **Redis** | 7.x compatible | Idempotency locking, token blocklists, and queue counters. |
| **Containerization** | **Docker & NGINX** | Alpine Multi-stage | Unprivileged non-root containers for hardened production deployment. |
| **Cloud IaC** | **Azure Bicep** | Latest | Declarative infrastructure as code for Azure Container Apps & Flexible Server. |

---

## 3. Repository Directory Structure

```text
KaizenAssests/
├── .env.production.example          # Production environment variables blueprint
├── .gitignore                       # Repository ignore rules (caches, builds, secrets)
├── docker-compose.prod.yml          # Production multi-container orchestration stack
├── README.md                        # Master repository documentation (This Document)
│
├── backend/                         # Backend Services Root
│   ├── README.md                    # Backend specific documentation
│   └── business-service/            # FastAPI Business Logic Engine
│       ├── alembic/                 # Database migrations
│       │   ├── env.py               # Async migration runner
│       │   └── versions/            # Versioned SQL migration scripts
│       ├── alembic.ini              # Alembic configuration
│       ├── app/                     # Core Application Package
│       │   ├── main.py              # FastAPI factory, middleware, router mounts, lifespan
│       │   ├── bootstrap.py         # Default system administrator & demo seed bootstrap
│       │   ├── common/              # Shared persistence models and base classes
│       │   ├── config/              # Pydantic v2 application settings and env parsing
│       │   ├── database/            # SQLAlchemy async engine, sessionmaker, Unit of Work
│       │   ├── events/              # Outbox models and transactional event schemas
│       │   ├── kafka/               # Kafka producer/consumer connection managers
│       │   ├── logging/             # Structured JSON logger and OpenTelemetry instrumentation
│       │   ├── middleware/          # Security headers, auth enforcement, audit log, error handling
│       │   ├── modules/             # Domain Modules
│       │   │   ├── admin/           # User management, supplier accounts, system audit trail
│       │   │   ├── assembly/        # BOM production, material requests, finished goods, QC
│       │   │   ├── assistant/       # Context-aware AI inventory assistant endpoints
│       │   │   ├── dispatch/        # Outbound orders, FIFO picking, loading, gate exit
│       │   │   ├── dock/            # Dock bay allocation, scheduling, turnaround SLA
│       │   │   ├── gate/            # Gate entries, vehicle check-in, yard queueing
│       │   │   ├── notification/    # WebSocket and broadcast alert center
│       │   │   ├── quarantine/      # Damaged and rejected material segregation
│       │   │   ├── receiving/       # Package scanning, ASN manifest reconciliation, GRN
│       │   │   ├── reporting/       # Aggregated KPIs, flow summaries, operations analytics
│       │   │   ├── returns/         # Damage claims, photographic evidence, supplier RMAs
│       │   │   ├── storage/         # Putaway tasks, rack capacity limits, zone/bin tracking
│       │   │   └── warehouse/       # Multi-zone layout, inventory ledger, batch controls
│       │   ├── security/            # JWT authentication, password hashing, RBAC dependencies
│       │   ├── services/            # Cross-module application services
│       │   └── workers/             # Background outbox relay scheduler and event consumers
│       ├── scripts/                 # Standalone administrative and database utilities
│       │   └── legacy_sqlite/       # Historical archive of legacy SQLite migration tools
│       ├── Dockerfile               # Production hardened multi-stage container build
│       ├── pyproject.toml           # Python dependencies and project metadata
│       └── requirements.txt         # Pinned production Python dependencies
│
├── frontend/                        # Web Client Root (React 19 / TanStack Router SPA)
│   ├── README.md                    # Frontend specific developer guide
│   ├── Dockerfile                   # Multi-stage production NGINX build
│   ├── nginx.conf                   # Unprivileged NGINX SPA reverse proxy configuration
│   ├── package.json                 # Node scripts and dependencies
│   ├── vite.config.ts               # Vite bundler configuration
│   └── src/
│       ├── components/              # UI Component Library
│       │   ├── ui/                  # Radix UI primitives (Button, Dialog, Select, Tooltip, etc.)
│       │   └── wms/                 # Domain-specific components (AppShell, Tables, Scanners)
│       ├── lib/                     # Utilities & API Client
│       │   ├── api-client.ts        # Central unified HTTP client connecting to backend API
│       │   ├── auth-utils.ts        # Session persistence, JWT decoding, role shields
│       │   ├── information-help.ts  # Contextual operational help and guidance tooltips
│       │   └── input-validation.ts  # Regex and format validators (Vehicles, Phones, Dates)
│       └── routes/                  # TanStack Router File-Based Pages (44 routes)
│           ├── __root.tsx           # Application root shell, global providers, toast alerts
│           ├── index.tsx            # Landing redirect based on authenticated user role
│           ├── login.tsx            # Multi-role authentication & Magic Link verification
│           ├── supplier-dashboard.tsx # Supplier supplier-facing order command center
│           ├── supplier.asns.new.tsx# Inbound Advance Shipping Notice (ASN) builder
│           ├── gate-dashboard.tsx   # Security guard arrival intake and gate pass generator
│           ├── vehicle-queue.tsx    # Active yard queue and fast-track priority monitor
│           ├── dock-management.tsx  # Dynamic dock bay scheduling and turnaround monitor
│           ├── receiving.tsx        # Unloading verification and package barcode scanner
│           ├── damage-claims.tsx    # Photographic damage logging and supplier resolution
│           ├── grn.tsx              # Goods Receipt Note (GRN) generation and cryptographic QR
│           ├── putaway-tasks.tsx    # Two-step putaway workflow (Package -> Target Bin QR)
│           ├── inventory.tsx        # Real-time multi-zone inventory ledger and rack layout
│           ├── assembly.*.tsx       # BOM requisitions, production tracking, QC inspection
│           ├── assembly.finished-goods.tsx # Serialized FG inventory and section QR binding
│           ├── dispatch-orders.tsx  # Outbound customer sales order processing
│           ├── dispatch-loading.tsx # Loading verification and checklist scanning
│           ├── vehicle-exit.tsx     # Security exit gate pass validation and seal check
│           └── admin*.tsx           # Plant telemetry, audit log explorer, user permissions
│
└── infrastructure/                  # Infrastructure as Code (IaC)
    └── azure/                       # Production Azure Cloud Bicep Templates
        ├── main.bicep               # Root deployment orchestrator
        ├── main.parameters.prod.json# Production environment parameters
        ├── app-insights-alerts.json # Cloud monitoring alert rules
        └── modules/                 # Modular Bicep components (Container Apps, DB, VNet)
```

---

## 4. End-to-End Operational Journey (The 10 Flow Stages)

The platform enforces a deterministic, closed-loop operational flow where each stage provides the prerequisite data for subsequent operations:

```mermaid
flowchart TD
    S1["Stage 1: Auth & RBAC Governance\n(/login)"] --> S2["Stage 2: Supplier ASN Creation\n(/supplier.asns.new)"]
    S2 --> S3["Stage 3: Gate Security & Arrival Intake\n(/gate-dashboard, /vehicle-queue)"]
    S3 --> S4["Stage 4: Dock Bay Scheduling\n(/dock-management)"]
    S4 --> S5["Stage 5: Unloading, Receiving & GRN\n(/receiving, /damage-claims, /grn)"]
    S5 --> S6["Stage 6: Putaway & Inventory Control\n(/putaway-tasks, /inventory)"]
    S6 --> S7["Stage 7: Manufacturing Requisitions & QC\n(/assembly.production, /assembly.quality)"]
    S7 --> S8["Stage 8: Finished Goods Traceability\n(/assembly.finished-goods, /fg-sections)"]
    S8 --> S9["Stage 9: Outbound Sales & Dispatch Gate Exit\n(/dispatch-orders, /vehicle-exit)"]
    S9 --> S10["Stage 10: Plant Telemetry, Audit & Alerts\n(/admin_.operations, /admin_.audit)"]
```

### Stage 1: Authentication, Identity & RBAC Governance
- **Routes**: `/login`, `/`
- **Capabilities**: Enterprise credential validation, JWT bearer tokens with configurable expiration, Magic Link token verification (`/api/v1/auth/magic-login`), and client-side route guards.

### Stage 2: Supplier Portal & Inbound ASN Creation
- **Routes**: `/supplier-dashboard`, `/supplier.asns`, `/supplier.asns.new`, `/supplier.dispatch`
- **Capabilities**: Active Purchase Order (PO) lookup, multi-item line quantity enforcement, transport carrier assignment with regex vehicle validation (`^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$`), driver validation, and Advance Shipping Notice (ASN) barcode/QR generation.

### Stage 3: Gate Security & Arrival Intake
- **Routes**: `/gate-dashboard`, `/vehicle-queue`, `/gate.finished-goods-pickup`
- **Capabilities**: ASN QR scanning or plate entry at the factory gate, verification against pre-registered manifests, active yard vehicle queueing with real-time wait-time counters, fast-track prioritization, and digital Gate Pass issuance.

### Stage 4: Dock Management & Dynamic Scheduling
- **Routes**: `/dock-management`, `/dock-master`
- **Capabilities**: Real-time bay occupancy grid (`AVAILABLE`, `OCCUPIED`, `MAINTENANCE`), directional filters (`INBOUND`, `OUTBOUND`, `BOTH`), queue-to-dock allocation, turnaround time (TAT) SLA monitoring, and overstay alerts.

### Stage 5: Unloading, Receiving, Inspection & GRN Issuance
- **Routes**: `/receiving`, `/grn`, `/damage-claims`
- **Capabilities**: Package-level barcode/QR scanning against ASN lines, quantitative tolerance checks, damage claim logging with photo evidence and resolution routing (`REPLACEMENT`, `CREDIT_NOTE`, `RETURN`), and Goods Receipt Note (GRN) generation with cryptographic QR codes.

### Stage 6: Putaway, Storage & Inventory Control
- **Routes**: `/inventory`, `/putaway-tasks`
- **Capabilities**: Automated putaway task generation triggered by GRN posting, multi-zone segregation (`RAW_MATERIALS`, `QUARANTINE`, `FINISHED_GOODS`), rack/bin capacity enforcement (weight/volume), two-step QR verification (Package Scan $\to$ Target Bin QR Scan), and real-time stock ledger synchronization.

### Stage 7: Manufacturing Requisitions, BOM & Assembly Execution
- **Routes**: `/assembly-dashboard`, `/assembly.material-requests`, `/assembly.production`, `/assembly.quality`
- **Capabilities**: Bill of Materials (BOM) explosion, material requisitions with date validation (past dates blocked), warehouse line-picking and physical handover confirmation, assembly run execution, and multi-point QC inspection (`QC_APPROVED`, `REWORK`, `SCRAP`).

### Stage 8: Finished Goods Traceability & Serialization
- **Routes**: `/assembly.finished-goods`, `/fg-sections`
- **Capabilities**: Unit serialization, 8-section modular unit QR generation and camera binding, complete backward genealogical query (FG Serial $\to$ Production Run $\to$ Raw Material Lots $\to$ Receiving GRN $\to$ Supplier PO), and historical legacy data handling (`NOT_AVAILABLE`, `UNLINKED`).

### Stage 9: Outbound Sales, Dispatch & Gate Exit
- **Routes**: `/dispatch-orders`, `/dispatch-loading`, `/dispatch-gate-out`, `/vehicle-exit`, `/assembly.dispatch`
- **Capabilities**: Strict FIFO finished goods reservation (oldest QC-approved batches allocated first), picking/packing verification, vehicle docking, loading checklist QR verification, Proof of Delivery (POD) generation, and security gate departure authorization.

### Stage 10: Administration, Operations Control & Audit
- **Routes**: `/admin`, `/admin_.audit`, `/admin_.operations`, `/admin_.users`, `/admin_.suppliers`, `/notifications`
- **Capabilities**: Plant-wide operational KPI cards and throughput sparklines, granular user and supplier permission matrix (`READ`, `WRITE`, `NONE`), immutable append-only audit trail logging all system events and data diffs, and WebSocket/polling alert broadcast center.

---

## 5. Role-Based Access Control (RBAC) Matrix

| Role Identifier | Display Name | Core Permissions & Accessible Workspaces |
| :--- | :--- | :--- |
| `SECURITY_GUARD` | Gate Security Officer | Gate check-in, active yard queue, Gate Pass issuance, Outbound vehicle exit clearance. |
| `RECEIVING_OPERATOR` | Receiving Operator | Inbound dock unloading, package barcode scanning, variance checking, initial GRN drafting. |
| `STORE_KEEPER` | Store Keeper | Putaway task execution, zone/rack/bin scanning, material picking for assembly requisitions. |
| `STORE_MANAGER` | Store / Warehouse Manager | Dock bay configuration, warehouse layout, rack capacity limits, inventory adjustments, GRN approval. |
| `LINE_SUPERVISOR` | Assembly Line Supervisor | BOM material requisitions, production scheduling, assembly line assignment, output recording. |
| `ASSEMBLY_OPERATOR` | Assembly Operator | Work order execution, component consumption logging, sub-assembly section QR scanning. |
| `QC_INSPECTOR` | Quality Control Inspector | Incoming material inspection, assembly output QA, defect classification (`REWORK`/`SCRAP`/`PASS`). |
| `DISPATCH_OFFICER` | Dispatch Officer | Sales order allocation, FIFO finished goods picking, transport vehicle loading, POD generation. |
| `SUPPLIER` | External Vendor / Supplier | Vendor dashboard, PO balance view, Inbound ASN creation, driver/transport assignment, delivery tracking. |
| `SYSTEM_ADMIN` | System Administrator | Full unrestricted access, user accounts, supplier permissions, system telemetry, immutable audit logs. |

---

## 6. Local Development & Setup Guide

### 6.1 Prerequisites
- **Node.js**: `v20.x` or `v22.12+` (If using `Node v22.11.0` on Windows, set `NODE_OPTIONS=--experimental-require-module`).
- **Python**: `3.12.x` (with `venv` module).
- **PostgreSQL**: Version `16.x` running on local port `5432` (or via Docker).
- **Git**: Installed and configured.

---

### 6.2 Step 1: Database Setup
Ensure PostgreSQL is active and create the primary database:
```sql
CREATE USER ams_business WITH PASSWORD 'ams_business';
CREATE DATABASE ams_business OWNER ams_business;
GRANT ALL PRIVILEGES ON DATABASE ams_business TO ams_business;
```

---

### 6.3 Step 2: Backend Setup (FastAPI)

1. Open a terminal and navigate to the business service directory:
   ```bash
   cd backend/business-service
   ```

2. Create and activate a Python 3.12 virtual environment:
   ```powershell
   # Windows PowerShell
   python -m venv ..\.venv
   ..\.venv\Scripts\Activate.ps1
   ```
   ```bash
   # Linux / macOS
   python3.12 -m venv ../.venv
   source ../.venv/bin/activate
   ```

3. Install required dependencies:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

4. Configure the local environment:
   ```powershell
   # Copy the example environment file if .env does not exist
   Copy-Item .env.example .env
   ```
   Ensure `DATABASE_URL` in `.env` points to your PostgreSQL database:
   ```ini
   DATABASE_URL=postgresql+asyncpg://ams_business:ams_business@localhost:5432/ams_business
   ```

5. Run database schema migrations:
   ```bash
   alembic upgrade head
   ```

6. Start the development backend server:
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
   - **Backend Base API**: `http://localhost:8000`
   - **Interactive OpenAPI Documentation (Swagger)**: `http://localhost:8000/docs`
   - **Service Health Check**: `http://localhost:8000/health`
   - **Deep Readiness Probe**: `http://localhost:8000/health/ready`

---

### 6.4 Step 3: Frontend Setup (React 19 / Vite)

1. Open a second terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install Node dependencies:
   ```bash
   npm install
   ```

3. Start the development web server:
   ```powershell
   # Windows PowerShell (Node 22.11 compatibility)
   $env:NODE_OPTIONS="--experimental-require-module"
   npm run dev
   ```
   ```bash
   # Linux / macOS
   npm run dev
   ```

4. Open your browser and navigate to:
   - **Application Web UI**: **`http://localhost:8080`** (or `http://localhost:5173`)

---

### 6.5 Default Demo Credentials (Local Bootstrap)

When the backend starts up for the first time, it automatically provisions standard operational accounts:

| Role | Username | Password | Purpose |
| :--- | :--- | :--- | :--- |
| **System Admin** | `admin` | `admin123` | Full system administration, audit logs, configuration. |
| **Warehouse Manager** | `manager` | `manager123` | Yard, docks, putaway, storage, and inventory ledger control. |
| **Store Keeper** | `storekeeper` | `store123` | Physical putaway and line requisition picking. |
| **Assembly Operator** | `assembly` | `assembly123` | Production orders, BOM tracking, section QR binding. |
| **QC Inspector** | `inspector` | `qc123` | Incoming material inspection and production lot QA. |
| **Gate Security** | `guard` | `gate123` | Vehicle check-in, active yard queue, gate pass verification. |
| **Dispatch Officer** | `dispatch` | `dispatch123` | Outbound sales order allocation, loading, and POD. |
| **Supplier** | `supplier` | `supplier123` | Inbound ASN generation and transport management. |

---

## 7. Production Deployment Architecture

The platform supports three deployment architectures:

```mermaid
graph TD
    subgraph Option A: Local / Staging Multi-Container
        DC[docker-compose.prod.yml] --> C_PG[Postgres 16 Container]
        DC --> C_BE[FastAPI Business Service Container]
        DC --> C_FE[NGINX Unprivileged Web Container]
    end

    subgraph Option B: Cloud Container Deployment
        K8S[Kubernetes / Container Apps]
        K8S --> POD_BE[FastAPI Replicas (Port 8000)]
        K8S --> POD_FE[NGINX Static Replicas (Port 8080)]
        K8S --> EXT_PG[(Managed PostgreSQL Flexible Server)]
    end
```

### 7.1 Option A: Production Docker Compose (`docker-compose.prod.yml`)
Deploy the full production-grade stack (PostgreSQL 16, multi-worker FastAPI backend, unprivileged NGINX frontend) with a single command:

```powershell
# 1. Review environment variables
Copy-Item .env.production.example .env.production

# 2. Build and launch all production containers
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
- **Web Client**: `http://localhost:8080`
- **Backend API**: `http://localhost:8000`
- **PostgreSQL**: `localhost:5432`

---

### 7.2 Option B: Standalone Container Build & Run

#### Backend Container:
```bash
cd backend/business-service
docker build -t kaizen-backend:prod -f Dockerfile .
docker run -d --name kaizen-backend -p 8000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://ams_business:password@postgres_host:5432/ams_business" \
  -e ENVIRONMENT="production" \
  kaizen-backend:prod
```

#### Frontend Container:
```bash
cd frontend
docker build -t kaizen-frontend:prod -f Dockerfile .
docker run -d --name kaizen-frontend -p 8080:8080 kaizen-frontend:prod
```

---

### 7.3 Option C: Enterprise Azure Cloud Infrastructure (Bicep IaC)

The repository provides production Azure Bicep templates in `infrastructure/azure/`:
- **Compute**: Azure Container Apps with KEDA autoscaling.
- **Database**: Azure Database for PostgreSQL Flexible Server (Version 16, Private Endpoint, DigiCert SSL root CA).
- **Secrets**: Azure Key Vault for credentials and JWT signing keys.
- **Network**: Private Virtual Network (VNet) with delegated subnets.
- **Observability**: Azure Log Analytics & Application Insights monitoring.

To deploy to Azure:
```bash
az deployment sub create \
  --location eastus2 \
  --template-file infrastructure/azure/main.bicep \
  --parameters infrastructure/azure/main.parameters.prod.json
```

---

## 8. Environment Configuration Reference

### Backend Configuration (`backend/business-service/.env`)

| Variable Name | Default Value | Required | Description |
| :--- | :--- | :---: | :--- |
| `ENVIRONMENT` | `local` | Yes | Runtime environment: `local`, `dev`, `staging`, or `production`. |
| `DATABASE_URL` | `postgresql+asyncpg://...` | Yes | SQLAlchemy async connection string pointing to PostgreSQL. |
| `DATABASE_POOL_SIZE` | `10` | No | SQLAlchemy connection pool size. |
| `DATABASE_MAX_OVERFLOW` | `20` | No | Maximum overflow connections beyond pool size. |
| `LOCAL_SESSION_LIFETIME_MINUTES` | `60` | No | JWT token validity window. |
| `LOGIN_MAX_FAILURES` | `5` | No | Failed login attempts before account lockout. |
| `LOGIN_LOCKOUT_MINUTES` | `15` | No | Duration of security lockout upon threshold breach. |
| `TRUSTED_HOSTS` | `["localhost","127.0.0.1"]` | Yes | Allowed HTTP Host headers for CORS and proxy protection. |
| `FORCE_HTTPS` | `false` (set `true` in prod) | No | Enforces SSL redirect middleware. |
| `ENABLE_API_DOCS` | `false` in prod | No | Enables `/docs` and `/redoc` OpenAPI explorers. |
| `KAFKA_BOOTSTRAP_SERVERS`| `localhost:9092` | No | Kafka cluster address for asynchronous event relay. |
| `REDIS_URL` | `redis://localhost:6379/0` | No | Redis connection URL for distributed locking and caching. |
| `ADMIN_USERNAME` | `admin` | No | Initial administrator username on clean database. |
| `ADMIN_PASSWORD` | `admin123` | No | Initial administrator password on clean database. |

### Frontend Configuration (`frontend/.env`)

| Variable Name | Default Value | Required | Description |
| :--- | :--- | :---: | :--- |
| `VITE_BUSINESS_API_URL` | `http://localhost:8000` | Yes | URL of the Python business-service API. |

---

## 9. Operational Maintenance & Troubleshooting

### Database Schema Migrations
Always apply migrations through Alembic before starting new service versions:
```bash
cd backend/business-service
alembic upgrade head
```
To create a new migration after updating SQLAlchemy persistence models:
```bash
alembic revision --autogenerate -m "describe_schema_change"
```

### Checking Service Health & Readiness
The platform exposes two standardized health probes:
1. **Liveness Probe** (`GET /health`): Returns HTTP 200 if the FastAPI application process is alive.
2. **Readiness Probe** (`GET /health/ready`): Performs an active `SELECT 1` database query and verifies transactional outbox connectivity. Returns HTTP 200 when ready to receive traffic, or HTTP 503 if downstream dependencies are offline.

### Windows Node.js ESM Resolution Note
If running `vite` or `vitest` on Windows using Node.js versions between `22.0.0` and `22.11.0`, define the Node option:
```powershell
$env:NODE_OPTIONS="--experimental-require-module"
```
*(This is not required in production Docker containers, which use Node 20 LTS Alpine).*

---

## 10. Verification & Quality Standards

- **Backend Architecture**: Validated against 303 REST endpoints across Gate, Receiving, Storage, Assembly, Dispatch, and Audit modules.
- **Frontend Architecture**: Zero TypeScript compilation errors across 44 TanStack routes; production bundle minified and SSR-ready.
- **Data Integrity**: Enforced through foreign keys, PostgreSQL sequences, transactional outbox logging, and strict FIFO allocation algorithms.
