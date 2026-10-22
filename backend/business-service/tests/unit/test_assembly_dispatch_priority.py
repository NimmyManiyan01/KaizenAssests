"""FCFS/FIFO integration tests on an isolated SQLite ledger."""
from datetime import datetime, timedelta
from decimal import Decimal
import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy import select, func
from tests.unit.test_assembly_fg_inventory import session, Uow, dispatch
from app.common.persistence.models import FinishedGoodsRequestModel
from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel, AssemblyFinishedGoodsAllocationModel, AssemblyOrderModel
from app.modules.dispatch.infrastructure.persistence.models import DispatchModel
from app.modules.assembly.infrastructure.api.router import allocate_supplier_finished_goods_fifo, list_supplier_finished_goods_dispatch_requests
from app.modules.assembly.infrastructure.finished_goods import dispatch_priorities, post_dispatch_stock, stock_quantities, allocate_fifo
from app.security.dependencies import CurrentUser

USER = CurrentUser(subject="manager", username="manager", roles=["ASSEMBLY_MANAGER"], permissions=[], raw_claims={})

async def seed(session, quantities=(5, 7)):
    for index, quantity in enumerate(quantities):
        order = AssemblyOrderModel(id=uuid.uuid4(), order_number=f"ASM-{index}", product_code="PUMP", product_name="Pump", completed_quantity=quantity, status="COMPLETED", created_by="maker")
        session.add(order)
        session.add(AssemblyFinishedGoodsModel(assembly_order_id=order.id, product_code="PUMP", product_name="Pump", quantity=quantity, status="QC_APPROVED", warehouse_id="ASSEMBLY", location_code="ASSEMBLY-STORAGE-01", on_hand_before=0, on_hand_after=quantity, batch_number=f"BATCH-{index}", qr_code=f"QR-{index}", posted_at=datetime(2026, 1, 1)+timedelta(days=index)))
    await session.commit()

async def pickup(session, name, quantity, minute, status="PENDING_ASSEMBLY"):
    row = FinishedGoodsRequestModel(id=uuid.uuid4(), request_number=name, material_code="PUMP", material_name="Pump", quantity=quantity, warehouse="ASSEMBLY", requested_by="supplier", department="SUPPLIER", required_date=datetime(2026, 12, 1).date(), expected_pickup_date=datetime(2026, 12, 1).date(), status=status, supplier_name="Supplier", vehicle_number="MH12AB1234", driver_name="Ravi Kumar", driver_contact="9876543210", created_at=datetime(2026, 1, 1)+timedelta(minutes=minute))
    session.add(row)
    await session.commit()
    return row.id

async def allocate(session, identifier):
    return await allocate_supplier_finished_goods_fifo(str(identifier), uow=Uow(session), current_user=USER)

@pytest.mark.asyncio
async def test_submission_timestamp_priority_enforced_and_fifo_stock_preserved(session):
    await seed(session)
    newer = await pickup(session, "FGD-A-NEW", 4, 2)
    older = await pickup(session, "FGD-Z-OLD", 8, 1)
    # Pickup date and insertion order must not override actual submission time.
    row = await session.get(FinishedGoodsRequestModel, newer)
    row.expected_pickup_date = datetime(2026, 1, 2).date()
    await session.commit()
    rows = await list_supplier_finished_goods_dispatch_requests(Uow(session), USER)
    assert [r["id"] for r in rows] == [str(older), str(newer)]
    assert [r["priority_rank"] for r in rows] == [1, 2]
    assert rows[0]["next_to_process"] and not rows[1]["next_to_process"]
    assert rows[0]["requested_on"] == "2026-01-01T00:01:00"
    with pytest.raises(HTTPException) as error:
        await allocate(session, newer)
    assert error.value.status_code == 409
    assert "FGD-Z-OLD" in error.value.detail
    assert await session.scalar(select(func.count()).select_from(DispatchModel)) == 0
    first = await allocate(session, older)
    assert [a["batch_number"] for a in first["allocated"]] == ["BATCH-0", "BATCH-1"]
    assert [a["quantity"] for a in first["allocated"]] == [5, 3]
    retry = await allocate(session, older)
    assert retry["already_allocated"]
    assert (await dispatch_priorities(session))[newer]["next_to_process"]
    await allocate(session, newer)
    assert await session.scalar(select(func.sum(AssemblyFinishedGoodsAllocationModel.quantity))) == 12
    shipment = await session.scalar(select(DispatchModel).where(DispatchModel.order_number == "FGD-Z-OLD"))
    await post_dispatch_stock(session, dispatch_id=shipment.id)
    await session.commit()
    await post_dispatch_stock(session, dispatch_id=shipment.id)
    await session.commit()
    batches = (await session.execute(select(AssemblyFinishedGoodsModel))).scalars().all()
    assert sum(fg.quantity for fg in batches) == 4
    quantities = [await stock_quantities(session, fg) for fg in batches]
    assert sum(q["reserved_quantity"] for q in quantities) == 4
    assert sum(q["dispatched_quantity"] for q in quantities) == 8

