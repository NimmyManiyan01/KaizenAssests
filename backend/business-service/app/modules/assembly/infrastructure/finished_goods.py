"""Assembly FG reservation and gate-out ledger shared by both dispatch flows."""
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, select, update

from app.common.persistence.models import FinishedGoodsRequestModel
from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel, AssemblyFinishedGoodsAllocationModel
from app.modules.dispatch.infrastructure.persistence.models import DispatchModel, DispatchItemModel


async def stock_quantities(session, fg):
    allocations = (await session.execute(select(AssemblyFinishedGoodsAllocationModel).where(
        AssemblyFinishedGoodsAllocationModel.finished_goods_id == fg.id
    ))).scalars().all()
    reserved = sum((a.quantity for a in allocations if a.status in ("ALLOCATED", "LOADED")), Decimal("0"))
    dispatched = sum((a.quantity for a in allocations if a.status == "DISPATCHED"), Decimal("0"))
    return {"produced_quantity": fg.quantity + dispatched, "available_quantity": max(Decimal("0"), fg.quantity - reserved),
            "reserved_quantity": reserved, "dispatched_quantity": dispatched}


async def dispatch_priorities(session, lock=False):
    """FCFS across supplier pickups which can be fully fulfilled now."""
    pending = (FinishedGoodsRequestModel.warehouse == "ASSEMBLY",
               FinishedGoodsRequestModel.department == "SUPPLIER",
               FinishedGoodsRequestModel.status.in_(["PENDING_ASSEMBLY", "APPROVED"]))
    if lock and session.bind.dialect.name == "sqlite":
        # SQLite ignores FOR UPDATE. Acquire its write lock before reading stock.
        await session.execute(update(FinishedGoodsRequestModel).where(*pending).values(
            status=FinishedGoodsRequestModel.status).execution_options(synchronize_session=False))
    query = select(FinishedGoodsRequestModel).where(*pending).order_by(
        FinishedGoodsRequestModel.created_at, FinishedGoodsRequestModel.id)
    rows = (await session.execute(query.with_for_update() if lock else query)).scalars().all()
    batches_query = select(AssemblyFinishedGoodsModel).where(
        AssemblyFinishedGoodsModel.status.in_(["QC_APPROVED", "AVAILABLE"]),
        AssemblyFinishedGoodsModel.quantity > 0,
    ).order_by(AssemblyFinishedGoodsModel.posted_at, AssemblyFinishedGoodsModel.id)
    batches = (await session.execute(batches_query.with_for_update() if lock else batches_query)).scalars().all()
    available = {}
    for fg in batches:
        available[fg.product_code] = available.get(fg.product_code, Decimal("0")) + (await stock_quantities(session, fg))["available_quantity"]
    dispatches = (await session.execute(select(DispatchModel).where(
        DispatchModel.order_number.in_([row.request_number for row in rows])))).scalars().all()
    progressed = {d.order_number for d in dispatches if d.status not in ("DRAFT", "PENDING", "CREATED", "STOCK_RESERVED")}
    allocations = (await session.execute(select(AssemblyFinishedGoodsAllocationModel).where(
        AssemblyFinishedGoodsAllocationModel.finished_goods_request_id.in_([row.id for row in rows]),
        AssemblyFinishedGoodsAllocationModel.status.in_(["ALLOCATED", "LOADED", "DISPATCHED"]),
    ))).scalars().all()
    allocated = {a.finished_goods_request_id for a in allocations}
    result = {}
    rank = 0
    for row in rows:
        if row.request_number in progressed or row.id in allocated:
            continue
        logistics_ready = all(str(value or "").strip() for value in (row.vehicle_number, row.driver_name, row.driver_contact))
        sufficient = logistics_ready and available.get(row.material_code, Decimal("0")) >= row.quantity
        if sufficient:
            rank += 1
        result[row.id] = {"priority_rank": rank if sufficient else None,
                          "next_to_process": sufficient and rank == 1,
                          "allocation_eligible": sufficient,
                          "priority_reason": None if sufficient else ("Supplier vehicle or driver details are missing" if not logistics_ready else "Insufficient available finished-goods stock")}
    return result


