# KaizenX FG eight-section implementation

Date: 2026-10-29

## End-to-end status: PASSED (automated API flow)

The complete requested two-vehicle workflow passed against isolated PostgreSQL database `kaizenassests_test_fg_b978662c`. Production data was not modified. Nothing was deployed. The existing working tree contained extensive changes before this task; they were preserved.

Full application release validation remains BLOCKED by repository TypeScript errors. Browser, camera hardware, physical printing, and actual image file upload interactions were not exercised end to end. Automated UI and QR decoder checks are reported separately below.

## Implementation

- New FGs receive a concurrency-safe transport label such as `FG-0001`, with exactly eight linked labels `FG-0001-S01` through `FG-0001-S08` after full QC approval. Original database FG ID, batch number, Main FG QR, serial, and original-material traceability remain unchanged. The numeric transport label supplements the original identity.
- Each section stores a unique random QR identity. Parent locking, unique constraints, and idempotent generation prevent duplicate section sets. Repeated QC approval is rejected by the existing order lifecycle without generating replacements.
- New partially approved FGs reserve a transport label but receive sections only when fully approved. Historical FGs without that marker are never automatically backfilled.
- Main FG detail, list, and traceability responses include sections, per-section state, dispatch count, and derived `dispatch_status`: READY, PARTIALLY_DISPATCHED, or FULLY_DISPATCHED. This transport status is separate from the existing QC/stock status so existing QR and stock workflows remain compatible.
- Supplier registration uses a supplier-scoped FG dropdown, displays its FG transport ID and remaining available sections, and preserves vehicle, driver, contact, and pickup date fields. Supplier does not select sections or dispatch quantity. The server loads product details from the selected FG and rejects another supplier's FG or a FG without available sections.
- Supplier ownership is obtained from the existing FG request whose `work_order_id` links to the Assembly order. Ownership is not inferred from raw-material suppliers or matching product codes. Missing or ambiguous ownership does not expose the FG to any supplier; an explicit operator assignment is required.
- Existing pickup request and Gate Pass visit records are reused. Gate Entry verifies the registered transport pair, reuses the same visit on retry, prevents a section-pickup vehicle from holding another active Gate Pass, and notifies Assembly with a link to FG Loading.
- FG Loading is embedded in the existing Assembly finished-goods screen. Assembly selects available sections and scans their exact QR identities. Confirmation atomically marks them LOADED and the vehicle READY_FOR_GATE_EXIT. Multiple sections per vehicle and different vehicles for one FG are supported.
- Gate Exit displays the loaded section list, supports section QR verification, requires exactly the loaded QR set and document confirmation, records exit officer/time, and atomically changes LOADED sections to DISPATCHED. Loading itself never dispatches sections.
- Conditional SQL updates and transactional rollback prevent conflicting allocation, duplicate loading, duplicate exit, and partial mutation after an invalid scan. Loading and dispatch actor/timestamps and the linked Gate Pass preserve section history.
- Section-based requests cannot enter the existing FIFO stock-allocation endpoint. Legacy pickup/stock workflows remain available for legacy records.
- Section labels support viewing, PNG download, printing, and verification through the existing camera/upload QR input. Main QR traceability views display all eight sections alongside original GRN material traceability.
- No Purchase Orders, Dispatch Team, FG warehouse, transport allocation module, or dashboard redesign was introduced.

## Files changed in this task

Backend:

- `backend/business-service/app/common/persistence/models.py`: optional pickup request FG foreign key.
- `backend/business-service/app/modules/assembly/infrastructure/persistence/models.py`: FG transport identity/ownership and constrained section records.
- `backend/business-service/app/modules/assembly/infrastructure/sections.py`: generation, summaries, and atomic lifecycle transitions.
- `backend/business-service/app/modules/assembly/infrastructure/api/router.py`: QC integration, supplier selection/registration validation, detail/traceability extension, FG Loading APIs, legacy allocation guard.
- `backend/business-service/app/modules/gate/infrastructure/api/router.py`: existing visit workflow extended for section verification and exit.
- `backend/business-service/alembic/versions/20261036_fg_transport_sections.py`.
- `backend/business-service/alembic/versions/20261037_fg_section_numbering.py`.
- `backend/business-service/scripts/backfill_fg_sections.py`: controlled historical backfill/ownership assignment.
- `backend/business-service/scripts/run_fg_sections_tests.py`: explicitly allowlisted disposable database runner.
- `backend/business-service/tests/integration/test_fg_transport_sections.py`: end-to-end and concurrency tests.
- `backend/business-service/fg-sections-backend.xml`: final backend test evidence.

Frontend:

- `frontend/src/components/wms/fg-sections.tsx`: section labels, verification, and Assembly loading controls.
- `frontend/src/lib/api-client.ts`: supplier FG and section loading API methods; exit scan payload.
- `frontend/src/routes/assembly.finished-goods.tsx`: embedded loading, section display, and transport dispatch counts.
- `frontend/src/routes/supplier.dispatch.tsx`: supplier-scoped selection and automatic FG ID/count display.
- `frontend/src/routes/gate.finished-goods-pickup.tsx`: loaded section display and exit QR verification.
- `frontend/tests/assembly/fg-sections.test.tsx`.
- `frontend/tests/assembly/fg-section-qr-roundtrip.test.tsx`.
- `frontend/tests/assembly/supplier-dispatch-transport.test.tsx`: updated to the supplier-scoped FG contract.
- `frontend/tests/assembly/finished-goods-traceability.test.tsx`: loading API mock for the extended screen.
- `frontend/fg-sections-typecheck.log`: repository TypeScript diagnostics.
- This report.

