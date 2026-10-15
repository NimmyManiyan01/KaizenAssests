"""
Procurement router compatibility module.
Provides auth routes under /api/v1/procurement/auth and shared helpers.
"""
from __future__ import annotations

from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.common.email_utils import send_email
from app.config.settings import get_settings
from app.logging.logger import get_logger
from app.security.router import (
    router as auth_router,
    dev_login,
    supplier_login,
    change_password,
    magic_login,
    verify_magic_token_endpoint,
)
from app.modules.procurement.infrastructure.api.schemas import (
    RfqResponse,
    RfqItemSchema,
    SupplierResponse,
)
from app.common.persistence.models import (
    PurchaseOrderItemModel,
    PurchaseOrderModel,
    SupplierAddressModel,
    SupplierModel,
)
from app.database.session import UnitOfWork, get_uow
from app.security.dependencies import CurrentUser, get_current_user

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/procurement", tags=["procurement"])
router.include_router(auth_router, prefix="/auth")


def _to_supplier_response(supplier: SupplierModel) -> dict[str, Any]:
    contact = getattr(supplier, "contact", None)
    address = getattr(supplier, "address", None)
    return {
        "id": str(supplier.id),
        "supplier_name": supplier.supplier_name,
        "registered_company_name": supplier.registered_company_name,
        "supplier_code": supplier.supplier_code,
        "vendor_type": supplier.vendor_type,
        "category": supplier.category or [],
        "industry": supplier.industry,
        "gstin": supplier.gstin,
        "main_materials": supplier.main_materials or [],
        "rating": supplier.rating,
        "performance_score": supplier.performance_score,
        "payment_terms": supplier.payment_terms,
        "credit_period_days": supplier.credit_period_days,
        "remarks": supplier.remarks,
        "status": supplier.status,
        "created_at": supplier.created_at,
        "updated_at": supplier.updated_at,
        "contact": {
            "primary_contact_name": getattr(contact, "primary_contact_name", None),
            "primary_email": getattr(contact, "primary_email", None),
            "phone": getattr(contact, "phone", None),
        } if contact else None,
        "address": {
            "registered_address": getattr(address, "registered_address", None),
            "city": getattr(address, "city", None),
            "state": getattr(address, "state", None),
            "country": getattr(address, "country", None),
            "pincode": getattr(address, "pincode", None),
        } if address else None,
    }


@router.get("/suppliers")
async def list_suppliers(
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    material: str | None = Query(default=None),
    city: str | None = Query(default=None),
    vendor_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict[str, Any]]:
    stmt = select(SupplierModel).options(
        selectinload(SupplierModel.contact),
        selectinload(SupplierModel.address),
    ).order_by(SupplierModel.supplier_name.asc())
    if search and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                SupplierModel.supplier_name.ilike(term),
                SupplierModel.registered_company_name.ilike(term),
                SupplierModel.supplier_code.ilike(term),
                SupplierModel.gstin.ilike(term),
            )
        )
    if vendor_type and vendor_type.strip():
        stmt = stmt.where(SupplierModel.vendor_type.ilike(vendor_type.strip()))
    if status and status.strip():
        stmt = stmt.where(SupplierModel.status.ilike(status.strip()))
    if city and city.strip():
        stmt = stmt.join(SupplierAddressModel).where(SupplierAddressModel.city.ilike(city.strip()))
    result = await uow.session.execute(stmt)
    suppliers = result.scalars().unique().all()
    if category or material:
        category_term = category.strip().lower() if category else None
        material_term = material.strip().lower() if material else None
        suppliers = [
            supplier for supplier in suppliers
            if (not category_term or any(category_term in str(value).lower() for value in (supplier.category or [])))
            and (not material_term or any(material_term in str(value).lower() for value in (supplier.main_materials or [])))
        ]
    return [_to_supplier_response(supplier) for supplier in suppliers]


