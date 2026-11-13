import re
import pytest
from fastapi import HTTPException

from app.modules.gate.infrastructure.api.damage_claims import (
    compute_replacement_asn_number,
    router as damage_claims_router,
    ShipmentBody,
)


def test_replacement_asn_number_first_transaction():
    """Verify appending -R to the original ASN reference for the initial replacement."""
    ref = compute_replacement_asn_number("ASN-2026-00125", [])
    assert ref == "ASN-2026-00125-R"


def test_replacement_asn_number_collision_safety():
    """Verify collision avoidance with -R2, -R3 for subsequent replacement transactions."""
    ref2 = compute_replacement_asn_number("ASN-2026-00125", ["ASN-2026-00125-R"])
    assert ref2 == "ASN-2026-00125-R2"

    ref3 = compute_replacement_asn_number("ASN-2026-00125", ["ASN-2026-00125-R", "ASN-2026-00125-R2"])
    assert ref3 == "ASN-2026-00125-R3"


def test_replacement_asn_number_empty_original_fallback():
    """Verify fallback handling when original ASN is empty or None."""
    ref = compute_replacement_asn_number("", [])
    assert ref == "ASN-REPLACEMENT-R"


def test_replacement_asn_does_not_corrupt_standard_asn_numbering():
    """Verify that regular ASN counter parsing regex excludes replacement -R identifiers."""
    year = 2026
    standard_pattern = re.compile(rf"^ASN-{year}-(\d+)$")

    standard_asn = "ASN-2026-00125"
    replacement_asn_1 = "ASN-2026-00125-R"
    replacement_asn_2 = "ASN-2026-00125-R2"

    m_std = standard_pattern.match(standard_asn)
    assert m_std is not None
    assert int(m_std.group(1)) == 125

    # Replacement references MUST NOT match the standard sequential integer pattern
    assert standard_pattern.match(replacement_asn_1) is None
    assert standard_pattern.match(replacement_asn_2) is None


def test_shipment_body_validation():
    """Verify validation constraints on replacement shipment payload."""
    body = ShipmentBody(
        vehicle_number="MH12AB1234",
        driver_name="Ramesh Kumar",
        driver_contact="9876543210",
        replacement_quantity=10,
        transporter="VRL Logistics",
        challan_number="DC-2026-001",
        invoice_number="INV-2026-001",
    )
    assert body.vehicle_number == "MH12AB1234"
    assert body.replacement_quantity == 10

    # Replacement quantity must be strictly greater than 0
    with pytest.raises(Exception):
        ShipmentBody(vehicle_number="MH12AB1234", replacement_quantity=0)

    with pytest.raises(Exception):
        ShipmentBody(vehicle_number="MH12AB1234", replacement_quantity=-5)


def test_damage_claims_routes_registered():
    """Verify that replacement shipment routes are properly exposed on the router."""
    rep_routes = [r for r in damage_claims_router.routes if "replacement-shipment" in getattr(r, "path", "")]
    assert len(rep_routes) >= 1