## Database migrations

`20261036_fg_transport_sections`, following `20261035_putaway_batch_uniqueness`:

- Adds nullable FG transport label and supplier ownership fields.
- Adds nullable pickup request FK to the existing Main FG.
- Adds `finished_goods_section`, with parent/visit foreign keys, unique parent section numbers, unique Sub-IDs, unique QR identities, number range 1–8, and constrained lifecycle states.
- Contains no historical record generation or data rewrite. Downgrade refuses to delete section history.

`20261037_fg_section_numbering`:

- Adds the PostgreSQL sequence for concurrency-safe numeric FG transport labels. Sequence gaps after rolled-back transactions are acceptable; existing Main FG identities are unaffected.
- Downgrade refuses removal while section labels exist.

Both upgrades were executed only against the explicitly named disposable test database. They were not applied to production.

## Controlled historical process

The operator must explicitly set `DATABASE_URL` and supply an FG ID and confirmed supplier ID. The script does not load database credentials from `.env`.

```powershell
python scripts/backfill_fg_sections.py --fg-id <existing-fg-uuid> --supplier-id <confirmed-supplier-id>
# Review the dry-run record, then explicitly apply if appropriate:
python scripts/backfill_fg_sections.py --fg-id <existing-fg-uuid> --supplier-id <confirmed-supplier-id> --apply
```

The script locks the FG and refuses non-approved FGs, existing legacy allocation history, used sections, or an existing supplier assignment. Existing unused section sets can receive an explicit missing owner assignment without changing labels. Partial/inconsistent section sets are refused by the generator. This command was not run against production. Operator backfill itself has not been exercised in an automated CLI test.

## Tests and evidence

Backend command, from `backend/business-service`:

```powershell
.venv/Scripts/python.exe scripts/run_fg_sections_tests.py tests/integration/test_fg_transport_sections.py tests/integration/test_fg_consumption_traceability.py -q -p no:cacheprovider --junitxml=fg-sections-backend.xml
```

Result: **24 PASSED, 0 FAILED**. Existing Pydantic/reportlab deprecation warnings remain.

The new tests cover:

1. QC approval creates a Main FG and eight unique section identities.
2. QC retry does not duplicate or replace section identities.
3. Supplier ownership filtering and rejection of cross-supplier registration.
4. Supplier FG/vehicle registration, Gate Entry, and Gate Pass retry reuse.
5. S01–S03 loading; invalid scan rolls back all attempted changes.
6. Duplicate and concurrent same-visit loading rejection.
7. Loading leaves dispatched count unchanged.
8. Exit rejects an incomplete section verification set.
9. First exit records PARTIALLY_DISPATCHED, 3/8.
10. Second vehicle loads S04–S08 and exits; FG records FULLY_DISPATCHED, 8/8.
11. Duplicate exit rejection and Main FG QR preservation.
12. Unauthorized supplier access to Assembly loading is rejected.
13. Different vehicles concurrently loading the same section produce exactly one success and one conflict, with only one loading record.

The 22 existing material-consumption/traceability tests also passed, including original batch QR identity, GRN/supplier links, immutable QR payloads, material quantity guards, historical FG compatibility, and traceability access controls.

Frontend commands, from `frontend`:

```powershell
npm.cmd test -- tests/assembly/fg-sections.test.tsx tests/assembly/fg-section-qr-roundtrip.test.tsx tests/assembly/supplier-dispatch-transport.test.tsx tests/assembly/finished-goods-traceability.test.tsx --pool=forks --maxWorkers=1
```

Final combined result: **4 test files PASSED; 22 tests PASSED, 0 FAILED**. This includes the section UI, supplier vehicle form, existing FG traceability screen, and the real encoding/decoding round trip for all eight QR identities.

The default threaded Vitest worker initially timed out during startup with no tests executed. Retrying with forked workers succeeded. The QR round-trip test exercises the real QR encoder and the same `jsQR` decoder used by uploaded images; it does not simulate a browser file picker or physical camera.

`npx.cmd tsc --noEmit --pretty false`: **FAILED** due to repository errors, including duplicate API client declarations (`qr_identifier`, `getMaterialRequests`, `performBinTransfer`, `createMaterialIssue`) and errors in journey components, GRN, inventory, and vehicle-exit screens. These declarations and unrelated modules were not introduced by this task. No errors were reported in the new section component or changed supplier/Assembly/Gate screens. Diagnostics are saved in `frontend/fg-sections-typecheck.log`.

## Remaining limitations and blockers

- Full repository type checking is not green; full application build/release readiness is not claimed.
- Browser-level complete navigation, physical printing, camera capture, and actual file upload interaction remain untested.
- Missing supplier/work-order ownership relationships require explicit operator review and assignment; they are never guessed from material traceability.
- Production migrations, historical backfill, and deployment were intentionally not performed.
