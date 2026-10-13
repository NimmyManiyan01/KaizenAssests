"""Canonical read-only Material Master endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.common.persistence.models import MaterialModel
from app.database.session import UnitOfWork, get_uow
from app.security.dependencies import CurrentUser, require_permission


router = APIRouter(prefix="/api/v1/materials", tags=["materials"])


def _variant_payload(variant) -> dict:
    return {
        "id": str(variant.id),
        "variant_code": variant.variant_code,
        "size": variant.size,
        "color": variant.color,
        "grade": variant.grade,
        "specification": variant.specification,
        "uom": variant.uom,
        "attributes": variant.attributes,
        "status": variant.status,
    }


def _material_payload(material: MaterialModel) -> dict:
    return {
        "id": str(material.id),
        "material_code": material.material_code,
        "material_name": material.material_name,
        "category": material.category,
        "description": material.description,
        "base_uom": material.base_uom,
        "status": material.status,
        "variants": [_variant_payload(v) for v in material.variants],
    }


@router.get("")
async def list_active_materials(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _user: CurrentUser = Depends(require_permission("procurement:read")),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    """Return active canonical Material Master records."""
    result = await uow.session.execute(
        select(MaterialModel)
        .options(selectinload(MaterialModel.variants))
        .where(MaterialModel.status.ilike("active"))
        .order_by(MaterialModel.material_code)
        .offset(offset)
        .limit(limit)
    )
    return [_material_payload(material) for material in result.scalars().unique().all()]


@router.get("/{material_id}")
async def get_material(
    material_id: uuid.UUID,
    _user: CurrentUser = Depends(require_permission("procurement:read")),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Return one canonical Material Master record by UUID."""
    result = await uow.session.execute(
        select(MaterialModel)
        .options(selectinload(MaterialModel.variants))
        .where(MaterialModel.id == material_id)
    )
    material = result.scalars().unique().first()
    if material is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )
    return _material_payload(material)
