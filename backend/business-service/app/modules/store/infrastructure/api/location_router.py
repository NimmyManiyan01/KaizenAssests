"""Single-warehouse store, zone, and bin endpoints used by the WMS location screen."""

from __future__ import annotations

import re
import unicodedata
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.database.session import UnitOfWork, get_uow
from app.modules.store.infrastructure.persistence.models import (
    StoreBinModel,
    StoreModel,
    StoreZoneModel,
)
from app.security.dependencies import CurrentUser, get_current_user

store_router = APIRouter(prefix="/api/v1/stores", tags=["store-locations"])
zone_router = APIRouter(prefix="/api/v1/zones", tags=["store-locations"])

_CODE_RE = re.compile(r"^[A-Z0-9_-]+$")


class ZoneCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    zone_name: str = Field(min_length=2, max_length=100)
    zone_code: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=1000)

    @field_validator("zone_name")
    @classmethod
    def validate_zone_name(cls, value: str) -> str:
        if any(unicodedata.category(character) == "Cc" for character in value):
            raise ValueError("Zone name cannot contain control characters")
        value = unicodedata.normalize("NFKC", value)
        value = re.sub(r"\s+", " ", value).strip()
        if len(value) < 2 or not any(character.isalnum() for character in value):
            raise ValueError("Zone name must include at least one letter or number")
        if len(value) > 100:
            raise ValueError("Zone name must be 100 characters or fewer")
        if not re.fullmatch(r"[\w\s&().,'/#:+-]+", value, flags=re.UNICODE):
            raise ValueError("Zone name can use letters, numbers, spaces, and common punctuation only")
        return value

    @field_validator("zone_code")
    @classmethod
    def validate_zone_code(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip().upper()
        if not _CODE_RE.fullmatch(normalized):
            raise ValueError("Zone code may contain only letters, numbers, underscores, and hyphens")
        return normalized


class ZoneUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    zone_name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, max_length=32)

    @field_validator("zone_name")
    @classmethod
    def validate_zone_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if any(unicodedata.category(character) == "Cc" for character in value):
            raise ValueError("Zone name cannot contain control characters")
        value = unicodedata.normalize("NFKC", value)
        value = re.sub(r"\s+", " ", value).strip()
        if len(value) < 2 or not any(character.isalnum() for character in value):
            raise ValueError("Zone name must include at least one letter or number")
        if len(value) > 100:
            raise ValueError("Zone name must be 100 characters or fewer")
        if not re.fullmatch(r"[\w\s&().,'/#:+-]+", value, flags=re.UNICODE):
            raise ValueError("Zone name can use letters, numbers, spaces, and common punctuation only")
        return value

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in {"ACTIVE", "INACTIVE"}:
            raise ValueError("Zone status must be ACTIVE or INACTIVE")
        return normalized


class BinCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    bin_name: str = Field(min_length=1, max_length=128)
    bin_code: str = Field(min_length=1, max_length=64)
    rack: str = Field(min_length=1, max_length=64)
    position: str = Field(min_length=1, max_length=64)
    qr_identifier: str | None = Field(default=None, max_length=128)
    storage_type: str = Field(default="GENERAL", max_length=64)
    capacity: Decimal = Field(default=Decimal("1000"), gt=0)

    @field_validator("bin_code", "rack", "position")
    @classmethod
    def validate_location_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not _CODE_RE.fullmatch(normalized):
            raise ValueError("Codes may contain only letters, numbers, underscores, and hyphens")
        return normalized

    @field_validator("bin_name")
    @classmethod
    def validate_bin_name(cls, value: str) -> str:
        if not value or not any(character.isalnum() for character in value):
            raise ValueError("Bin name must include at least one letter or number")
        if any(ord(character) < 32 for character in value):
            raise ValueError("Bin name cannot contain control characters")
        return value


def _require_location_write(user: CurrentUser) -> None:
    roles = {role.upper() for role in (user.roles or [])}
    if not roles.intersection({"ADMIN", "SUPERUSER", "WAREHOUSE", "WAREHOUSE_MANAGER"}) and "store:write" not in (user.permissions or []):
        raise HTTPException(status_code=403, detail="You do not have permission to manage warehouse locations")


