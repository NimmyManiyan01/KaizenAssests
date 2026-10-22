"""Isolated inventory ledger tests; run with pytest --noconftest."""
from datetime import datetime, timedelta
from decimal import Decimal
import uuid

from fastapi import HTTPException
import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.modules.assembly.infrastructure.api.router import (
    QualityInspectionPayload, perform_quality_inspection, list_assembly_finished_goods,
    get_finished_goods_inventory_summary,
)
from app.modules.assembly.infrastructure.finished_goods import allocate_fifo, post_dispatch_stock, stock_quantities
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyOrderModel, AssemblyQualityInspectionModel, AssemblyFinishedGoodsModel, AssemblyFinishedGoodsAllocationModel,
)
from app.modules.dispatch.infrastructure.persistence.models import DispatchModel, DispatchItemModel
from app.security.dependencies import CurrentUser
from app.common.persistence.models import FinishedGoodsRequestModel, NotificationModel
from app.modules.gate.infrastructure.persistence.models import FinishedGoodsPickupGateVisitModel
from app.modules.gate.infrastructure.api.router import complete_finished_goods_pickup_gate_exit, FinishedGoodsPickupGateExitPayload
from app.modules.dispatch.infrastructure.api.router import scan_dispatch_package
from app.modules.dispatch.infrastructure.api.schemas import ScanPackageRequest
from app.modules.assembly.infrastructure.api.router import allocate_supplier_finished_goods_fifo, list_supplier_finished_goods_dispatch_requests



class Uow:
    def __init__(self, session): self.session = session
    async def __aenter__(self): return self
    async def __aexit__(self, kind, value, tb):
        if kind: await self.session.rollback()
    async def commit(self): await self.session.commit()


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for model in [AssemblyOrderModel, AssemblyQualityInspectionModel, AssemblyFinishedGoodsModel,
                      DispatchModel, DispatchItemModel, AssemblyFinishedGoodsAllocationModel, FinishedGoodsRequestModel, FinishedGoodsPickupGateVisitModel, NotificationModel]:
            await conn.run_sync(model.__table__.create)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        yield db
    await engine.dispose()


async def dispatch(session, quantity, name):
    order = DispatchModel(id=uuid.uuid4(), dispatch_number=name, order_number=name,
                          customer_name="Customer", warehouse_id="ASSEMBLY", status="STOCK_RESERVED")
    item = DispatchItemModel(id=uuid.uuid4(), dispatch_order_id=order.id, material_code="PUMP",
                             material_name="Pump", quantity_ordered=quantity, uom="PCS")
    session.add_all([order, item]); await session.flush()
    return order, item


