"""Regression coverage for Assembly status aliases and material detail responses."""
from datetime import datetime
import uuid
import pytest

from tests.unit.test_assembly_fg_inventory import session, Uow
from app.common.persistence.models import MaterialRequestModel, MaterialRequestItemModel, MaterialIssueModel, PickTaskModel
from app.modules.storage.infrastructure.persistence.models import InventoryLocationBalanceModel
from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel, AssemblyQualityInspectionModel
from app.modules.assembly.infrastructure.api.router import (
    _material_fulfillment, list_quality_inspections, list_assembly_material_requests, get_assembly_material_request_detail,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("raw,rework,held,group", [
    ("QC_APPROVED", 0, 0, "PASSED"), ("PASSED", 0, 0, "PASSED"),
    ("PARTIALLY_APPROVED", 2, 0, "REWORK"), ("PARTIALLY_APPROVED", 0, 2, "HELD"),
    ("PARTIALLY_APPROVED", 0, 0, "PARTIALLY_APPROVED"), ("REJECTED", 0, 0, "FAILED"),
])
async def test_quality_filters_match_persisted_statuses(session, raw, rework, held, group):
    order = AssemblyOrderModel(id=uuid.uuid4(), order_number="ASM-STATUS", product_name="Pump", created_by="maker", completed_quantity=10, status="COMPLETED")
    session.add(order)
    session.add(AssemblyQualityInspectionModel(assembly_order_id=order.id, produced_quantity=10, passed_quantity=10,
        rework_quantity=rework, held_quantity=held, status=raw, inspected_by="Status Inspector"))
    await session.commit()
    rows = await list_quality_inspections(status=group, search="Status Inspector", uow=Uow(session), current_user=None)
    assert len(rows) == 1
    assert rows[0]["qc_status"] == raw  # Stored/API status is preserved.
    assert rows[0]["qc_status_group"] == group
    assert not rows[0]["can_inspect"]
    assert len(await list_quality_inspections(status=raw, search=None, uow=Uow(session), current_user=None)) == 1


def test_fulfillment_uses_issue_ledger_and_actual_receipts():
    data = _material_fulfillment("MAT-1", 10, [{"material_code": "mat-1", "received_quantity": 6}],
        [{"material_code": "MAT-1", "issued_quantity": 4}, {"material_code": "mat-1", "issued_quantity": 6}])
    assert data == {"required_quantity": 10, "issued_quantity": 10, "received_quantity": 6, "shortage": 4}
    assert _material_fulfillment("MAT-2", 10, [], [])["issued_quantity"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("production_status", ["IN_PRODUCTION", "QC_PENDING", "COMPLETED"])
async def test_request_list_and_detail_preserve_actual_quantities_and_order_status(session, production_status):
    async with session.bind.begin() as conn:
        for model in [MaterialRequestModel, MaterialRequestItemModel, MaterialIssueModel, PickTaskModel, InventoryLocationBalanceModel]:
            await conn.run_sync(model.__table__.create)
    request = MaterialRequestModel(id=uuid.uuid4(), request_number="MR-STATUS", warehouse_id="WH-1", department="Assembly", requested_by="manager", required_date=datetime.now().date(), status="ISSUED")
    issue = MaterialIssueModel(id=uuid.uuid4(), issue_number="ISS-STATUS", request_id=request.id,
        items=[{"material_code": "MAT-1", "issued_quantity": 10}])
    order = AssemblyOrderModel(id=uuid.uuid4(), order_number="ASM-DETAIL", product_name="Pump", created_by="maker",
        status=production_status, material_request_id=request.id, material_issue_id=issue.id,
        material_received_at=datetime.now(), items=[{"material_code": "MAT-1", "required_quantity": 10, "received_quantity": 8}])
    session.add_all([request, issue, order, MaterialRequestItemModel(request_id=request.id, material_code="MAT-1", material_name="Motor", quantity=10, uom="PCS")])
    # A completed pick must never overwrite the real production status.
    session.add(PickTaskModel(request_id=request.id, department="Assembly", task_number="PICK-STATUS", completed_at=datetime.now(), status="COMPLETED"))
    await session.commit()
    rows = await list_assembly_material_requests(search=None, status=None, uow=Uow(session), current_user=None)
    detail = await get_assembly_material_request_detail(str(request.id), uow=Uow(session), current_user=None)
    assert rows[0]["order_status"] == detail["order_status"] == production_status
    assert rows[0]["status"] == detail["status"] == "RECEIVED"
    assert request.status == "ISSUED"  # Read-only normalization never rewrites historical data.
    for field in ["required_quantity", "issued_quantity", "received_quantity", "shortage"]:
        assert rows[0]["items"][0][field] == detail["items"][0][field]
    assert detail["items"][0]["issued_quantity"] == 10
    assert detail["items"][0]["received_quantity"] == 8


@pytest.mark.asyncio
@pytest.mark.parametrize("received,expected_status", [(10, "rejected"), (1, "MATERIAL_SHORTAGE")])
async def test_receipt_uses_one_issued_unit_instead_of_ten_requested(session, received, expected_status):
    from fastapi import HTTPException
    from app.common.persistence.models import NotificationModel
    from app.modules.assembly.infrastructure.persistence.models import AssemblyMaterialReceiptModel
    from app.modules.assembly.infrastructure.api.router import confirm_assembly_material_receipt, ConfirmMaterialReceiptPayload
    async with session.bind.begin() as conn:
        for model in [MaterialRequestModel, MaterialIssueModel, PickTaskModel, AssemblyMaterialReceiptModel]:
            await conn.run_sync(model.__table__.create)
    request = MaterialRequestModel(id=uuid.uuid4(), request_number="MR-ONE", warehouse_id="WH-1", department="Assembly", requested_by="manager", required_date=datetime.now().date(), status="ISSUED")
    issue = MaterialIssueModel(id=uuid.uuid4(), issue_number="ISS-ONE", request_id=request.id,
        items=[{"material_code": "MAT-1", "issued_quantity": 1}])
    order = AssemblyOrderModel(id=uuid.uuid4(), order_number="ASM-ONE", product_name="Pump", created_by="maker",
        status="MATERIAL_ISSUED", material_request_id=request.id, material_issue_id=issue.id,
        items=[{"material_code": "MAT-1", "required_quantity": 10}])
    session.add_all([request, issue, order])
    await session.commit()
    payload = ConfirmMaterialReceiptPayload(received_items=[{"material_code": "MAT-1", "received_quantity": received}])
    if expected_status == "rejected":
        with pytest.raises(HTTPException) as exc:
            await confirm_assembly_material_receipt(str(request.id), payload, Uow(session), None)
        assert exc.value.status_code == 422
        assert "exceeds issued" in exc.value.detail
    else:
        result = await confirm_assembly_material_receipt(str(request.id), payload, Uow(session), None)
        assert result["order_status"] == expected_status
        assert result["items"][0]["issued_quantity"] == 1
        assert result["items"][0]["received_quantity"] == 1
        assert "production is blocked" in result["message"]


@pytest.mark.asyncio
async def test_receipt_combines_duplicate_material_lines_without_double_counting(session):
    from app.modules.assembly.infrastructure.persistence.models import AssemblyMaterialReceiptModel
    from app.modules.assembly.infrastructure.api.router import confirm_assembly_material_receipt, ConfirmMaterialReceiptPayload
    from sqlalchemy import select
    from fastapi import HTTPException
    async with session.bind.begin() as conn:
        for model in [MaterialRequestModel, MaterialRequestItemModel, MaterialIssueModel, PickTaskModel, AssemblyMaterialReceiptModel]:
            await conn.run_sync(model.__table__.create)
    request = MaterialRequestModel(id=uuid.uuid4(), request_number="MR-DUP", warehouse_id="WH-1", department="Assembly", requested_by="manager", required_date=datetime.now().date(), status="ISSUED")
    issue = MaterialIssueModel(id=uuid.uuid4(), issue_number="ISS-DUP", request_id=request.id,
        items=[{"material_code": "MAT-1", "issued_quantity": 10}, {"material_code": "MAT-1", "issued_quantity": 10}])
    order = AssemblyOrderModel(id=uuid.uuid4(), order_number="ASM-DUP", product_name="Pump", created_by="maker", status="MATERIAL_ISSUED", material_request_id=request.id, material_issue_id=issue.id,
        items=[{"material_code": "MAT-1", "required_quantity": 10, "received_quantity": 0}, {"material_code": "MAT-1", "required_quantity": 10, "received_quantity": 0}])
    session.add_all([request, issue, order])
    for _ in range(2):
        session.add(MaterialRequestItemModel(request_id=request.id, material_code="MAT-1", material_name="Motor", quantity=10, uom="PCS"))
    await session.commit()
    identifier = str(request.id)
    detail = await get_assembly_material_request_detail(identifier, uow=Uow(session), current_user=None)
    assert len(detail["items"]) == 1
    assert detail["items"][0]["quantity"] == detail["items"][0]["issued_quantity"] == 20
    result = await confirm_assembly_material_receipt(identifier, ConfirmMaterialReceiptPayload(received_items=[{"material_code": "MAT-1", "received_quantity": 20}]), Uow(session), None)
    assert result["order_status"] == "MATERIAL_READY"
    assert len(result["items"]) == 1
    assert result["items"][0]["required_quantity"] == 20
    receipts = (await session.execute(select(AssemblyMaterialReceiptModel))).scalars().all()
    assert len(receipts) == 1
    assert receipts[0].issued_quantity == receipts[0].received_quantity == 20
    with pytest.raises(HTTPException) as error:
        await confirm_assembly_material_receipt(identifier, None, Uow(session), None)
    assert error.value.status_code == 409
