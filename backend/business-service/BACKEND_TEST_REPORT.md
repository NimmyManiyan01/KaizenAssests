# KaizenX Phase 3A Backend Test Report

## Scope

The suite was run on the disposable PostgreSQL database
`kaizenx_test_phase3a_20261013`. `tests/conftest.py` requires
`KAIZENX_TEST_DATABASE_URL`, rejects protected business-database names, and
accepts only PostgreSQL URLs using the `kaizenx_test_`/`_test` naming policy.

Alembic was applied before testing and the independent database inspection
confirmed persisted revision `0023_allow_supplier_fg_allocations`.

## Initial results

Command:

```text
.venv\Scripts\pytest.exe -q
```

Result:

- Tests discovered: 159
- Passed: 65
- Failed: 81
- Errors: 13
- Skipped: 0
- Duration: 89.82 seconds

The suite emitted 14 warnings, including the existing pytest-asyncio loop-scope
deprecation warning.

## Failure classification

### Database schema / migration compatibility

Multiple tests failed or errored because ORM/test expectations reference schema
elements not present in the migrated database at the point of use. Confirmed
examples include:

- `material_stock` referenced by cleanup/test flows
- `material_request.suggested_supplier`
- `store_manager_user.role`

These require migration/model/test-fixture reconciliation. No schema changes
were made during Phase 3A.

### Authorization and response expectations

Several store, warehouse, zone, and authorization regression tests returned
`403` where the tests expected `200`. These need separate classification against
the current role/header authorization implementation; they were not changed or
bypassed.

### Cleanup fixture failures

At least one teardown failed while issuing cleanup SQL against an expected
schema object. These are test-fixture/schema-contract failures and can obscure
the original test result.

### Other workflow areas

The full output contains failures across store/warehouse, material, putaway,
and authorization-related tests. No Phase 3A fix was applied because the
failures span multiple contracts and a safe smallest related group was not yet
isolated.

## Root-cause assessment

The results do not support the previous assumption of a single migration
failure. The dominant shared issue is drift between the current Alembic schema,
SQLAlchemy models, and older test expectations/cleanup SQL. Authorization
failures are a separate likely application-or-test-contract issue.

## Phase 3B changes

Added `alembic/versions/0024_complete_material_store_schema.py`.

The guarded migration now owns the canonical `material_stock` table when it is
missing and adds the model-required `material_request.suggested_supplier`,
`store_manager_user.role`, related store-manager fields, and `store_bin.position`
without dropping or rewriting existing data. The downgrade is intentionally
non-destructive because these objects may predate the corrective migration.

The test database setup and cleanup fixtures were not weakened or bypassed.

## Phase 3C changes

Extended `0024_complete_material_store_schema.py` with the remaining confirmed
canonical `store_bin` fields and `purchase_order.revision_number`. These are
guarded `ADD COLUMN IF NOT EXISTS` operations with defaults and do not remove
or rewrite existing values.

No tests were updated: the material route failures and authorization failures
were not established as obsolete tests, and changing their assertions would
hide unresolved API behavior.

## Files modified in Phase 3A/3B

- `alembic/env.py`: completed Phase 2H metadata transaction fix was preserved.
- `alembic/versions/0024_complete_material_store_schema.py`: guarded canonical
  schema completion.
- `BACKEND_TEST_REPORT.md`: this report.

No business APIs, workflows, frontend files, or database migrations were
modified during the Phase 3A test run.

## Phase 3B verification

Fresh disposable database: `kaizenx_test_phase3b_20261013`.

Alembic completed successfully through revision
`0024_complete_material_store_schema`.

Focused tests after the migration change: `4 passed, 5 failed`. The remaining
focused failures included missing additional `store_bin` fields such as
`storage_type`, plus unrelated material endpoint/authorization contract issues.

The complete suite on a fresh database completed in 55.12 seconds:

- 156 tests executed in the final run
- 78 passed
- 78 failed
- 0 errors
- 0 skipped

Compared with Phase 3A (`65 passed, 81 failed, 13 errors`), fixture/setup errors
were eliminated and the pass count increased by 13. The suite still has broad
application/schema-contract failures.

## Remaining failures

- `store_bin` still lacks additional ORM-required columns, including
  `storage_type`; this needs a complete canonical store schema decision rather
  than incremental test-driven additions.
- `purchase_order.revision_number` is absent from fresh Alembic state and causes
  Gate Entry/PO integration failures.
- Several material endpoint tests use routes or response contracts that do not
  match the current API implementation.
- Authorization failures remain intentionally deferred; no authorization rule
  was changed in Phase 3B.

## Final results

```text
78 passed, 78 failed, 0 errors
```

