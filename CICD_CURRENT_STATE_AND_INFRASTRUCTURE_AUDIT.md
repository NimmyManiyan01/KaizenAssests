# Continuous Integration & Continuous Deployment (CI/CD) Current State & Infrastructure Audit

## Executive Summary
This document provides a verified, empirical audit of the Warehouse Management System (WMS) repository, application architecture, containerization configuration, and Microsoft Azure deployment infrastructure. 

Prior to this audit, deployments were executed manually via developer terminal commands (`az acr build` and `az containerapp update`). There was no automated CI/CD pipeline, no pull request gatekeeper, and no automated container verification.

---

## 1. Repository Architecture & Git Topology

### 1.1 Remote Repositories
- **Primary Origin Remote**: `https://github.com/Vardhan158/KaizenAssests.git`
- **Production Secondary Remote**: `https://github.com/NimmyManiyan01/KaizenAssests.git`
- **Active Branch**: `main` (synchronized across both remotes at commit `24b68bd`).

### 1.2 Repository File Structure
```
KaizenAssests/
├── .azure/                          # Local Azure CLI profile cache
├── .github/                         # NOT PRESENT (CI/CD workflows missing)
├── backend/
│   ├── .python-version              # 3.12
│   └── business-service/            # Primary backend FastAPI microservice
│       ├── alembic/                 # Database migrations (120+ migration scripts)
│       ├── app/                     # Clean Architecture / DDD implementation
│       ├── Dockerfile               # Multi-stage production container build
│       ├── pyproject.toml           # Project dependencies & Ruff/Pytest config
│       ├── requirements.txt         # Pinned production dependencies
│       └── uv.lock                  # Fast dependency resolution lockfile
├── frontend/
│   ├── Dockerfile                   # Multi-stage Node 20 / Nitro SSR container build
│   ├── package.json                 # Node dependencies & test/build scripts
│   ├── package-lock.json            # Deterministic npm lockfile
│   ├── playwright.config.ts         # Playwright E2E configuration
│   ├── src/                         # TanStack Start / React 19 UI
│   └── tests/                       # Playwright test suites (12 comprehensive suites)
├── infrastructure/
│   └── azure/                       # Existing Bicep templates & parameter files
└── docker-compose.prod.yml          # Local multi-service orchestrator
```

### 1.3 Baseline CI/CD Status
- **Workflows Directory**: `.github/workflows/` does **not exist**.
- **Automated Validation**: Zero automated tests or linters run on Git push or PR creation.
- **Image Traceability**: Images are currently pushed with manual semver tags (`1.0.5`, `1.0.6`) without direct association to the Git commit SHA.

---

## 2. Application Architecture & Startup Profile

### 2.1 Backend: `business-service`
- **Runtime**: Python 3.12 (Debian `slim-bookworm` base in Docker).
- **Framework**: FastAPI 0.115, Uvicorn 0.34, SQLAlchemy 2.0 (asyncpg), Alembic 1.14.
- **Startup Command**:
  ```bash
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers --forwarded-allow-ips *
  ```
- **Listening Port**: `8000`.
- **Health Probes**:
  - Liveness: `GET /health` (returns `{"status": "ok"}`).
  - Deep Readiness: `GET /health/ready` (validates database connectivity).
- **Background Processes**:
  - `apscheduler`: Runs asynchronous outbox relay every 5 seconds (`relay_once`).
  - Optional Kafka background consumer/producer for notifications.
- **Database Connection**:
  - Connects to Azure Database for PostgreSQL Flexible Server via `asyncpg`.
  - SSL Mode: Required / `verify-full` bundled with DigiCert Global Root CA.

### 2.2 Frontend: `web-client`
- **Runtime**: Node.js 20 (Alpine base in Docker).
- **Framework**: TanStack Start SSR (React 19, Vite 6, Tailwind CSS v4, Nitro node-server engine).
- **Build Process**:
  ```bash
  npm run build  # Produces Nitro output at .output/server/index.mjs
  ```
- **Startup Command**:
  ```bash
  node .output/server/index.mjs
  ```
- **Listening Port**: `8080`.
- **Health Check**:
  - Readiness: HTTP 200 on `GET /` (or `/login`).
- **Build-Time Dependency**:
  - Requires `VITE_BUSINESS_API_URL` to be baked into the client bundle during build time.

---

## 3. Azure Infrastructure Live Inventory

All resources have been audited directly against the active Azure subscription via Azure CLI:

