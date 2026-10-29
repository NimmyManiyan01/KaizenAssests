"""Current assembly material-request validation coverage."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.assembly.infrastructure.api.router import CreateAssemblyMaterialRequestPayload


def test_material_request_payload_accepts_positive_production_target():
    payload = CreateAssemblyMaterialRequestPayload(
        product_code="FG-PIPE-001",
        target_quantity=Decimal("10"),
        required_date=date.today() + timedelta(days=1),
    )

    assert payload.target_quantity == Decimal("10")
    assert payload.priority == "NORMAL"
    assert payload.assembly_line == "LINE-01"


def test_material_request_payload_rejects_non_positive_target():
    with pytest.raises(ValidationError):
        CreateAssemblyMaterialRequestPayload(
            product_code="FG-PIPE-001",
            target_quantity=0,
            required_date=date.today() + timedelta(days=1),
        )
