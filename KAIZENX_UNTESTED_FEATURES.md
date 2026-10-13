# KaizenX Untested Features

The following features were not marked PASS:

- Exact MTU / MAT-STEEL-21C5 ASN creation and notification.
- Gate-pass QR generation/download/upload for 32CGRL.
- Dock allocation to RM-01 for the requested vehicle.
- GRN reconciliation of 100 received, 90 accepted, and 10 damaged.
- Damage return and supplier association for the requested 10 PCS.
- Accepted-material QR traceability to the requested GRN and batch.
- 90-PCS putaway and 80-PCS post-issue inventory reconciliation.
- Assembly request, reservation, picking, issue, and separate assembly receipt for 10 PCS.
- Production output based on the actual product BOM.
- Finished-goods QC and QR verification.
- Multi-batch FIFO verification.
- Packing, dispatch, outbound gate exit, and saved exit timestamp.
- Inbound vehicle exit.
- Browser Playwright/UI workflow verification.
- Persistence verification across a backend restart.
- Responsive-layout verification.

Reasons:

1. The only matching ASN number contains a different material code.
2. The requested gate pass and material code are absent.
3. The repository has no isolated test-database fixture for the full workflow.
4. The full backend suite has failures and cleanup foreign-key errors.
5. Frontend lint fails with 2,627 reported problems.
