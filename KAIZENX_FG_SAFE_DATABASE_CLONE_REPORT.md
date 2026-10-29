# Protected FG database backup and disposable clone verification

## Results

| Check | Result |
|---|---|
| Backup status | PASS — custom-format PostgreSQL backup, SHA-256 verified, restored and compared |
| Restore verification | PASS — all 138 table contents exactly matched one consistent exported source snapshot |
| Disposable migration status | PASS — `20261030_assembly_consumption_api` to `20261037_fg_section_numbering` using Alembic |
| FG Loading | PASS — actual application API returns HTTP 200 using the migrated clone |
| Existing FG identity preservation | PASS — all five Main FG records, IDs, QR identities, and original column values preserved |
| Original material traceability | PASS — source and clone API responses match exactly after excluding new transport availability metadata |
| Eight Sub-ID generation | PASS — new QC-approved test FG generated exactly eight unique Sub-IDs; partial 3/8 and full 8/8 dispatch passed |
| Focused regressions | PASS — 24 tests, zero failures/errors/skips |
| Protected source | UNCHANGED — final fingerprints of all 138 source tables, including the Alembic revision, match the backup snapshot |
| Automatic application switch/deployment | NOT PERFORMED |

## Database and backup details

- Protected source: `localhost:5432/ams_business`, PostgreSQL 17.10.
- The source is configured as `local`. Local/loopback sessions were observed, but production/staging/shared ownership could not be conclusively excluded. The source remained protected throughout.
- Source revision remains `20261030_assembly_consumption_api`.
- Verified development clone: `kaizenassests_test_fg_clone_202610290741304887b0` on the same PostgreSQL server.
- Separate regression sibling: `kaizenassests_test_fg_clone_20261029074910reg0e6fad`.
- Backup directory: `backend/business-service/backups/fg-safe-clone-202610290741304887b0/`.
- Backup archive: `ams_business.dump`, 524,473 bytes.
- SHA-256: `62cbb5847e97e81f66ddadef417d3687e1d195cdeebbd03b2ec32d018232eab7`.
- Evidence: `manifest.json`, `source-snapshot.json`, `archive-contents.txt`, `migration.log`, `clone-traceability.json`, `regressions.xml`, and `regressions.log` in the backup directory.
- Backup files and clone-only credentials are in the existing Git-ignored local backup directory. They were not committed or published.

The source backup used an exported, repeatable-read, read-only transaction snapshot shared with `pg_dump`. Restore used a newly created database and `pg_restore --single-transaction --exit-on-error`, without `--clean`. No existing tables were dropped, and no source records were modified or reset.

After migration, all original data columns in every restored table were compared again; only the expected Alembic revision changed. Existing FG and material traceability APIs were then compared with strictly read-only source transactions. Application lifespan/background workers were not started for these checks.

## Required schema in the clone

- `assembly_finished_goods.section_main_id`: present.
- `assembly_finished_goods.section_supplier_id`: present.
- `finished_goods_request.section_fg_id`: present.
- `finished_goods_section`: present with the application's section constraints.
- `fg_transport_main_number`: present. This is the actual sequence name used by the migration and code; no manually invented `_sequence` object was created.

All eight pending migrations were applied in order through the existing Alembic framework. No schema fields were invented or patched manually.

## Test setup correction

The first extended regression run exposed a test-fixture assumption: raw SQL omitted required order values because the old disposable test database supplied server defaults that the protected source did not have. Test inserts now use the existing SQLAlchemy model's client-side defaults. The legacy FG fixture was corrected the same way. Application behavior and database defaults were not changed.

The initial diagnostic is retained as `initial-fixture-failure.log`. The corrected rerun passed all 24 tests on a separate sibling of the migrated clone, so sample material chains were not added to the verified development clone. Tests created/deleted only their own disposable records. Original FG/GRN/Assembly data in the development clone and the entire protected source were verified again afterward.

## Exact manual local-development connection steps

These steps have **not** been executed. They start separate local instances and do not edit `.env`, stop existing services, or replace the backend on port 8000.

### 1. Start the clone backend in a new PowerShell terminal

```powershell
Set-Location -LiteralPath 'C:\Users\Kavya G\OneDrive\Desktop\kgs\KaizenAssests\backend\business-service'
$env:CORS_ALLOW_ORIGINS='["http://127.0.0.1:18099","http://localhost:18099"]'
.\.venv\Scripts\python.exe scripts/verify_fg_database_clone.py serve --manifest backups/fg-safe-clone-202610290741304887b0/manifest.json --port 18098
```

The launcher checks the allowlisted clone name, passing migration/test manifest, actual connected database, and revision before serving. It supplies the clone URL only to its own process and refuses port 8000. Startup schema compatibility, Kafka, outbox, and notification lifespan workers remain disabled for this isolated development session. The protected source configuration is not edited.

### 2. Start a separate frontend in another new PowerShell terminal

```powershell
Set-Location -LiteralPath 'C:\Users\Kavya G\OneDrive\Desktop\kgs\KaizenAssests\frontend'
$env:VITE_BUSINESS_API_URL='http://127.0.0.1:18098'
npm.cmd run dev -- --host 127.0.0.1 --port 18099
```

Open `http://127.0.0.1:18099/assembly/finished-goods` and sign in with the appropriate existing local account. Confirm the browser's business API requests use port **18098**, not **8000**. Existing local frontend instances keep their existing configuration.

### 3. Check the isolated backend

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:18098/api/v1/assembly/fg-loading' -Headers @{'X-User-Roles'='ASSEMBLY'}
```

This development-only role header uses the existing local authentication behavior. An empty queue is valid until a section pickup vehicle has arrived. It must not return the migration error.

### 4. Historical section records need a separate explicit decision

The five restored historical FGs intentionally retain **zero section records**. Migration does not silently backfill them. Eight-section generation was verified on new QC-approved test FGs, with their temporary FG records cleaned up by the tests.

To add sections to a historical FG later, review its supplier ownership, QC approval, and any existing allocations first, then use the existing controlled single-FG backfill process **against the clone only**. No existing Main FG QR should be regenerated. This backfill was not automatically performed.

### 5. Stop the isolated session

Press Ctrl+C in the two new terminals and close them. Their process-only environment overrides disappear. No rollback, database reset, production configuration change, or source migration is needed.

## Reverification commands

From `backend/business-service`:

```powershell
.\.venv\Scripts\python.exe scripts/verify_fg_database_clone.py verify --manifest backups/fg-safe-clone-202610290741304887b0/manifest.json
.\.venv\Scripts\python.exe scripts/verify_fg_database_clone.py audit --manifest backups/fg-safe-clone-202610290741304887b0/manifest.json
```

The audit compares source fingerprints with the original backup snapshot. If legitimate source activity occurs later, a difference requires review rather than overwriting or restoring the source.
