from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.database.session import UnitOfWork, get_uow
from app.modules.store.infrastructure.persistence.models import StoreBinModel, StoreModel, StoreZoneModel

router = APIRouter(prefix="/api/v1/stores", tags=["stores"])
bin_router = APIRouter(prefix="/api/v1/zones", tags=["store-bins"])


class StoreCreate(BaseModel):
    store_name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    warehouse_id: str = "Main Warehouse"
    store_type: str = "RAW_MATERIAL"
    store_manager_id: str | None = None
    store_manager_name: str | None = None
    status: str = "ACTIVE"
    store_code: str | None = None


class ZoneCreate(BaseModel):
    zone_name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    zone_code: str | None = None
    status: str = "ACTIVE"


class BinCreate(BaseModel):
    bin_name: str = Field(min_length=1, max_length=128)
    bin_code: str | None = None
    rack: str | None = None
    shelf: str | None = None
    position: str | None = None
    storage_type: str = "GENERAL"
    capacity: float = 1000.0
    maximum_weight: float | None = None
    maximum_volume: float | None = None
    allowed_material_category: str | None = None
    hazardous_material_permitted: bool = False
    temperature_requirement: str | None = None
    status: str = "AVAILABLE"


def store_response(store: StoreModel) -> dict:
    return {
        "id": str(store.id),
        "store_code": store.store_code,
        "store_name": store.store_name,
        "description": store.description,
        "warehouse_id": store.warehouse_id,
        "store_type": store.store_type,
        "store_manager_id": store.store_manager_id,
        "store_manager_name": store.store_manager_name,
        "status": store.status,
        "created_at": store.created_at,
        "updated_at": store.updated_at,
    }


def zone_response(zone: StoreZoneModel) -> dict:
    return {
        "id": str(zone.id),
        "store_id": str(zone.store_id),
        "zone_code": zone.zone_code,
        "zone_name": zone.zone_name,
        "description": zone.description,
        "status": zone.status,
        "created_at": zone.created_at,
        "updated_at": zone.updated_at,
    }


def bin_response(bin_obj: StoreBinModel) -> dict:
    return {
        "id": str(bin_obj.id), "store_id": str(bin_obj.store_id), "zone_id": str(bin_obj.zone_id),
        "bin_code": bin_obj.bin_code, "bin_name": bin_obj.bin_name, "rack": bin_obj.rack,
        "shelf": bin_obj.shelf, "position": bin_obj.position, "storage_type": bin_obj.storage_type,
        "capacity": float(bin_obj.capacity), "maximum_weight": bin_obj.maximum_weight,
        "maximum_volume": bin_obj.maximum_volume, "allowed_material_category": bin_obj.allowed_material_category,
        "hazardous_material_permitted": bin_obj.hazardous_material_permitted,
        "temperature_requirement": bin_obj.temperature_requirement, "qr_identifier": bin_obj.qr_identifier,
        "occupied_quantity": float(bin_obj.occupied_quantity), "status": bin_obj.status,
        "created_at": bin_obj.created_at, "updated_at": bin_obj.updated_at,
    }


async def resolve_store(uow: UnitOfWork, store_id_or_code: str) -> StoreModel | None:
    try:
        store = await uow.session.get(StoreModel, store_id_or_code)
    except (ValueError, TypeError):
        store = None
    if store:
        return store
    result = await uow.session.execute(
        select(StoreModel).where(StoreModel.store_code == store_id_or_code)
    )
    return result.scalar_one_or_none()


@router.get("")
async def list_stores(uow: UnitOfWork = Depends(get_uow)) -> list[dict]:
    result = await uow.session.execute(select(StoreModel).order_by(StoreModel.store_name.asc()))
    return [store_response(store) for store in result.scalars().all()]


@router.get("/next-code")
async def next_store_code(uow: UnitOfWork = Depends(get_uow)) -> dict[str, str]:
    count = await uow.session.scalar(select(func.count(StoreModel.id))) or 0
    return {"suggested_store_code": f"STR-{int(count) + 1:03d}"}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_store(payload: StoreCreate, uow: UnitOfWork = Depends(get_uow)) -> dict:
    name = payload.store_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Store name is required")
    code = (payload.store_code or "").strip().upper()
    if not code:
        count = await uow.session.scalar(select(func.count(StoreModel.id))) or 0
        code = f"STR-{int(count) + 1:03d}"
    existing = await uow.session.scalar(select(StoreModel).where(StoreModel.store_code == code))
    if existing:
        raise HTTPException(status_code=409, detail="Store code already exists")
    store = StoreModel(
        store_code=code,
        store_name=name,
        description=payload.description,
        warehouse_id=payload.warehouse_id.strip() or "Main Warehouse",
        store_type=payload.store_type,
        store_manager_id=payload.store_manager_id,
        store_manager_name=payload.store_manager_name,
        status=payload.status,
    )
    uow.session.add(store)
    await uow.session.flush()
    return store_response(store)


