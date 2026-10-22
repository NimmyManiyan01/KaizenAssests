"""Store master endpoints used by Warehouse location management."""
import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from app.database.session import UnitOfWork, get_uow
from app.security.dependencies import require_permission
from app.modules.store.infrastructure.persistence.models import StoreModel, StoreZoneModel, StoreBinModel

router = APIRouter(prefix="/api/v1/stores", tags=["stores"])

class CreateStoreRequest(BaseModel):
    store_name: str = Field(min_length=1, max_length=128)
    store_code: str | None = Field(default=None, max_length=64)
    description: str | None = None
    warehouse_id: str = Field(min_length=1, max_length=64)
    store_type: str = "RAW_MATERIAL"
    status: str = "ACTIVE"
    store_manager_id: str | None = None
    store_manager_name: str | None = None

async def next_code(session):
    codes = (await session.execute(select(StoreModel.store_code))).scalars().all()
    numbers = [int(code[4:]) for code in codes if code.startswith("STR-") and code[4:].isdigit()]
    return f"STR-{max(numbers, default=0) + 1:05d}"

def serialize(store):
    return {key: str(value) if isinstance(value, uuid.UUID) else value for key, value in
            ((column.name, getattr(store, column.name)) for column in store.__table__.columns)}

@router.get("/next-code", dependencies=[Depends(require_permission("store:read"))])
async def suggest_store_code(uow: UnitOfWork = Depends(get_uow)):
    return {"suggested_store_code": await next_code(uow.session)}

@router.get("", dependencies=[Depends(require_permission("store:read"))])
async def list_stores(warehouse_id: str | None = None, search: str | None = None, status: str | None = None, uow: UnitOfWork = Depends(get_uow)):
    query = select(StoreModel).order_by(StoreModel.store_code)
    if warehouse_id:
        query = query.where(StoreModel.warehouse_id == warehouse_id)
    if status:
        query = query.where(StoreModel.status == status.upper())
    if search:
        query = query.where(or_(StoreModel.store_name.ilike(f"%{search.strip()}%"), StoreModel.store_code.ilike(f"%{search.strip()}%")))
    return [serialize(store) for store in (await uow.session.execute(query)).scalars().all()]

@router.post("", status_code=201, dependencies=[Depends(require_permission("store:write"))])
async def create_store(payload: CreateStoreRequest, uow: UnitOfWork = Depends(get_uow)):
    values = payload.model_dump()
    values["store_name"] = payload.store_name.strip()
    values["warehouse_id"] = payload.warehouse_id.strip()
    if not values["store_name"] or not values["warehouse_id"]:
        raise HTTPException(422, "Warehouse name and location / plant are required")
    values["store_code"] = (payload.store_code or "").strip() or await next_code(uow.session)
    store = StoreModel(id=uuid.uuid4(), **values)
    uow.session.add(store)
    try:
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.session.rollback()
        raise HTTPException(409, "Warehouse code already exists; refresh and retry") from exc
    return serialize(store)

@router.get("/{id_or_code}", dependencies=[Depends(require_permission("store:read"))])
async def get_store(id_or_code: str, uow: UnitOfWork = Depends(get_uow)):
    condition = StoreModel.store_code == id_or_code
    try:
        condition = or_(condition, StoreModel.id == uuid.UUID(id_or_code))
    except ValueError:
        pass
    store = (await uow.session.execute(select(StoreModel).where(condition))).scalar_one_or_none()
    if store is None:
        raise HTTPException(404, "Warehouse not found")
    return serialize(store)


class CreateZoneRequest(BaseModel):
    zone_name: str = Field(min_length=1, max_length=128)
    zone_code: str | None = Field(default=None, max_length=64)
    description: str | None = None
    status: str = "ACTIVE"

class CreateBinRequest(BaseModel):
    bin_name: str = Field(min_length=1, max_length=128)
    bin_code: str | None = Field(default=None, max_length=64)
    rack: str | None = Field(default=None, max_length=64)
    shelf: str | None = Field(default=None, max_length=64)
    position: str | None = Field(default=None, max_length=64)
    qr_identifier: str | None = Field(default=None, max_length=128)
    storage_type: str = "GENERAL"
    capacity: Decimal = Field(default=Decimal("1000"), gt=0)
    maximum_weight: Decimal | None = Field(default=None, ge=0)
    maximum_volume: Decimal | None = Field(default=None, ge=0)
    allowed_material_category: str | None = None
    hazardous_material_permitted: bool = False
    temperature_requirement: str | None = None
    status: str = "ACTIVE"

async def resolve_zone(zone_id, session):
    try:
        zone = await session.get(StoreZoneModel, uuid.UUID(zone_id))
    except ValueError:
        zone = None
    if zone is None:
        raise HTTPException(404, "Storage zone not found")
    return zone

