# Continuous Integration & Continuous Deployment (CI/CD) Operations Runbook

## 1. Quick Reference: Operational Workflows

### 1.1 Triggering Continuous Integration (CI)
- **Automatic**: Every Pull Request opened against `main`, or any commit pushed to `main`, `feature/**`, `fix/**`, or `chore/**`.
- **View Results**: GitHub Repository -> **Actions** -> **Kaizen WMS Continuous Integration (CI)**.
- **Rules**: Pull requests cannot be merged if any check (`backend-ci`, `frontend-ci`, `docker-dry-run`) fails.

### 1.2 Deploying to Production (CD)
- **Automatic**: When an approved pull request is merged into `main`.
- **Manual Trigger**:
  1. Go to **Actions** -> **Deploy to Azure Production (CD)**.
  2. Click **Run workflow**.
  3. Select branch: `main`.
  4. Select environment: `production`.
  5. Click **Run workflow**.

---

## 2. Identifying Currently Deployed Commit & Images

### Via GitHub Actions
1. Navigate to **Actions** -> **Deploy to Azure Production (CD)** -> Select the latest green run.
2. Click on the job **Build, Publish & Deploy to Azure**.
3. View the **Deployment Summary** section at the bottom. It displays:
   - Git Commit SHA
   - Backend Image & Digest
   - Frontend Image & Digest

### Via Azure CLI
```bash
# Check Backend Image & Active Revision
az containerapp show \
  --name kaizen-wms-backend \
  --resource-group rg-kaizenx-dev \
  --query "{revision:properties.latestReadyRevisionName, image:properties.template.containers[0].image}" -o json

# Check Frontend Image & Active Revision
az containerapp show \
  --name kaizen-wms-frontend \
  --resource-group rg-kaizenx-dev \
  --query "{revision:properties.latestReadyRevisionName, image:properties.template.containers[0].image}" -o json
```

---

## 3. Investigating Logs & Troubleshooting

### 3.1 Viewing Live Container Logs (Azure CLI)
```bash
# Stream live backend container logs
az containerapp logs show \
  --name kaizen-wms-backend \
  --resource-group rg-kaizenx-dev \
  --tail 100 --follow

# Stream live frontend container logs
az containerapp logs show \
  --name kaizen-wms-frontend \
  --resource-group rg-kaizenx-dev \
  --tail 100 --follow
```

### 3.2 Querying Log Analytics (Kusto / KQL)
In the Azure Portal -> Log Analytics Workspace (`workspace-rgkaizenxdev2g4U`):
```kusto
// Find recent backend errors
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "kaizen-wms-backend"
| where Log_s has "ERROR" or Log_s has "Exception"
| project TimeGenerated, Log_s
| order by TimeGenerated desc
| take 100
```

---

## 4. Emergency Rollback Procedures

### Scenario: The deployment succeeded in GitHub Actions, but an unexpected bug was discovered.

#### Option 1: Redeploy the Previous Commit via GitHub Actions (Recommended)
1. In GitHub, go to **Actions** -> **Deploy to Azure Production (CD)**.
2. Click **Run workflow**.
3. In the branch/commit input, enter the Git Commit SHA of the previous known-good commit.
4. Click **Run workflow**.

#### Option 2: Immediate One-Line Azure CLI Rollback
```bash
# Revert backend to previous verified image tag
az containerapp update \
  --name kaizen-wms-backend \
  --resource-group rg-kaizenx-dev \
  --image kaizenwmsacr.azurecr.io/kaizen-backend:sha-<PREVIOUS_SHA>

# Revert frontend to previous verified image tag
az containerapp update \
  --name kaizen-wms-frontend \
  --resource-group rg-kaizenx-dev \
  --image kaizenwmsacr.azurecr.io/kaizen-frontend:sha-<PREVIOUS_SHA>
```

---

## 5. Routine Maintenance: Database Migrations

When a feature includes database schema changes:
1. Ensure the migration follows the **Expand / Contract** pattern (additive, nullable or with server defaults).
2. Create the Alembic revision in `backend/business-service/alembic/versions/`.
3. Apply migrations to Azure PostgreSQL Flexible Server prior to activating code that depends on the new schema:
   ```bash
   python -m alembic upgrade head
   ```
4. Never execute `alembic downgrade` against production without explicit Database Administrator approval and full database snapshot backup.