@pytest.mark.asyncio
async def test_fifo_reservations_dispatch_and_persistent_records(session):
    batches = []
    for index, qty in enumerate([5, 7]):
        order = AssemblyOrderModel(id=uuid.uuid4(), order_number=f"ASM-{index}", product_code="PUMP",
                                   product_name="Pump", completed_quantity=qty, status="COMPLETED", created_by="maker")
        fg = AssemblyFinishedGoodsModel(id=uuid.uuid4(), assembly_order_id=order.id, product_code="PUMP",
            product_name="Pump", quantity=qty, uom="PCS", status="QC_APPROVED", warehouse_id="ASSEMBLY",
            location_code="ASSEMBLY-STORAGE-01", on_hand_before=0, on_hand_after=qty,
            batch_number=f"BATCH-{index}", qr_code=f"QR-{index}", posted_at=datetime(2026, 1, 1)+timedelta(days=index))
        session.add_all([order, fg]); batches.append(fg)
    first, _ = await dispatch(session, 8, "DSP-1")
    second, second_item = await dispatch(session, 4, "DSP-2")
    third, _ = await dispatch(session, 1, "DSP-3")
    await session.commit()
    result = await allocate_fifo(session, first.id)
    assert [row["quantity"] for row in result] == [5, 3]
    assert [row["batch_number"] for row in result] == ["BATCH-0", "BATCH-1"]
    assert await allocate_fifo(session, first.id) == []  # retries cannot reserve twice
    second_result = await allocate_fifo(session, second.id)
    assert [row["quantity"] for row in second_result] == [4]
    await session.commit()
    third_id, first_id, second_item_id = third.id, first.id, second_item.id
    with pytest.raises(HTTPException, match="409"):
        await allocate_fifo(session, third_id)
    await session.rollback()
    await post_dispatch_stock(session, dispatch_id=first_id)
    await session.commit()
    # A repeated gate-out or a second gate-out path must not deduct again.
    await post_dispatch_stock(session, dispatch_id=first_id)
    await session.commit()
    second_item = await session.get(DispatchItemModel, second_item_id)
    second_item.quantity_packed = 2
    await session.commit()
    records = await list_assembly_finished_goods(search=None, uow=Uow(session), current_user=None)
    assert sum(row["produced_quantity"] for row in records) == 12
    assert sum(row["available_quantity"] for row in records) == 0
    assert sum(row["reserved_quantity"] for row in records) == 4
    assert sum(row["dispatched_quantity"] for row in records) == 8
    assert {row["batch_number"] for row in records} == {"BATCH-0", "BATCH-1"}
    summary = await get_finished_goods_inventory_summary(uow=Uow(session), current_user=None)
    assert {key: summary[key] for key in ["available", "reserved", "dispatched", "packed", "qc_approved"]} == {
        "available": 0, "reserved": 4, "dispatched": 8, "packed": 2, "qc_approved": 12,
    }


@pytest.mark.asyncio
async def test_reinspection_preserves_batch_and_does_not_replenish_dispatched_stock(session):
    order = AssemblyOrderModel(id=uuid.uuid4(), order_number="ASM-QC", product_code="PUMP", product_name="Pump",
                               completed_quantity=10, status="QC_PENDING", created_by="maker")
    session.add(order); await session.commit()
    user = CurrentUser(subject="user-1", username="manager", roles=["QC"], permissions=[], raw_claims={})
    def qc(passed):
        return QualityInspectionPayload(order_id="ASM-QC", passed_quantity=passed, rework_quantity=10-passed,
                                        inspector_name="Asha Kumar", authorized_person_confirmed=True)
    await perform_quality_inspection(qc(6), uow=Uow(session), current_user=user)
    fg = await session.scalar(select(AssemblyFinishedGoodsModel))
    identity = (fg.id, fg.batch_number, fg.qr_code, fg.posted_at)
    shipment, _ = await dispatch(session, 4, "DSP-QC")
    await allocate_fifo(session, shipment.id)
    await post_dispatch_stock(session, dispatch_id=shipment.id)
    await session.commit()
    await perform_quality_inspection(qc(8), uow=Uow(session), current_user=user)
    fg = await session.scalar(select(AssemblyFinishedGoodsModel))
    assert fg.quantity == 4  # eight passed minus four already dispatched
    assert (fg.id, fg.batch_number, fg.qr_code, fg.posted_at) == identity
    assert await session.scalar(select(func.count()).select_from(AssemblyFinishedGoodsModel)) == 1
    assert (await stock_quantities(session, fg))["dispatched_quantity"] == 4
    with pytest.raises(HTTPException):
        await perform_quality_inspection(qc(3), uow=Uow(session), current_user=user)
    fg = await session.scalar(select(AssemblyFinishedGoodsModel))
    assert fg.quantity == 4

    await perform_quality_inspection(qc(10), uow=Uow(session), current_user=user)
    with pytest.raises(HTTPException):
        await perform_quality_inspection(qc(10), uow=Uow(session), current_user=user)
    fg = await session.scalar(select(AssemblyFinishedGoodsModel))
    assert fg.quantity == 6
    assert await session.scalar(select(func.count()).select_from(AssemblyFinishedGoodsModel)) == 1