@router.get("/{store_id_or_code}/zones")
async def list_zones(store_id_or_code: str, uow: UnitOfWork = Depends(get_uow)) -> list[dict]:
    store = await resolve_store(uow, store_id_or_code)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    result = await uow.session.execute(
        select(StoreZoneModel).where(StoreZoneModel.store_id == store.id).order_by(StoreZoneModel.zone_code.asc())
    )
    return [zone_response(zone) for zone in result.scalars().all()]


@router.get("/{store_id_or_code}/zones/next-code")
async def next_zone_code(store_id_or_code: str, uow: UnitOfWork = Depends(get_uow)) -> dict[str, str]:
    store = await resolve_store(uow, store_id_or_code)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    count = await uow.session.scalar(
        select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
    ) or 0
    return {"suggested_zone_code": f"ZN-{int(count) + 1:03d}"}


@router.post("/{store_id_or_code}/zones", status_code=status.HTTP_201_CREATED)
async def create_zone(store_id_or_code: str, payload: ZoneCreate, uow: UnitOfWork = Depends(get_uow)) -> dict:
    store = await resolve_store(uow, store_id_or_code)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    code = (payload.zone_code or "").strip().upper()
    if not code:
        count = await uow.session.scalar(
            select(func.count(StoreZoneModel.id)).where(StoreZoneModel.store_id == store.id)
        ) or 0
        code = f"ZN-{int(count) + 1:03d}"
    duplicate = await uow.session.scalar(
        select(StoreZoneModel).where(StoreZoneModel.store_id == store.id, StoreZoneModel.zone_code == code)
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Zone code already exists")
    zone = StoreZoneModel(
        store_id=store.id,
        zone_code=code,
        zone_name=payload.zone_name.strip(),
        description=payload.description,
        status=payload.status,
    )
    uow.session.add(zone)
    await uow.session.flush()
    return zone_response(zone)


async def resolve_zone(uow: UnitOfWork, zone_id: str) -> StoreZoneModel | None:
    try:
        zone = await uow.session.get(StoreZoneModel, zone_id)
    except (ValueError, TypeError):
        zone = None
    return zone


@bin_router.get("/{zone_id}/bins")
async def list_zone_bins(zone_id: str, uow: UnitOfWork = Depends(get_uow)) -> list[dict]:
    zone = await resolve_zone(uow, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    result = await uow.session.execute(
        select(StoreBinModel).where(StoreBinModel.zone_id == zone.id).order_by(StoreBinModel.bin_code.asc())
    )
    return [bin_response(bin_obj) for bin_obj in result.scalars().all()]


@bin_router.get("/{zone_id}/bins/next-code")
async def next_bin_code(zone_id: str, uow: UnitOfWork = Depends(get_uow)) -> dict[str, str]:
    zone = await resolve_zone(uow, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    count = await uow.session.scalar(select(func.count(StoreBinModel.id)).where(StoreBinModel.zone_id == zone.id)) or 0
    return {"suggested_bin_code": f"BIN-{int(count) + 1:03d}"}


@bin_router.post("/{zone_id}/bins", status_code=status.HTTP_201_CREATED)
async def create_bin(zone_id: str, payload: BinCreate, uow: UnitOfWork = Depends(get_uow)) -> dict:
    zone = await resolve_zone(uow, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    code = (payload.bin_code or "").strip().upper()
    if not code:
        count = await uow.session.scalar(select(func.count(StoreBinModel.id)).where(StoreBinModel.zone_id == zone.id)) or 0
        code = f"BIN-{int(count) + 1:03d}"
    duplicate = await uow.session.scalar(select(StoreBinModel).where(StoreBinModel.zone_id == zone.id, StoreBinModel.bin_code == code))
    if duplicate:
        raise HTTPException(status_code=409, detail="Bin code already exists")
    bin_obj = StoreBinModel(store_id=zone.store_id, zone_id=zone.id, bin_code=code, bin_name=payload.bin_name.strip(),
                            rack=payload.rack, shelf=payload.shelf, position=payload.position, storage_type=payload.storage_type,
                            capacity=payload.capacity, maximum_weight=payload.maximum_weight, maximum_volume=payload.maximum_volume,
                            allowed_material_category=payload.allowed_material_category, hazardous_material_permitted=payload.hazardous_material_permitted,
                            temperature_requirement=payload.temperature_requirement, qr_identifier=f"QR-{code}", status=payload.status)
    uow.session.add(bin_obj)
    await uow.session.flush()
    return bin_response(bin_obj)
