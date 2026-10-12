import uuid
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.database.session import get_db
from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel
from app.modules.dispatch.infrastructure.persistence.models import DispatchItemModel, DispatchModel
from app.security.dependencies import CurrentUser, get_current_user
from ..persistence.models import CustomerOrderCustomerModel, CustomerOrderItemModel, CustomerOrderModel

router = APIRouter()

class ItemIn(BaseModel):
    product_code: str
    ordered_quantity: float = Field(gt=0)
    uom: str = "PCS"

class OrderIn(BaseModel):
    customer_id: str | None = None
    customer_name: str | None = None
    customer_po: str | None = None
    order_date: date
    expected_delivery_date: date
    delivery_address: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    remarks: str | None = None
    items: list[ItemIn] = Field(min_length=1)

def dto(o):
    return {"id": str(o.id), "order_number": o.order_number, "customer_name": o.customer.name,
            "customer_id": str(o.customer_id), "customer_po": o.customer_po, "order_date": o.order_date,
            "expected_delivery_date": o.expected_delivery_date, "delivery_address": o.customer.address,
            "contact_person": o.customer.contact_person, "phone": o.customer.phone, "status": o.status,
            "remarks": o.remarks, "items": [{"id": str(i.id), "product_code": i.product_code, "product_name": i.product_name,
            "ordered_quantity": float(i.ordered_quantity), "dispatched_quantity": float(i.dispatched_quantity),
            "remaining_quantity": max(0, float(i.ordered_quantity) - float(i.dispatched_quantity)), "uom": i.uom} for i in o.items]}

@router.get("/api/customer-orders")
async def list_orders(db: AsyncSession = Depends(get_db), _user: CurrentUser = Depends(get_current_user)):
    rows = (await db.execute(select(CustomerOrderModel).options(selectinload(CustomerOrderModel.customer), selectinload(CustomerOrderModel.items)).order_by(CustomerOrderModel.created_at.desc()))).scalars().all()
    return [dto(o) for o in rows]

@router.get("/api/customer-orders/eligible")
async def eligible_orders(db: AsyncSession = Depends(get_db), _user: CurrentUser = Depends(get_current_user)):
    rows = (await db.execute(select(CustomerOrderModel).options(selectinload(CustomerOrderModel.customer), selectinload(CustomerOrderModel.items)).where(CustomerOrderModel.status == "CONFIRMED").order_by(CustomerOrderModel.created_at))).scalars().all()
    return [{**dto(o), "items": [i for i in dto(o)["items"] if i["remaining_quantity"] > 0]} for o in rows if any(float(i.ordered_quantity) > float(i.dispatched_quantity) for i in o.items)]

@router.get("/api/customer-orders/finished-goods")
async def available_finished_goods(db: AsyncSession = Depends(get_db), _user: CurrentUser = Depends(get_current_user)):
    rows = (await db.execute(select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.quantity > 0))).scalars().all()
    eligible = {"AVAILABLE", "QC_CERTIFIED", "QC_APPROVED", "QC_PASSED", "PASSED", "READY"}
    result = []
    for fg in rows:
        if str(fg.status or "").upper().replace("-", "_").replace(" ", "_") not in eligible:
            continue
        reserved = (await db.execute(select(func.coalesce(func.sum(DispatchItemModel.quantity_reserved), 0)).join(DispatchModel, DispatchModel.id == DispatchItemModel.dispatch_order_id).where(DispatchItemModel.material_code == fg.product_code, DispatchModel.status.notin_(["CANCELLED"]), DispatchItemModel.status != "DISPATCHED"))).scalar_one()
        available = max(0.0, float(fg.quantity) - float(reserved or 0))
        if available > 0:
            result.append({"id": str(fg.id), "product_code": fg.product_code, "product_name": fg.product_name, "quantity": available, "uom": fg.uom, "status": fg.status, "location_code": fg.location_code, "warehouse_id": fg.warehouse_id, "qr_code": fg.qr_code})
    return result

@router.post("/api/customer-orders", status_code=status.HTTP_201_CREATED)
async def create_order(payload: OrderIn, db: AsyncSession = Depends(get_db), _user: CurrentUser = Depends(get_current_user)):
    if not payload.delivery_address or not payload.delivery_address.strip():
        raise HTTPException(400, "Delivery address is required")
    if payload.expected_delivery_date < payload.order_date:
        raise HTTPException(400, "Expected delivery date cannot be earlier than order date")
    customer = None
    if payload.customer_id:
        customer = await db.get(CustomerOrderCustomerModel, payload.customer_id)
    if not customer and payload.customer_name:
        customer = (await db.execute(select(CustomerOrderCustomerModel).where(CustomerOrderCustomerModel.name == payload.customer_name))).scalar_one_or_none()
    if not customer:
        if not payload.customer_name: raise HTTPException(400, "Customer is required")
        customer = CustomerOrderCustomerModel(id=uuid.uuid4(), name=payload.customer_name, address=payload.delivery_address, contact_person=payload.contact_person, phone=payload.phone)
        db.add(customer); await db.flush()
    else:
        customer.address = payload.delivery_address
        customer.contact_person = payload.contact_person
        customer.phone = payload.phone
    prefix = f"CO-{date.today().year}-"
    last = (await db.execute(select(CustomerOrderModel.order_number).where(CustomerOrderModel.order_number.like(f"{prefix}%")).order_by(CustomerOrderModel.order_number.desc()).limit(1))).scalar_one_or_none()
    seq = int(last.rsplit("-", 1)[1]) + 1 if last else 1
    order = CustomerOrderModel(id=uuid.uuid4(), order_number=f"{prefix}{seq:06d}", customer_id=customer.id, customer_po=payload.customer_po, order_date=payload.order_date, expected_delivery_date=payload.expected_delivery_date, remarks=payload.remarks)
    order.items = []
    for item in payload.items:
        product = (await db.execute(select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.product_code == item.product_code, AssemblyFinishedGoodsModel.quantity > 0))).scalars().first()
        if not product: raise HTTPException(400, f"Product not found or inactive: {item.product_code}")
        order.items.append(CustomerOrderItemModel(id=uuid.uuid4(), product_code=product.product_code, product_name=product.product_name, ordered_quantity=item.ordered_quantity, uom=item.uom or product.uom))
    db.add(order); await db.commit(); await db.refresh(order)
    await db.refresh(order, ["customer", "items"])
    return dto(order)

@router.post("/api/customer-orders/{order_id}/confirm")
async def confirm_order(order_id: str, db: AsyncSession = Depends(get_db), _user: CurrentUser = Depends(get_current_user)):
    order = await db.get(CustomerOrderModel, order_id, options=[selectinload(CustomerOrderModel.customer), selectinload(CustomerOrderModel.items)])
    if not order: raise HTTPException(404, "Customer order not found")
    if not order.items: raise HTTPException(400, "Customer order has no products")
    order.status = "CONFIRMED"; await db.commit(); return dto(order)
