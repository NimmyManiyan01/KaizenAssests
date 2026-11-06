# Database Migration & Deployment Coordination Strategy

## 1. Overview & Core Philosophy

The Warehouse Management System (WMS) backend uses **PostgreSQL Flexible Server** (`ams_business`) orchestrated via **Alembic**.

In an enterprise cloud environment with horizontal autoscaling (multiple container replicas), schema migrations must be strictly decoupled from application startup:

> **Rule 1**: Application container replicas must **NEVER** run schema-modifying Alembic migrations on startup (`lifespan` or entrypoint).
> **Rule 2**: Schema changes must strictly follow the **Expand / Contract (Two-Phase) Rollout Pattern** to ensure zero-downtime rolling updates.

---

## 2. Decoupled Migration Architecture

```
                  [CI/CD Deployment Pipeline]
                              │
                              ▼
           ┌──────────────────────────────────────┐
           │   Stage 1: Pre-Deployment Schema    │
           │   Check & Migration Gate             │
           │   (Single transient runner)          │
           └──────────────────┬───────────────────┘
                              │ (Alembic Upgrade Head Succeeded)
                              ▼
           ┌──────────────────────────────────────┐
           │   Stage 2: Blue/Green Revision       │
           │   Activation (Azure Container Apps)  │
           └──────────────────┬───────────────────┘
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
       [Active Replicas]             [New Replicas]
       (Old Code Version)            (New Code Version)
               │                             │
               └──────────────┬──────────────┘
                              ▼
                 [Azure PostgreSQL Database]
```

### 2.1 Why Autoscaling Replicas Cannot Run Migrations
1. **Concurrency Race Conditions**: If 2 or more replicas launch simultaneously, each attempts to acquire advisory locks or create tables simultaneously, resulting in `duplicate table`, `deadlock detected`, or corrupt `alembic_version` state.
2. **Startup Latency**: Running migration discovery on every cold start delays container readiness and causes health probes to fail.
3. **Blast Radius Isolation**: Decoupling ensures that if a database migration fails, the running application pods remain untouched and healthy.

---

## 3. The Expand / Contract (Two-Phase) Schema Pattern

To support zero-downtime rolling updates where older and newer application revisions temporarily coexist:

### Phase 1: Expand (Additive Changes)
- **Add Columns**: All new columns must be `NULLABLE` or have a database-level `SERVER_DEFAULT`.
- **Add Tables**: New tables can be added safely.
- **Add Indexes**: Use `CONCURRENTLY` where appropriate.
- **Compatibility**: Both old application replicas and new replicas function simultaneously without error.

### Phase 2: Deploy Application
- Deploy new application code that begins reading and writing the new columns/tables.

### Phase 3: Contract (Cleanup - Future Release)
- After the new application code is confirmed stable across all environments, backfill legacy rows and apply `NOT NULL` constraints or drop deprecated columns in a subsequent release.

---

## 4. Pipeline Migration Execution Pattern

In the CD pipeline (`deploy.yml`):
1. **Migration Verification**:
   The deployment workflow inspects whether any unapplied Alembic migrations exist:
   ```bash
   alembic check || alembic current
   ```
2. **Execution Gate**:
   A dedicated, isolated step connects to Azure PostgreSQL with secure TLS and runs:
   ```bash
   alembic upgrade head
   ```
3. **Post-Migration Health**:
   The pipeline verifies that the database version matches the expected migration revision before proceeding to container revision updates.

---

## 5. Rollback & Disaster Recovery Rules

1. **Reverting Application != Reverting Database**: Reverting a Container App revision to a previous known-good image will **NOT** roll back the database schema.
2. **Backward-Compatible Schema Preservation**: Because all migrations follow the **Expand** rule, the previous application code revision can safely run against the newly migrated schema.
3. **No Automatic Down-Migrations**: Automatic `alembic downgrade` is **STRICTLY PROHIBITED** in automated rollback scripts. Destructive schema rollbacks (dropping tables or columns) risk permanent data loss and must require manual Database Administrator review.
