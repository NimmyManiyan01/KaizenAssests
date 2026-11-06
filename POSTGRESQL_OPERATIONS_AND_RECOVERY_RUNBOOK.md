# PostgreSQL Operations and Recovery Runbook

## 1. Scope & Purpose

This operational runbook governs standard day-2 database operations, migration deployment procedures, health monitoring, and disaster recovery for the Kaizen Warehouse Management System (`ams-wms-business-service`) running on **Microsoft Azure Database for PostgreSQL Flexible Server**.

---

## 2. Standard Migration Deployment Procedure

### 2.1 The Cardinal Rule of Production Migrations
> [!IMPORTANT]
> **Never run database migrations from multiple autoscaling application pods simultaneously.** Migrations must be executed from a dedicated single-instance runner (such as a GitHub Actions CD deployment job or an Azure Container App Job) before new application revisions receive traffic.

### 2.2 Executing Migrations Manually
When executing or validating migrations manually from an authorized bastion or developer environment:

```bash
# 1. Navigate to the service root
cd backend/business-service

# 2. Check current database revision status
python -m alembic current

# 3. Check pending heads
python -m alembic heads

# 4. Execute migrations forward to head
python -m alembic upgrade head

# 5. Verify successful update
python -m alembic current
```

---

## 3. Azure Point-in-Time Restore (PITR) Runbook

In the event of accidental data corruption or an operational incident:

### Step 1: Capture Incident Timestamp & Coordinates
- Resource Group: `rg-kaizenx-dev`
- Source Server: `kaizen-wms-psql`
- Target Restore Time: Specific UTC timestamp prior to incident (e.g. `2026-11-06T21:00:00Z`).

### Step 2: Trigger Point-in-Time Restore via Azure CLI
Azure Flexible Server does not overwrite the source server in-place; it provisions a point-in-time clone to ensure zero secondary data loss.

```bash
az postgres flexible-server restore \
  --resource-group rg-kaizenx-dev \
  --name kaizen-wms-psql-restored \
  --source-server kaizen-wms-psql \
  --restore-time "2026-11-06T21:00:00Z"
```

### Step 3: Validate Restored Database & Switch Connection String
1. Connect to `kaizen-wms-psql-restored.postgres.database.azure.com` and verify record integrity.
2. Update the `DATABASE_URL` secret on Azure Container App `kaizen-wms-backend`.
3. Restart backend pods to route traffic to the restored instance.

---

## 4. Connection Pool & Performance Tuning

### 4.1 Pool Configuration Baseline
- **Pool Size**: `10`
- **Max Overflow**: `20` (Total maximum connections per pod: 30)
- **Pool Recycle**: `1800` seconds (Prevents TCP keepalive drops through Azure load balancers)
- **Pre-Ping**: `True` (Discards broken connections before checkout)

### 4.2 Sizing Guidelines
If autoscaling backend container apps up to $N$ replicas:
$$\text{Max Azure PG Connections} \ge N \times (\text{Pool Size} + \text{Max Overflow}) + 20 \text{ (Admin reserve)}$$
For 3 backend replicas:
$$3 \times (10 + 20) + 20 = 110 \text{ connections}$$
Ensure the Azure Flexible Server `max_connections` parameter is configured to at least **200**.

---

## 5. Troubleshooting & Health Diagnostics

### 5.1 Querying Active Connections and Locks
```sql
SELECT pid, usename, client_addr, state, query_start, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state != 'idle' AND pid <> pg_backend_pid()
ORDER BY duration DESC;
```

### 5.2 Identifying Blocking Locks
```sql
SELECT 
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_statement,
    blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

