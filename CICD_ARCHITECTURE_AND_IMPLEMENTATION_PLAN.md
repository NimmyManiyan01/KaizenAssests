# Continuous Integration & Continuous Deployment (CI/CD) Architecture & Implementation Plan

## 1. Architectural Principles & Overview

The Kaizen WMS CI/CD pipeline establishes an automated, secure, traceable, and repeatable delivery lifecycle between GitHub and Microsoft Azure.

```
       [Developer Push / PR]
                 │
                 ▼
    ┌─────────────────────────┐
    │     GitHub Actions      │
    │     Continuous Int.     │
    │  (Lint, Test, Validate) │
    └────────────┬────────────┘
                 │ (Pass)
                 ▼
    ┌─────────────────────────┐
    │     Production Gate     │
    │  (GitHub Environment)   │
    └────────────┬────────────┘
                 │ (Approved)
                 ▼
    ┌─────────────────────────┐
    │       Build & Tag       │
    │    (Immutable SHA)      │
    └────────────┬────────────┘
                 │
                 ▼
    ┌─────────────────────────┐
    │  Azure Container Reg.   │
    │   (`kaizenwmsacr.io`)   │
    └────────────┬────────────┘
                 │
                 ▼
    ┌─────────────────────────┐
    │  Azure Container Apps   │
    │ (Zero-Downtime Rollout) │
    └────────────┬────────────┘
                 │
                 ▼
    ┌─────────────────────────┐
    │   Health Smoke Tests    │
    │  (Rollback if Unhealthy)│
    └─────────────────────────┘
```

---

## 2. Pipeline Decomposition: CI vs. CD

### 2.1 Continuous Integration (`ci.yml`)
- **Triggers**:
  - Any pull request targeting `main`.
  - Any push to feature branches or `main`.
- **Concurrency**:
  - `group: ci-${{ github.ref }}`, `cancel-in-progress: true` (saves compute when rapid commits are pushed).
- **Parallel Jobs**:
  1. **`backend-lint-and-test`**:
     - Environment: `ubuntu-latest`, Python `3.12`.
     - Dependency cache: `pip` / `uv` cache.
     - Linter: `ruff check backend/business-service`.
     - Python byte-compilation: `python -m compileall backend/business-service`.
     - Unit tests: `pytest` with in-memory SQLite / mock DB.
  2. **`frontend-lint-and-test`**:
     - Environment: `ubuntu-latest`, Node.js `20`.
     - Dependency cache: `~/.npm`.
     - Static checks: `npm run lint` and TypeScript check.
     - Unit tests: `npm run test` (Vitest).
  3. **`container-build-verification`**:
     - Validates that both `backend/business-service/Dockerfile` and `frontend/Dockerfile` compile cleanly without pushing to the registry.

---

### 2.2 Continuous Deployment (`deploy.yml`)
- **Triggers**:
  - Merged push to `main` branch.
  - Manual trigger via `workflow_dispatch` (with optional environment selection).
- **Concurrency**:
  - `group: cd-production`, `cancel-in-progress: false` (prevents overlapping deployments from corrupting state).
- **Deployment Stages**:
  1. **Validation & Preflight**:
     - Ensures all required Azure credentials and secrets are present.
     - Verifies Git commit SHA and tags.
  2. **Image Build & Publish (Immutable Traceability)**:
     - Builds Docker images with immutable Git commit SHA:
       - `kaizenwmsacr.azurecr.io/kaizen-backend:sha-${{ github.sha }}`
       - `kaizenwmsacr.azurecr.io/kaizen-frontend:sha-${{ github.sha }}`
     - Also tags with release timestamp/semver for human readability.
     - Captures and records the exact **Image Digest** (`sha256:...`).
  3. **Database Migration Verification Gate**:
     - Coordinates database migration verification against Azure PostgreSQL before updating application containers.
  4. **Azure Container Apps Deployment**:
     - Deploys `kaizen-wms-backend` to the new image tag.
     - Deploys `kaizen-wms-frontend` to the new image tag.
     - Azure Container Apps automatically spins up the new revision and executes health probes.
  5. **Post-Deployment Smoke Verification**:
     - Automated probe checks `/health/ready` on the backend.
     - Automated probe checks HTTP 200 on frontend `/login`.
  6. **Automated Rollback Safeguard**:
     - If the new revision fails health checks, the workflow immediately triggers a rollback to the previous healthy revision and alerts the team.

---

## 3. Traceability Matrix

Every single production artifact is traceable across the entire lifecycle:

```
Git Commit SHA (e.g. 24b68bd)
   ↓
GitHub Actions Run ID (e.g. 11849204)
   ↓
Container Image Tag (`kaizenwmsacr.azurecr.io/kaizen-backend:sha-24b68bd`)
   ↓
Container Registry Digest (`sha256:210f61f8a7...`)
   ↓
Azure Container App Revision (`kaizen-wms-backend--0000009`)
   ↓
Runtime Audit Log & Deployment Summary
```

---

## 4. Implementation Phasing Plan

| Step | Action Item | Target File / Resource | Verification Criteria |
|---|---|---|---|
| **Step 1** | Security & Identity Architecture | `CICD_SECURITY_AND_IDENTITY_DESIGN.md` | Least-privilege Azure RBAC & GitHub secret map |
| **Step 2** | Database Migration Strategy | `CICD_DATABASE_MIGRATION_DEPLOYMENT_STRATEGY.md` | Decoupled migration pattern |
| **Step 3** | Rollback & Recovery Specification | `CICD_DEPLOYMENT_ROLLBACK_AND_RECOVERY.md` | Tested rollback procedures |
| **Step 4** | Implement CI Workflow | `.github/workflows/ci.yml` | Passes YAML lint & runs on test push |
| **Step 5** | Implement CD Workflow | `.github/workflows/deploy.yml` | Deploys with commit SHA tags and smoke checks |
| **Step 6** | Hardening & Dockerfile Optimization | `.dockerignore` files | Excludes `.env`, `.git`, test artifacts |
| **Step 7** | End-to-End Validation | `CICD_PIPELINE_VALIDATION_AND_TEST_REPORT.md` | Verification of full pipeline execution |
| **Step 8** | Operational Runbook | `CICD_OPERATIONS_RUNBOOK.md` | Complete troubleshooting & operations guide |

