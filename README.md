# KaizenAssests — End-to-End Project Flow

KaizenAssests is a warehouse and manufacturing operations platform. It contains a React Native mobile client and a FastAPI business backend. The backend exposes operational APIs, persists warehouse transactions, and publishes asynchronous events through Kafka.

## 1. Repository overview

```text
KaizenAssests/
├── kaizenX/                         React Native mobile application
│   ├── App.tsx                      App state and screen navigation
│   └── src/
│       ├── screens/                 Login, gate entry, vehicles, assembly, profile
│       ├── components/              Reusable UI components
│       └── services/api.ts          HTTP client and backend API methods
└── backend/
    ├── docker-compose.yml           Local infrastructure and services
    ├── business-service/            FastAPI WMS/AMS business service
    │   ├── app/main.py              Application, routers, lifecycle
    │   ├── app/modules/              Domain modules and APIs
    │   ├── app/database/             Async SQLAlchemy database setup
    │   ├── app/security/             Login, JWT and role checks
    │   ├── app/events/               Transactional outbox
    │   ├── app/kafka/                Kafka wrappers
    │   ├── app/workers/               Outbox relay and notification consumer
    │   └── alembic/                  Database migrations
    ├── common/                       Shared Java code
    └── auth-service/                 Java authentication service when present
```

## 2. Runtime architecture

```text
React Native app (kaizenX)
        │ HTTP/JSON
        ▼
FastAPI business-service :8000
        │
        ├── JWT/RBAC validation and request middleware
        ├── Router → application use case → domain rules
        ├── Async SQLAlchemy transaction → business PostgreSQL
        └── Transactional outbox row
                         │
                         ▼
                 Outbox relay → Kafka
                                      │
                                      ▼
                          Notification consumer / downstream work

Java auth-service :8080 ── tokens and JWKS ──► FastAPI security layer
Redis ── cache/queue support       OCR/ANPR services ──► gate workflows
```

## 3. Startup flow

1. Start Docker Desktop and run the backend stack from `backend/`. This provides auth-db, business-db, Redis, Kafka, the Java auth service, and the containerized business service.
2. The business service loads settings from its environment and `.env` file.
3. `app.main` creates FastAPI, CORS, request-context middleware, exception handling, health endpoints, and all module routers.
4. During lifespan startup, the service starts Kafka, schedules the outbox relay, and starts the notification consumer when normal runtime mode is enabled.
5. Run Metro from `kaizenX/`, then build the Android or iOS app. The mobile app uses the configured backend URL.

## 4. Mobile application flow

The root component is `kaizenX/App.tsx`.

1. **Boot:** `SplashScreen` runs first and returns any existing session.
2. **Authentication:** without a user, `LoginScreen` calls `POST /api/v1/auth/login` through `mobileApi.loginStaff`.
3. **Home:** after login, the app shows `HomeScreen` with HOME, SCAN, ASSEMBLY, VEHICLES, and PROFILE tabs.
4. **API request:** screen code calls `src/services/api.ts`. `mobileRequest` builds URLs, serializes JSON, applies a timeout, parses errors, and returns JSON.
5. **Gate entry:** the operator scans/selects a PO or ASN, submits vehicle and delivery data, then sees `GateEntrySuccessScreen`; history is available in `RecentEntriesScreen`.
6. **Assembly:** `AssemblyScreen` reads dashboards/orders/operations and updates order status, steps, and progress through `/api/v1/assembly/...`.
7. **Logout:** local session and navigation state are cleared.

The API client covers health, authentication, gate entries, ASN/delivery lookup, purchase orders, docks, notifications, assembly, and warehouse/inventory endpoints. Swagger at `/docs` is the source of truth for the full API contract.

## 5. Backend request flow

1. The mobile client sends an HTTP request to port 8000.
2. Middleware adds request context and translates exceptions into API errors.
3. Security dependencies validate the bearer JWT/JWKS and required role/permission.
4. `app.main` dispatches the request to a module router.
5. The router validates input with Pydantic and calls an application use case/service.
6. The use case invokes framework-independent domain entities and rules.
7. The persistence repository uses an async SQLAlchemy session. Success commits; failures roll back.
8. Integration events are stored in the outbox in the same transaction.
9. The API returns the result and the mobile app updates its screen.

Active router areas include gate entry, receiving/GRN, returns, warehouse docks, storage/putaway, inventory, notifications, assembly, dispatch, customer orders, procurement, materials, stores/zones/bins, quarantine, and authentication.