@pytest.mark.asyncio
async def test_shortage_does_not_block_smaller_request_and_rolls_back_partial_reservation(session):
    await seed(session, (5,))
    short = await pickup(session, "FGD-SHORT", 10, 0)
    ready = await pickup(session, "FGD-READY", 4, 1)
    states = await dispatch_priorities(session)
    assert states[short]["priority_rank"] is None
    assert "Insufficient" in states[short]["priority_reason"]
    assert states[ready]["next_to_process"]
    with pytest.raises(HTTPException) as error:
        await allocate(session, short)
    assert "Insufficient" in error.value.detail
    assert await session.scalar(select(func.count()).select_from(AssemblyFinishedGoodsAllocationModel)) == 0
    assert await session.scalar(select(func.count()).select_from(DispatchModel)) == 0
    await allocate(session, ready)
    fg = await session.scalar(select(AssemblyFinishedGoodsModel))
    assert (await stock_quantities(session, fg))["available_quantity"] == 1

@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["PACKED", "LOADED", "COMPLETED", "LOADING_STARTED", "LOADING_VERIFIED", "READY_FOR_GATE_EXIT", "DISPATCHED", "CANCELLED"])
async def test_progressed_dispatch_does_not_block_pending_even_with_stale_request_status(session, status):
    await seed(session)
    old = await pickup(session, "FGD-PROGRESSED", 1, 0)
    new = await pickup(session, "FGD-PENDING", 1, 1)
    shipment, _ = await dispatch(session, 1, "FGD-PROGRESSED")
    shipment.status = status
    await session.commit()
    states = await dispatch_priorities(session)
    assert old not in states
    assert states[new]["next_to_process"]
    await allocate(session, new)

@pytest.mark.asyncio
async def test_direct_dispatch_allocator_cannot_bypass_fcfs(session):
    await seed(session)
    await pickup(session, "FGD-OLD", 2, 0)
    await pickup(session, "FGD-NEW", 2, 1)
    shipment, _ = await dispatch(session, 2, "FGD-NEW")
    shipment.dispatch_type = "SUPPLIER_FINISHED_GOODS"
    await session.commit()
    with pytest.raises(HTTPException) as error:
        await allocate_fifo(session, shipment.id)
    assert "FGD-OLD" in error.value.detail