def generated_code(codes, prefix):
    numbers = [int(code[len(prefix):]) for code in codes if code.startswith(prefix) and code[len(prefix):].isdigit()]
    return f"{prefix}{max(numbers, default=0)+1:03d}"

async def flush_location(session):
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "Location code or QR identifier already exists; refresh and retry") from exc

@router.get("/{store_id}/zones/next-code", dependencies=[Depends(require_permission("store:read"))])
async def next_zone_code(store_id: str, uow: UnitOfWork = Depends(get_uow)):
    store = await get_store(store_id, uow)
    codes = (await uow.session.execute(select(StoreZoneModel.zone_code).where(StoreZoneModel.store_id == uuid.UUID(store["id"])))).scalars().all()
    return {"suggested_zone_code": generated_code(codes, "ZONE-")}

@router.get("/{store_id}/zones", dependencies=[Depends(require_permission("store:read"))])
async def list_zones(store_id: str, status: str | None = None, uow: UnitOfWork = Depends(get_uow)):
    store = await get_store(store_id, uow)
    query = select(StoreZoneModel).where(StoreZoneModel.store_id == uuid.UUID(store["id"])).order_by(StoreZoneModel.zone_code)
    if status:
        query = query.where(StoreZoneModel.status == status.upper())
    return [serialize(zone) for zone in (await uow.session.execute(query)).scalars().all()]

@router.post("/{store_id}/zones", status_code=201, dependencies=[Depends(require_permission("store:write"))])
async def create_zone(store_id: str, payload: CreateZoneRequest, uow: UnitOfWork = Depends(get_uow)):
    store = await get_store(store_id, uow)
    values = payload.model_dump()
    values["zone_name"] = payload.zone_name.strip()
    if not values["zone_name"]:
        raise HTTPException(422, "Zone name is required")
    values["zone_code"] = (payload.zone_code or "").strip() or (await next_zone_code(store_id, uow))["suggested_zone_code"]
    zone = StoreZoneModel(id=uuid.uuid4(), store_id=uuid.UUID(store["id"]), **values)
    uow.session.add(zone)
    await flush_location(uow.session)
    return serialize(zone)

@router.get("/{store_id}/bins", dependencies=[Depends(require_permission("store:read"))])
async def list_store_bins(store_id: str, status: str | None = None, uow: UnitOfWork = Depends(get_uow)):
    store = await get_store(store_id, uow)
    query = select(StoreBinModel).where(StoreBinModel.store_id == uuid.UUID(store["id"])).order_by(StoreBinModel.bin_code)
    if status:
        query = query.where(StoreBinModel.status == status.upper())
    return [serialize(item) for item in (await uow.session.execute(query)).scalars().all()]

zone_router = APIRouter(prefix="/api/v1/zones", tags=["storage zones"])

@zone_router.get("/{zone_id}/bins/next-code", dependencies=[Depends(require_permission("store:read"))])
async def next_bin_code(zone_id: str, uow: UnitOfWork = Depends(get_uow)):
    zone = await resolve_zone(zone_id, uow.session)
    codes = (await uow.session.execute(select(StoreBinModel.bin_code).where(StoreBinModel.store_id == zone.store_id))).scalars().all()
    prefix = "BIN-" + zone.zone_code.replace(" ", "").upper() + "-"
    return {"suggested_bin_code": generated_code(codes, prefix)}

@zone_router.get("/{zone_id}/bins", dependencies=[Depends(require_permission("store:read"))])
async def list_zone_bins(zone_id: str, status: str | None = None, uow: UnitOfWork = Depends(get_uow)):
    zone = await resolve_zone(zone_id, uow.session)
    query = select(StoreBinModel).where(StoreBinModel.zone_id == zone.id).order_by(StoreBinModel.bin_code)
    if status:
        query = query.where(StoreBinModel.status == status.upper())
    return [serialize(item) for item in (await uow.session.execute(query)).scalars().all()]

@zone_router.post("/{zone_id}/bins", status_code=201, dependencies=[Depends(require_permission("store:write"))])
async def create_bin(zone_id: str, payload: CreateBinRequest, uow: UnitOfWork = Depends(get_uow)):
    zone = await resolve_zone(zone_id, uow.session)
    values = payload.model_dump()
    values["bin_name"] = payload.bin_name.strip()
    if not values["bin_name"]:
        raise HTTPException(422, "Bin name is required")
    values["bin_code"] = (payload.bin_code or "").strip() or (await next_bin_code(zone_id, uow))["suggested_bin_code"]
    values["qr_identifier"] = payload.qr_identifier or f"BIN:{zone.store_id}:{zone.id}:{values['bin_code']}"
    item = StoreBinModel(id=uuid.uuid4(), store_id=zone.store_id, zone_id=zone.id, **values)
    uow.session.add(item)
    await flush_location(uow.session)
    return serialize(item)


bin_router = zone_router