## 6. Main warehouse business flow

```text
Purchase order / ASN
        ▼
Gate arrival and vehicle identification
        ▼
Gate entry creation and dock allocation
        ▼
Dock arrival and unloading
        ▼
Quality inspection
        ├── accepted → GRN posting → putaway task → bin/location stock
        ├── rejected → quarantine / disposition / return workflow
        └── damaged → damage claim and notification workflow
        ▼
Inventory and stock ledger updates
        ▼
Material requests / assembly consumption / dispatch
```

### Gate entry

The operator authenticates, looks up an expected delivery or ASN, scans/enters vehicle information, and submits a gate entry. Gate services can use OCR/ANPR and file storage integrations. The backend validates and stores the entry and exposes its status for history and dashboards.

### Dock and receiving

Warehouse users allocate a dock to the gate entry. Arrival and unloading update operational state. Receiving validates PO/ASN and quantities, then creates a GRN/receipt. Quality inspection separates accepted, rejected, held, or damaged quantities.

### Storage and inventory

Accepted material becomes eligible for putaway. Storage services assign a location/bin, record handling-unit or QR information where applicable, and update inventory and the stock ledger. Pickup, issue, reservation, and assembly requisition operations later move or consume stock.

### Assembly and dispatch

Assembly APIs expose production orders, operations, steps, and progress. Material reservations and consumption connect stock to production. Dispatch APIs manage finished-goods requests, pickup/gate-exit information, and outbound movement.

## 7. Asynchronous event flow

The backend uses the outbox pattern:

1. A business transaction writes business data and an outbox event in one database transaction.
2. `app.workers.outbox_relay` periodically reads unpublished rows.
3. The Kafka producer publishes each event to its configured topic.
4. Successful events are marked published; failures remain available for retry.
5. `app.workers.notification_consumer` consumes relevant events and records notification/operational updates.

This prevents a database commit from succeeding while its corresponding integration event is lost.

## 8. Data and migrations

- **Business database:** PostgreSQL, normally exposed locally on port 5433 and reached through `DATABASE_URL`.
- **Auth database:** PostgreSQL used by the Java auth service.
- **Redis:** cache and queue-support service.
- **Alembic:** migrations under `backend/business-service/alembic/versions/`.
- **Local database:** `backend/business-service/wms.db` may exist for local/test compatibility; Docker is configured for PostgreSQL.

Use Alembic for permanent schema changes. Development compatibility checks in the application help older local schemas but should not replace a migration.

## 9. Local development

### Start infrastructure

```powershell
cd D:\KaizenAssests\backend
docker compose up -d
```

### Run the backend locally

```powershell
cd D:\KaizenAssests\backend\business-service
uv sync
Copy-Item .env.example .env       # only if .env does not already exist
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Useful URLs:

- API: `http://localhost:8000`
- Swagger UI: `http://localhost:8000/docs`
- Health: `http://localhost:8000/health`
- Readiness: `http://localhost:8000/health/ready`

### Run the mobile app

```powershell
cd D:\KaizenAssests\kaizenX
npm install
npm start
```

In another terminal:

```powershell
npm run android
# or
npm run ios
```

For a physical device, the app must reach the development machine over the network. Configure the address using `setServerBaseUrl` or update the development default in `kaizenX/src/services/api.ts`.

## 10. Testing and troubleshooting

Backend tests are under `backend/business-service/tests`:

```powershell
cd D:\KaizenAssests\backend\business-service
uv run pytest
```

Mobile tests are under `kaizenX/__tests__`:

```powershell
cd D:\KaizenAssests\kaizenX
npm test
```

If mobile connectivity fails, check `/health`, device access to port 8000, and the configured URL. If event updates are missing, check Kafka and worker logs. If login fails, verify the auth service, JWKS URL, issuer/audience settings, and bearer-token flow.

## 11. Important source files

- Mobile entry/navigation: [`kaizenX/App.tsx`](kaizenX/App.tsx)
- Mobile API client: [`kaizenX/src/services/api.ts`](kaizenX/src/services/api.ts)
- Backend application/lifecycle: [`backend/business-service/app/main.py`](backend/business-service/app/main.py)
- Backend settings: [`backend/business-service/app/config/settings.py`](backend/business-service/app/config/settings.py)
- Docker stack: [`backend/docker-compose.yml`](backend/docker-compose.yml)
- Backend setup notes: [`backend/BACKEND_SETUP.md`](backend/BACKEND_SETUP.md)

