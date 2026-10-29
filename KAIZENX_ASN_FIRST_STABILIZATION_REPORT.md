# KAIZENX ASN-first stabilization

Date: 2026-10-29. Decision: **ASN-FIRST BLOCKED**.

## Evidence and baseline

The working tree already contained substantial uncommitted stabilization changes when this session began. The PO-removal report describes an older state: its 18 failures **do not reproduce in the supplied working tree**. Running all nine files containing those failures produced **33 passed, 0 failed**, with 10 warnings. These existing fixes have been preserved; they are not attributed to this session.

Evidence: `backend/business-service/stabilization-backend-baseline.log`. The first attempt used the workspace-root Python environment, which lacks `dotenv`; the actual baseline and subsequent runs used `backend/business-service/.venv/Scripts/python.exe`. No application database tests ran from the failed first attempt.

The original 132-pass/18-failure run's tracebacks were not supplied in the report and were not found in the available logs. Consequently exact historical stack traces cannot honestly be recovered. The table below separates source-supported explanations from historical facts that remain unverified. Current passing results do not prove what exception occurred in the earlier run.

## Original 18 failures and classification

All paths below are relative to `backend/business-service/tests/unit/`. Every listed test passed in this session's baseline. “Earlier expectation” identifies the older test contract visible in Git or the PO-removal report, **not a newly observed failure trace**.

| # | Exact original test ID | Classification / source evidence | Earlier expectation or problem; correction present in supplied tree |
|---|---|---|---|
| 1 | `test_gate_module.py::test_active_duplicate_entry_prevention` | Test fixture incompatibility; Gate domain | Duplicate check omitted `vehicle_plate`; service requires the PO/vehicle pair. Fixture now supplies the vehicle and retains the duplicate rejection assertion. |
| 2 | `test_dock_allocation.py::test_seed_and_get_overview_metrics` | Test fixture incompatibility; Dock | Expected nine seeded docks, but production `seed_default_docks_if_empty` explicitly does nothing. Fixture explicitly creates nine docks. |
| 3 | `test_dock_allocation.py::test_dock_type_filtering` | Test fixture incompatibility; Dock | Relied on automatic dock seeds; fixture now provides typed docks explicitly. |
| 4 | `test_dock_allocation.py::test_auto_create_allocation_request_idempotent` | Test contract incompatibility; Dock notifications | Earlier `len(notifs) == 0` conflicts with the existing idempotent “Truck waiting for dock” notification. Supplied test asserts exactly one notification and its title. |
| 5 | `test_dock_allocation.py::test_dock_allocation_lifecycle` | Test fixture / contract incompatibility; Dock/Gate | Missing persisted ASN/Gate context and old RESERVED/release expectations. Fixture supplies the context and assertions check OCCUPIED, AT_DOCK and receiving-before-release validation. |
| 6 | `test_dock_allocation.py::test_dock_notifications_on_allocation` | Test fixture / contract incompatibility; Dock | Missing ASN/Gate context and old notification assumptions. Fixture supplies context; test checks current warehouse/QC notifications. Original report does not establish which assertion failed first. |
| 7 | `test_dock_allocation.py::test_conflict_on_already_reserved_dock` | Test fixture incompatibility; Dock | No seeded dock / unfiltered dock selection. Explicit typed fixture and RAW_MATERIAL selection are present; conflict assertion remains. |
| 8 | `test_dock_allocation.py::test_dock_reassignment` | Test fixture incompatibility; Dock | Relied on implicit docks; explicit two-RAW_MATERIAL fixture and filtering now supply the reassignment pair. |
| 9 | `test_receiving_qr.py::test_material_qr_model_initialization` | Test fixture incompatibility; Receiving persistence | Older constructor passed unsupported `generated_by` to `GrnBatchQrModel`. Supplied fixture removes that argument; QR identity/payload assertions remain. Historical exception text is unavailable. |
| 10 | `test_comprehensive_putaway_verification.py::test_full_putaway_end_to_end_verification` | Fixture/schema/contract incompatibility; Gate/Receiving/Storage | Supplied changes add actual ASN, batch and QR links and use the current inventory-location endpoint. Prior report mentions schema/fixture failures but supplies no first failing exception; a unique original root cause cannot be established. |
| 11 | `test_store_keeper_putaway_lifecycle.py::test_complete_store_keeper_putaway_lifecycle_and_security` | Fixture/contract incompatibility; Storage | Supplied changes seed Material Master and GRN lines and assert canonical ASSIGNED/IN_PROGRESS/COMPLETED states. Original first exception remains unavailable. Security and stock assertions pass. |
| 12 | `test_putaway_auth_and_zone_scan.py::test_dev_login_case_insensitivity_and_auth_rules` | Test fixture incompatibility involving authentication; Security | Old `/api/v1/procurement/auth/dev-login` route replaced by existing `/api/v1/auth/dev-login`; case-insensitive success and invalid-password rejection assertions retained. |
| 13 | `test_putaway_auth_and_zone_scan.py::test_dev_login_is_disabled_outside_authorized_environments` | Test fixture incompatibility involving authentication; Security | Same stale login URL; current test exercises the active route and retains the environment restriction assertion. |
| 14 | `test_putaway_auth_and_zone_scan.py::test_handling_unit_lookup_and_putaway_zone_uuid_completion` | Fixture/contract incompatibility; Security/Storage | Supplied changes use active login route, persist a GRN line, and expect canonical COMPLETED status. Original first failing exception is unavailable. |
| 15 | `test_warehouse_authorization_regression.py::test_manager_mock_token_has_explicit_approval_permissions_only` | Authentication/authorization; Security | Supplied dependency code recognizes the manager mock token in development environments with MANAGER role and explicit approval permissions. Test retains rejection of ADMIN role. |
| 16 | `test_assembly_reservation.py::test_material_request_payload_accepts_positive_production_target` | Date-sensitive test fixture incompatibility; Assembly DTO | Fixed 2026-10-20 date became past; supplied fixture uses tomorrow. Positive-quantity and invalid-target assertions remain. |
| 17 | `test_assembly_fg_inventory.py::test_supplier_dispatch_split_batch_loading_and_gate_exit[batch]` | Existing unrelated FG dispatch behavior; exact historical root cause unverified | Earlier report mentions dispatch gate-exit assertions. Current gate/dispatch code and both parameterizations pass; do not attribute the earlier failure to PO removal without its trace. |
| 18 | `test_assembly_fg_inventory.py::test_supplier_dispatch_split_batch_loading_and_gate_exit[package]` | Existing unrelated FG dispatch behavior; exact historical root cause unverified | Same evidence limitation as #17. Existing stock reservation, dispatch and confirmed Gate Exit assertions pass. |

