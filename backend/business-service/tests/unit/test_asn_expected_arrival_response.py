"""Regression coverage for the ASN expected-arrival response contract."""

from datetime import date, datetime
from decimal import Decimal
import uuid

from app.common.persistence.models import AsnLineModel, AsnModel
from app.modules.gate.infrastructure.api.router import _asn_response


def test_asn_response_exposes_persisted_expected_arrival_date():
    asn = AsnModel(
        id=uuid.uuid4(),
        asn_number="ASN-DATE-REGRESSION",
        supplier_id=uuid.uuid4(),
        shipment_date=date(2026, 10, 13),
        expected_arrival_at=datetime(2026, 10, 14),
        status="SUBMITTED",
    )
    asn.lines = [AsnLineModel(
        id=uuid.uuid4(),
        asn_id=asn.id,
        item_code="MAT-DATE-001",
        material_name="Date test material",
        shipped_quantity=Decimal("1"),
        uom="PCS",
    )]

    response = _asn_response(asn)

    assert response["expected_arrival_at"] == "2026-10-14T00:00:00"
    assert response["expected_arrival_date"] == "2026-10-14"
    assert response["delivery_date"] == "2026-10-14"
