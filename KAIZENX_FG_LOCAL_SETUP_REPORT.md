# KaizenX FG local application setup

| Required check | Result |
|---|---|
| Connected database name | `kaizenassests_test_fg_clone_202610290741304887b0` |
| Backend status | PASS — one loopback-only backend running on `localhost:8000`, PID 24028 |
| Migration revision | `20261037_fg_section_numbering` |
| FG Loading API status | PASS — HTTP 200 |
| Assembly page status | PASS — `http://localhost:8080/assembly/finished-goods`, migration error absent |
| Main FG QR status | PASS — original five FG records and QR identities preserved; original material traceability unchanged |
| Eight Sub-ID status | PASS — new QC-approved verification FG `FG-0003` has `FG-0003-S01` through `FG-0003-S08`, each with a distinct QR identity |
| Browser verification | PASS — actual localhost:8080 page, Main FG QR verification, eight rendered QR images, no browser JavaScript exceptions |

## Local service switch

Before replacement, both port-8000 Uvicorn processes were inspected. They belonged to the current Windows user, used this workspace, had `environment=local`, and were launched from local IDE/PowerShell process trees. Neither was a Windows service; no non-loopback clients were connected. The two duplicate local backend process trees were stopped. Their source database was not migrated or modified.

They were replaced by a single clone-bound development backend. The existing Vite frontend on port 8080, PID 2552, was left running with its existing `http://localhost:8000` API URL. No production/shared `.env` files were edited.

Database configuration is applied only inside the clone launcher's process before application import. The actual running API confirms its database and revision at:

```text
http://localhost:8000/api/local/fg-clone-status
```

This diagnostic is installed only by the local launcher, is restricted to loopback clients, and reads a fresh database connection. Application lifespan/background Kafka, outbox and notification workers remain disabled in this local clone session.

## New QC verification FG

- Product: `Local clone setup verification FG`.
- FG database ID: `d50ccb23-59a7-484a-807f-a2918167629d`.
- Transport label: `FG-0003`.
- Sections: eight unique Sub-IDs and QR identities.
- The order was explicitly created as clone-only QA data, and QC approval was performed through the running local API.
- This verification FG is retained so its eight QR labels can be viewed in the application. It is separate from the five historical FGs.
- No historical backfill or Main FG QR regeneration was performed.

## Preservation verification

- A final read-only audit of `ams_business` matched all 138 table fingerprints, including its unchanged migration revision, to the original backup snapshot.
- Every original column in the five existing FG records in the clone matched the original snapshot.
- The original five material-traceability API responses matched the verified baseline.
- No section records were added to the historical five FGs.

## Browser evidence

- `frontend/scratch/fg-local-setup-browser/verification.json`: actual API HTTP statuses and browser checks.
- `frontend/scratch/fg-local-setup-browser/assembly-eight-sections.png`: screenshot of the verified eight section labels.
- `frontend/scratch/fg-local-setup-browser/page.txt`: final page text.
- `backend/business-service/backups/fg-safe-clone-202610290741304887b0/local-fg-verification.json`: retained QC verification record.
- `backend/business-service/backups/fg-safe-clone-202610290741304887b0/local-runtime.json`: local backend database, revision and PID.
- Backend stdout/stderr logs are in the same ignored backup directory.

## Future local startup

Use the clone-specific launcher from `backend/business-service`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start_local_fg_clone.ps1
```

The launcher verifies an already-running clone backend and returns without starting a duplicate. If another backend occupies port 8000, it refuses to replace it automatically. The shared source `.env` remains unchanged, so use this launcher for future clone-based local development.

No deployment or production configuration change was performed.
