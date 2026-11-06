# Deployment Rollback, Health Probes & Disaster Recovery

## 1. Overview & Objectives

In production systems, deployment failures (e.g. configuration errors, unhandled startup exceptions, broken dependencies) must be caught automatically and mitigated within minutes to maintain 99.9% application availability.

This document defines:
1. Automated deployment health-check criteria.
2. Automated rollback procedures triggered upon deployment health failure.
3. Manual rollback procedures for operational teams.
4. Post-incident root cause analysis guidelines.

---

## 2. Health Check Criteria & Probing Strategy

A deployment is considered successful **only** when both container workloads satisfy their operational readiness probes:

```
[Deploy Container App Revision]
               │
               ▼
   [Wait for ACA Provisioning] (Status: Succeeded, Running)
               │
               ▼
   [Automated Readiness Smoke Probes]
   ├─ Probe 1: Backend /health/ready (HTTP 200 within 60s)
   ├─ Probe 2: Frontend /login (HTTP 200 within 60s)
   └─ Probe 3: CORS & Ingress Connectivity
               │
      ┌────────┴────────┐
      ▼ (Pass)          ▼ (Fail)
 [Deployment Succeeded] [Automated Rollback Triggered]
```

### 2.1 Backend Health Endpoint (`/health/ready`)
- **URL**: `https://kaizen-wms-backend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io/health/ready`
- **Expected Status**: `HTTP 200 OK`
- **Verification Payload**:
  ```json
  {"status": "ready", "database": "connected"}
  ```
- **Failure Conditions**:
  - HTTP 500/503 (Database unreachable, connection pool exhausted, or schema mismatch).
  - TCP Connection Timeout / Ingress 502 Bad Gateway.

### 2.2 Frontend Health Endpoint (`/login`)
- **URL**: `https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io/login`
- **Expected Status**: `HTTP 200 OK`
- **Failure Conditions**:
  - SSR rendering crash (Node runtime error).
  - Ingress 502/503.

---

## 3. Automated Rollback Safeguard in CI/CD

In the GitHub Actions deployment workflow (`deploy.yml`):

1. **Capture Previous State**:
   Before updating any container, the workflow queries and records the active revision and image tag:
   ```bash
   PREV_BACKEND_IMAGE=$(az containerapp show -n kaizen-wms-backend -g rg-kaizenx-dev --query "properties.template.containers[0].image" -o tsv)
   PREV_FRONTEND_IMAGE=$(az containerapp show -n kaizen-wms-frontend -g rg-kaizenx-dev --query "properties.template.containers[0].image" -o tsv)
   ```
2. **Execute Deployment**:
   The workflow updates the apps to the newly built immutable commit SHA tags.
3. **Execute Readiness Loop**:
   Polls the health endpoints every 10 seconds for up to 3 minutes.
4. **Trigger Automatic Rollback if Health Probes Fail**:
   If the health check fails, the workflow automatically runs:
   ```bash
   echo "CRITICAL: Health check failed! Rolling back to previous images..."
   az containerapp update -n kaizen-wms-backend -g rg-kaizenx-dev --image $PREV_BACKEND_IMAGE
   az containerapp update -n kaizen-wms-frontend -g rg-kaizenx-dev --image $PREV_FRONTEND_IMAGE
   exit 1
   ```

---

## 4. Manual Emergency Rollback Runbook

If an issue is discovered after deployment passes initial health checks (e.g. subtle business logic flaw):

### Scenario A: Roll Back via Azure CLI
```bash
# 1. Inspect recent revisions
az containerapp revision list -n kaizen-wms-backend -g rg-kaizenx-dev -o table
az containerapp revision list -n kaizen-wms-frontend -g rg-kaizenx-dev -o table

# 2. Re-deploy the known-good image tag
az containerapp update -n kaizen-wms-backend -g rg-kaizenx-dev \
  --image kaizenwmsacr.azurecr.io/kaizen-backend:sha-<PREVIOUS_GOOD_SHA>

az containerapp update -n kaizen-wms-frontend -g rg-kaizenx-dev \
  --image kaizenwmsacr.azurecr.io/kaizen-frontend:sha-<PREVIOUS_GOOD_SHA>
```

### Scenario B: Roll Back via GitHub Actions
1. Navigate to **Actions** -> **Deploy to Azure Production**.
2. Click **Run workflow**.
3. In the branch/ref selector, select the previous stable commit or tag.
4. Click **Run workflow** to redeploy the verified stable build.

---

## 5. Post-Incident Review Checklist

When a rollback occurs:
- [ ] Export container console logs via Log Analytics / Azure Portal (`ContainerAppConsoleLogs_CL`).
- [ ] Record the failing Git commit SHA and the previous stable commit SHA.
- [ ] Verify that database integrity remains intact and no corrupted records exist.
- [ ] Create a reproducible test case in `frontend/tests/e2e/` or backend `tests/`.
- [ ] File a high-priority incident issue before attempting redeployment.

