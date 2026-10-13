# KaizenX Database Validation

## Read-only checks performed

Database connection: configured PostgreSQL through the backend SQLAlchemy async engine.

| Query target | Result |
|---|---|
| asn.asn_number = ASN-2026-1 | 1 row |
| Existing ASN vehicle | KA03AB1234 |
| Existing ASN status | AWAITING_DOCK |
| Existing ASN supplier ID | 252458f6-1af0-4985-9f03-0ee2ced61dc5 |
| Existing ASN line | MAT-STEEL-7809, steel, 100.0000 PCS |
| finished_goods_pickup_gate_visit.gate_pass_number = 32CGRL | 0 rows |
| material.material_code = MAT-STEEL-21C5 | 0 rows |

## Requested quantity validation

The requested invariant is:

100 received = 90 accepted + 10 damaged

It was not executed because no isolated matching GRN transaction was available.

Expected downstream invariants, also not executed:

- post-putaway accepted stock: 90 PCS
- post-issue warehouse stock: 80 PCS
- assembly received: 10 PCS
- finished-goods output: determined by the actual BOM, not assumed to equal 10

## Data-safety finding

The existing automated suite uses the configured PostgreSQL database and includes direct cleanup statements. A cleanup attempt in tests/unit/test_finished_goods_requests_flow.py failed because child allocation rows still reference the parent request. This demonstrates that the current test setup is not rollback-safe for the requested complete audit.

No application records were deleted or updated by this audit. The checks for ASN, gate pass, and material were read-only.
# Isolated database validation update — 2026-10-13

## Target

The isolated database `ams_business_e2e_20261013` was created on PostgreSQL port 5432 with schema `public`. It is separate from `ams_business`.

## Commands

1. `psql -h localhost -p 5432 -U ams_business -d postgres -c "CREATE DATABASE ams_business_e2e_20261013 OWNER ams_business;"`
2. `DATABASE_URL=postgresql+asyncpg://.../ams_business_e2e_20261013 python -m alembic upgrade head`
3. Read-only identity checks against both databases.

## Results

- `ams_business` remained at revision `0023_allow_supplier_fg_allocations`.
- The new database connected successfully and initially contained zero public tables.
- Alembic failed on a fresh database at `246123db4a01_add_notification_details.py` with `NoSuchTableError: notification`.
- No fixture data or business transaction was inserted.

## Safety finding

`tests/conftest.py` contains an autouse fixture that executes schema-altering `ALTER TABLE` statements through the application session. It does not enforce a test database name and must not be used against `ams_business`.

## Blocker

The migration graph cannot provision a clean database from zero. A migration-chain repair or an approved existing schema bootstrap strategy is required before adding the MTU/Steel fixture and running API preflight transactions.