## Recommended next actions

1. Approve a complete canonical store-bin schema reconciliation.
2. Reconcile purchase-order ORM fields and migrations before retesting Gate Entry.
3. Audit material endpoint paths and response contracts.
4. Handle authorization expectations in the next phase without weakening role
   checks.

## Phase 3C verification

Fresh disposable database: `kaizenx_test_phase3c_20261013`.

Alembic reached the Phase 3C head successfully. The full suite completed in
59.59 seconds:

- 156 tests collected/executed
- 82 passed
- 74 failed
- 0 errors
- 0 skipped

The discovery count is 156 rather than the earlier 159 because the earlier
baseline count included collection/teardown error accounting; the current
pytest summary is the authoritative executed-test count.

Compared with Phase 3B (`78 passed, 78 failed, 0 errors`), 4 additional tests
pass and the schema-related errors are reduced. Remaining failures include
additional legacy Purchase Order columns such as `payment_terms`, material API
route/response mismatches, and deferred authorization expectations.

## Phase 3C remaining failures

- Purchase Order/Gate integration still selects legacy PO fields not owned by
  the current fresh migration. Whether those fields belong to the supported
  legacy procurement feature requires a product/schema decision; no PO
  dependency was introduced into ASN processing.
- Material Master tests expect `/api/v1/materials` routes/contracts that do not
  match the currently registered router behavior. No assertion or authorization
  change was made.
- Store-manager and warehouse authorization tests still contain `403` versus
  `200` disagreements. Authorization remains deferred and was not weakened.
- Remaining workflow failures are downstream of these unresolved contracts.

## Phase 3D authorization and API contract review

No Phase 3D application or test files were changed.

### Authorization findings

The reviewed `403` cases are consistent with active security rules in the
storage, store, dock, and gate routers:

- Store managers and keepers are restricted to their assigned store context.
- Warehouse-only operations reject store-manager, procurement, and finance
  roles.
- Cross-store access and IDOR attempts are intentionally rejected.
- Gate, dispatch, putaway, and assembly endpoints use explicit role sets.

The remaining `403` versus `200` failures therefore appear to be incorrect test
fixtures or outdated endpoint expectations. Changing them requires an explicit
contract decision for each endpoint. No permission was broadened.

### Material API findings

The failing material tests call `/api/v1/materials` and related `/next-code`
routes. The currently registered material surfaces do not expose that exact
route contract; material operations are distributed across procurement, gate
preview, storage, and assembly routers. The tests cannot be safely rewritten
without selecting a canonical public Material Master API. No response contract
or UOM behavior was changed.

### Legacy Purchase Order decision

Gate integration tests exercise PO lookup and expect legacy seeded PO behavior,
while the current ASN workflow is decoupled from Purchase Orders. Additional PO
fields such as `payment_terms` remain outside the fresh canonical migration.
Adding them or restoring legacy test endpoints requires product approval; no PO
dependency was introduced into ASN processing.

### Phase 3D verification

The full suite was run on disposable database `kaizenx_test_phase3c_20261013`
after Alembic reached head: `82 passed, 74 failed, 0 errors` in 59.59 seconds.
The database was isolated by the existing test guard and dropped after
verification. `ams_business` was not accessed or modified.

## Phase 3H Part 1 canonical Material Master read API

Implemented only the two approved read endpoints:

- `GET /api/v1/materials` — active canonical materials, with `limit` and `offset`.
- `GET /api/v1/materials/{material_id}` — canonical UUID lookup.

Both use `MaterialModel`/`material` and its supported `material_variant` relationship,
and require the established `procurement:read` authorization dependency. No write
endpoint, migration, model, frontend, or business data was changed.

Focused verification used disposable database `kaizenx_test_phase3h1_20261013`:

```text
Fresh alembic upgrade head: passed
Authorized list: 200; UUID lookup: 200; unknown UUID: 404; unauthorized role: 403
Material Master test subset: 3 failed, 0 passed (pre-existing write/legacy-contract tests)
Full suite: 82 passed, 74 failed, 0 errors, 0 skipped, 48.15 seconds
```

The full-suite result matches the Phase 3G baseline. The disposable database was
dropped after verification; `ams_business` was not accessed or modified.

Remaining failures are authorization-contract decisions, material API contract
selection, legacy PO test compatibility, and downstream failures from those
areas.

## Phase 3E test-alignment audit

No tests were changed, excluded, or deleted. The exact fresh-run result was:

```text
156 collected/executed; 82 passed, 74 failed, 0 errors, 0 skipped
```

The 74 failures are classified below. Tests marked downstream should not be
fixed independently until their shared root cause is resolved.

### Legacy Purchase Order / Gate contract

