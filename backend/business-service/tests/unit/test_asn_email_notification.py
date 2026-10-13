"""Current ASN boundary coverage after the procurement API removal."""

from datetime import date, datetime
from decimal import Decimal
import uuid

from app.common.persistence.models import AsnLineModel, AsnModel


def test_asn_lines_preserve_quantity_and_supplier_linkage_fields():
    supplier_id = uuid.uuid4()
    asn = AsnModel(
        id=uuid.uuid4(),
        asn_number="ASN-CURRENT-001",
        po_id=str(uuid.uuid4()),
        po_number="PO-CURRENT-001",
        supplier_id=supplier_id,
        shipment_date=date(2026, 10, 13),
        expected_arrival_at=datetime(2026, 10, 14, 9, 0),
        vehicle_number="KA01AB1234",
        status="SUBMITTED",
    )
    asn.lines = [AsnLineModel(
        id=uuid.uuid4(), asn_id=asn.id, item_code="MAT-001",
        material_name="Steel", shipped_quantity=Decimal("10"), uom="PCS",
    )]

    assert asn.supplier_id == supplier_id
    assert asn.lines[0].shipped_quantity == Decimal("10")
    assert asn.lines[0].item_code == "MAT-001"
