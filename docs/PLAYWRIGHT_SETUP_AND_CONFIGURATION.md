# Playwright Setup and Configuration Guide

## 1. Executive Summary
This document establishes the enterprise-grade automated testing configuration implemented for **KaizenAssets (AMS/WMS)**. The test automation framework uses Playwright with TypeScript to perform comprehensive end-to-end, security, and performance testing against the deployed Azure Container Apps environment and local development environments.

---

## 2. Environment & System Architecture
| Component | Specification | Notes |
| :--- | :--- | :--- |
| **Operating System** | Windows 11 Enterprise | Host environment |
| **Node.js Runtime** | Node.js `v22.11.0` / npm `v10.9.0` | Frontend execution engine |
| **Python Runtime** | Python `3.12.7` / uv | Backend execution engine |
| **Playwright Version** | `@playwright/test@1.64.1` | Native browser automation harness |
| **Frontend Framework** | React 19 + TanStack Start (SSR) + Nitro | Port 8080 |
| **Backend Framework** | FastAPI + AsyncPG + SQLAlchemy 2.0 | Port 8000 |
| **Database** | Azure Database for PostgreSQL Flexible Server | `ams_business` (Central India) |
| **Cloud Deployment** | Azure Container Apps (`kaizen-wms-env`) | Managed environment |

---

## 3. Browser Binaries & Engine Dependencies
Playwright browser engines and native OS dependencies were installed and verified in `C:\Users\Admin\AppData\Local\ms-playwright`:
- **Chromium for Testing**: `156.0.8078.4` (Revision `v1248`)
- **Chrome Headless Shell**: `156.0.8078.4` (Revision `v1248`)
- **FFmpeg Engine**: Revision `v1013` (used for automated high-fidelity video recording)
- **Winldd**: Revision `v1007` (Windows dynamic dependency validator)
- **System Google Chrome**: `156.0.8078.81` (`C:\Program Files\Google\Chrome\Application\chrome.exe`)

---

## 4. Configuration Architecture (`frontend/playwright.config.ts`)
The configuration targets the live Azure production environment by default, with complete environment variable overrides for local or staging environments.

```typescript
import { defineConfig, devices } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: APP_URL,
    headless: true,
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 },
      },
    },
  ],
});
```

---

## 5. Artifact & Evidence Collection
- **Failure Screenshots**: Automatically captured upon any assertion or navigation failure (`test-results/**/*.png`).
- **Video Capture**: Retained on failure (`test-results/**/*.webm`) for visual post-mortem analysis.
- **Deep Execution Traces**: Zip-compressed Playwright traces containing network call cascades, DOM snapshots, and console outputs (`trace.zip`), inspectable via `npx playwright show-trace <path>`.
- **HTML & JSON Reports**: Generated at `frontend/playwright-report/` and `frontend/test-results/results.json`.

---

## 6. Execution Command Reference
| Goal | Command | Description |
| :--- | :--- | :--- |
| Run all E2E tests against Azure | `cd frontend; npx.cmd playwright test` | Executes full automated test suite |
| Run specific module tests | `cd frontend; npx.cmd playwright test tests/e2e/01-auth.spec.ts` | Target single module |
| Run with live visual UI | `cd frontend; npx.cmd playwright test --ui` | Interactive debugging console |
| Open generated HTML test report | `cd frontend; npx.cmd playwright show-report` | View full execution trace and videos |
| Target Local Dev Environment | `$env:APP_URL="http://localhost:8080"; npx.cmd playwright test` | Run against local container/server |

---

## 7. Verification Checkpoint
- **Playwright CLI & Core Modules**: Verified OK (`@playwright/test@1.64.1`).
- **Browser Launch Test**: Verified OK (`Chromium 156.0.8078.4` launched and exited with code 0).
- **Live Azure Preflight Check**: Verified OK (`https://kaizen-wms-frontend...` and `https://kaizen-wms-backend...` responding with HTTP 200).