No historical row has been classified as a proven PO-removal regression merely because it appeared in that run. Existing canonical persistence import corrections are also present across the supplied tests. No assertions were weakened or tests skipped by this session to clear these 18 tests.

## Changes made in this session

1. `backend/business-service/app/modules/gate/infrastructure/api/router.py`: ASN read ownership was incomplete. Supplier list requests could select other suppliers, and detail/PDF routes did not check ownership. Read routes now resolve the authenticated supplier and restrict list output or return 404 for another supplier's detail/PDF. Internal receiving users retain their existing visibility. Both UUID and ASN-number lookup paths are covered, including the compact-reference fallback's final ownership check.
2. `backend/business-service/tests/integration/test_supplier_asn_po_authorization.py`: test both PO-free and PO-linked read/mutation isolation; verify owner PDF/detail access, query-filter tampering, authenticated ownership despite a spoofed payload supplier, invalid ASN references and historical PO-linked Gate Entry.
3. `backend/business-service/scripts/verify_asn_stabilization_migrations.py`: reproducible safety-gated migration verification, using only the named disposable database and a rolled-back verification schema.
4. `frontend/src/routes/supplier.asns.new.tsx`: scoped ESLint formatting corrections.
5. `frontend/src/routes/supplier-dashboard.tsx`: scoped ESLint formatting corrections.
6. `frontend/src/routes/vehicle-queue.tsx`: scoped ESLint formatting corrections.
7. `frontend/tests/assembly/pages.test.tsx`: search filtering test supplies complete input changes instead of simulating every character, retaining every filtering/global-total assertion; scoped formatting.
8. `frontend/tests/assembly/supplier-dispatch-transport.test.tsx`: replace expired 2026-10-28 pickup-date fixture with `localDateInput()`; scoped formatting.
9. `frontend/vitest.config.ts`: bound concurrency and use threads to avoid fork-worker startup exhaustion; no timeout increase or test exclusions.
10. This report.