async def enforce_dispatch_priority(session, request_id):
    priorities = await dispatch_priorities(session, lock=True)
    entry = priorities.get(request_id)
    if entry and not entry["allocation_eligible"]:
        raise HTTPException(409, entry["priority_reason"])
    if entry is None:
        request = await session.get(FinishedGoodsRequestModel, request_id)
        if request and request.status in ("PENDING_ASSEMBLY", "APPROVED"):
            raise HTTPException(409, "This pickup already has dispatch progress. Refresh and continue its current step.")
    if entry and not entry["next_to_process"]:
        first_id = next(key for key, value in priorities.items() if value["next_to_process"])
        first = await session.get(FinishedGoodsRequestModel, first_id)
        raise HTTPException(409, f"Process older eligible request {first.request_number} first (FCFS submission priority).")


async def allocate_fifo(session, dispatch_id, request_id=None):
    # Resolve supplier identity before taking dispatch/batch locks so every
    # supplier allocation path uses the same request -> batch -> dispatch order.
    dispatch = await session.get(DispatchModel, dispatch_id)
    if not dispatch:
        raise HTTPException(404, "Dispatch order not found")
    if request_id is None and dispatch.dispatch_type == "SUPPLIER_FINISHED_GOODS":
        request = (await session.execute(select(FinishedGoodsRequestModel).where(
            FinishedGoodsRequestModel.request_number == dispatch.order_number))).scalar_one_or_none()
        if request:
            request_id = request.id
    if request_id is not None:
        await enforce_dispatch_priority(session, request_id)
    dispatch = (await session.execute(select(DispatchModel).where(DispatchModel.id == dispatch_id).with_for_update())).scalar_one()
    items = (await session.execute(select(DispatchItemModel).where(DispatchItemModel.dispatch_order_id == dispatch_id).order_by(DispatchItemModel.material_code, DispatchItemModel.id))).scalars().all()
    if not items:
        raise HTTPException(409, "Dispatch has no finished-goods items")
    result = []
    for item in items:
        # All allocators lock the same batches before reading reservations.
        batches = (await session.execute(select(AssemblyFinishedGoodsModel).where(
            AssemblyFinishedGoodsModel.product_code == item.material_code,
            AssemblyFinishedGoodsModel.status.in_(["QC_APPROVED", "AVAILABLE"]),
            AssemblyFinishedGoodsModel.quantity > 0,
        ).order_by(AssemblyFinishedGoodsModel.posted_at, AssemblyFinishedGoodsModel.id).with_for_update())).scalars().all()
        if session.bind.dialect.name == "sqlite" and batches:
            await session.execute(update(AssemblyFinishedGoodsModel).where(
                AssemblyFinishedGoodsModel.id.in_([fg.id for fg in batches])).values(
                quantity=AssemblyFinishedGoodsModel.quantity).execution_options(synchronize_session=False))
        existing = (await session.execute(select(AssemblyFinishedGoodsAllocationModel).where(
            AssemblyFinishedGoodsAllocationModel.dispatch_item_id == item.id,
            AssemblyFinishedGoodsAllocationModel.status.in_(["ALLOCATED", "LOADED", "DISPATCHED"]),
        ))).scalars().all()
        remaining = max(Decimal("0"), item.quantity_ordered - sum((a.quantity for a in existing), Decimal("0")))
        if remaining and dispatch.status in ("GATE_OUT", "EXIT_COMPLETED", "DISPATCHED", "CANCELLED"):
            raise HTTPException(409, "Dispatch no longer accepts stock allocations")
        for fg in batches:
            if remaining <= 0:
                break
            quantities = await stock_quantities(session, fg)
            available = quantities["available_quantity"]
            quantity = min(remaining, available)
            if quantity <= 0:
                continue
            allocation = AssemblyFinishedGoodsAllocationModel(finished_goods_id=fg.id, finished_goods_request_id=request_id,
                dispatch_order_id=dispatch_id, dispatch_item_id=item.id, quantity=quantity, status="ALLOCATED")
            session.add(allocation)
            await session.flush()
            remaining -= quantity
            result.append({"dispatch_item_id": str(item.id), "finished_goods_id": str(fg.id), "batch_number": fg.batch_number,
                           "product_code": fg.product_code, "quantity": float(quantity), "qr_code": fg.qr_code,
                           "posted_at": fg.posted_at.isoformat(), "location_code": fg.location_code})
        if remaining > 0:
            raise HTTPException(409, f"Insufficient Assembly finished-goods stock for {item.material_code}. Short by {remaining:g} {item.uom}.")
        item.quantity_reserved = item.quantity_ordered
        item.quantity_available = item.quantity_ordered
        item.quantity_pending = Decimal("0")
        if item.status in ("PENDING", "RESERVED"):
            item.status = "RESERVED"
    return result


