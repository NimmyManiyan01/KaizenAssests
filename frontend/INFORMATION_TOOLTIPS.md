# Information tooltip implementation and coverage

The frontend uses `InformationTooltip` from `src/components/ui/information-tooltip.tsx`.
Copy is centralized in `src/lib/information-help.ts`; no API calls or database writes are involved.

```tsx
<InformationTooltip help="batch" />
```

Use `placement="title"` immediately after a main heading for an 8px gap.
Context triggers use a 6px gap. Field help is a sibling of its label, outside the label
and outside action buttons. This preserves the label/input association and avoids
accidental submissions or checkbox changes.

Desktop uses the existing Radix Tooltip primitives for hover/focus. Touch devices use
the existing Radix Popover primitives for tap, outside dismissal, Escape and focus return.
Both display the same registry content. Content is portalled, collision-aware, padded
16px from viewport edges, width-constrained on small screens and vertically scrollable.
Each trigger has an accessible name and visible keyboard focus indicator.

## Placement coverage

All **37 existing operational route definitions** have page-help mappings. Redirect-only
routes retain their existing destination; help appears on that destination. Login,
the root redirect and error pages are outside the operational module scope.

AppShell owns each standard page-title icon. Inventory has a single custom title icon
that selects help for its **six views**: dashboard, putaway, inventory, requisitions,
picking, and locations. Existing supplier title icons were removed to prevent duplication.

| Module | Existing surfaces covered |
| --- | --- |
| Supplier | Dashboard, material master, dispatch requests, damage returns |
| Procurement | GRN optional PO reference; no standalone Procurement route exists in this checkout |
| ASN | Page title, vehicle, driver, contact, arrival date, quantity and complex progress/quantity columns |
| Gate | Dashboard, vehicle queue, vehicle exit, finished-goods pickup entry/exit |
| Dock | Allocation title, dock-selection field and existing redirect destination |
| GRN | Main title, reconciliation, batches, saved QR generation, damage evidence and report export |
| QC | Quality page title and QC breakdown/status columns |
| Warehouse | Dashboard, locations, first-zone destination and requisition/picking workspace |
| Putaway | Workspace title, scan field help and confirmation help outside the button |
| Inventory | Workspace title and availability/status columns |
| Assembly | Dashboard, requests, material requests, production progress and reserved-stock columns |
| Finished Goods | Records title, quality eligibility and status column |
| Dispatch | Orders, picking/packing, loading, gate-out, exceptions and package QR help |
| Reports | GRN CSV-export help outside the action; no standalone Reports route exists in this checkout |
| Notifications | Page-title help in main content only |

There are **39 centralized help topics**. Each has a purpose, instructions and next step;
validation rules and example values are included when relevant. Basic fields and basic
table columns deliberately receive no extra icon. Existing non-information tooltips on
ordinary controls are retained where they do not conflict with navigation restrictions.

No information triggers are added to sidebars, navigation menus or the global header.
The former header notification tooltip and native navigation `title` attributes were removed.

## Automated verification

`information-tooltip.test.tsx` exercises every one of the 39 topics on keyboard focus,
checks their content and Escape dismissal, and covers desktop hover, mobile tap/toggle,
mobile Escape/focus restoration, viewport width constraints and form/checkbox safety.

`information-help-coverage.test.tsx` audits every operational route and inventory view,
forbids tooltips in navigation/header/sidebar markup, and forbids information triggers
inside action buttons or links.

Regression checks also exercise ASN transport details, pickup-date validation, QR
download/print/preview, first-dock setup, saved GRN batch loading, damage photo preview,
and requisition-to-picking refresh. These tests use JSDOM and do not change live data.

Commands:

```text
npm.cmd test -- --maxWorkers=2
node node_modules/vite/bin/vite.js build
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

Results: **164 tests passed across 11 files**, including **46 information-tooltip
behavior and placement checks**. The production build succeeds. The repository-wide TypeScript check reports existing
errors in Journey components and existing workflow types/notification references; it
reports no errors in the new tooltip component or centralized help registry. Physical
device testing and a live end-to-end walkthrough of every workflow were not performed.

Backend code, schemas, database contents, API behavior, validation rules and operational
actions are unchanged by this tooltip implementation.