Existing changes in Assembly consumption, Finished Goods, transport pairing, QR rendering, warehouse stock handling and earlier migrations were not authored by this session. No new PO API, QR identity, QR payload format, consumption architecture or UI redesign was introduced.

## Frontend timeout investigation

The exact reported test is `tests/assembly/pages.test.tsx > Material request queue > searches material details and keeps global totals when filtering`.

The default complete run encountered worker-start timeouts across ten files, finishing only 73 tests: **68 passed, 5 failed, 10 unhandled worker errors**. A bounded two-fork run completed all **264 tests: 250 passed, 14 failed**. Most failures were five-second test timeouts. This establishes a runner/environment issue in addition to the reported search test; it does not establish a production rendering loop.

The search test also timed out when isolated with a single thread. Its two `userEvent.type` calls simulate 26 character changes against the rendered request table plus repeated DOM/pointer checks. Replacing these with two `fireEvent.change` calls tests the intended filtering behavior without the repeated typing simulation. The exact test then passed at the original timeout; all original assertions remain. Evidence: `frontend/stabilization-search-threads.log` and `frontend/stabilization-search-fixed.log`. Focused runs deselect other tests and are not complete-suite passes.

A subsequent single-fork complete attempt stalled and was interrupted; it is not counted as a completed suite. A two-thread complete run finished **260 passed, 4 failed, 0 skipped**, across all 23 files, in 101.38 seconds, without worker-start errors. The original search test and corrected supplier dispatch test passed. Evidence: `frontend/stabilization-assembly-threads.log`. Its four failures were all `Error: Test timed out in 5000ms`:

- `finished-goods-traceability.test.tsx > Finished Goods material traceability > opens the original material QR from its verified traceability row` (line 154).
- `finished-goods-traceability.test.tsx > Finished Goods material traceability > preserves fractional consumed quantities from the API` (line 169).
- `pages.test.tsx > Assembly dashboard > displays API-backed metrics without Manage Orders or the removed overview` (line 144).
- `pages.test.tsx > Assembly dashboard > refreshes all dashboard sources` (line 151).

An additional definite fixture problem was found: the supplier dispatch transport test submitted 2026-10-28, now a past date. The fixture now submits today's local date, preserving pickup-date validation. Final configuration uses one thread; the five-second timeout remains unchanged.

**Final complete Assembly run: 264 passed, 0 failed, 0 skipped, all 23 files passed**, in 127.92 seconds. Evidence: `frontend/stabilization-assembly-final-thread.log`. One thread removes inter-file render/DOM contention and avoids fork startup exhaustion. No unresolved mock or production rendering loop was demonstrated. These results support the test-environment/concurrency diagnosis; they do not imply every machine has the same performance. The earlier failed runs remain in the evidence and are not presented as passes.

**Focused frontend traceability run: 44 passed, 0 failed, 0 skipped**, across `finished-goods-traceability.test.tsx`, `finished-goods-traceability-api.test.tsx` and `original-material-qr.test.tsx`, in 19.34 seconds. Evidence: `frontend/stabilization-traceability-final.log`. This is the actual three-file selection executed here, rather than the prior report's different 51-test selection. It includes original-payload scanner round-trip and fractional-consumption display coverage.

## ESLint

