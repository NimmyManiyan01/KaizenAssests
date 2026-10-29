# Supplier FG catalog correction

- Updated requirement: all finished goods are visible to suppliers. The previous supplier-ownership catalog filter and matching pickup-registration ownership rejection were removed as explicitly requested.
- All six local FG products are returned by the supplier catalog API. Five historical records are visible with `Assembly must create transport sections`; they are not selectable for dispatch until their section setup is explicitly completed. `FG-0003` is selectable with eight available sections.
- Registration still requires authorized supplier access, approved FG status, exactly eight transport sections, and at least one available section. Assembly QR/loading checks and atomic dispatch guards remain in place. Pickup requests retain the authenticated registering supplier identity.
- Corrected a local supplier login identity bug: browser role/name headers no longer replace the supplier UUID carried by its local login token. Supplier tokens also cannot be elevated to ADMIN using role headers.
- No historical backfill, FG ownership reassignment, or Main FG QR regeneration was performed.

## Verification

- Backend regression suite: **25 passed** on a separate disposable regression database, including all-supplier visibility, historical records displayed without section generation, rejected registration for missing sections, and two-vehicle loading/exit guards.
- Supplier login identity tests: **3 passed**.
- Supplier UI tests: **3 passed**, including visible-but-disabled historical options and the selectable ready FG.
- Actual Chrome verification at `http://localhost:8080/supplier/dispatch`: all six options visible, five historical options explain the missing sections, and selecting `FG-0003` displays its ID and eight remaining sections.
- Browser evidence: `frontend/scratch/fg-supplier-catalog/verification.json`.

## Unexpected database state and recovery

During final verification, PostgreSQL no longer contained the previously verified development clone. Read-only checks also found zero rows in the protected `ams_business` FG, order, supplier-user, material, and GRN tables. The cause of that database-state change was not established. No attempt was made to restore or modify the protected database.

Only the missing disposable clone was recovered. Recovery verified the existing backup checksum, restored its original 138-table snapshot into a newly created clone database, and applied the existing Alembic migrations. The verification FG, its order/QC record, and its eight section records were recovered from the retained regression copy with the same IDs and QR identities; no QRs were regenerated. The numbering sequence was restored beyond retained label numbers.

The recovery refused to overwrite an existing database, did not drop any tables, and verified that the protected source was left exactly as found immediately before recovery. Evidence: `backend/business-service/backups/fg-safe-clone-202610290741304887b0/clone-recovery.json`.

The local backend remains connected to `kaizenassests_test_fg_clone_202610290741304887b0`. No production configuration or deployment was changed.