- `tests/integration/test_gate_api.py`: `test_anpr_ocr_preview_full_match`,
  `test_purchase_order_lookup_endpoint`,
  `test_gate_entry_lifecycle_create_verify_lookup`,
  `test_duplicate_active_gate_entry_rejection`,
  `test_supervisor_rejection_flow`, and
  `test_verify_gate_entry_move_to_unscheduled`.
- `tests/unit/test_gate_module.py::test_active_duplicate_entry_prevention`.

These expect legacy PO lookup/seeding and routes not required by the current
ASN-first workflow. They require a product decision, not silent test removal.

### Material API contract

- `tests/unit/test_material_master_and_requests_audit.py`:
  `test_material_master_code_and_variant_sequencing_audit` and
  `test_material_request_validation_and_lifecycle_audit`.
- `tests/unit/test_canonical_material_procurement.py::test_canonical_material_master_and_procurement_flow`.

These use `/api/v1/materials` contracts that are not registered as the active
canonical Material Master surface. They require endpoint-contract selection.

### Authorization or role-fixture expectations

- `tests/unit/test_store_manager_accounts_and_auth.py`: `test_chemical_manager_login_and_role_resolution`.
- `tests/unit/test_store_master_and_access_control.py::test_store_manager_isolation_and_idor_protection`.
- `tests/unit/test_phase3_dock_release_and_putaway.py::test_phase3_dock_release_authorization_and_validation`.
- `tests/unit/test_dock_release_store_manager_auth.py::test_dock_release_store_manager_authorization`.
- `tests/unit/test_putaway_auth_and_zone_scan.py::test_dev_login_case_insensitivity_and_auth_rules`.

The active implementation intentionally denies cross-store and unsupported-role
actions. These are incorrect fixtures or unresolved contract expectations; no
permissions were broadened.

### Downstream workflow failures

The following groups depend on the unresolved material, PO, store/putaway, or
authorization contracts and should not be independently rewritten:

- `tests/unit/test_asn_supplier_e2e.py`
- `tests/unit/test_assembly_custom_material_workflow.py`
- `tests/unit/test_assembly_store_pickup_workflow.py`
- `tests/unit/test_comprehensive_putaway_verification.py`
- `tests/unit/test_damaged_goods_email_flow.py`
- `tests/unit/test_dispatch_module.py`
- `tests/unit/test_dock_allocation.py`
- `tests/unit/test_e2e_prompt5_pytest.py` through `test_e2e_prompt13_pytest.py`
- `tests/unit/test_end_to_end_dock_store_movement_flow.py`
- `tests/unit/test_finished_goods_requests_flow.py`
- `tests/unit/test_gate_scan_ocr.py`
- `tests/unit/test_phase2_post_arrival_store_assignment.py`
- `tests/unit/test_phase3_dock_release_and_putaway.py` (workflow portion)
- `tests/unit/test_phase8_store_pickup_material_issue.py`
- `tests/unit/test_phase9_inventory_control_and_stock_ledger.py`
- `tests/unit/test_putaway_store_zone_integration.py`
- `tests/unit/test_qr_putaway_flow.py`
- `tests/unit/test_qr_scan_result.py`
- `tests/unit/test_quarantine_workflow.py`
- `tests/unit/test_receiving_qr.py`
- `tests/unit/test_rfq_response.py`
- `tests/unit/test_store_bins_and_hierarchy.py`
- `tests/unit/test_store_keeper_putaway_lifecycle.py`

### Phase 3E conclusion

No unambiguous test-only correction was established from the active routes and
role definitions. Rewriting these tests now would either select an unapproved
Material Master contract, revive a PO dependency, or weaken security assertions.
The next phase should obtain decisions on the canonical Material API and legacy
PO test category before aligning tests.

## Phase 3G controlled alignment

No tests were changed. The Phase 3F mapping does not establish an unambiguous
replacement for the failing `/api/v1/materials`, `/next-code`, variant, and
status routes: the frontend calls them, but no corresponding backend handlers
are registered. The existing `/api/gate/materials` and procurement catalog
routes have different responsibilities and schemas, so redirecting tests to
them would change the business contract rather than align it.

Focused Material Master tests:

```text
3 failed, 0 passed
```

The failures were preserved because selecting a canonical Material Master CRUD
API requires an explicit product/API decision.

Full-suite verification on fresh disposable database
`kaizenx_test_phase3g_20261013`:

```text
82 passed, 74 failed, 0 errors, 0 skipped
18 warnings, 40.29 seconds
```

This matches the Phase 3F baseline and introduced no regressions. The database
was migrated to head, isolated by the existing test guard, and dropped after
verification. `ams_business` was not accessed or modified.

