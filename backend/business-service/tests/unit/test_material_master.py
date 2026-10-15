"""Current shared Material Master model and assembly request item coverage."""

from decimal import Decimal
import uuid

from app.common.persistence.models import (
    MaterialModel,
    MaterialRequestItemModel,
    MaterialVariantModel,
)


def test_material_master_exposes_canonical_code_and_name():
    material = MaterialModel(
        id=uuid.uuid4(),
        material_code="MAT-STEEL-001",
        material_name="Steel",
        category="Raw Materials",
        base_uom="PCS",
        status="Active",
    )

    assert material.code == "MAT-STEEL-001"
    assert material.name == "Steel"
    assert material.status == "Active"


def test_material_variant_and_request_item_preserve_quantity_identity():
    material_id = uuid.uuid4()
    variant = MaterialVariantModel(
        id=uuid.uuid4(), material_id=material_id,
        variant_code="MAT-STEEL-001-V001", uom="PCS", status="Active",
    )
    item = MaterialRequestItemModel(
        id=uuid.uuid4(), request_id=uuid.uuid4(), material_id=material_id,
        material_variant_id=variant.id, material_code="MAT-STEEL-001",
        variant_code=variant.variant_code, material_name="Steel",
        quantity=Decimal("10"), approved_quantity=Decimal("6"), uom="PCS",
    )

    assert item.material_id == material_id
    assert item.material_variant_id == variant.id
    assert item.quantity - item.approved_quantity == Decimal("4")
