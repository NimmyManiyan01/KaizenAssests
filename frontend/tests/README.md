# Frontend tests

Run `npm run test:assembly` from the frontend directory for Assembly component regression tests, or `npm test` for all frontend tests.

The tests render the actual dashboard, Material Requests, Production, Quality, Finished Goods, and Assembly Dispatch React pages. API calls, authentication, router navigation, toast notifications, and the application shell are mocked; dialogs, tables, inputs, and buttons use the real components. Fixtures are test-only and never replace production data.

Coverage includes KPI data and partial failures, refresh, navigation, material search/status filters, persisted quantities, workflow stages, creation dialog, physical receipt API payload, production start/completion, QC submission, finished-goods empty state, FIFO allocation, and packing handoff.

These tests require no backend or database. They do not validate backend business rules, real authentication, browser layout, printing, scanning hardware, or a complete warehouse workflow. Run the production build separately with `npm run build`.
