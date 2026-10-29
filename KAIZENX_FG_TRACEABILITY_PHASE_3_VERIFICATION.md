# KAIZENX FG Traceability — Phase 3 Regression Verification

## Result

**PHASE 4 READY**

The two reported frontend regressions have been resolved and the requested regression checks pass. Phase 3 integrity behavior is covered by the PostgreSQL integration tests below. This readiness decision means Phase 3 verification gates are clear for planning Phase 4; Phase 4 implementation has not started.

## Root cause and correction

### ASN validation

- **File:** `frontend/tests/assembly/asn-transport-validation.test.tsx`
- **Observed test expectation:** after typing `123` in Driver Name and blurring, the test expected a 2–100 character validation message.
- **Actual behavior:** the input handler calls `sanitizeAsnDriverName`, which removes digits and unsupported characters. `123` therefore becomes an empty string. On blur, the correct validation message is **“Driver name is required.”** The Next button remains disabled until the vehicle, driver, and contact values are valid. The validation rule itself was working and was not weakened.
- The test was corrected to assert the required-name message for the sanitized empty value. The displayed length guidance had mojibake in the current source file; its wording was changed to the readable equivalent “2 to 100 characters.” This is presentation text only; validation logic and criteria are unchanged.
- **Pre-Phase 3 status:** The prior Phase 3 regression report records this failure after Phase 3. There is no preserved pre-Phase 3 test run for this exact case, so a historical introduction date cannot be proven. Its cause is in the ASN input sanitization/test expectation and is independent of the Phase 3 traceability API.

### BOM add-material test

- **File:** `frontend/tests/assembly/bom-production-quantity.test.tsx`
- **Expected request:** `api.addProductBOMMaterial("FG-TEST", { material_code: "MAT-ADD", quantity_per_unit: 2 })`.
- **Actual request behavior:** when a material is selected, the page calls the existing API client method. That method POSTs to `/api/v1/assembly/products/{encoded product code}/bom/materials` with the JSON body `{ material_code, quantity_per_unit }`. Neither URL nor payload changed.
- **Root cause:** clicking Add Material starts an asynchronous warehouse availability lookup and temporarily disables the select while it clears and reloads its options. The test attempted to change the disabled select immediately, so no material was selected. The submit handler correctly stopped before the API call because the material code was empty.
- **Correction:** the test fixture now waits for the select to be enabled and for the `MAT-ADD` option to appear before selecting it. It keeps the same API URL/payload assertion and still exercises the backend validation path. No production BOM or backend validation logic was bypassed.
- **Pre-Phase 3 status:** This failure was reported after Phase 3. No preserved pre-Phase 3 run exists for the exact BOM test, so chronology cannot be established. Its cause is an asynchronous frontend test race unrelated to Phase 3 traceability.

## Files changed in this resolution

Production source:

- `frontend/src/routes/supplier.asns.new.tsx` — corrected malformed inline length-guidance text. No validation rule or input behavior changed.

Tests only:

- `frontend/tests/assembly/asn-transport-validation.test.tsx` — assert required-name feedback after the test input is sanitized to an empty value.
- `frontend/tests/assembly/bom-production-quantity.test.tsx` — wait for availability options before selecting the add-material fixture.

No database schema, GRN QR, warehouse picking, assembly consumption, finished-goods QR generation, traceability API, or dispatch behavior was modified.

## Before-and-after results

The prior Phase 3 report recorded a serial full Assembly run of 215 passed and 5 failed, including the ASN and BOM tests addressed here. The initial post-fix focused rerun exposed the correct ASN required-field message and the BOM availability timing issue; the resulting focused validation run now passes:

| Check | Before resolution | After resolution |
|---|---:|---:|
| ASN validation + BOM production-quantity files | 2 reported failures in prior run | 38 passed, 0 failed |
| Complete frontend suite, serial worker setting | 215 passed / 5 failed in prior Assembly run | 220 passed across 20 files |
| Complete Assembly frontend tests | 215 passed / 5 failed in prior run | 220 passed across 20 files |
| Finished Goods frontend page tests | Not separately recorded | 9 passed, 25 skipped by name filter |
| Phase 3 and Assembly backend regression tests | Prior verification reported 73 passed | 73 passed, 8 warnings |
| Production build | Previous verification passed | Passed |

The full frontend run used `vitest run --pool=threads --maxWorkers=1 --testTimeout=15000`; all 220 tests passed. The separate Assembly run used the same concurrency and timeout settings and also passed all 220 tests. The Finished Goods filter ran the relevant tests in `tests/assembly/pages.test.tsx`.

Backend command ran against the isolated test database `kaizenassests_test_fg_b978662c`:

`python -m pytest tests/integration/test_fg_consumption_traceability.py tests/unit/test_assembly_qc_authorization.py tests/unit/test_assembly_completion_date.py tests/unit/test_assembly_status_consistency.py -q -p no:cacheprovider`

Result: **73 passed, 8 warnings in 17.83 seconds.** The warnings are pytest-asyncio, Pydantic, and reportlab deprecations. The command used the isolated database `kaizenassests_test_fg_b978662c`; no production database was accessed.

Build command: `npm.cmd run build` — **passed** for client and server output. The build emitted existing advisories about large chunks (including WarehouseJourney) and Vite’s `vite-tsconfig-paths` plugin; neither stopped the build.

## Phase 3 integrity verification

The passing backend integration module exercises the Phase 3 read-only traceability endpoint and includes tests for:

- Returning the stored original material QR payload and keeping it immutable after consumption events reference it.
- Multiple batches of the same material being returned as separate, batch-linked consumption history.
- Historical aggregate consumption without verified event links being reported as legacy/unlinked, without assigning a GRN batch by material code.
- Existing finished-goods-to-assembly-order relationships and the existing finished-goods detail response remaining compatible.
- Read-only traceability requests, lookup forms, authorization, incomplete data, and error cases.

No finished-goods QR generation implementation was modified during this regression resolution. No migration was created or run. Backend tests were pointed to the isolated test database only.

## Remaining limitations

- There is no archived pre-Phase 3 run of these exact frontend tests, so this report cannot conclusively date their introduction, although both demonstrated causes are unrelated to Phase 3 traceability code.
- The existing Phase 3 data-model limitation remains: the schema has one finished-goods row per assembly order, so separately tracked finished-goods rows would need explicit consumption allocation.
- Build warnings about chunk sizes and the Vite path plugin remain outside this regression task.
- Phase 4 has not been started.

## Decision

**PHASE 4 READY**

Evidence: focused frontend tests pass 38/38; the full Assembly suite passes 220/220; the Phase 3 and relevant Assembly PostgreSQL tests pass 73/73 on an isolated database; and the client/server production build completes successfully. Original QR preservation, multiple-batch traceability, legacy/unlinked handling, and existing finished-goods relationships are covered by integration tests. Phase 4 has not been implemented.
