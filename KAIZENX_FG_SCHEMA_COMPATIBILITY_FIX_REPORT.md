# FG page HTTP 500 correction

- Root cause: the running `ams_business` database reports Alembic revision `20261030_assembly_consumption_api`, while the new code requires migrations through `20261037_fg_section_numbering`. The FG supplier/main-label columns, pickup FG link, and numbering sequence are missing. Application startup had already created the section table, which alone does not migrate existing tables.
- Fixed: historical FG list, detail, inventory summary, original Main QR verification lookup, and material traceability can read without selecting missing section columns. Unavailable section data is explicitly flagged; dispatch counts are unknown rather than fabricated as zero.
- Fixed: section loading, supplier FG selection, and new section writes fail closed with HTTP 503 and an exact migration requirement before incompatible queries or mutations.
- Fixed: FG Loading does not claim an empty vehicle queue when its API is unavailable.
- Fixed: migrations handle the section table or individual schema additions already existing, without automatically backfilling historical FG records.

## Verified

- Running API, read-only requests: grouped Finished Goods HTTP 200 (five product records), historical FG detail HTTP 200, original material traceability HTTP 200.
- Running FG Loading: HTTP 503 with missing schema elements and required migration revision. Full loading is BLOCKED until the database is migrated.
- Isolated PostgreSQL: 25 backend tests passed. Includes the exact incomplete-schema case, historical identity preservation, safe migration retries with an existing section table, and existing dispatch/traceability regression tests.
- Frontend: three section UI tests passed; 18 traceability UI tests passed on an isolated rerun with a 30-second test timeout. The initial combined run exceeded the default five-second timeout and caused cascading dialog interaction failures; no unrelated application code was changed to address test timing.
- Backend evidence: `backend/business-service/fg-schema-compatibility.xml`.

## Required environment correction

An administrator must review and apply the pending migration chain to the intended running database. From `backend/business-service`, the target revision command is:

```powershell
.venv/Scripts/python.exe -m alembic upgrade 20261037_fg_section_numbering
```

This command was **not** run against `ams_business`. Only read-only diagnostic requests/transactions were used against that database. Migration testing and schema mutation were confined to the allowlisted disposable test database. No deployment or historical backfill was performed.