| Resource Name | Azure Resource Type | Region | SKU / Spec | Active Configuration |
|---|---|---|---|---|
| **`KaizentrixProduction`** | `Microsoft.Resources/subscriptions` | Global | Production (`15374487-4b97-4ad7-bad4-8dd4505ec4a8`) | Tenant: `kaizentrixglobal.com` (`cb612dec-8566-4f0d-ae8a-60635202a1c8`) |
| **`rg-kaizenx-dev`** | `Microsoft.Resources/resourceGroups` | `centralindia` | Standard | Hosting all active container apps, database, and ACR |
| **`kaizenwmsacr`** | `Microsoft.ContainerRegistry/registries` | `centralindia` | Basic | Login Server: `kaizenwmsacr.azurecr.io`<br>Admin User: **Enabled** |
| **`kaizen-wms-env`** | `Microsoft.App/managedEnvironments` | `centralindia` | Consumption | Managed ACA environment with Log Analytics integration |
| **`workspace-rgkaizenxdev2g4U`** | `Microsoft.OperationalInsights/workspaces` | `centralindia` | PerGB2018 | Centralized telemetry & container logs |
| **`kaizen-wms-psql`** | `Microsoft.DBforPostgreSQL/flexibleServers` | `centralindia` | Flexible Server (v16) | FQDN: `kaizen-wms-psql.postgres.database.azure.com`<br>Database: `ams_business`<br>SSL: Enforced |
| **`kaizen-wms-backend`** | `Microsoft.App/containerApps` | `centralindia` | 0.5 vCPU, 1.0 GiB | Ingress: External (Port 8000)<br>FQDN: `kaizen-wms-backend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io`<br>Active Revision: `kaizen-wms-backend--0000009`<br>Image: `kaizenwmsacr.azurecr.io/kaizen-backend:1.0.6` |
| **`kaizen-wms-frontend`** | `Microsoft.App/containerApps` | `centralindia` | 0.5 vCPU, 1.0 GiB | Ingress: External (Port 8080)<br>FQDN: `kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io`<br>Active Revision: `kaizen-wms-frontend--0000005`<br>Image: `kaizenwmsacr.azurecr.io/kaizen-frontend:1.0.6` |

---

## 4. Containerization & Dockerfile Assessment

### 4.1 Backend Dockerfile (`backend/business-service/Dockerfile`)
- **Strengths**:
  - Multi-stage build (`builder` compiles wheels; `runtime` installs only runtime shared libraries).
  - Downloads and bundles official `DigiCertGlobalRootCA.crt.pem` for strict SSL validation.
  - Dedicated unprivileged non-root user `appuser` (UID 10001).
  - Native container `HEALTHCHECK` configured using `curl -f http://localhost:8000/health/ready`.
- **Gaps / Recommendations**:
  - Keep build context tightly scoped to `backend/business-service`.

### 4.2 Frontend Dockerfile (`frontend/Dockerfile`)
- **Strengths**:
  - Multi-stage build (`node:20-alpine` builder; `node:20-alpine` runtime).
  - Unprivileged non-root user `node` (UID 1000).
  - Native container `HEALTHCHECK` configured using `wget -qO- http://127.0.0.1:8080/`.
- **Gaps / Recommendations**:
  - Ensure `.dockerignore` explicitly excludes `.env` and `.env.*` so local developer configurations are never bundled into the Docker context.

---

## 5. Database Migration & Deployment Coordination

### 5.1 Migration Mechanism
- Uses **Alembic** with asynchronous SQLAlchemy.
- Current database schema version: `20261106_hard_delete_docks` (HEAD).
- Database contains 120+ historical migration revisions.

### 5.2 Critical Migration Findings
- **Decoupling Requirement**: The application replicas must **never** run auto-migrations on container startup. Multiple replicas starting concurrently would cause race conditions and transaction deadlocks on the `alembic_version` table.
- **Controlled Migration Stage**: Migrations must be run either in a dedicated CI/CD job prior to updating container images, or triggered via a controlled management script.

---

## 6. Gap Analysis & Proposed CI/CD Roadmap

| Capability | Current State | Required Enterprise State |
|---|---|---|
| **Pull Request Validation** | Non-existent | CI workflow running Ruff/Pytest on backend, ESLint/Vitest on frontend |
| **Container Build Verification** | Ad-hoc local builds | Automated multi-stage Docker build dry-run in GitHub Actions |
| **Image Tagging & Traceability** | Mutable semver tags (`1.0.6`) | Immutable tags combining Git Commit SHA and Release Semver (`${{ github.sha }}`) |
| **Deployment Automation** | Manual CLI commands (`az containerapp update`) | Automated, zero-downtime deployment via GitHub Actions OIDC / Azure Login |
| **Post-Deployment Health Checks** | Manual browser testing | Automated HTTP probe on `/health/ready` and frontend root with automatic rollback on failure |
| **Production Gating** | Open (anyone with local az credentials can push) | Protected GitHub Environment (`production`) with required reviewer approval |

