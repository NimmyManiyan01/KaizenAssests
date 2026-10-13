# KaizenX Backend Test Report

## Scope

Task 2 was limited to the four obsolete tests created for the removed procurement module. No production Python files, frontend files, or Alembic migrations were changed.

## Obsolete tests identified

The original files were archived outside pytest discovery under tests/legacy_archive/obsolete_procurement_tests/:

- test_asn_email_notification.py.txt — imported removed _dispatch_asn_email.
- test_assembly_reservation.py.txt — imported removed aggregate_requirements.
- test_material_master.py.txt — imported removed material_schemas and its deleted schema classes.
- test_supplier_identity.py.txt — imported the deleted app.modules.procurement.domain package.

The archive preserves the original test content and is not collected because the files use a .txt suffix.

## Replacement tests created

- tests/unit/test_asn_email_notification.py: current ASN ORM line quantity and supplier relationship fields.
- tests/unit/test_assembly_reservation.py: current CreateAssemblyMaterialRequestPayload positive-target and validation behavior.
- tests/unit/test_material_master.py: current MaterialModel properties, variant identity, and requested-versus-approved quantity fields.
- tests/unit/test_supplier_identity.py: current SupplierModel/SupplierUserModel ownership linkage.

Email-helper behavior remains a coverage gap because the old helper is not present.

## Current module references

- ASN and supplier models: app.common.persistence.models.
- Supplier authentication: app.security.auth_router and app.security.dependencies.
- Assembly material-request payload and API: app.modules.assembly.infrastructure.api.router.
- Material Master, variants, requests, and supplier identity models: app.common.persistence.models.
- Supplier finished-goods dispatch API: app.modules.assembly.infrastructure.api.router.

The deleted procurement-domain and material-schema imports were not restored and no compatibility shims were added.

## Files changed

- tests/unit/test_asn_email_notification.py
- tests/unit/test_assembly_reservation.py
- tests/unit/test_material_master.py
- tests/unit/test_supplier_identity.py
- tests/legacy_archive/obsolete_procurement_tests/test_asn_email_notification.py.txt
- tests/legacy_archive/obsolete_procurement_tests/test_assembly_reservation.py.txt
- tests/legacy_archive/obsolete_procurement_tests/test_material_master.py.txt
- tests/legacy_archive/obsolete_procurement_tests/test_supplier_identity.py.txt
- KAIZENX_BACKEND_TEST_REPORT.md

## Test execution

Collection command:

    D:\KaizenAssests\backend\.venv\Scripts\python.exe -m pytest --collect-only -q

Collection result:

- 156 tests collected.
- Collection errors: 0.

Full-suite command:

    D:\KaizenAssests\backend\.venv\Scripts\python.exe -m pytest -q

Full-suite result:

- Passed: 88
- Failed: 63
- Setup errors: 5
- Skipped: 0
- Blocked: 0 at collection; the suite completed execution.
- Warnings: pytest-asyncio loop-scope deprecation, Pydantic deprecations, ReportLab deprecation, and SQLAlchemy connection cleanup warnings.

## Remaining errors and failures

The five setup errors in tests/unit/test_finished_goods_requests_flow.py occur during its cleanup fixture at line 25:

    DELETE FROM finished_goods_request
    asyncpg.exceptions.ForeignKeyViolationError:
    update or delete on table "finished_goods_request" violates foreign key constraint
    "fk_assembly_finished_goods_allocation_finished_goods_re_a7cb"
    on table "assembly_finished_goods_allocation"
    DETAIL: Key (id)=(4b2db0ff-7e79-4e89-a550-febb79825065) is still referenced
    from table "assembly_finished_goods_allocation".

The 63 test failures are existing suite failures outside the four replacement files. They include:

- tests/integration/test_gate_api.py — gate/API lifecycle and OCR cases.
- tests/unit/test_asn_supplier_e2e.py — current ASN endpoint/email integration.
- tests/unit/test_assembly_custom_material_workflow.py and test_assembly_store_pickup_workflow.py — assembly/material workflows.
- tests/unit/test_canonical_material_procurement.py and test_material_master_and_requests_audit.py — legacy procurement/material endpoint assumptions.
- tests/unit/test_damaged_goods_email_flow.py — supplier/procurement notification cases.
- dispatch, dock, gate OCR, putaway, QR, store authorization, and prompt E2E tests listed in the pytest summary.

The full suite uses the configured PostgreSQL database through the existing tests/conftest.py and several existing tests perform live inserts/deletes. A truly isolated database fixture is not currently provided by the repository; creating one would require test-infrastructure changes beyond the four obsolete tests and was not introduced in this task.

## Missing test coverage

- Direct ASN notification behavior is not testable through the removed _dispatch_asn_email helper. Current ASN creation coverage should be redesigned around the surviving endpoint and notification behavior.
- There is no current procurement-domain SupplierId value object.
- There is no current material_schemas.py API schema module or replacement Material Master Pydantic schema layer.
- The current assembly request API does not expose the removed aggregate_requirements helper; requested-versus-received behavior requires endpoint/database workflow tests once the shared cleanup fixture is corrected.
- Supplier authorization ownership needs endpoint-level tests using current supplier token claims and current finished-goods dispatch routes.

## Conclusion

The four pytest collection errors are repaired without restoring the deleted procurement module. Collection succeeds, but the full backend suite is not green: 88 passed, 63 failed, and 5 setup errors. The remaining failures are preserved as actionable coverage/environment issues and were not silently skipped.