@router.get("/suppliers/{supplier_id}")
async def get_supplier(
    supplier_id: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict[str, Any]:
    stmt = select(SupplierModel).options(
        selectinload(SupplierModel.contact),
        selectinload(SupplierModel.address),
    ).where(SupplierModel.id == supplier_id)
    result = await uow.session.execute(stmt)
    supplier = result.scalars().unique().first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return _to_supplier_response(supplier)


def _to_purchase_order_response(po: PurchaseOrderModel) -> dict[str, Any]:
    """Serialize the canonical PO model using JSON-safe primitive values."""
    return {
        "id": str(po.id),
        "po_number": po.po_number,
        "po_date": po.po_date,
        "status": po.status,
        "revision_number": po.revision_number,
        "rfq_id": str(po.rfq_id) if po.rfq_id else None,
        "quotation_id": str(po.quotation_id) if po.quotation_id else None,
        "supplier_id": str(po.supplier_id) if po.supplier_id else None,
        "supplier_name": po.supplier_name,
        "supplier_code": po.supplier_code,
        "supplier_contact_person": po.supplier_contact_person,
        "supplier_phone": po.supplier_phone,
        "supplier_email": po.supplier_email,
        "warehouse_id": po.warehouse_id,
        "delivery_warehouse_name": po.delivery_warehouse_name,
        "delivery_address": po.delivery_address,
        "total_amount": po.total_amount,
        "subtotal": po.subtotal,
        "discount_amount": po.discount_amount,
        "tax_amount": po.tax_amount,
        "freight_charges": po.freight_charges,
        "additional_charges": po.additional_charges,
        "expected_delivery_date": po.expected_delivery_date,
        "payment_terms": po.payment_terms,
        "delivery_terms": po.delivery_terms,
        "warranty": po.warranty,
        "billing_address": po.billing_address,
        "notes": po.notes,
        "attachments": po.attachments or [],
        "procurement_officer": po.procurement_officer,
        "department": po.department,
        "created_at": po.created_at,
        "updated_at": po.updated_at,
        "items": [
            {
                "id": str(item.id),
                "material_id": str(item.material_id) if item.material_id else None,
                "material_variant_id": str(item.material_variant_id) if item.material_variant_id else None,
                "material_code": item.material_code,
                "variant_code": item.variant_code,
                "material_name": item.material_name,
                "category": item.category,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "discount": item.discount,
                "tax": item.tax,
                "uom": item.uom,
            }
            for item in (po.items or [])
        ],
    }


@router.get("/purchase-orders")
async def list_purchase_orders(
    search: str | None = Query(default=None),
    supplier_id: str | None = Query(default=None),
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict[str, Any]]:
    stmt = select(PurchaseOrderModel).options(selectinload(PurchaseOrderModel.items)).order_by(PurchaseOrderModel.created_at.desc())
    if search and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(PurchaseOrderModel.po_number.ilike(term), PurchaseOrderModel.supplier_name.ilike(term)))
    if supplier_id and supplier_id.strip():
        stmt = stmt.where(PurchaseOrderModel.supplier_id == supplier_id.strip())
    result = await uow.session.execute(stmt)
    return [_to_purchase_order_response(po) for po in result.scalars().unique().all()]


async def _find_purchase_order(identifier: str, uow: UnitOfWork) -> PurchaseOrderModel | None:
    stmt = select(PurchaseOrderModel).options(selectinload(PurchaseOrderModel.items)).where(
        or_(PurchaseOrderModel.po_number == identifier, PurchaseOrderModel.id == identifier)
    )
    result = await uow.session.execute(stmt)
    return result.scalars().unique().first()


@router.get("/purchase-orders/by-number/{po_number}")
async def get_purchase_order_by_number(
    po_number: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict[str, Any]:
    po = await _find_purchase_order(po_number, uow)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return _to_purchase_order_response(po)


@router.get("/purchase-orders/{identifier}")
async def get_purchase_order(
    identifier: str,
    _user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict[str, Any]:
    po = await _find_purchase_order(identifier, uow)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return _to_purchase_order_response(po)


def _to_rfq_response(rfq) -> RfqResponse:
    items = []
    for item in (getattr(rfq, "items", []) or []):
        items.append(
            RfqItemSchema(
                material_id=str(getattr(item, "material_id", None)) if getattr(item, "material_id", None) else None,
                material_variant_id=str(getattr(item, "material_variant_id", None)) if getattr(item, "material_variant_id", None) else None,
                material_code=item.material_code,
                variant_code=getattr(item, "variant_code", None),
                material_name=item.material_name,
                category=getattr(item, "category", None),
                quantity=item.quantity,
                uom=item.uom,
                required_delivery_date=getattr(item, "required_delivery_date", None),
                warehouse=getattr(item, "warehouse", None),
                special_requirements=getattr(item, "special_requirements", None),
            )
        )

    suppliers_list = []
    supplier_emails = []
    for sup in (getattr(rfq, "suppliers", []) or []):
        suppliers_list.append(
            SupplierResponse(
                id=str(sup.id),
                supplier_name=sup.supplier_name,
                supplier_code=getattr(sup, "supplier_code", None),
                registered_company_name=getattr(sup, "registered_company_name", None),
                vendor_type=getattr(sup, "vendor_type", None),
                status=getattr(sup, "status", None),
            )
        )
        if hasattr(sup, "contact") and sup.contact and getattr(sup.contact, "primary_email", None):
            supplier_emails.append(sup.contact.primary_email)

    return RfqResponse(
        id=str(rfq.id),
        rfq_number=rfq.rfq_number,
        rfq_date=rfq.rfq_date,
        material_request_number=getattr(rfq, "material_request_number", None),
        required_delivery_date=getattr(rfq, "required_delivery_date", None),
        warehouse=getattr(rfq, "warehouse", None),
        procurement_officer=getattr(rfq, "procurement_officer", None),
        remarks=getattr(rfq, "remarks", None),
        status=rfq.status,
        items=items,
        suppliers=suppliers_list,
        supplier_emails=supplier_emails,
        created_at=getattr(rfq, "created_at", None),
    )
