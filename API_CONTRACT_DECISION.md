# KaizenX Canonical API and Legacy Feature Decision

Read-only Phase 3F investigation. No application code, tests, permissions, or
databases were changed.

## 1. Canonical Material Master API

The repository currently has three distinct material surfaces:

| Surface | Registered route family | Purpose | Evidence |
|---|---|---|---|
| Material Master CRUD expected by frontend | `/api/v1/materials...` | Material identity, variants, status, UOM | Frontend `api-client.ts` methods `getMaterial`, `createMaterial`, `updateMaterial`, `updateMaterialStatus`, `addMaterialVariant` |
| Procurement catalog | `/api/v1/procurement/raw-materials`, `/api/v1/procurement/material-catalog` | Procurement/raw-material selection | Frontend `api-client.ts`; procurement router |
| Gate material selection | `/api/gate/materials` | Gate/GRN material lookup and custom material creation | Gate router `preview_router` and frontend `getGateMaterials`, `createMaterialComponent` |

The backend route scan does not find registered `/api/v1/materials`,
`/api/v1/materials/next-code`, or `/api/v1/materials/{id}/variants` handlers.
Those are used by the frontend and by failing Material Master tests. Therefore
the mismatch is a genuine cross-layer contract gap, not proof that the tests
are obsolete.

The active data model is `MaterialModel`/`MaterialVariantModel`:

- Material identity: UUID `id`
- Stable business identifier: unique `material_code`
- Base unit: `base_uom`
- Variant identity: UUID variant `id` plus `variant_code`
- Operational records use `material_id`, `material_variant_id`, material code,
  and UOM together

ASN, GRN, inventory, and Assembly flows select materials by code and/or UUID
links. UOM is persisted on material, variant, ASN line, stock, request item,
and QR/receiving records; it must not be replaced with hardcoded test values.

### Old-to-current endpoint mapping

| Outdated test/frontend call | Verified current backend equivalent | Decision |
|---|---|---|
| `GET /api/v1/materials/next-code` | No registered equivalent found | Requires canonical Material Master route decision |
| `POST /api/v1/materials` | No registered equivalent; `/api/gate/materials` is a different lightweight gate surface | Do not redirect automatically |
| `GET /api/v1/materials/{id}` | No registered equivalent found | Requires decision |
| `PATCH /api/v1/materials/{id}` | No registered equivalent found | Requires decision |
| `PATCH /api/v1/materials/{id}/status` | No registered equivalent found | Requires decision |
| `POST /api/v1/materials/{id}/variants` | No registered equivalent found | Requires decision |
| `GET /api/gate/materials` | Registered gate preview material lookup | Preserve as gate/GRN contract |
| `POST /api/gate/materials` | Registered gate custom-material creation | Preserve; not a replacement for full Material Master CRUD |
| `GET /api/v1/procurement/raw-materials` | Registered procurement raw-material list | Preserve for procurement consumers |
| `GET /api/v1/procurement/material-catalog` | Registered catalog lookup | Preserve for selection consumers |

Authentication is enforced through the current role dependencies. Material
creation/linking paths in storage/procurement require warehouse/admin or the
specific module role; the gate preview surface has its own current dependency.
No permission change is recommended.

## 2. Role-permission matrix

| Operation | Supported roles | Scope |
|---|---|---|
| Global material/catalog administration | Admin and explicitly authorized warehouse/procurement roles | Global material master/catalog |
| Gate/GRN material lookup | Gate/warehouse/GRN-compatible authenticated roles according to the registered route | Inbound material context |
| Warehouse stock and putaway | Warehouse/Warehouse Manager; store roles only within assigned store scope | Warehouse or assigned store |
| Store inventory/location access | Store Manager/Store Keeper within assigned store; Admin/Warehouse global access | Store-scoped |
| Assembly material request/receipt | Assembly/Assembly Manager and warehouse roles according to endpoint | Assembly order/request scope |
| Cross-store or IDOR access | Denied | No cross-store override from headers alone |

The negative authorization tests asserting `403` for cross-store, unsupported
roles, and IDOR attempts should be preserved.

## 3. Legacy Purchase Order dependency inventory

### Actively supported or still consumed

- Procurement frontend calls PO list/detail, by-number lookup, approval,
  rejection, resubmission, supplier acknowledgement, amendment, PDF, and
  damaged-goods endpoints in `frontend/src/lib/api-client.ts`.
- Procurement router exposes the PO APIs and the `PurchaseOrderModel` remains
  in the database model set.
- Gate code still reads PO-related data for legacy OCR/lookup and gate-entry
  compatibility paths.
- GRN/receiving models retain nullable or historical PO references.

These cannot be classified as unused solely because the current ASN-first
workflow does not require them.

### Legacy but still required for compatibility

PO-linked damage claims, OCR preview, procurement screens, and historical
receiving records appear to be compatibility features. Preserve them until
their consumers and migration/data requirements are explicitly retired.

### Candidate for retirement / product approval

The PO stage as a mandatory prerequisite for ASN, Gate Entry, GRN, Putaway,
Assembly, or Dispatch is not supported by the approved workflow. Any test that
requires PO creation merely to exercise the current ASN workflow should be
rewritten or retired only after approval. PO APIs/tables themselves should not
be removed in this phase.

The failing Gate tests that expect seeded `PO-1001`/`PO-1003` behavior and
legacy lookup endpoints require a product decision about whether that
compatibility surface remains supported.

## 4. Proposed test changes

| Failure group | Recommendation |
|---|---|
| Material Master tests using `/api/v1/materials...` | Defer; first approve and implement/restore the canonical Material Master API contract. Do not point them at gate custom-material endpoints because schemas and responsibilities differ. |
| Gate/PO OCR and PO lookup tests | Preserve in a separately labelled legacy-compatibility category pending approval. Do not add PO prerequisites to ASN tests. |
| Store/warehouse `403` vs `200` cases | Correct fixtures only when the endpoint’s documented scope proves the test user should have access. Preserve all cross-store/IDOR negative assertions. |
| Downstream Assembly, Putaway, Inventory, Dispatch tests | Keep as regression tests; resolve shared API/schema contracts first rather than masking downstream failures. |
| Tests failing from missing legacy PO fields | Defer pending decision; do not add fields solely to satisfy tests. |

No tests are approved for deletion or exclusion by this report.

## 5. Risks and unresolved decisions

1. The frontend currently calls Material Master CRUD routes that are not
   registered in the inspected backend. This is a production integration risk.
2. There is no single documented Material Master contract covering UUIDs,
   material codes, variants, UOMs, authorization, and dropdown use across
   procurement, ASN, GRN, inventory, and Assembly.
3. PO compatibility remains active in frontend and backend consumers even though
   PO is not a required operational stage.
4. Legacy PO migration/schema fields must not be restored without deciding which
   integrations remain supported.
5. Role headers used by tests must be mapped to real authenticated identities and
   store assignments before changing any expected status code.

## 6. Expected impact on the 74 failures

- Material Master/API-contract failures: likely resolved only after selecting a
  canonical CRUD route and aligning frontend/tests to it.
- PO/Gate failures: remain pending legacy compatibility approval.
- Authorization failures: some test fixtures may be corrected; genuine
  cross-store and unauthorized failures should remain expected `403`.
- Downstream workflow failures: expected to reduce after the shared material,
  PO-compatibility, and role-fixture decisions are implemented.

## Decision status

This document is investigative only. It does not authorize API changes, test
changes, permission changes, PO retirement, or database changes.