The three ASN-first routes passed scoped ESLint with **0 errors and 0 warnings**. No rules were disabled. The final scope also includes the two touched test files and Vitest configuration, using `--max-warnings=0`; **exit status 0, zero errors and zero warnings**. Evidence is `frontend/stabilization-eslint-all-touched.log` (empty on success). Formatting was restricted to touched files. Diff whitespace checks on session-touched code passed; a repository-wide check still identifies two pre-existing whitespace lines in the untouched Assembly API router.

## Database and migration verification

Configured application database: `ams_business`. Verified disposable target: `kaizenassests_test_fg_b978662c`. Test runner checks the actual connected database, distinct names, expected revision, five nullable fields and the historical PO foreign key before importing pytest. No configured application database was modified and no application server lifespan was started.

Current database revision and sole repository head: `20261034_optional_handling_unit_po`.

The two ASN-first migrations change exactly:

- `gate_entry.po_number`
- `gate_entry.po_document_path`
- `damage_report.po_number`
- `vehicle_exit_approval.po_id`
- `handling_unit.po_number`

`scripts/verify_asn_stabilization_migrations.py` executed the actual upgrade/downgrade functions in a transaction-local verification schema on that disposable PostgreSQL database. It verified exactly five nullable changes, an unchanged unrelated NOT NULL column, readable historical PO-linked data and the retained PO foreign key. Clean downgrade and re-upgrade passed. All **five independent NULL downgrade guards passed**. The verification schema was rolled back and its removal asserted. This is migration-function round-trip coverage against a minimal predecessor schema, **not a destructive downgrade of the populated public schema or a fresh installation of the entire historical migration chain**.

Evidence: `backend/business-service/stabilization-migrations.log`. Reproduce from the service directory with `.venv/Scripts/python.exe scripts/verify_asn_stabilization_migrations.py`.

The supplied working tree also contains unrelated startup compatibility DDL dropping NOT NULL from legacy `material_stock.material_name` and `category`, and restricting damage-claim resolutions to REPLACEMENT. These are outside the five-field ASN migration. They were not executed or broadened here, and their intended business scope needs disposition before broad release approval. Existing putaway code retains an explicit assigned-bin check before its zone/location fallback; passing putaway tests are not evidence that every legacy fallback has been audited.

## ASN-first integration verification

Final supplier authorization plus Gate API selection: **28 passed, 0 failed, 0 skipped, 8 warnings**. Evidence: `backend/business-service/stabilization-authorization-final.log` and `stabilization-authorization.xml`.

Verified on disposable PostgreSQL:

1. Supplier creates an ASN without either PO field.
2. ASN persists null PO references and the authenticated supplier ID, despite a different payload supplier ID.
3. Another supplier cannot read the ASN through list/filter, UUID/number detail or PDF routes; owner reads/PDF remain available.
4. Another supplier cannot cancel a PO-free or PO-linked ASN.
5. Another supplier cannot delete a PO-free or PO-linked ASN; persisted state remains SUBMITTED.
6. Gate Entry accepts the PO-free ASN and retains a null PO number; duplicate active entry is rejected.
7. Missing ASN number and UUID references return 404.
8. Historical PO-linked ASN creation/read and Gate Entry retain the PO reference.

Existing tests also retain invalid/mismatched/cross-supplier PO-reference rejection and off-PO material rejection. No mandatory PO validation was reintroduced.

## Backend regression results

Expanded 25-file backend selection: **131 passed, 1 failed, 0 skipped, 8 warnings** (132 tests). Evidence: `backend/business-service/stabilization-regressions-final.log` and `stabilization-regressions-final.xml`. This includes supplier ASN, Gate, Dock, GRN, Receiving QR, warehouse/putaway, Assembly validation/FG inventory and **22 PostgreSQL consumption traceability tests**. The later 28-test authorization run includes three newly added cases and overlaps this selection; counts must not be added as independent coverage.

Per-file collected counts in that 132-test selection:

