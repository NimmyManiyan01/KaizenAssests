from decimal import Decimal
from types import SimpleNamespace
import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import UniqueConstraint

from app.common.persistence.models import MaterialStockModel
from app.modules.receiving.infrastructure.persistence.repository_impl import _qc_released_quantity
from app.modules.storage.infrastructure.api.inventory_router import BinTransferRequest
from app.modules.storage.infrastructure.api.pickup_router import CompletePickupTaskRequest, get_pickup_task
from app.modules.storage.infrastructure.api.router import PutawayConfirmationRequest
from app.modules.storage.infrastructure.persistence.models import (
    InventoryIssueTransactionModel,
    InventoryLocationBalanceModel,
    PutawayMovementModel,
)
from app.modules.store.infrastructure.api.schemas import BulkRackCreate


def test_inventory_balances_are_unique_per_material_location_and_batch():
    constraints = [
        constraint
        for constraint in InventoryLocationBalanceModel.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    ]

    assert any(
        {column.name for column in constraint.columns}
        == {"material_code", "storage_location_id", "batch_number"}
        for constraint in constraints
    )


def test_warehouse_stock_aliases_share_the_persisted_quantity_columns():
    stock = MaterialStockModel(
        material_code="TEST-MATERIAL",
        warehouse_id="configured-warehouse",
        on_hand=Decimal("8"),
        allocated=Decimal("3"),
        available=Decimal("5"),
    )

    assert stock.on_hand_quantity == Decimal("8")
    assert stock.allocated_quantity == Decimal("3")
    assert stock.available_quantity == Decimal("5")
    assert stock.warehouse_id == "configured-warehouse"


@pytest.mark.parametrize("model", [PutawayMovementModel, InventoryIssueTransactionModel])
def test_confirmation_ids_have_database_uniqueness_guards(model):
    confirmation_index = next(index for index in model.__table__.indexes if "confirmation_id" in index.columns)

    assert confirmation_index.unique is True


def test_qc_rejection_and_unreleased_lines_never_create_putaway_quantity():
    assert _qc_released_quantity(SimpleNamespace(quality_result="REJECTED", quality_approved_quantity=Decimal("9"))) == 0
    assert _qc_released_quantity(SimpleNamespace(quality_result="PENDING", quality_approved_quantity=Decimal("9"))) == 0
    assert _qc_released_quantity(SimpleNamespace(quality_result="ACCEPTED", quality_approved_quantity=Decimal("0"))) == 0
    assert _qc_released_quantity(SimpleNamespace(quality_result="PASSED", quality_approved_quantity=Decimal("2.5"))) == Decimal("2.5")


def test_bulk_rack_and_batch_transfer_requests_validate_inputs():
    rack = BulkRackCreate(
        zone_id="persisted-zone",
        rack_code="RACK-A",
        bin_code_prefix="A-",
        bin_code_start=1,
        count=25,
        position_prefix="P-",
        position_start=1,
        code_width=3,
        capacity=Decimal("150"),
    )
    transfer = BinTransferRequest(
        material_code="MAT-X",
        batch_number="LOT-22",
        source_bin_code="A-001",
        destination_bin_code="B-001",
        quantity=Decimal("2"),
        reason="Space Optimization",
    )

    assert rack.count == 25
    assert transfer.batch_number == "LOT-22"
    with pytest.raises(ValidationError):
        BulkRackCreate(
            zone_id="persisted-zone",
            rack_code="RACK-A",
            bin_code_prefix="A-",
            count=501,
            position_prefix="P-",
            capacity=Decimal("150"),
        )


def test_scan_confirmation_contracts_accept_client_idempotency_keys():
    putaway = PutawayConfirmationRequest(
        material_scan="existing-material-qr",
        location_scan="existing-rack-qr",
        quantity=Decimal("1"),
        confirmation_id="client-confirmation-1",
    )
    picking = CompletePickupTaskRequest(
        material_scan="existing-material-qr",
        zone_scan="existing-bin-qr",
        quantity=Decimal("1"),
        confirmation_id="client-confirmation-2",
    )

    assert putaway.confirmation_id == "client-confirmation-1"
    assert picking.confirmation_id == "client-confirmation-2"


@pytest.mark.asyncio
async def test_get_pickup_task_remains_a_read_only_route():
    task = SimpleNamespace(
        id=uuid.uuid4(),
        task_number="PICK-1",
        requisition_id=None,
        request_id=None,
        requisition_number=None,
        request_number="REQ-1",
        store_id=uuid.uuid4(),
        store_code="STORE-A",
        store_name="Store A",
        department="Assembly",
        material_code="MAT-A",
        material_name="Material A",
        requested_quantity=Decimal("2"),
        picked_quantity=Decimal("0"),
        uom="PCS",
        priority="NORMAL",
        required_date=None,
        suggested_zone_id=None,
        suggested_zone_code=None,
        picked_zone_id=None,
        picked_zone_code=None,
        status="PENDING",
        assigned_by=None,
        assigned_at=None,
        started_by=None,
        started_at=None,
        completed_by=None,
        completed_at=None,
        created_at=None,
        updated_at=None,
    )

    class Result:
        def scalar_one_or_none(self):
            return task

    class Session:
        async def execute(self, _statement):
            return Result()

    response = await get_pickup_task(
        str(task.id),
        uow=SimpleNamespace(session=Session()),
        user=SimpleNamespace(roles=["ADMIN"]),
    )

    assert response["task_number"] == "PICK-1"
    assert response["status"] == "PENDING"
