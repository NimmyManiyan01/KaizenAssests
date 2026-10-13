# Assembly Schema Decision — Phase 2C

**Date:** 2026-10-13  
**Scope:** read-only investigation only.  
**Database safety:** no database was modified; `ams_business` was not accessed for mutation.

## 1. Current Assembly architecture

The current Assembly workflow is implemented as a direct warehouse-integrated flow:

`Raw Material Request → Warehouse Issue → Assembly Receipt → Production → QC → Finished Goods QR → Assembly Stock → Dispatch`

The principal backend module is `backend/business-service/app/modules/assembly`. Its API router uses SQLAlchemy models from `app/modules/assembly/infrastructure/persistence/models.py` and storage models for live material availability. The frontend uses `frontend/src/routes/assembly.*.tsx` and the centralized methods in `frontend/src/lib/api-client.ts`.

The Assembly module does not introduce a separate warehouse transfer after finished-goods production. `AssemblyFinishedGoodsModel` represents finished goods remaining in Assembly, and dispatch/FIFO allocation reads that stock.

## 2. Missing table dependency analysis

| Table | Current ORM model | Active usage | Required by current workflow? | Finding |
|---|---|---|---|---|
| `assembly_line` | `AssemblyLineModel` in `app/modules/assembly/infrastructure/persistence/models.py:259` | `GET /api/v1/assembly/lines` queries it; Assembly order/material-request payloads carry `assembly_line`; frontend `assembly.orders.tsx` loads and selects line codes. | Yes, for line master data and the UI/API contract. The core quantity flow can carry a string, but the implemented line endpoint requires the table. | Missing migration creation, not an obsolete reference. |
| `bill_of_materials` | `BillOfMaterialsModel` at `models.py:222` | Product listing, product creation, BOM lookup, BOM preview, material-request creation, and order/BOM linkage all query or write it. | Yes, essential. BOM components determine raw-material requests and quantities. | Missing migration creation before `20261007_assembly_orders_phase1.py`. |
| `bill_of_materials_item` | `BillOfMaterialsItemModel` at `models.py:240` | BOM creation writes items; product listing and BOM/material-request endpoints read items; `BillOfMaterialsModel.items` has a cascading relationship. | Yes, essential. Removing it would break component calculation and the raw-material workflow. | Missing migration creation before the seed block in phase 1. |

## 3. Active API and service references

### Assembly lines

- `backend/business-service/app/modules/assembly/infrastructure/api/router.py:550-570`: `GET /api/v1/assembly/lines` selects `AssemblyLineModel`.
- `frontend/src/lib/api-client.ts:3122-3125`: web client calls the endpoint.
- `frontend/src/routes/assembly.orders.tsx:253-263`: loads lines and chooses a default line.
- `backend/business-service/tests/unit/test_assembly_reservation.py:21`: expects `LINE-01` in an Assembly payload.
- `20261007_assembly_orders_phase1.py:43-53`: seeds `LINE-01` and `LINE-02`.

No alternate line table or equivalent model was found. `storage.infrastructure.persistence.models.py:340` contains an `assembly_line` string field on a storage/request model, but that is a denormalized value, not a line master.

### BOM header and items

- `router.py:387-428`: lists active BOM-backed products and counts `BillOfMaterialsItemModel` rows.
- `router.py:444-548`: creates a BOM header and component rows.
- `router.py:940-1000`: resolves a product BOM and calculates material availability.
- `router.py:1033-1070`: creates a raw-material request from BOM components.
- `frontend/src/lib/api-client.ts:1911-1960`: exposes generic BOM CRUD methods.
- `frontend/src/lib/api-client.ts:3161-3166`: exposes product BOM preview.
- `frontend/src/routes/assembly.orders.tsx` and `assembly.material-requests.tsx`: use active BOMs to create requests and show required materials.
- `20261007_assembly_orders_phase1.py:58-72`: seeds one BOM and five BOM item rows.

No alternate canonical BOM table was found. Finished-goods request fields `bom_attachment_url` and `bom_attachment_name` are document attachments, not structured BOM data and cannot replace these tables.

## 4. Existing equivalent tables

No equivalent canonical tables were found for any of the three missing tables.

- `assembly_order` stores the order and optional `bom_id`/`bom_number`; it is not a BOM header or component table.
- `material_request` and `material_request_item` store a generated request snapshot/transaction; they do not represent the reusable product BOM.
- `finished_goods_request` stores request metadata and optional BOM attachment fields; it is not structured BOM data.
- Storage `assembly_line` string fields are copied business values, not a master table.

Therefore, reusing another existing table would change the implemented Assembly workflow or lose BOM/line semantics.

## 5. Migration and schema ownership evidence

### Actual revision graph

- `20260826_assembly_reservation` creates `assembly_order` and `assembly_material_reservation`.
- `20260827_assembly_steps`, `20260828_assembly_workforce`, `20260829_material_consumption`, `20260830_assembly_scrap`, `20260831_assembly_quality`, `20260901_assembly_rework`, and `20260902_assembly_finished_goods` extend the Assembly workflow.
- `20261007_assembly_orders_phase1` revises `20261006_asn_logistics` and assumes `assembly_order`, `assembly_line`, `bill_of_materials`, and `bill_of_materials_item` exist.
- `20261008_assembly_orders_phase2_bom` adds `assembly_order.bom_id` and `assembly_order.bom_number` with a foreign key to `bill_of_materials`.
- `20261008_assembly_orders_phase3_receipt` adds Assembly Receipt fields.