@pytest.mark.asyncio
async def test_gate_out_rejects_unallocated_assembly_stock(session):
    shipment, _ = await dispatch(session, 10, "DSP-NO-STOCK")
    await session.commit()
    with pytest.raises(HTTPException, match="409"):
        await post_dispatch_stock(session, dispatch_id=shipment.id)


@pytest.mark.asyncio
@pytest.mark.parametrize("loading_mode", ["batch", "package"])
async def test_supplier_dispatch_split_batch_loading_and_gate_exit(session, loading_mode):
    user = CurrentUser(subject="user-1", username="assembly_manager", roles=["ASSEMBLY_MANAGER"], permissions=[], raw_claims={})
    pickup = FinishedGoodsRequestModel(id=uuid.uuid4(), request_number="FGD-TEST", material_code="PUMP", material_name="Pump",
        quantity=10, warehouse="ASSEMBLY", requested_by="supplier", department="SUPPLIER", required_date=datetime.now().date(),
        status="PENDING_ASSEMBLY", supplier_name="Supplier One", vehicle_number="MH12AB1234", driver_name="Ravi Kumar", driver_contact="9876543210")
    session.add(pickup)
    for index in range(2):
        order = AssemblyOrderModel(id=uuid.uuid4(), order_number=f"ASM-SPLIT-{index}", product_code="PUMP", product_name="Pump", completed_quantity=5, status="COMPLETED", created_by="maker")
        session.add(order)
        session.add(AssemblyFinishedGoodsModel(id=uuid.uuid4(), assembly_order_id=order.id, product_code="PUMP", product_name="Pump",
            quantity=5, status="QC_APPROVED", warehouse_id="ASSEMBLY", location_code="ASSEMBLY-STORAGE-01", on_hand_before=0, on_hand_after=5,
            batch_number=f"SPLIT-{index}", qr_code=f"SPLIT-QR-{index}", posted_at=datetime(2026, 1, 1)+timedelta(days=index)))
    await session.commit()
    pickup_id = pickup.id
    await allocate_supplier_finished_goods_fifo(str(pickup_id), uow=Uow(session), current_user=user)
    requests = await list_supplier_finished_goods_dispatch_requests(uow=Uow(session), current_user=user)
    assert requests[0]["vehicle_number"] == "MH12AB1234"
    assert requests[0]["driver_name"] == "Ravi Kumar"
    assert len(requests[0]["allocated_batches"]) == 2
    dispatch_id = uuid.UUID(requests[0]["dispatch_id"])
    shipment = await session.get(DispatchModel, dispatch_id)
    shipment.status = "PACKED"
    item = await session.scalar(select(DispatchItemModel).where(DispatchItemModel.dispatch_order_id == dispatch_id))
    item.quantity_picked = 10; item.quantity_packed = 10; item.package_number = "PKG-TEST"
    await session.commit()
    with pytest.raises(HTTPException, match="409"):
        await scan_dispatch_package(str(dispatch_id), ScanPackageRequest(qr_code="SPLIT-QR-0"), db=session, _user=user)
    visit = FinishedGoodsPickupGateVisitModel(request_id=pickup_id, gate_pass_number="123456", supplier_name="Supplier One",
        vehicle_number="MH12AB1234", driver_name="Ravi Kumar", driver_contact="9876543210", security_officer="security")
    session.add(visit); await session.commit()
    visit.vehicle_number = "KA01AB1234"; await session.commit()
    with pytest.raises(HTTPException, match="409"):
        await scan_dispatch_package(str(dispatch_id), ScanPackageRequest(qr_code="SPLIT-QR-0"), db=session, _user=user)
    visit.vehicle_number = "MH12AB1234"; await session.commit()
    with pytest.raises(HTTPException, match="422"):
        await scan_dispatch_package(str(dispatch_id), ScanPackageRequest(qr_code="UNALLOCATED-QR"), db=session, _user=user)
    if loading_mode == "batch":
        first = await scan_dispatch_package(str(dispatch_id), ScanPackageRequest(qr_code="SPLIT-QR-0"), db=session, _user=user)
        assert first.items[0].quantity_loaded == 5
        with pytest.raises(HTTPException, match="409"):
            await scan_dispatch_package(str(dispatch_id), ScanPackageRequest(qr_code="SPLIT-QR-0"), db=session, _user=user)
        second = await scan_dispatch_package(str(dispatch_id), ScanPackageRequest(qr_code="SPLIT-QR-1"), db=session, _user=user)
        assert second.items[0].quantity_loaded == 10
    else:
        loaded = await scan_dispatch_package(str(dispatch_id), ScanPackageRequest(qr_code="PKG-TEST"), db=session, _user=user)
        assert loaded.items[0].quantity_loaded == 10
        with pytest.raises(HTTPException, match="409"):
            await scan_dispatch_package(str(dispatch_id), ScanPackageRequest(qr_code="PKG-TEST"), db=session, _user=user)
    summary = await get_finished_goods_inventory_summary(uow=Uow(session), current_user=user)
    assert summary["reserved"] == 10 and summary["dispatched"] == 0
    exit_payload = FinishedGoodsPickupGateExitPayload(vehicle_number="MH12AB1234", driver_name="Ravi Kumar", documents_verified=True)
    with pytest.raises(HTTPException, match="409"):
        await complete_finished_goods_pickup_gate_exit("123456", exit_payload, user=user, uow=Uow(session))
    shipment = await session.get(DispatchModel, dispatch_id)
    shipment.status = "READY_FOR_GATE_EXIT"; await session.commit()
    await complete_finished_goods_pickup_gate_exit("123456", exit_payload, user=user, uow=Uow(session))
    await post_dispatch_stock(session, dispatch_id=dispatch_id)
    await session.commit()
    summary = await get_finished_goods_inventory_summary(uow=Uow(session), current_user=user)
    assert summary["reserved"] == 0 and summary["dispatched"] == 10 and summary["available"] == 0
    assert (await session.get(DispatchModel, dispatch_id)).status == "DISPATCHED"
    final = (await list_supplier_finished_goods_dispatch_requests(Uow(session), user))[0]
    assert final["priority_rank"] == 1
    assert final["gate_exit_confirmed"]
    assert final["workflow_status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_completion_requires_gate_security_audit_and_preserves_priority(session):
    from app.modules.assembly.infrastructure.api.router import list_supplier_finished_goods_dispatch_requests
    user = CurrentUser(subject="manager", username="manager", roles=["ASSEMBLY_MANAGER"], permissions=[], raw_claims={})
    request = FinishedGoodsRequestModel(id=uuid.uuid4(), request_number="FGD-AUDIT", material_code="PUMP", material_name="Pump", quantity=1, warehouse="ASSEMBLY", department="SUPPLIER", requested_by="supplier", required_date=datetime.now().date(), status="DISPATCHED")
    session.add(request)
    visit = FinishedGoodsPickupGateVisitModel(request_id=request.id, gate_pass_number="AUD123", supplier_name="Supplier", vehicle_number="MH12AB1234", driver_name="Ravi", driver_contact="9876543210", security_officer="security", status="INSIDE_FACILITY")
    session.add(visit)
    await session.commit()
    before = (await list_supplier_finished_goods_dispatch_requests(Uow(session), user))[0]
    assert before["priority_rank"] == 1
    assert before["workflow_status"] == "AWAITING_GATE_EXIT"
    assert not before["gate_exit_confirmed"]
    visit.status = "CLOSED"
    visit.exited_at = datetime.now()
    visit.exit_approved_by = "security"
    await session.commit()
    after = (await list_supplier_finished_goods_dispatch_requests(Uow(session), user))[0]
    assert after["priority_rank"] == 1
    assert after["workflow_status"] == "COMPLETED"
    assert after["gate_exit_confirmed"]
