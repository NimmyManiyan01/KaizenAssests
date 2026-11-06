# Continuous Integration & Continuous Deployment (CI/CD) Security & Identity Design

## 1. Authentication Strategy: GitHub Actions to Microsoft Azure

Securing the boundary between GitHub Actions and Microsoft Azure is paramount. We support two enterprise-grade authentication pathways:

1. **Pathway A (Recommended / Preferred): Microsoft Entra ID Workload Identity Federation (OIDC)**
   - **Zero Secrets**: No static passwords or client secrets are stored in GitHub Secrets.
   - **Short-Lived Tokens**: Azure issues temporary, federated tokens (lifetime: ~1 hour) specifically scoped to the GitHub repository and branch.
2. **Pathway B (Universal Compatibility): Least-Privilege Azure Service Principal (`AZURE_CREDENTIALS`)**
   - Fallback when the organization's Entra ID administrator has restricted application federation.
   - Restricted strictly to Resource Group `rg-kaizenx-dev` with `Contributor` on Container Apps and `AcrPush` on `kaizenwmsacr`.

---

## 2. Workload Identity Federation (OIDC) Architecture

```
GitHub Actions Runner
        │
        ├─ 1. Requests OIDC token with repo claims (iss: https://token.actions.githubusercontent.com)
        ▼
GitHub OIDC Provider
        │
        ├─ 2. Returns signed JWT token
        ▼
Azure Entra ID
        │
        ├─ 3. Validates subject identifier: `repo:Vardhan158/KaizenAssests:ref:refs/heads/main`
        ├─ 4. Exchanges JWT for short-lived Azure Access Token
        ▼
Azure Resource Manager (ARM)
        │
        └─ 5. Authenticates deployment commands scoped to `rg-kaizenx-dev`
```

### 2.1 Configured OIDC Federated Credentials (Provisioned)
- **App Registration Display Name**: `kaizen-github-actions-sp`
- **Application (Client) ID**: `e242f246-fd44-4ca8-a2c5-d968ea003d84`
- **Object ID**: `98d6b0f3-f7e7-43b9-a750-d6964d70eca6`
- **Directory (Tenant) ID**: `cb612dec-8566-4f0d-ae8a-60635202a1c8`
- **Subscription ID**: `15374487-4b97-4ad7-bad4-8dd4505ec4a8`
- **Issuer**: `https://token.actions.githubusercontent.com`
- **Audiences**: `api://AzureADTokenExchange`
- **Configured Subjects**:
  1. `repo:Vardhan158/KaizenAssests:ref:refs/heads/main`
  2. `repo:Vardhan158/KaizenAssests:environment:production`
  3. `repo:Vardhan158/KaizenAssests:pull_request`
  4. `repo:NimmyManiyan01/KaizenAssests:ref:refs/heads/main`
  5. `repo:NimmyManiyan01/KaizenAssests:environment:production`
  6. `repo:NimmyManiyan01/KaizenAssests:pull_request`

---

## 3. Least-Privilege Role-Based Access Control (RBAC)

The deployment identity is strictly limited to the operational boundary of the application:

| Scope | Role | Purpose |
|---|---|---|
| `/subscriptions/.../resourceGroups/rg-kaizenx-dev/providers/Microsoft.ContainerRegistry/registries/kaizenwmsacr` | **`AcrPush`** | Allows building, pushing, and tagging container images. Cannot delete the registry or modify firewall rules. |
| `/subscriptions/.../resourceGroups/rg-kaizenx-dev/providers/Microsoft.App/containerApps/kaizen-wms-backend` | **`Azure ContainerApps Contributor`** | Allows updating container images and revision settings. |
| `/subscriptions/.../resourceGroups/rg-kaizenx-dev/providers/Microsoft.App/containerApps/kaizen-wms-frontend` | **`Azure ContainerApps Contributor`** | Allows updating container images and revision settings. |
| `/subscriptions/.../resourceGroups/rg-kaizenx-dev/providers/Microsoft.DBforPostgreSQL/flexibleServers/kaizen-wms-psql` | **No RBAC Granted** | The CI/CD pipeline does not possess direct administrative control over the PostgreSQL server infrastructure. |

---

## 4. GitHub Secrets & Variables Configuration Map

The following secrets and environment variables must be configured in GitHub (Repository Settings -> Secrets and Variables -> Actions):

### 4.1 Secrets (`${{ secrets.* }}`)
| Secret Name | Required By | Description | Example / Source |
|---|---|---|---|
| `AZURE_CLIENT_ID` | OIDC / Login | Entra ID App Registration Client ID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `AZURE_TENANT_ID` | OIDC / Login | Entra ID Directory Tenant ID | `cb612dec-8566-4f0d-ae8a-60635202a1c8` |
| `AZURE_SUBSCRIPTION_ID` | OIDC / Login | Azure Subscription ID | `15374487-4b97-4ad7-bad4-8dd4505ec4a8` |
| `AZURE_CREDENTIALS` | Service Principal (Optional) | Full JSON auth block (if not using OIDC) | `{"clientId": "...", "clientSecret": "...", ...}` |
| `ACR_USERNAME` | ACR Login | Container registry admin/push username | `kaizenwmsacr` |
| `ACR_PASSWORD` | ACR Login | Container registry password/token | Stored securely in Key Vault / ACR Keys |

### 4.2 Variables (`${{ vars.* }}`)
| Variable Name | Description | Verified Value |
|---|---|---|
| `AZURE_RESOURCE_GROUP` | Target Azure resource group | `rg-kaizenx-dev` |
| `AZURE_ACR_NAME` | Name of the Azure Container Registry | `kaizenwmsacr` |
| `BACKEND_APP_NAME` | Backend Container App name | `kaizen-wms-backend` |
| `FRONTEND_APP_NAME` | Frontend Container App name | `kaizen-wms-frontend` |
| `VITE_BUSINESS_API_URL` | Production Backend URL baked into Vite build | `https://kaizen-wms-backend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io` |

---

## 5. Security Gates & Anti-Leakage Controls

1. **Masking in Logs**: GitHub Actions automatically masks all secrets configured in the repository.
2. **`.dockerignore` Protection**: `.env`, `.env.*`, and `.git` are strictly excluded from Docker build contexts to prevent accidental baking of local secrets into images.
3. **No Dynamic Code Ingestion**: Workflows run pinned, immutable action versions (e.g. `actions/checkout@v4`, `azure/login@v2`).
4. **Isolated Runner Permissions**: Workflow permissions are declared explicitly at the top of each workflow file:
   ```yaml
   permissions:
     id-token: write   # Required for requesting the OIDC JWT token
     contents: read    # Read-only access to repository code
   ```

