# KAIZENX FG Traceability — Phase 3 Report

## Status

**PARTIAL — API implemented; Assembly regression test suite has unresolved test failures.**

Phase 3 adds a read-only finished-goods backward traceability API. It uses the existing Phase 1/2 consumption events and QR records; it introduces no migration and does not modify production data.

## API

`GET /api/v1/assembly/finished-goods/{fg_id}/traceability`

The endpoint returns finished-goods identity, assembly order, status and warnings, verified material batches, individual consumption events, and historical consumption records that cannot be linked. Supported lookup identities are the persisted finished-goods UUID, existing QR payload, serial number, or batch number. Existing QR payload parsing requires its product code, order number, and batch number to match a single persisted row; ambiguity returns HTTP 409. Malformed identity returns 400 and an unknown identity returns 404.

The route accepts a path identity so that existing QR payloads containing slashes in their product name can be passed directly. It only reads data. It does not call the existing QR verification/update route.

## Data relationships and integrity

The API follows the established relationship chain:

`assembly_finished_goods → assembly_order → assembly_material_consumption_event → grn_batch_qr → grn_batch → grn_line → grn`

Queries preserve incomplete rows with outer joins. An event is reported as verified only when its event, original QR row, batch, material code, and GRN line consistently agree. The response returns the stored original QR payload verbatim; no replacement or new QR identity is generated. Each consumption event remains individually visible, while a grouped material/batch/QR view provides summed quantities for convenient review.

Legacy aggregated consumption without a verified event is returned as unlinked history. It is never matched to a batch from material code alone. All endpoint database operations are reads; the endpoint does not commit changes.

## Traceability statuses

- **COMPLETE**: the order has material requirements, every required material is covered by verified events, no legacy/unlinked remainder exists, and the current one-finished-goods-row-per-order relationship is unambiguous.
- **PARTIAL**: some events are verified, but one or more required materials or historical quantities are not fully linked.
- **UNLINKED**: consumption history exists but none can be verified to an original QR and GRN batch.
- **NOT_AVAILABLE**: neither event-based nor legacy consumption history is available.

Warnings expose missing order material requirements, uncovered material codes, absent supplier name snapshots, incomplete QR/batch references, and the finished-goods allocation limitation.

## Authorization and supplier information

Access is restricted to Assembly, Assembly Manager, Quality/QC, Admin/Superuser roles and the existing relevant quality permissions, with `assembly:traceability:read` also accepted. A supplier role is denied. The inspected GRN schema has supplier name snapshots but no supplier foreign key; therefore, the response reports only those snapshots and does not infer a supplier relationship or expose supplier contact details.

## Files changed for Phase 3

- `backend/business-service/app/modules/assembly/infrastructure/api/router.py` — read-only lookup, status calculation, authorization, and response assembly.
- `backend/business-service/tests/integration/test_fg_consumption_traceability.py` — traceability endpoint coverage, including two batches, repeated events, exact original QR preservation, lookup forms, incomplete history, ambiguity, authorization, and read-only behavior.
- `frontend/tests/assembly/asn-transport-validation.test.tsx` — test expectation adjusted to the rendered “Next” button while investigating earlier Assembly-suite failures.
- `frontend/tests/assembly/bom-production-quantity.test.tsx` — availability API/quantity fixtures added while investigating earlier Assembly-suite failures.
- `frontend/tests/assembly/pages.test.tsx` — availability mock and a future completion date added while investigating earlier Assembly-suite failures.

No frontend production UI source was changed for Phase 3. The test-only edits are limited to investigation; they do not resolve all associated failures and should be reviewed with the remaining Assembly test failures.

## Migration and production data

No Phase 3 migration was needed: the endpoint reads the existing Phase 1/2 event, QR, batch, GRN, and finished-goods records. No migration was executed and no production database was queried or changed.

## Automated test results

Backend command executed against the configured isolated test database (`kaizenassests_test_fg_b978662c`):

`pytest tests/integration/test_fg_consumption_traceability.py tests/unit/test_assembly_qc_authorization.py tests/unit/test_assembly_completion_date.py tests/unit/test_assembly_status_consistency.py -q -p no:cacheprovider`

**Result: 73 passed, 8 warnings.** This exercises the traceability endpoint along with relevant Assembly authorization and compatibility coverage. Python `compileall` also completed successfully for the modified router and integration test module.

Frontend Assembly test investigation used a serial Vitest worker. The three tests that had timed out under the prior full parallel run passed when run serially (13 tests passed across the three selected files). The serial full Assembly suite before the latest test-only fixture edits reported 215 passed and 5 failed across 220 tests, with no worker startup errors. A focused serial rerun after the fixture edits still has **2 failures**:

1. `asn-transport-validation.test.tsx`: the test cannot find the expected “Enter 2–100 characters” validation text in the current rendered page. The button-name expectation was corrected, but this additional mismatch remains.
2. `bom-production-quantity.test.tsx`: `adds a material beside the preview and refreshes calculated requirements` still does not observe the expected API request with the current fixture.

The selected date-submission test in `pages.test.tsx` passed after its fixture date was moved into the future. These failures are in test expectations/setup and were not changed through production business logic. The full Assembly suite has not passed, so the frontend regression gate remains open.

## Known limitations and risks

1. `assembly_finished_goods.assembly_order_id` is unique in the current schema. One finished-goods row represents the order's finished batch, and the API associates order events with that row. If future production allows multiple separate finished-goods rows per order, a consumption-to-finished-goods allocation relation will be required before claiming row-level completeness.
2. Supplier identity is only a GRN name snapshot because the current GRN model has no supplier foreign key.
3. Legacy aggregate consumption cannot be assigned to original batches without verified event links; it remains explicitly unlinked.
4. Frontend Assembly tests still have the two unresolved failures listed above. No traceability UI, QR printing/download, or Phase 4 work is included.

## Phase 4 readiness

The read-only backend traceability data path is implemented and its focused PostgreSQL integration tests pass. Phase 4 should wait until the two Assembly test failures are resolved or explicitly accepted by the project QA owner, and until the intended finished-goods allocation semantics are confirmed if one assembly order can produce multiple separately tracked finished-goods rows. This work does not implement Phase 4.
