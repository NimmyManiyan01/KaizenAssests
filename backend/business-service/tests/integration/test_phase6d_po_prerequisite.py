"""Disposable, test-only multi-material PO prerequisite for Phase 6D."""

from datetime import date
from decimal import Decimal
import os
import uuid

import pytest
from sqlalchemy import select, text

from app.common.persistence.models import (
    MaterialModel,
    PurchaseOrderItemModel,
    PurchaseOrderModel,
    SupplierModel,
)
from app.database.session import AsyncSessionFactory


@pytest.mark.anyio
async def test_three_batch_po_prerequisite_is_valid_and_isolated():
    """Seed only prerequisite master/PO rows; operational receipts use APIs."""
    from urllib.parse import unquote, urlparse

    configured = urlparse(os.environ["KAIZENASSESTS_TEST_DATABASE_URL"])
    expected_database = unquote(configured.path.lstrip("/")).lower()
    supplier_id, material_a_id, material_b_id, po_id = (uuid.uuid4() for _ in range(4))
    suffix = uuid.uuid4().hex[:12].upper()
    supplier_code = f"PH6D-S-{suffix}"
    po_number = f"PH6D-PO-{suffix}"
    material_a_code, material_b_code = f"PH6D-A-{suffix}", f"PH6D-B-{suffix}"

    async with AsyncSessionFactory() as session:
        actual_database = (await session.execute(text("SELECT current_database()"))).scalar_one().lower()
        assert actual_database == expected_database
        assert actual_database.startswith("kaizenassests_test_") or actual_database.endswith("_test")

        supplier = SupplierModel(
            id=supplier_id,
            supplier_name=f"Phase 6D Supplier {suffix}",
            registered_company_name=f"Phase 6D Supplier {suffix} Ltd",
            vendor_type="MANUFACTURER",
            category=["RAW_MATERIAL"],
            industry="MANUFACTURING",
            gstin=f"PH6D{suffix}",
            supplier_code=supplier_code,
            main_materials=[material_a_code, material_b_code],
            status="Active",
        )
        material_a = MaterialModel(
            id=material_a_id, material_code=material_a_code,
            material_name=f"Phase 6D Material A {suffix}", category="RAW_MATERIAL",
            base_uom="PCS", status="Active",
        )
        material_b = MaterialModel(
            id=material_b_id, material_code=material_b_code,
            material_name=f"Phase 6D Material B {suffix}", category="RAW_MATERIAL",
            base_uom="PCS", status="Active",
        )
        po = PurchaseOrderModel(
            id=po_id, po_number=po_number, po_date=date.today(), status="APPROVED",
            supplier_id=supplier_id, supplier_name=supplier.supplier_name,
            warehouse_id="MAIN", total_amount=Decimal("70.00"),
            items=[
                PurchaseOrderItemModel(
                    material_id=material_a_id, material_code=material_a_code,
                    material_name=material_a.material_name, category="RAW_MATERIAL",
                    quantity=Decimal("25"), unit_price=Decimal("2"), uom="PCS",
                ),
                PurchaseOrderItemModel(
                    material_id=material_b_id, material_code=material_b_code,
                    material_name=material_b.material_name, category="RAW_MATERIAL",
                    quantity=Decimal("20"), unit_price=Decimal("1.00"), uom="PCS",
                ),
            ],
        )
        session.add_all([supplier, material_a, material_b])
        await session.flush()
        session.add(po)
        try:
            await session.commit()
            persisted = await session.scalar(
                select(PurchaseOrderModel)
                .where(PurchaseOrderModel.id == po_id)
            )
            assert persisted is not None
            assert persisted.supplier_id == supplier_id
            assert len(persisted.items) == 2
            quantities = {item.material_code: Decimal(item.quantity) for item in persisted.items}
            assert quantities == {material_a_code: Decimal("25"), material_b_code: Decimal("20")}
            # The planned receipt lots are A1=10 PCS + A2=15 PCS, and B1=20 PCS.
            assert quantities[material_a_code] == Decimal("10") + Decimal("15")
            assert quantities[material_b_code] == Decimal("20")
        finally:
            await session.rollback()
            await session.execute(
                text("DELETE FROM purchase_order_item WHERE purchase_order_id = :id"),
                {"id": po_id},
            )
            await session.execute(
                text("DELETE FROM purchase_order WHERE id = :id"), {"id": po_id}
            )
            await session.execute(text("DELETE FROM material WHERE id IN (:a, :b)"), {
                "a": material_a_id, "b": material_b_id,
            })
            await session.execute(text("DELETE FROM supplier WHERE id = :id"), {"id": supplier_id})
            await session.commit()
