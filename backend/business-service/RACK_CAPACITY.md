# Rack capacity and occupancy

Warehouse > Locations now uses Warehouse > Zone > Rack. New racks require a positive integer Maximum Capacity (PCS); shelf/position is optional. A canonical bin/QR remains behind each new rack so existing QR-based putaway, inventory and picking continue to use their persisted location IDs.

## Persistence and enforcement

- `store_rack` holds one shared limit per zone/rack. Multiple legacy bins and materials share it.
- Stock balances (`inventory_location_balance.quantity`, not available/reserved quantity) are the source of physical occupancy.
- SQLite and PostgreSQL inventory-write triggers atomically maintain rack occupancy and an occupancy event ledger. PostgreSQL serializes writers on the rack row; SQLite serializes database writers. A failed movement rolls back its occupancy and ledger changes together.
- Rack assignment, putaway and transfers also perform a locked capacity check to return the exact remaining-PCS message before saving. Database triggers protect other inventory writers, including picking, issues and adjustments.
- PCS racks accept whole PCS stock. Existing non-PCS stock can still be removed; it cannot be newly added to a PCS rack.
- Capacity edits cannot fall below physical occupancy. They record the user's reason and actor.
- Existing racks are initialized once from real stock balances. Their existing bin capacity limits are summed and rounded up, with at least their current physical occupancy retained. Edit Capacity can set an approved rack limit. Startup does not reset capacities or stock.

## Actions

Add Material opens the existing putaway queue. View Materials reads exact rack/batch/location balances and saved QR references. Pick / Remove and Transfer require matching rack and batch QR scans; transfers use the existing audited transfer transaction. Empty Rack is an authorized inventory adjustment requiring explicit confirmation and a reason. It blocks reserved/unavailable stock, retains balance rows, and records stock movement history with the user and reason. It never deletes stock records.

## Schema rollout

`alembic/versions/20261021_rack_capacity.py` adds the rack tables and inventory triggers to the existing zone/bin migration branch. The same idempotent installer runs during backend startup, including local SQLite startup. The current local database has been initialized. Restart the backend if it does not reload source changes automatically.

## Verification

- 16 database/validation tests: empty, partial, full, overflow, multiple materials and batches, negative/fractional/non-PCS rejection, partial/complete picking, capacity reduction, successful/failed transfers, concurrent putaway, audit rollback and idempotent initialization.
- 15 API tests using real SQLite inventory: persisted materials/QRs, exact capacity errors, capacity edits, matching/wrong scans, removal audit, authorized emptying, stock transfers and stock adjustment synchronization, freed-space reuse after an Assembly issue, rejection of an assignment exceeding that space, and unchanged physical occupancy when stock is only reserved.
- 7 focused frontend tests; full frontend suite: 185 passed.
- Production frontend build passed. Repository-wide TypeScript checking still reports existing unrelated errors; the new rack component has no reported type errors.
- PostgreSQL trigger implementation is included; PostgreSQL runtime/concurrency tests were not run in this environment. Concurrency tests ran against SQLite.

## Reusing space after an Assembly issue

With maximum capacity 80 PCS, a confirmed physical issue of 10 PCS changes occupancy to 70 and available capacity to 10. Another material can be assigned into that 10 PCS and put away through the existing QR process. Rack QR resolution and assignment read the persisted rack occupancy, and capacity validation refreshes legacy bin/location mirrors from physical balances. Merely reserving 10 PCS does not free physical rack space.

## HTTP route ownership

The legacy store router also defined zone/bin list, next-code, and creation URLs. Registering it first bypassed the capacity-aware handlers, so the UI received no rack capacity despite correct database records. Only `location_router.zone_router` is now mounted for those URLs. HTTP-level tests verify the actual ASGI route registration, persisted capacity responses, freed-space responses, materials, and capacity-required rack creation.
