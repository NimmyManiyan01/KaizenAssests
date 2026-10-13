"""Current supplier identity and ownership model coverage."""

import uuid

from app.common.persistence.models import SupplierModel, SupplierUserModel


def test_supplier_user_is_bound_to_one_supplier_record():
    supplier_id = uuid.uuid4()
    supplier = SupplierModel(
        id=supplier_id,
        supplier_name="Test Supplier",
        registered_company_name="Test Supplier Pvt Ltd",
        vendor_type="MANUFACTURER",
        category=["Raw Materials"],
        industry="Manufacturing",
        gstin="TEST-GSTIN-001",
        supplier_code="SUP-TEST-001",
        status="Active",
    )
    user = SupplierUserModel(
        id=uuid.uuid4(), supplier_id=supplier_id, username="supplier.test",
        password_hash="not-a-real-password", must_change_password=False,
    )

    assert user.supplier_id == supplier.id
    assert user.username == "supplier.test"
    assert supplier.status == "Active"