| Test file | Tests | Outcome |
|---|---:|---|
| integration/test_supplier_asn_po_authorization.py | 16 | passed; expanded to 19 in final authorization run |
| integration/test_gate_api.py | 9 | passed |
| integration/test_fg_consumption_traceability.py | 22 | passed |
| unit/test_asn_supplier_e2e.py | 1 | failed, obsolete removed API |
| unit/test_asn_transport_validation.py | 11 | passed |
| unit/test_gate_module.py | 7 | passed |
| unit/test_dock_allocation.py | 7 | passed |
| unit/test_receiving_qr.py | 2 | passed |
| unit/test_grn_number_sequence.py | 6 | passed |
| unit/test_grn_putaway_quantity_limit.py | 6 | passed |
| unit/test_grn_qr.py | 3 | passed |
| unit/test_grn_dock_warehouse.py | 3 | passed |
| unit/test_grn_damage_claim_sequence.py | 4 | passed |
| unit/test_completed_grn_and_empty_zones.py | 4 | passed |
| unit/test_dock_completion_reconciliation.py | 4 | passed |
| unit/test_qr_putaway_flow.py | 1 | passed |
| unit/test_putaway_store_zone_integration.py | 3 | passed |
| unit/test_phase3_dock_release_and_putaway.py | 2 | passed |
| unit/test_comprehensive_putaway_verification.py | 1 | passed |
| unit/test_store_keeper_putaway_lifecycle.py | 1 | passed |
| unit/test_putaway_auth_and_zone_scan.py | 4 | passed |
| unit/test_warehouse_authorization_regression.py | 3 | passed |
| unit/test_warehouse_summary.py | 4 | passed |
| unit/test_assembly_reservation.py | 2 | passed |
| unit/test_assembly_fg_inventory.py | 6 | passed |

Current exact backend failure:

```text
tests/unit/test_asn_supplier_e2e.py::test_asn_creation_sends_email_to_correct_supplier
  with patch("app.modules.procurement.infrastructure.api.router.send_email", ...):
  unittest.mock -> pkgutil.resolve_name -> getattr(result, p)
AttributeError: module 'app.modules.procurement.infrastructure.api' has no attribute 'router'
```

The full trace is retained in both backend regression logs/XML. Root cause: obsolete removed-module patch target, request URL and email contract, not a demonstrated PO-free ASN defect. The current `/api/gate/asns` implementation persists notifications and does not expose this removed procurement email API. Restoring it or silently rewriting the test's email assertions would violate scope or weaken coverage, so neither was done.

Full backend collection attempt: **418 tests collected, 1 collection error**, no complete all-backend execution. Evidence: `backend/business-service/stabilization-collection.log`.

```text
ERROR collecting tests/unit/test_rfq_response.py
tests/unit/test_rfq_response.py:3:
  from app.modules.procurement.infrastructure.api.router import _to_rfq_response
ModuleNotFoundError: No module named 'app.modules.procurement.infrastructure.api.router'
```

This is a separate stale RFQ API test. No replacement `_to_rfq_response` implementation exists to point it at. Tests were not excluded or skipped. Warnings concern Pydantic/reportlab deprecations and a non-collectable helper class; the baseline additionally emitted pytest cache-write warnings.

## Production build and scope

`npm.cmd run build` passed. Evidence: `frontend/stabilization-build.log`. Vite/Nitro plugin/chunk advisories remain. No deployment occurred. No operational GRN-to-Finished-Goods E2E sequence was begun; passing prepared-data traceability tests are not claimed as that sequence.

## Remaining blockers and readiness

- Exact historical failure traces are unavailable; source-supported classifications above must not be mistaken for reconstructed original stack traces.
- Obsolete ASN email regression and RFQ collection failure require an explicit decision on the removed procurement contracts without reintroducing PO APIs.
- Complete Assembly (264 tests), focused frontend traceability (44 tests), scoped ESLint and production build are clean; these are not remaining blockers.
- Unrelated supplied business-rule/startup-DDL changes require scope disposition.
- Passing supplier/Gate tests and prepared-record PostgreSQL traceability tests do not demonstrate the complete PO-free GRN-to-FG operational path.

GRN-to-FG E2E readiness: **blocked pending the listed stabilization issues**. No production data changes, deployment, historical PO deletion, material QR identity regeneration or next-phase E2E execution occurred.

**ASN-FIRST BLOCKED**