async def post_dispatch_stock(session, dispatch_id=None, request_id=None):
    query = select(AssemblyFinishedGoodsAllocationModel).where(AssemblyFinishedGoodsAllocationModel.status.in_(["ALLOCATED", "LOADED"]))
    query = query.where(AssemblyFinishedGoodsAllocationModel.dispatch_order_id == dispatch_id) if dispatch_id else query.where(AssemblyFinishedGoodsAllocationModel.finished_goods_request_id == request_id)
    allocations = (await session.execute(query.order_by(AssemblyFinishedGoodsAllocationModel.finished_goods_id).with_for_update())).scalars().all()
    if dispatch_id and not allocations:
        dispatch = await session.get(DispatchModel, dispatch_id)
        posted = (await session.execute(select(AssemblyFinishedGoodsAllocationModel.id).where(
            AssemblyFinishedGoodsAllocationModel.dispatch_order_id == dispatch_id,
            AssemblyFinishedGoodsAllocationModel.status == "DISPATCHED",
        ).limit(1))).scalar_one_or_none()
        if dispatch and dispatch.warehouse_id in ("ASSEMBLY", "ASSEMBLY-WH") and not posted:
            raise HTTPException(409, "Allocate Assembly finished-goods stock before gate exit")
    for allocation in allocations:
        # Claim each ledger line once, including on SQLite where FOR UPDATE is
        # ignored. Stock subtraction is atomic across different dispatches.
        claimed = await session.execute(update(AssemblyFinishedGoodsAllocationModel).where(
            AssemblyFinishedGoodsAllocationModel.id == allocation.id,
            AssemblyFinishedGoodsAllocationModel.status.in_(["ALLOCATED", "LOADED"]),
        ).values(status="DISPATCHED").execution_options(synchronize_session=False))
        if not claimed.rowcount:
            continue
        changed = await session.execute(update(AssemblyFinishedGoodsModel).where(
            AssemblyFinishedGoodsModel.id == allocation.finished_goods_id,
            AssemblyFinishedGoodsModel.quantity >= allocation.quantity,
        ).values(
            quantity=AssemblyFinishedGoodsModel.quantity - allocation.quantity,
            on_hand_after=AssemblyFinishedGoodsModel.quantity - allocation.quantity,
            status=case((AssemblyFinishedGoodsModel.quantity == allocation.quantity, "DISPATCHED"), else_=AssemblyFinishedGoodsModel.status),
            updated_at=datetime.now(),
        ).execution_options(synchronize_session=False))
        if not changed.rowcount:
            raise HTTPException(409, "Assembly finished-goods stock is insufficient for gate exit")
        fg = await session.get(AssemblyFinishedGoodsModel, allocation.finished_goods_id)
        await session.refresh(fg)
        allocation.status = "DISPATCHED"
        if allocation.finished_goods_request_id:
            request = await session.get(FinishedGoodsRequestModel, allocation.finished_goods_request_id)
            if request:
                request.status = "DISPATCHED"
    await session.flush()