@pytest.mark.asyncio
async def test_concurrent_allocation_retry_reserves_once(tmp_path):
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.modules.dispatch.infrastructure.persistence.models import DispatchItemModel
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'priority.sqlite'}")
    async with engine.begin() as conn:
        for model in [AssemblyOrderModel, AssemblyFinishedGoodsModel, FinishedGoodsRequestModel, DispatchModel, DispatchItemModel, AssemblyFinishedGoodsAllocationModel]:
            await conn.run_sync(model.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as db:
            await seed(db, (5,))
            identifier = await pickup(db, "FGD-CONCURRENT", 4, 0)
        async def attempt():
            async with factory() as db:
                return await allocate(db, identifier)
        results = await asyncio.gather(attempt(), attempt())
        assert sum(bool(result.get("already_allocated")) for result in results) == 1
        async with factory() as db:
            assert await db.scalar(select(func.sum(AssemblyFinishedGoodsAllocationModel.quantity))) == 4
            fg = await db.scalar(select(AssemblyFinishedGoodsModel))
            assert (await stock_quantities(db, fg))["available_quantity"] == 1
            assert fg.quantity == 5  # reservation does not deduct physical stock
    finally:
        await engine.dispose()



@pytest.mark.asyncio
async def test_original_priority_survives_every_dispatch_stage(session):
    await seed(session)
    older = await pickup(session, "FGD-HISTORY-OLD", 2, 0)
    newer = await pickup(session, "FGD-HISTORY-NEW", 1, 1)
    await allocate(session, older)
    shipment = await session.scalar(select(DispatchModel).where(DispatchModel.order_number == "FGD-HISTORY-OLD"))
    for stage in ["STOCK_RESERVED", "PICKING_IN_PROGRESS", "PACKING_IN_PROGRESS", "PACKED", "LOADING_STARTED", "LOADING_VERIFIED", "READY_FOR_GATE_EXIT", "COMPLETED"]:
        shipment.status = stage
        await session.commit()
        rows = await list_supplier_finished_goods_dispatch_requests(Uow(session), USER)
        by_id = {row["id"]: row for row in rows}
        assert by_id[str(older)]["priority_rank"] == 1
        assert by_id[str(newer)]["priority_rank"] == 2
        assert not by_id[str(older)]["next_to_process"]
        assert by_id[str(newer)]["next_to_process"]
        assert not by_id[str(older)]["gate_exit_confirmed"]
        assert by_id[str(older)]["workflow_status"] != "COMPLETED"


@pytest.mark.parametrize("raw,expected", [
    ("PENDING_ASSEMBLY", "0"), ("APPROVED", "0"), ("STOCK_RESERVED", "1"),
    ("PICKING_IN_PROGRESS", "1"), ("PICKING_COMPLETED", "1"), ("PACKING_IN_PROGRESS", "1"),
    ("PACKED", "2"), ("LOADED", "2"), ("LOADING_VERIFIED", "2"), ("READY_FOR_GATE_EXIT", "2"),
    ("COMPLETED", "2"), ("DISPATCHED", "2"), ("CANCELLED", "COMPLETE"),
])
def test_backend_filter_groups_do_not_depend_on_stale_request_status(raw, expected):
    from types import SimpleNamespace
    from app.modules.assembly.infrastructure.api.router import _supplier_dispatch_state
    request = SimpleNamespace(status="PENDING_ASSEMBLY")
    shipment = SimpleNamespace(status=raw, gate_exit_completed_at=None, gate_exit_security_officer=None)
    assert _supplier_dispatch_state(request, shipment, None)["processing_group"] == expected


def test_standard_dispatch_security_audit_confirms_completion_without_pickup_visit():
    from types import SimpleNamespace
    from app.modules.assembly.infrastructure.api.router import _supplier_dispatch_state
    request = SimpleNamespace(status="ALLOCATED")
    shipment = SimpleNamespace(status="DISPATCHED", gate_exit_completed_at=datetime(2026, 10, 16),
        gate_exit_security_officer="security", gate_exit_vehicle_verified=True,
        gate_exit_driver_verified=True, gate_exit_loaded_goods_verified=True)
    state = _supplier_dispatch_state(request, shipment, None)
    assert state["processing_group"] == "COMPLETE"
    assert state["workflow_status"] == "COMPLETED"
    assert state["gate_exit_confirmed"]
    shipment.gate_exit_loaded_goods_verified = False
    assert not _supplier_dispatch_state(request, shipment, None)["gate_exit_confirmed"]


@pytest.mark.asyncio
async def test_product_totals_zero_stock_restock_and_fifo(session):
    from app.modules.assembly.infrastructure.api.router import list_assembly_finished_goods
    await seed(session, (2, 3))
    first = await pickup(session, "FGD-EXHAUST", 5, 0)
    waiting = await pickup(session, "FGD-RESTOCK", 1, 1)
    before = await list_assembly_finished_goods(search=None, uow=Uow(session), current_user=USER, group_by="product")
    assert len(before) == 1 and len(before[0]["batches"]) == 2
    assert before[0]["available_quantity"] == 5
    assert before[0]["produced_quantity"] == 5
    await allocate(session, first)
    reserved = (await list_assembly_finished_goods(search=None, uow=Uow(session), current_user=USER, group_by="product"))[0]
    assert reserved["available_quantity"] == 0 and reserved["reserved_quantity"] == 5
    assert reserved["status"] == "OUT_OF_STOCK" and not reserved["allocation_enabled"]
    assert not (await dispatch_priorities(session))[waiting]["allocation_eligible"]
    with pytest.raises(HTTPException):
        await allocate(session, waiting)
    # Gate exit deduction preserves history and original total produced.
    shipment = await session.scalar(select(DispatchModel).where(DispatchModel.order_number == "FGD-EXHAUST"))
    await post_dispatch_stock(session, dispatch_id=shipment.id)
    await session.commit()
    exhausted = (await list_assembly_finished_goods(search=None, uow=Uow(session), current_user=USER, group_by="product"))[0]
    assert exhausted["dispatched_quantity"] == 5
    assert exhausted["available_quantity"] == exhausted["reserved_quantity"] == 0
    # Real QC generates a new batch; the old batch rows are retained.
    from app.modules.assembly.infrastructure.api.router import QualityInspectionPayload, perform_quality_inspection
    order = AssemblyOrderModel(id=uuid.uuid4(), order_number="ASM-RESTOCK", product_code="PUMP", product_name="Pump", completed_quantity=4, status="QC_PENDING", created_by="maker")
    session.add(order)
    await session.commit()
    await perform_quality_inspection(QualityInspectionPayload(order_id="ASM-RESTOCK", passed_quantity=4, inspector_name="Asha Kumar", authorized_person_confirmed=True), uow=Uow(session), current_user=USER)
    assert (await dispatch_priorities(session))[waiting]["next_to_process"]
    replenished = (await list_assembly_finished_goods(search=None, uow=Uow(session), current_user=USER, group_by="product"))[0]
    assert len(replenished["batches"]) == 3
    assert replenished["allocation_enabled"] and replenished["available_quantity"] == 4
    result = await allocate(session, waiting)
    assert len(result["allocated"]) == 1
    assert result["allocated"][0]["batch_number"] == replenished["batches"][-1]["batch_number"]
    final = (await list_assembly_finished_goods(search=None, uow=Uow(session), current_user=USER, group_by="product"))[0]
    assert final["available_quantity"] == 3 and final["reserved_quantity"] == 1 and final["dispatched_quantity"] == 5
    assert final["produced_quantity"] == 9
    assert await session.scalar(select(func.count()).select_from(AssemblyFinishedGoodsModel)) == 3
    # Searching one historic batch retains the totals from every product batch.
    found = await list_assembly_finished_goods(search="BATCH-0", uow=Uow(session), current_user=USER, group_by="product")
    assert found[0]["available_quantity"] == final["available_quantity"]
    assert len(found[0]["batches"]) == 3
