"""Schema-only tests; run with pytest --noconftest (no database required)."""
from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.modules.assembly.infrastructure.api.router import CreateAssemblyMaterialRequestPayload


@pytest.mark.parametrize("offset", [0, 1, 365])
def test_completion_date_accepts_today_and_future(offset):
    value = date.today() + timedelta(days=offset)
    payload = CreateAssemblyMaterialRequestPayload(
        product_code="PUMP", target_quantity=10, required_date=value.isoformat()
    )
    assert payload.required_date == value


@pytest.mark.parametrize("value", [None, "", "invalid", "2026-02-30"])
def test_completion_date_rejects_invalid(value):
    with pytest.raises(ValidationError) as error:
        CreateAssemblyMaterialRequestPayload(product_code="PUMP", target_quantity=10, required_date=value)
    assert error.value.errors()[0]["loc"] == ("required_date",)


def test_completion_date_is_mandatory():
    with pytest.raises(ValidationError):
        CreateAssemblyMaterialRequestPayload(product_code="PUMP", target_quantity=10)


def test_completion_date_rejects_past():
    with pytest.raises(ValidationError, match="today or later"):
        CreateAssemblyMaterialRequestPayload(
            product_code="PUMP", target_quantity=10,
            required_date=(date.today() - timedelta(days=1)).isoformat(),
        )