The phase 1 revision is therefore not self-contained: it assumes the three master tables but no earlier revision creates them.

### Repository schema evidence

- `app/main.py:928-960` contains startup DDL for `bill_of_materials` and `bill_of_materials_item`, including columns and indexes matching the ORM models closely.
- No startup DDL for `assembly_line` was found.
- `app/modules/assembly/infrastructure/persistence/models.py` defines all three tables and is imported by the Assembly router/application model loading.
- No raw SQL schema file defining these Assembly tables was found in the inspected repository paths.
- Git history shows the simplified Assembly implementation commit `357bef1` introduced the phase 1/phase 2 Assembly migration files and the Assembly model/API changes together. The historical patch added seed logic but did not add table-creation operations for the three tables.
- Git history contains no earlier creation revision for `assembly_line`, `bill_of_materials`, or `bill_of_materials_item`.

### Root cause classification

Primary cause: **missing table creation / incomplete migration ownership**.  
Secondary issue: **startup DDL has become a shadow schema path for the two BOM tables**.  
Not primarily a naming mismatch: the ORM and migration seed use the same table names.  
Not safely solvable by merely changing revision order: no existing revision creates the tables to move earlier.

## 6. Obsolete seed logic assessment

The seed logic is not proven obsolete:

- `LINE-01` is a frontend default and is expected by a backend unit test.
- `LINE-02` appears in Assembly UI/default display paths and should not be removed without product-owner confirmation.
- The seeded BOM is consumed by the product/BOM and material-request workflow if present.

The problem is not that the seed data is demonstrably unused; it is that the migration assumes its target tables already exist. The seeds should remain part of the eventual canonical migration plan unless an approved data-seeding policy says otherwise.

## 7. Recommended canonical schema decision

| Table | Recommendation | Reason |
|---|---|---|
| `assembly_line` | Restore/create the documented ORM-owned schema in the migration path, subject to explicit implementation approval. | Actively queried by the line API and represented by `AssemblyLineModel`; no equivalent exists. |
| `bill_of_materials` | Reuse the existing canonical ORM/startup-DDL schema; move ownership into Alembic rather than inventing a new table. | Actively written/read by product and raw-material workflows; `main.py` already documents the intended columns. |
| `bill_of_materials_item` | Reuse the existing canonical ORM/startup-DDL schema as the child of `bill_of_materials`. | Required for component quantities, warehouse availability, and material-request generation. |

No recommendation is made to remove the seed logic, replace these tables with `finished_goods_request`, or add a warehouse transfer. Those actions would change current Assembly behavior.

## 8. Minimum safe implementation plan (not implemented)

1. Obtain approval for the canonical columns/constraints from the existing ORM and, for BOM tables, the startup DDL.
2. Add the missing table creation to the migration path before `20261007_assembly_orders_phase1` runs on a fresh database, while preserving already-applied database compatibility. This requires careful Alembic graph handling; do not change revision IDs or stamp databases.
3. Make creation idempotent only where compatible with existing deployed schemas, and add the required indexes/foreign keys from the ORM relationships.
4. Keep the phase 1 seeds after table creation, preserving `LINE-01`, `LINE-02`, and the existing BOM seed behavior.
5. Verify on a disposable empty database that Assembly tables are created before seed/use, then verify foreign keys for BOM items, Assembly orders, finished goods, and dispatch allocations.
6. Verify the existing five passing domain tests and the Assembly API/model contract tests against the isolated database.
7. Compare the resulting schema against an existing database using read-only introspection only; never backfill or alter `ams_business` as part of the verification.

## 9. Risks to existing Assembly data

- Existing databases may already contain these tables because `app/main.py` startup DDL created the BOM tables, manual setup created them, or a prior deployment used an external schema process. A future migration must use compatible existence checks and avoid duplicate creation.
- Existing BOM rows and Assembly orders may depend on stable BOM IDs, BOM numbers, product codes, and item foreign keys. No replacement or destructive recreation is safe.
- Adding constraints to populated tables could fail if existing data violates them; this must be checked in an isolated schema rehearsal before any production migration.
- `assembly_order.bom_id` is introduced by a later revision and references `bill_of_materials`; table creation must precede that revision on fresh installs.
- `AssemblyFinishedGoodsModel` and `AssemblyFinishedGoodsAllocationModel` depend on Assembly/dispatch relationships outside these three tables. The proposed direction does not alter those relationships.

## Decision

All three tables are actively required by the current implemented Assembly workflow. No equivalent canonical table exists. The repository contains the intended BOM schema in ORM models and startup DDL, and the intended line schema in the ORM model plus phase 1 seed usage. The safe direction is to establish Alembic ownership of these existing schemas before phase 1 executes, preserving the current seeds and workflow. Implementation is intentionally deferred pending approval.
