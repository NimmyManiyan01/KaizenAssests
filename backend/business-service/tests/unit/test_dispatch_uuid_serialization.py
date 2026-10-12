import uuid

from app.modules.dispatch.infrastructure.api.router import _uuid_value
from app.modules.dispatch.infrastructure.api.schemas import DispatchItemResponse


def test_legacy_uuid_repr_is_normalized_before_dispatch_response():
    item_id = uuid.uuid4()
    normalized = _uuid_value(f"UUID('{item_id}')")

    response = DispatchItemResponse(
        id=normalized,
        material_code="MAT-TEST",
        material_name="Test material",
        quantity_ordered=1,
        quantity_available=1,
        quantity_reserved=1,
        quantity_picked=1,
        quantity_packed=1,
        quantity_loaded=0,
        quantity_pending=0,
        uom="PCS",
        status="PACKED",
        package_number="PKG-TEST-001",
    )

    assert response.id == item_id
    assert str(response.id) == str(item_id)


def test_uuid_value_preserves_real_uuid_objects():
    item_id = uuid.uuid4()
    assert _uuid_value(item_id) is item_id
