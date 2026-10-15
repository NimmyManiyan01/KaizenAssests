import hashlib
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.config.settings import get_settings
from app.database.session import UnitOfWork, get_uow
from app.common.persistence.models import SupplierModel, SupplierUserModel


router = APIRouter(prefix="/api/v1/procurement/auth", tags=["authentication"])


class SupplierLoginRequest(BaseModel):
    username: str
    password: str


@router.post("/supplier-login")
async def supplier_login(payload: SupplierLoginRequest, uow: UnitOfWork = Depends(get_uow)) -> dict:
    settings = get_settings()
    if payload.username.strip() != settings.supplier_username or payload.password != settings.supplier_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid supplier username or password",
        )

    # The local seeded credentials are a real application account, not an
    # anonymous supplier. Bootstrap its master/user link once when no
    # onboarding record exists yet. This preserves the existing login while
    # giving authenticated supplier APIs a durable UUID identity.
    username = settings.supplier_username.strip()
    result = await uow.session.execute(
        select(SupplierUserModel).where(SupplierUserModel.username == username)
    )
    supplier_user = result.scalar_one_or_none()
    if supplier_user is None:
        supplier_result = await uow.session.execute(
            select(SupplierModel).where(SupplierModel.supplier_code == "SUP-DEFAULT")
        )
        supplier = supplier_result.scalar_one_or_none()
        if supplier is None:
            supplier = SupplierModel(
                id=uuid.uuid4(),
                supplier_name=username,
                registered_company_name=f"{username} (Seeded Supplier)",
                vendor_type="MANUFACTURER",
                category=[],
                industry="GENERAL",
                gstin=f"SEED-{uuid.uuid4().hex[:12].upper()}",
                supplier_code="SUP-DEFAULT",
                status="Active",
            )
            uow.session.add(supplier)
            await uow.session.flush()
        supplier_user = SupplierUserModel(
            id=uuid.uuid4(),
            supplier_id=supplier.id,
            username=username,
            password_hash=hashlib.sha256(payload.password.encode()).hexdigest(),
            must_change_password=False,
        )
        uow.session.add(supplier_user)
        await uow.session.commit()

    return {
        "token": f"supplier-mock-token-{supplier_user.id}-{supplier_user.supplier_id}",
        "username": supplier_user.username,
        "supplierId": str(supplier_user.supplier_id),
        "supplier_id": str(supplier_user.supplier_id),
        "mustChangePassword": supplier_user.must_change_password,
    }
