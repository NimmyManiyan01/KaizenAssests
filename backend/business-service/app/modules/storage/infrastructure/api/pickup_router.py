"""
API Router for Outbound Material Request Store Pickup Tasks (Phase 7).
Enforces strict store-scoped access, IDOR protection, Material QR validation,
Store Zone validation, concurrency locking, and auditable inventory issue transactions.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import uuid
from decimal import Decimal
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.database.session import UnitOfWork, get_uow
from app.common.persistence.models import (
    MaterialModel,
    MaterialStockModel,
    NotificationModel,
)
from app.modules.quarantine.infrastructure.persistence.models import QuarantineRecordModel
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionItemModel,
    AssemblyRequisitionModel,
    AssemblyStockReservationModel,
    HandlingUnitModel,
    InventoryIssueTransactionModel,
    InventoryLocationBalanceModel,
    InventoryMovementHistoryModel,
    PickupTaskModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreManagerUserModel,
    StoreModel,
    StoreZoneModel,
)
from app.security.dependencies import CurrentUser, get_current_user

pickup_router = APIRouter(prefix="/api/storage/pickup-tasks", tags=["pickup-tasks"])


class CompletePickupTaskRequest(BaseModel):
    material_scan: str = Field(..., description="Scanned Material QR payload or item code")
    batch_number: Optional[str] = Field(None, description="Batch on the scanned material label when material QR is shared")
    zone_scan: str = Field(..., description="Scanned Zone QR payload, ID, or zone code")
    quantity: Decimal = Field(..., description="Confirmed picked quantity")
    confirmation_id: Optional[str] = Field(None, max_length=64)


def _confirmation_digest(*parts: Any) -> str:
    normalized = [str(part or "").strip().upper() for part in parts]
    return hashlib.sha256(json.dumps(normalized, separators=(",", ":")).encode("utf-8")).hexdigest()


async def _resolve_user_store_context(uow: UnitOfWork, user: CurrentUser) -> tuple[Optional[uuid.UUID], Optional[str]]:
    """Resolve store_id and store_code for a Store Manager or Store Keeper user."""
    claims = getattr(user, "raw_claims", {}) or {}
    store_id_str = claims.get("store_id")
    store_code = claims.get("store_code")

    if store_id_str:
        try:
            return uuid.UUID(str(store_id_str)), store_code
        except ValueError:
            pass

    # Lookup in StoreManagerUserModel
    username = user.username or ""
    stmt = (
        select(StoreManagerUserModel)
        .options()
        .where(
            or_(
                func.lower(StoreManagerUserModel.username) == username.lower(),
                func.lower(StoreManagerUserModel.employee_id) == username.lower(),
            )
        )
    )
    res = await uow.session.execute(stmt)
    mgr = res.scalars().first()
    if mgr:
        store_code_val = store_code
        if not store_code_val and mgr.store_id:
            store_res = await uow.session.execute(select(StoreModel.store_code).where(StoreModel.id == mgr.store_id))
            store_code_val = store_res.scalar_one_or_none()
        return mgr.store_id, store_code_val

    # Lookup by store_code if available
    if store_code:
        store_res = await uow.session.execute(
            select(StoreModel.id).where(
                or_(
                    func.lower(StoreModel.store_code) == store_code.lower(),
                    func.lower(StoreModel.store_name).like(f"%{store_code.lower()}%"),
                )
            )
        )
        s_id = store_res.scalar_one_or_none()
        if s_id:
            return s_id, store_code

    return None, store_code


def _format_pickup_task(t: PickupTaskModel) -> dict[str, Any]:
    req_id = str(getattr(t, "requisition_id", None) or getattr(t, "request_id", ""))
    req_no = getattr(t, "requisition_number", None) or getattr(t, "request_number", "")
    return {
        "id": str(t.id),
        "task_number": t.task_number,
        "requisition_id": req_id,
        "requisition_number": req_no,
        "request_id": req_id,
        "request_number": req_no,
        "store_id": str(t.store_id),
        "store_code": t.store_code,
        "store_name": t.store_name,
        "department": t.department,
        "material_code": t.material_code,
        "material_name": t.material_name,
        "requested_quantity": float(t.requested_quantity),
        "picked_quantity": float(t.picked_quantity),
        "remaining_quantity": float(t.requested_quantity - t.picked_quantity),
        "uom": t.uom,
        "priority": t.priority,
        "required_date": t.required_date.isoformat() if t.required_date else None,
        "suggested_zone_id": str(t.suggested_zone_id) if t.suggested_zone_id else None,
        "suggested_zone_code": t.suggested_zone_code,
        "picked_zone_id": str(t.picked_zone_id) if t.picked_zone_id else None,
        "picked_zone_code": t.picked_zone_code,
        "status": t.status,
        "assigned_by": t.assigned_by,
        "assigned_at": t.assigned_at.isoformat() if t.assigned_at else None,
        "started_by": t.started_by,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "completed_by": t.completed_by,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


@pickup_router.get("", response_model=List[dict[str, Any]])
async def list_pickup_tasks(
    store_id: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    material_code: Optional[str] = None,
    search: Optional[str] = None,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """List outbound pickup tasks. Store Managers and Store Keepers are strictly scoped to their Store."""
    roles = [r.upper() for r in (user.roles or [])]
    is_warehouse_or_admin = any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles)
    is_store_user = any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles)

    if not is_warehouse_or_admin and not is_store_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only Warehouse personnel and Store Keepers can access Pickup Tasks.",
        )

    stmt = select(PickupTaskModel).order_by(PickupTaskModel.created_at.desc())

    if is_store_user and not is_warehouse_or_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        if user_store_id:
            stmt = stmt.where(PickupTaskModel.store_id == user_store_id)
        elif user_store_code:
            stmt = stmt.where(
                or_(
                    func.lower(PickupTaskModel.store_code) == user_store_code.lower(),
                    func.lower(PickupTaskModel.store_code).like(f"%{user_store_code.lower()}%"),
                )
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Store Keeper is not associated with any active Store.",
            )

        # If user explicitly requested a specific store_id that doesn't match theirs, return 403
        if store_id:
            try:
                requested_store_uuid = uuid.UUID(store_id)
                if user_store_id and requested_store_uuid != user_store_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access denied. Cannot query another Store's pickup tasks.",
                    )
            except ValueError:
                pass
    elif store_id and isinstance(store_id, str):
        try:
            store_uuid = uuid.UUID(store_id)
            stmt = stmt.where(PickupTaskModel.store_id == store_uuid)
        except ValueError:
            stmt = stmt.where(func.lower(PickupTaskModel.store_code) == store_id.lower())

    if status_filter and isinstance(status_filter, str) and status_filter.upper() != "ALL":
        stmt = stmt.where(func.upper(PickupTaskModel.status) == status_filter.upper())

    if material_code:
        stmt = stmt.where(func.lower(PickupTaskModel.material_code) == material_code.lower())

    if search:
        s = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(PickupTaskModel.task_number).like(s),
                func.lower(PickupTaskModel.request_number).like(s),
                func.lower(PickupTaskModel.material_code).like(s),
                func.lower(PickupTaskModel.material_name).like(s),
                func.lower(PickupTaskModel.department).like(s),
            )
        )

    res = await uow.session.execute(stmt)
    tasks = res.scalars().all()
    return [_format_pickup_task(t) for t in tasks]


@pickup_router.get("/{id}", response_model=dict[str, Any])
async def get_pickup_task(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """Get single pickup task details with IDOR store validation."""
    try:
        task_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Pickup Task UUID")

    stmt = select(PickupTaskModel).where(PickupTaskModel.id == task_uuid)
    res = await uow.session.execute(stmt)
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pickup task not found")

    req_id_val = getattr(task, "requisition_id", None) or getattr(task, "request_id", None)
    req_no_val = getattr(task, "requisition_number", None) or getattr(task, "request_number", "")

    roles = [r.upper() for r in (user.roles or [])]
    is_warehouse_or_admin = any(r in ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"] for r in roles)
    is_store_user = any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles)

    if not is_warehouse_or_admin and not is_store_user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if is_store_user and not is_warehouse_or_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        if user_store_id and task.store_id != user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. This pickup task belongs to '{task.store_name}'.",
            )
        elif not user_store_id and user_store_code and task.store_code.lower() != user_store_code.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. This pickup task belongs to '{task.store_name}'.",
            )

    return _format_pickup_task(task)


@pickup_router.post("/{id}/start", response_model=dict[str, Any])
async def start_pickup_task(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """Start physical picking for a task. Restricted to assigned Store Keeper."""
    try:
        task_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Pickup Task UUID")

    roles = [r.upper() for r in (user.roles or [])]
    is_store_user = any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles)
    is_admin = any(r in ["ADMIN", "SUPERUSER"] for r in roles)

    if not is_store_user and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Warehouse cannot directly start physical Store picking. This must be performed by the Store Keeper.",
        )

    stmt = select(PickupTaskModel).where(PickupTaskModel.id == task_uuid).with_for_update()
    res = await uow.session.execute(stmt)
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pickup task not found")

    if not is_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        if user_store_id and task.store_id != user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Cannot start pickup task for '{task.store_name}'.",
            )

    if task.status.upper() in ["COMPLETED", "CANCELLED"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot start task in '{task.status}' status.",
        )

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    task.status = "PICKING"
    task.started_by = user.username or "store_keeper"
    task.started_at = now_utc
    task.updated_at = now_utc

    # Update Assembly Requisition status to PICKING
    req_id = getattr(task, "requisition_id", None) or getattr(task, "request_id", None)
    if req_id:
        req_stmt = select(AssemblyRequisitionModel).where(AssemblyRequisitionModel.id == req_id)
        req_res = await uow.session.execute(req_stmt)
        req = req_res.scalar_one_or_none()
        if req and req.status.upper() in ["PENDING", "SUBMITTED", "ASSIGNED_TO_STORE"]:
            req.status = "PICKING"
            req.updated_at = now_utc

    await uow.commit()
    return _format_pickup_task(task)


@pickup_router.post("/{id}/complete", response_model=dict[str, Any])
async def complete_pickup_task(
    id: str,
    payload: CompletePickupTaskRequest,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Confirm physical picking and issue material to Assembly.
    Validates Material QR, validates Store Zone, checks available stock with FOR UPDATE lock,
    decrements stock, records InventoryIssueTransactionModel, and updates request lifecycle.
    """
    task = None
    try:
        task_uuid = uuid.UUID(id)
        stmt = select(PickupTaskModel).where(PickupTaskModel.id == task_uuid).with_for_update()
        res = await uow.session.execute(stmt)
        task = res.scalar_one_or_none()
    except (ValueError, TypeError):
        pass

    if not task:
        stmt = select(PickupTaskModel).where(
            or_(
                func.lower(PickupTaskModel.task_number) == str(id).strip().lower(),
                func.lower(PickupTaskModel.requisition_number) == str(id).strip().lower(),
            )
        ).with_for_update()
        res = await uow.session.execute(stmt)
        task = res.scalar_one_or_none()

    roles = [r.upper() for r in (user.roles or [])]
    is_store_user = any(r in ["STORE_MANAGER", "STORE_KEEPER"] for r in roles)
    is_admin = any(r in ["ADMIN", "SUPERUSER"] for r in roles)

    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pickup task not found")

    confirmation_id = (payload.confirmation_id or "").strip() or None
    confirmation_hash = _confirmation_digest(
        task.id,
        payload.material_scan,
        payload.batch_number,
        payload.zone_scan,
        payload.quantity,
    )

    # 1. Store IDOR Verification
    if not is_admin:
        user_store_id, user_store_code = await _resolve_user_store_context(uow, user)
        if user_store_id and task.store_id != user_store_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Cannot complete pickup task for '{task.store_name}'.",
            )
        elif not user_store_id and user_store_code and task.store_code.lower() != user_store_code.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Cannot complete pickup task for '{task.store_name}'.",
            )

    # The task row is already locked. Recheck after obtaining that lock so a
    # second operator retrying the same client confirmation observes the
    # first committed issue instead of receiving a stale over-pick error.
    if confirmation_id:
        prior_confirmation = await uow.session.scalar(
            select(InventoryIssueTransactionModel).where(
                InventoryIssueTransactionModel.confirmation_id == confirmation_id
            )
        )
        if prior_confirmation:
            if prior_confirmation.confirmation_hash != confirmation_hash:
                raise HTTPException(status_code=409, detail="Confirmation ID was already used for a different pick scan")
            response = _format_pickup_task(task)
            response["duplicate_confirmation"] = True
            response["issue_number"] = prior_confirmation.issue_number
            response["inventory_available_before"] = float(prior_confirmation.stock_before)
            response["inventory_available_after"] = float(prior_confirmation.stock_after)
            return response

    # 2. Status Validation
    if task.status.upper() == "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Pickup task '{task.task_number}' is already COMPLETED.",
        )

    remaining_needed = task.requested_quantity - task.picked_quantity
    if payload.quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Picked quantity must be greater than zero.",
        )
    if payload.quantity > remaining_needed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Picked quantity ({payload.quantity}) exceeds remaining requested quantity ({remaining_needed} {task.uom}).",
        )

    # 3. Material QR Validation
    scanned_mat = payload.material_scan.strip()
    target_mat_code = task.material_code.strip()
    scanned_batch = payload.batch_number.strip() if payload.batch_number else None
    mat_matches = False

    if scanned_mat.upper() == target_mat_code.upper():
        mat_matches = True
    else:
        try:
            parsed = json.loads(scanned_mat)
            if isinstance(parsed, dict):
                p_code = parsed.get("item_code") or parsed.get("material_code") or parsed.get("material_tag") or parsed.get("code") or ""
                if str(p_code).strip().upper() == target_mat_code.upper():
                    mat_matches = True
                    scanned_batch = scanned_batch or parsed.get("batch_number") or parsed.get("batch")
        except (json.JSONDecodeError, ValueError):
            pass

    # Multi-line label format parsing (e.g. "Material Code: MAT-MOTOR-001")
    if not mat_matches:
        for line in scanned_mat.splitlines():
            label, separator, candidate = line.partition(":")
            if separator and label.strip().upper() in {"MATERIAL CODE", "ITEM CODE", "MATERIAL TAG", "CODE", "MAT", "ITEM"}:
                if candidate.strip().upper() == target_mat_code.upper():
                    mat_matches = True
                    break

    # Handling Unit database lookup
    if not mat_matches:
        hu_res = await uow.session.execute(
            select(HandlingUnitModel).where(
                or_(
                    HandlingUnitModel.hu_number == scanned_mat,
                    HandlingUnitModel.barcode_value == scanned_mat,
                )
            )
        )
        scanned_hu = hu_res.scalar_one_or_none()
        if scanned_hu and scanned_hu.item_code.upper() == target_mat_code.upper():
            mat_matches = True
            if scanned_batch and scanned_batch.upper() != (scanned_hu.batch_number or "").upper():
                raise HTTPException(status_code=422, detail="Scanned batch does not match the handling-unit QR")
            scanned_batch = scanned_batch or scanned_hu.batch_number

    if not mat_matches:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Scanned Material QR does not match requested material '{target_mat_code}'.",
        )
    material_exists = await uow.session.scalar(select(MaterialModel.id).where(
        func.upper(MaterialModel.material_code) == target_mat_code.upper(),
        func.upper(MaterialModel.status) == "ACTIVE",
    ))
    if not material_exists:
        raise HTTPException(status_code=422, detail=f"Material '{target_mat_code}' is not an active persisted material")

    # 4. Store Zone/Bin Validation. Pickup labels may contain either a zone
    # QR or a bin QR; a bin resolves to its owning zone for the stock issue.
    scanned_zone_str = payload.zone_scan.strip()
    zone: StoreZoneModel | None = None
    scanned_bin: StoreBinModel | None = None

    # Try UUID
    try:
        zone = await uow.session.get(StoreZoneModel, uuid.UUID(scanned_zone_str))
    except (ValueError, TypeError):
        pass

    if zone is None:
        try:
            scanned_bin = await uow.session.get(StoreBinModel, uuid.UUID(scanned_zone_str))
        except (ValueError, TypeError):
            pass

    if zone is None:
        # Check if JSON payload or QR string like WMS:ZONE:<code>:<id>
        candidate_code = scanned_zone_str
        if scanned_zone_str.startswith("WMS:ZONE:"):
            parts = scanned_zone_str.split(":")
            if len(parts) >= 3:
                candidate_code = parts[2]
        else:
            try:
                parsed_z = json.loads(scanned_zone_str)
                if isinstance(parsed_z, dict):
                    candidate_code = (
                        parsed_z.get("bin_code")
                        or parsed_z.get("bin_id")
                        or parsed_z.get("zone_code")
                        or parsed_z.get("zone_id")
                        or scanned_zone_str
                    )
            except (json.JSONDecodeError, ValueError):
                pass

        if scanned_bin is None:
            bin_stmt = select(StoreBinModel).where(
                or_(
                    func.lower(StoreBinModel.qr_identifier) == scanned_zone_str.lower(),
                    func.upper(StoreBinModel.bin_code) == candidate_code.strip().upper(),
                    func.lower(StoreBinModel.bin_name) == candidate_code.strip().lower(),
                )
            )
            bin_res = await uow.session.execute(bin_stmt)
            scanned_bin = bin_res.scalars().first()
        if scanned_bin is not None:
            zone = await uow.session.get(StoreZoneModel, scanned_bin.zone_id)

        if zone is None:
            zone_stmt = select(StoreZoneModel).where(
                or_(
                    func.upper(StoreZoneModel.zone_code) == candidate_code.strip().upper(),
                    func.lower(StoreZoneModel.zone_name) == candidate_code.strip().lower(),
                )
            )
            zone_res = await uow.session.execute(zone_stmt)
            zone = zone_res.scalars().first()
    if not zone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Zone '{scanned_zone_str}' not found.",
        )
    if scanned_bin is None:
        raise HTTPException(status_code=422, detail="Scan a persisted bin QR label to confirm the exact pick location")
    if zone.status.upper() != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Zone '{zone.zone_code}' is inactive.",
        )

    # Cross-store Zone Validation: Zone MUST belong to the task's assigned Store!
    if zone.store_id != task.store_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Zone '{zone.zone_code}' does not belong to assigned Store '{task.store_name}'. Cannot pick from another Store.",
        )
    if scanned_bin is not None and scanned_bin.store_id != task.store_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Bin '{scanned_bin.bin_code}' does not belong to assigned Store '{task.store_name}'.",
        )
    store_obj = await uow.session.get(StoreModel, task.store_id)
    if not store_obj or not store_obj.warehouse_id:
        raise HTTPException(status_code=409, detail="Assigned Store has no configured warehouse")

    # Lock the exact material/bin balance first. A valid bin label without the
    # requested material balance is not a valid pick source.
    loc_balance_stmt = (
        select(InventoryLocationBalanceModel)
        .join(StorageLocationModel, InventoryLocationBalanceModel.storage_location_id == StorageLocationModel.id)
        .where(
            InventoryLocationBalanceModel.material_code == task.material_code,
            StorageLocationModel.store_id == task.store_id,
            StorageLocationModel.warehouse_id == store_obj.warehouse_id,
            StorageLocationModel.zone_id == zone.id,
            StorageLocationModel.bin_id == scanned_bin.id,
        )
        .with_for_update()
    )
    if scanned_batch:
        loc_balance_stmt = loc_balance_stmt.where(func.upper(InventoryLocationBalanceModel.batch_number) == scanned_batch.upper())
    loc_balances = (await uow.session.execute(loc_balance_stmt)).scalars().all()
    if not scanned_batch and len(loc_balances) > 1:
        raise HTTPException(status_code=422, detail="Scan a batch-specific material label or enter the batch number for this bin")
    loc_balance = loc_balances[0] if loc_balances else None
    if loc_balance is None or loc_balance.available_quantity < payload.quantity:
        available_here = loc_balance.available_quantity if loc_balance else Decimal("0")
        raise HTTPException(status_code=409, detail=f"Insufficient {task.material_code} stock in scanned bin {scanned_bin.bin_code}: {available_here} {task.uom} available")

    # 5. Inventory Stock Validation & Concurrency Lock
    stock_stmt = (
        select(MaterialStockModel)
        .where(
            MaterialStockModel.material_code == task.material_code,
            MaterialStockModel.warehouse_id == store_obj.warehouse_id,
        )
        .with_for_update()
    )
    stock_res = await uow.session.execute(stock_stmt)
    stock = stock_res.scalar_one_or_none()

    # Check for any active quarantine records for this material
    quar_stmt = select(func.coalesce(func.sum(QuarantineRecordModel.damaged_quantity), Decimal("0.0"))).where(
        QuarantineRecordModel.item_code == task.material_code,
        QuarantineRecordModel.status.in_(["PENDING_REVIEW", "QUARANTINED"]),
    )
    quar_res = await uow.session.execute(quar_stmt)
    quarantined_qty = quar_res.scalar() or Decimal("0.0")

    available_stock = stock.available if stock else Decimal("0.0")
    allocated_stock = stock.allocated if stock else Decimal("0.0")
    on_hand_stock = stock.on_hand if stock else Decimal("0.0")
    # For a pickup task, the usable stock includes both free available and allocated (reserved for AR) stock
    reserved_for_task = Decimal("0")
    if req_id_val:
        req_item = await uow.session.scalar(
            select(AssemblyRequisitionItemModel)
            .where(
                AssemblyRequisitionItemModel.requisition_id == req_id_val,
                AssemblyRequisitionItemModel.material_code == task.material_code,
            )
            .with_for_update()
        )
        if not req_item:
            raise HTTPException(status_code=409, detail="Pickup task has no linked Assembly requisition item")
        reserved_for_task = max(
            Decimal("0"),
            Decimal(str(req_item.reserved_quantity or 0)) - Decimal(str(req_item.issued_quantity or 0)),
        )
        if payload.quantity > reserved_for_task:
            raise HTTPException(status_code=409, detail=f"Pick quantity exceeds this requisition's remaining reservation ({reserved_for_task} {task.uom})")
        reservation = await uow.session.scalar(
            select(AssemblyStockReservationModel)
            .where(
                AssemblyStockReservationModel.requisition_id == req_id_val,
                AssemblyStockReservationModel.requisition_item_id == req_item.id,
            )
            .with_for_update()
        )
        location_code = await uow.session.scalar(
            select(StorageLocationModel.location_code).where(StorageLocationModel.id == loc_balance.storage_location_id)
        )
        reserved_in_location = Decimal("0")
        if reservation and isinstance(reservation.allocations, list):
            for allocation in reservation.allocations:
                if (
                    str(allocation.get("location_code") or "").upper() == str(location_code or "").upper()
                    and str(allocation.get("batch_number") or allocation.get("batch") or "UNTRACKED").upper() == loc_balance.batch_number.upper()
                ):
                    reserved_in_location += Decimal(str(allocation.get("quantity") or 0))
        issued_from_location = await uow.session.scalar(
            select(func.coalesce(func.sum(InventoryIssueTransactionModel.quantity), Decimal("0"))).where(
                InventoryIssueTransactionModel.requisition_id == req_id_val,
                InventoryIssueTransactionModel.material_code == task.material_code,
                InventoryIssueTransactionModel.batch_number == loc_balance.batch_number,
                InventoryIssueTransactionModel.source_location_id == loc_balance.storage_location_id,
            )
        ) or Decimal("0")
        remaining_reserved_here = max(Decimal("0"), reserved_in_location - Decimal(str(issued_from_location)))
        if payload.quantity > remaining_reserved_here:
            raise HTTPException(status_code=409, detail=f"This batch/location has only {remaining_reserved_here} {task.uom} reserved for the requisition")
        if not reservation or reserved_in_location <= 0:
            raise HTTPException(status_code=409, detail="No active stock reservation covers this batch and pick location")
    reserved_pick = min(reserved_for_task, payload.quantity) if req_id_val else min(allocated_stock, payload.quantity)
    free_pick = payload.quantity - reserved_pick
    usable_stock = allocated_stock + available_stock
    effective_available = max(Decimal("0.0"), usable_stock - quarantined_qty)

    if not stock or effective_available < payload.quantity or stock.available < free_pick or stock.allocated < reserved_pick or stock.on_hand < payload.quantity:
        avail = float(effective_available)
        quar_info = f" ({float(quarantined_qty)} {task.uom} quarantined/blocked)" if quarantined_qty > 0 else ""
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient available stock for '{task.material_code}' in {task.store_name}{quar_info}. Requested: {payload.quantity}, Available: {avail} {task.uom}.",
        )

    # 6. Atomic Inventory Deduction
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    stock_before = stock.on_hand
    stock.allocated -= reserved_pick
    stock.available -= free_pick
    stock.on_hand -= payload.quantity
    stock_after = stock.on_hand
    stock.updated_at = now_utc.replace(tzinfo=None)

    # Decrement location balance if existing
    loc_balance.available_quantity -= payload.quantity
    loc_balance.quantity -= payload.quantity
    loc_balance.updated_at = now_utc

    # 7. Record Immutable Inventory Issue Transaction
    issue_no = f"ISS-{now_utc.year}-{uuid.uuid4().hex[:6].upper()}"
    issue_tx = InventoryIssueTransactionModel(
        id=uuid.uuid4(),
        issue_number=issue_no,
        confirmation_id=confirmation_id,
        confirmation_hash=confirmation_hash if confirmation_id else None,
        requisition_id=req_id_val,
        requisition_number=req_no_val,
        pickup_task_id=task.id,
        source_location_id=loc_balance.storage_location_id,
        store_id=task.store_id,
        store_code=task.store_code,
        zone_id=zone.id,
        zone_code=zone.zone_code,
        material_code=task.material_code,
        batch_number=loc_balance.batch_number,
        material_name=task.material_name,
        quantity=payload.quantity,
        uom=task.uom,
        recipient_department=task.department,
        stock_before=stock_before,
        stock_after=stock_after,
        issued_by=user.username,
        issued_at=now_utc,
    )
    uow.session.add(issue_tx)

    # Keep the common pickup workflow auditable for finished goods as a
    # dispatch movement, while retaining TAKEAWAY for raw-material stores.
    is_finished_goods = bool(
        store_obj and (
            (store_obj.store_type or "").upper() == "FINISHED_GOODS"
            or "FINISHED GOODS" in (store_obj.store_name or "").upper()
        )
    )
    uow.session.add(InventoryMovementHistoryModel(
        id=uuid.uuid4(),
        movement_type="DISPATCH" if is_finished_goods else "TAKEAWAY",
        material_code=task.material_code,
        material_name=task.material_name,
        material_qr=scanned_mat[:128],
        batch_lot=loc_balance.batch_number,
        from_location=f"{task.store_name} / {zone.zone_code}",
        to_location=task.department or ("CUSTOMER_DISPATCH" if is_finished_goods else "ASSEMBLY"),
        quantity=payload.quantity,
        uom=task.uom,
        stock_before=stock_before,
        stock_after=stock_after,
        performed_by=user.username,
        user_role="STORE_MANAGER" if "STORE_MANAGER" in roles else "STORE_KEEPER",
        warehouse_id=store_obj.warehouse_id,
        store_id=task.store_id,
        store_code=task.store_code,
        reference_document=req_no_val,
        remarks="Finished goods dispatch" if is_finished_goods else "Assembly material pickup",
        performed_at=now_utc,
    ))

    # 8. Update Task Status
    task.picked_quantity = task.picked_quantity + payload.quantity
    task.picked_zone_id = zone.id
    task.picked_zone_code = zone.zone_code
    if task.picked_quantity >= task.requested_quantity:
        task.status = "COMPLETED"
    else:
        task.status = "PARTIALLY_PICKED"
    task.completed_by = user.username or "store_keeper"
    task.completed_at = now_utc
    task.updated_at = now_utc

    # 9. Update Assembly Requisition Lifecycle
    if req_id_val:
        req_stmt = select(AssemblyRequisitionModel).options(selectinload(AssemblyRequisitionModel.items)).where(
            AssemblyRequisitionModel.id == req_id_val
        )
        req_res = await uow.session.execute(req_stmt)
        req = req_res.scalar_one_or_none()
        if req:
            # Update item issued quantity
            for it in req.items:
                if it.material_code == task.material_code:
                    it.issued_quantity = (it.issued_quantity or Decimal("0.0")) + payload.quantity

            # Check all tasks for this Requisition
            all_tasks_res = await uow.session.execute(
                select(PickupTaskModel).where(PickupTaskModel.requisition_id == req.id)
            )
            all_tasks = all_tasks_res.scalars().all()
            all_completed = all(t.status.upper() == "COMPLETED" for t in all_tasks)
            if all_completed:
                req.status = "PICKED_UP"
            else:
                req.status = "PARTIALLY_PICKED_UP"
            req.updated_at = now_utc

        # Update matching AssemblyStockReservationModel status
        res_stmt = select(AssemblyStockReservationModel).where(
            AssemblyStockReservationModel.requisition_id == req_id_val,
            AssemblyStockReservationModel.material_code == task.material_code,
        )
        res_rows = (await uow.session.execute(res_stmt)).scalars().all()
        for res_obj in res_rows:
            if task.status.upper() == "COMPLETED":
                res_obj.status = "FULFILLED"

    # 10. Notifications to Assembly and Warehouse
    notif_assembly = NotificationModel(
        id=uuid.uuid4(),
        user_role="ASSEMBLY",
        title=f"Material Handover Complete — {req_no_val}",
        message=f"{payload.quantity} {task.uom} of {task.material_name} ({task.material_code}) issued from {task.store_name} ({zone.zone_code}) to {task.department}.",
        link="/assembly/requests",
        is_read=False,
    )
    uow.session.add(notif_assembly)

    notif_wh = NotificationModel(
        id=uuid.uuid4(),
        user_role="WAREHOUSE",
        title=f"Pickup Task Completed — {task.task_number}",
        message=f"Pickup task {task.task_number} for {task.material_code} ({payload.quantity} {task.uom}) completed by {task.store_name}.",
        link="/warehouse/assembly-requisitions",
        is_read=False,
    )
    uow.session.add(notif_wh)

    await uow.commit()

    resp = _format_pickup_task(task)
    resp["issue_number"] = issue_no
    resp["inventory_available_before"] = float(stock_before)
    resp["inventory_available_after"] = float(stock_after)
    return resp
