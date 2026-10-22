"""Dashboard regression tests without a database: pytest --noconftest this_file."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.assembly.infrastructure.api.router import (
    _dashboard_material_supply,
    get_assembly_dashboard,
)


@pytest.mark.parametrize("received, expected", [(10, 0), (6, 4), (0, 10)])
def test_actual_receipt_overrides_stale_shortage(received, expected):
    item = {"required_quantity": 10, "available_quantity": 0, "shortage": 10,
            "status": "SHORTAGE", "issued_quantity": 10, "received_quantity": received}
    assert _dashboard_material_supply(item, 100, receipt_confirmed=True) == (10, received, expected)


def test_current_stock_and_issued_materials_replace_creation_snapshot():
    item = {"required_quantity": 10, "available_quantity": 0, "shortage": 10, "issued_quantity": 4}
    assert _dashboard_material_supply(item, 6) == (10, 10, 0)
    assert _dashboard_material_supply(item, 2) == (10, 6, 4)


@pytest.mark.asyncio
@pytest.mark.parametrize("status, received, expected", [
    ("IN_PRODUCTION", 10, []),
    ("MATERIAL_READY", 10, []),
    ("IN_PRODUCTION", None, []),
    ("COMPLETED", 0, []),
    ("CANCELLED", 0, []),
    ("IN_PRODUCTION", 6, ["Material Shortage"]),
    ("MATERIAL_REQUESTED", None, ["Waiting for Material"]),
    ("MATERIAL_PENDING", 0, ["Material Shortage"]),
])
async def test_dashboard_uses_current_fulfillment(status, received, expected):
    item = {"material_code": "MAT-1", "required_quantity": 10, "available_quantity": 0,
            "shortage": 10, "status": "SHORTAGE", "uom": "PCS"}
    if received is not None:
        item["received_quantity"] = received
    order = SimpleNamespace(status=status, items=[item], order_number="ASM-1", product_name="Pump",
                            completed_at=None, updated_at=None, rejected_quantity=0,
                            created_at=None, started_at=None, material_received_at=True if received is not None else None)
    orders_result = MagicMock()
    orders_result.scalars.return_value.all.return_value = [order]
    stock_result = MagicMock()
    stock_result.all.return_value = [("mat-1", 10)]
    uow = MagicMock()
    uow.__aenter__ = AsyncMock(return_value=uow)
    uow.__aexit__ = AsyncMock(return_value=False)
    uow.session.execute = AsyncMock(side_effect=[orders_result, stock_result])
    with patch("app.modules.assembly.infrastructure.api.router._serialize_order", return_value={}):
        response = await get_assembly_dashboard(uow=uow, current_user=None)
    assert [alert["type"] for alert in response["needs_attention"]] == expected
    if expected == ["Material Shortage"]:
        assert response["needs_attention"][0]["shortage"] == (4 if received == 6 else 10)


def test_zero_placeholder_before_receipt_uses_current_stock():
    item = {"required_quantity": 10, "received_quantity": 0, "issued_quantity": 0, "status": "SHORTAGE"}
    assert _dashboard_material_supply(item, 10) == (10, 10, 0)