async def _get_store(uow: UnitOfWork, id_or_code: str) -> StoreModel:
    store = None
    try:
        store = await uow.session.get(StoreModel, uuid.UUID(id_or_code))
    except ValueError:
        pass
    if store is None:
        store = await uow.session.scalar(
            select(StoreModel).where(func.upper(StoreModel.store_code) == id_or_code.strip().upper())
        )
    if store is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return store


async def _get_primary_store(uow: UnitOfWork) -> StoreModel:
    """Resolve the single legacy warehouse parent without exposing it in location APIs."""
    store = await uow.session.scalar(
        select(StoreModel)
        .where(func.upper(StoreModel.status) == "ACTIVE")
        .order_by(StoreModel.store_code.asc())
        .limit(1)
    )
    if store is None:
        raise HTTPException(status_code=409, detail="The warehouse has not been initialized")
    return store


async def _get_zone(uow: UnitOfWork, zone_id: str) -> StoreZoneModel:
    try:
        zone_uuid = uuid.UUID(zone_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Zone not found") from exc
    zone = await uow.session.get(StoreZoneModel, zone_uuid)
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone


def _store_response(store: StoreModel) -> dict:
    return {
        "id": str(store.id),
        "store_code": store.store_code,
        "store_name": store.store_name,
        "description": store.description,
        "warehouse_id": store.warehouse_id,
        "store_manager_id": store.store_manager_id,
        "store_manager_name": store.store_manager_name,
        "status": store.status,
        "store_type": store.store_type,
    }


def _zone_response(zone: StoreZoneModel, bins_count: int = 0) -> dict:
    return {
        "id": str(zone.id),
        "store_id": str(zone.store_id),
        "zone_code": zone.zone_code,
        "zone_name": zone.zone_name,
        "description": zone.description,
        "status": zone.status,
        "bins_count": bins_count,
    }


def _bin_response(bin_model: StoreBinModel) -> dict:
    return {
        "id": str(bin_model.id),
        "store_id": str(bin_model.store_id),
        "zone_id": str(bin_model.zone_id),
        "bin_code": bin_model.bin_code,
        "location_code": bin_model.qr_identifier or bin_model.bin_code,
        "bin_name": bin_model.bin_name,
        "rack": bin_model.rack,
        "shelf": bin_model.shelf,
        "position": bin_model.position,
        "storage_type": bin_model.storage_type,
        "capacity": float(bin_model.capacity or 0),
        "occupied_quantity": float(bin_model.occupied_quantity or 0),
        "qr_identifier": bin_model.qr_identifier,
        "status": bin_model.status,
    }


@store_router.get("")
async def list_stores(
    status_filter: str | None = Query(default="ACTIVE", alias="status"),
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    query = select(StoreModel).order_by(StoreModel.store_code.asc())
    if status_filter and status_filter.upper() != "ALL":
        query = query.where(func.upper(StoreModel.status) == status_filter.upper())
    result = await uow.session.execute(query)
    return [_store_response(store) for store in result.scalars().all()]


@store_router.get("/{id_or_code}/zones")
async def list_store_zones(
    id_or_code: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    store = await _get_store(uow, id_or_code)
    result = await uow.session.execute(
        select(StoreZoneModel)
        .where(StoreZoneModel.store_id == store.id)
        .order_by(StoreZoneModel.zone_code.asc())
    )
    zones = result.scalars().all()
    return [
        _zone_response(
            zone,
            await uow.session.scalar(
                select(func.count(StoreBinModel.id)).where(StoreBinModel.zone_id == zone.id)
            ) or 0,
        )
        for zone in zones
    ]


@zone_router.get("")
async def list_zones(
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    """List zones without requiring a store identifier."""
    store = await _get_primary_store(uow)
    result = await uow.session.execute(
        select(StoreZoneModel)
        .where(StoreZoneModel.store_id == store.id)
        .order_by(StoreZoneModel.zone_code.asc())
    )
    zones = result.scalars().all()
    rows = []
    for zone in zones:
        count = await uow.session.scalar(
            select(func.count(StoreBinModel.id)).where(StoreBinModel.zone_id == zone.id)
        )
        rows.append(_zone_response(zone, count or 0))
    return rows


@store_router.get("/{id_or_code}/zones/next-code")
async def next_zone_code(
    id_or_code: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    store = await _get_store(uow, id_or_code)
    result = await uow.session.execute(
        select(StoreZoneModel.zone_code).where(StoreZoneModel.store_id == store.id)
    )
    max_sequence = 0
    for code in result.scalars().all():
        match = re.search(r"(?:ZONE-|-Z)(\d+)$", str(code).upper())
        if match:
            max_sequence = max(max_sequence, int(match.group(1)))
    return {"suggested_zone_code": f"ZONE-{max_sequence + 1:03d}"}


@zone_router.get("/next-code")
async def next_unscoped_zone_code(
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    store = await _get_primary_store(uow)
    result = await uow.session.execute(
        select(StoreZoneModel.zone_code).where(StoreZoneModel.store_id == store.id)
    )
    max_sequence = 0
    for code in result.scalars().all():
        match = re.search(r"(?:ZONE-|-Z)(\d+)$", str(code).upper())
        if match:
            max_sequence = max(max_sequence, int(match.group(1)))
    return {"suggested_zone_code": f"ZONE-{max_sequence + 1:03d}"}


@zone_router.post("", status_code=status.HTTP_201_CREATED)
async def create_unscoped_zone(
    payload: ZoneCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Create a zone by name; warehouse ownership is resolved internally."""
    store = await _get_primary_store(uow)
    return await create_store_zone(store.store_code, payload, user, uow)


@store_router.post("/{id_or_code}/zones", status_code=status.HTTP_201_CREATED)
async def create_store_zone(
    id_or_code: str,
    payload: ZoneCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    _require_location_write(user)
    store = await _get_store(uow, id_or_code)
    if str(store.status).upper() != "ACTIVE":
        raise HTTPException(status_code=409, detail="Cannot add a zone to an inactive warehouse")
    existing_names = await uow.session.scalars(
        select(StoreZoneModel.zone_name).where(StoreZoneModel.store_id == store.id)
    )
    normalized_name = payload.zone_name.casefold()
    if any(
        unicodedata.normalize("NFKC", name).strip().casefold() == normalized_name
        or re.sub(r"\s+", " ", unicodedata.normalize("NFKC", name)).strip().casefold()
        == normalized_name
        for name in existing_names
    ):
        raise HTTPException(status_code=409, detail="A zone with this name already exists in the warehouse")
    code = payload.zone_code
    if not code:
        code = (await next_zone_code(id_or_code, user, uow))["suggested_zone_code"]
    if not re.fullmatch(r"ZONE-\d{3,}", code):
        raise HTTPException(status_code=422, detail="Zone codes must use the ZONE-001 format")
    duplicate_code = await uow.session.scalar(
        select(StoreZoneModel.id).where(
            StoreZoneModel.store_id == store.id,
            func.upper(StoreZoneModel.zone_code) == code,
        )
    )
    if duplicate_code:
        raise HTTPException(status_code=409, detail=f"Zone code '{code}' already exists")
    zone = StoreZoneModel(
        store_id=store.id,
        zone_code=code,
        zone_name=payload.zone_name,
        description=payload.description,
        status="ACTIVE",
    )
    uow.session.add(zone)
    try:
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.rollback()
        raise HTTPException(status_code=409, detail="Zone code already exists") from exc
    return _zone_response(zone)


@zone_router.put("/{zone_id}")
async def update_zone(
    zone_id: str,
    payload: ZoneUpdateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    _require_location_write(user)
    try:
        zone_uuid = uuid.UUID(zone_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Zone not found") from exc
    zone = await uow.session.scalar(
        select(StoreZoneModel).where(StoreZoneModel.id == zone_uuid).with_for_update()
    )
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")

    if payload.zone_name is not None:
        existing_names = await uow.session.scalars(
            select(StoreZoneModel.zone_name).where(
                StoreZoneModel.store_id == zone.store_id,
                StoreZoneModel.id != zone.id,
            )
        )
        normalized_name = payload.zone_name.casefold()
        if any(
            re.sub(r"\s+", " ", unicodedata.normalize("NFKC", name)).strip().casefold()
            == normalized_name
            for name in existing_names
        ):
            raise HTTPException(status_code=409, detail="A zone with this name already exists in the warehouse")
        zone.zone_name = payload.zone_name
    if payload.description is not None:
        zone.description = payload.description
    if payload.status is not None:
        zone.status = payload.status

    try:
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.rollback()
        raise HTTPException(status_code=409, detail="Unable to update the zone") from exc
    bins_count = await uow.session.scalar(
        select(func.count(StoreBinModel.id)).where(StoreBinModel.zone_id == zone.id)
    )
    return _zone_response(zone, bins_count or 0)


@zone_router.get("/{zone_id}/bins")
async def list_zone_bins(
    zone_id: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    zone = await _get_zone(uow, zone_id)
    result = await uow.session.execute(
        select(StoreBinModel)
        .where(StoreBinModel.zone_id == zone.id)
        .order_by(StoreBinModel.bin_code.asc())
    )
    return [_bin_response(bin_model) for bin_model in result.scalars().all()]


@zone_router.get("/{zone_id}/bins/next-code")
async def next_bin_code(
    zone_id: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    zone = await _get_zone(uow, zone_id)
    result = await uow.session.execute(
        select(StoreBinModel.bin_code).where(StoreBinModel.zone_id == zone.id)
    )
    max_sequence = 0
    for code in result.scalars().all():
        match = re.search(r"(?:-BIN-|BIN-)(\d+)$", str(code).upper())
        if match:
            max_sequence = max(max_sequence, int(match.group(1)))
    return {"suggested_bin_code": f"{zone.zone_code}-BIN-{max_sequence + 1:03d}"}


@zone_router.post("/{zone_id}/bins", status_code=status.HTTP_201_CREATED)
async def create_zone_bin(
    zone_id: str,
    payload: BinCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    _require_location_write(user)
    zone = await _get_zone(uow, zone_id)
    if str(zone.status).upper() != "ACTIVE":
        raise HTTPException(status_code=409, detail="Cannot add a bin to an inactive zone")
    if not re.fullmatch(rf"{re.escape(zone.zone_code)}-BIN-\d{{3,}}", payload.bin_code):
        raise HTTPException(
            status_code=422,
            detail=f"Bin codes in this zone must use the {zone.zone_code}-BIN-001 format",
        )
    if payload.capacity <= 0:
        raise HTTPException(status_code=422, detail="Bin capacity must be greater than zero")

    duplicate_code = await uow.session.scalar(
        select(StoreBinModel.id).where(
            StoreBinModel.store_id == zone.store_id,
            func.upper(StoreBinModel.bin_code) == payload.bin_code,
        )
    )
    if duplicate_code:
        raise HTTPException(status_code=409, detail=f"Bin code '{payload.bin_code}' already exists")
    duplicate_position = await uow.session.scalar(
        select(StoreBinModel.id).where(
            StoreBinModel.zone_id == zone.id,
            func.upper(StoreBinModel.rack) == payload.rack,
            func.upper(StoreBinModel.position) == payload.position,
        )
    )
    if duplicate_position:
        raise HTTPException(status_code=409, detail="This rack and shelf/position already has a bin")

    qr_identifier = f"QR-{payload.bin_code}"
    duplicate_qr = await uow.session.scalar(
        select(StoreBinModel.id).where(func.upper(StoreBinModel.qr_identifier) == qr_identifier.upper())
    )
    if duplicate_qr:
        raise HTTPException(status_code=409, detail="QR identifier already belongs to another bin")

    bin_model = StoreBinModel(
        store_id=zone.store_id,
        zone_id=zone.id,
        bin_code=payload.bin_code,
        bin_name=payload.bin_name,
        rack=payload.rack,
        shelf=payload.position,
        position=payload.position,
        storage_type=payload.storage_type.strip().upper(),
        capacity=payload.capacity,
        qr_identifier=qr_identifier,
        status="AVAILABLE",
    )
    uow.session.add(bin_model)
    try:
        await uow.session.flush()
    except IntegrityError as exc:
        await uow.rollback()
        raise HTTPException(status_code=409, detail="Bin code or QR identifier already exists") from exc
    return _bin_response(bin_model)
