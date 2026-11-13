import pytest
from app.modules.gate.infrastructure.api.router import resolve_asn_operational_status, _asn_response
from app.common.persistence.models import AsnModel
import uuid


def test_resolve_asn_operational_status_submitted():
    status = resolve_asn_operational_status(
        asn_status="SUBMITTED",
        gate_entry_status=None,
    )
    assert status == "SUBMITTED"


def test_resolve_asn_operational_status_cancelled():
    status = resolve_asn_operational_status(
        asn_status="CANCELLED",
        gate_entry_status="AWAITING_DOCK",
        assigned_dock_code="DOCK-1",
        grn_status="GRN_POSTED",
    )
    assert status == "CANCELLED"


def test_resolve_asn_operational_status_awaiting_dock():
    status = resolve_asn_operational_status(
        asn_status="SUBMITTED",
        gate_entry_status="AWAITING_DOCK",
    )
    assert status == "AWAITING_DOCK"


def test_resolve_asn_operational_status_dock_assigned():
    # Case A: gate entry has assigned dock id
    status_a = resolve_asn_operational_status(
        asn_status="AWAITING_DOCK",
        gate_entry_status="AWAITING_DOCK",
        assigned_dock_code="DOCK-02",
    )
    assert status_a == "DOCK_ASSIGNED"

    # Case B: dock request status is DOCK_ASSIGNED
    status_b = resolve_asn_operational_status(
        asn_status="AWAITING_DOCK",
        gate_entry_status=None,
        dock_request_status="DOCK_ASSIGNED",
    )
    assert status_b == "DOCK_ASSIGNED"


def test_resolve_asn_operational_status_occupied_and_unloading():
    status_occ = resolve_asn_operational_status(
        asn_status="DOCK_ASSIGNED",
        gate_entry_status="OCCUPIED",
        assigned_dock_code="DOCK-01",
    )
    assert status_occ == "OCCUPIED"

    status_unload = resolve_asn_operational_status(
        asn_status="OCCUPIED",
        gate_entry_status="UNLOADING_IN_PROGRESS",
        assigned_dock_code="DOCK-01",
    )
    assert status_unload == "UNLOADING_IN_PROGRESS"


def test_resolve_asn_operational_status_receiving_completed():
    status = resolve_asn_operational_status(
        asn_status="UNLOADING_IN_PROGRESS",
        gate_entry_status="RECEIVING_COMPLETED",
        assigned_dock_code="DOCK-01",
    )
    assert status == "RECEIVING_COMPLETED"


def test_resolve_asn_operational_status_grn():
    status_pending = resolve_asn_operational_status(
        asn_status="RECEIVING_COMPLETED",
        gate_entry_status="RECEIVING_COMPLETED",
        grn_status="DRAFT",
    )
    assert status_pending == "GRN_PENDING"

    status_posted = resolve_asn_operational_status(
        asn_status="AWAITING_DOCK",
        gate_entry_status="RECEIVING_COMPLETED",
        grn_posted=True,
    )
    assert status_posted == "GRN_POSTED"


def test_resolve_asn_operational_status_vehicle_exited():
    status = resolve_asn_operational_status(
        asn_status="AWAITING_DOCK",
        gate_entry_status="VEHICLE_EXITED",
        gate_entry_exited=True,
        grn_posted=True,
    )
    assert status == "VEHICLE_EXITED"


def test_asn_response_formatting():
    asn = AsnModel(
        id=uuid.uuid4(),
        asn_number="ASN-2026-001",
        po_number="PO-2026-101",
        vehicle_number="KA01AB2029",
        status="AWAITING_DOCK",
        shipment_type="STANDARD",
        logistics=[{"type": "asn_details", "supplier_name": "MTU Supplier"}],
        lines=[],
        documents=[],
    )
    gate_info = {
        "gate_entry_number": "GE-001",
        "vehicle_number": "KA01AB2029",
        "dock_number": "DOCK-01",
    }
    resp = _asn_response(asn, operational_status="DOCK_ASSIGNED", gate_info=gate_info)
    assert resp["asn_number"] == "ASN-2026-001"
    assert resp["status"] == "DOCK_ASSIGNED"
    assert resp["gate_entry_number"] == "GE-001"
    assert resp["assigned_dock_id"] == "DOCK-01"
    assert resp["dock_number"] == "DOCK-01"


def test_gate_entry_model_attributes_and_query_filters():
    from app.modules.gate.infrastructure.persistence.models import GateEntryModel
    from sqlalchemy import select, or_, func

    # Verify GateEntryModel has asn_id, vehicle_number, po_number, and NOT asn_number
    assert hasattr(GateEntryModel, "asn_id")
    assert hasattr(GateEntryModel, "vehicle_number")
    assert hasattr(GateEntryModel, "po_number")
    assert not hasattr(GateEntryModel, "asn_number")

    # Verify building query filters with asn_uuids, vehicle_numbers, po_numbers works without AttributeError
    asn_uuids = [uuid.uuid4()]
    vehicle_numbers = ["KA01AB2029"]
    po_numbers = ["PO-2026-101"]

    ge_filters = []
    if asn_uuids:
        ge_filters.append(GateEntryModel.asn_id.in_(asn_uuids))
    if vehicle_numbers:
        ge_filters.append(func.upper(GateEntryModel.vehicle_number).in_(vehicle_numbers))
    if po_numbers:
        ge_filters.append(func.upper(GateEntryModel.po_number).in_(po_numbers))

    stmt = select(GateEntryModel).where(or_(*ge_filters))
    assert stmt is not None

