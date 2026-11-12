from types import SimpleNamespace

from app.modules.gate.infrastructure.api.dashboard import _gate_security_metrics


def test_gate_security_metrics_counts_each_active_vehicle_independently():
    inbound = [
        {"status": "AWAITING_DOCK", "exited_at": None},
        {"status": "DOCK_ASSIGNED", "exited_at": None},
        {"status": "UNLOADING_IN_PROGRESS", "exited_at": None},
        {"status": "RECEIVING_COMPLETED", "exited_at": None},
    ]

    metrics = _gate_security_metrics(inbound, [])

    assert metrics == {"totalEntries": 4, "vehiclesInside": 4, "totalExits": 0}


def test_gate_security_metrics_excludes_rejected_and_exited_records():
    inbound = [
        {"status": "AWAITING_DOCK", "exited_at": None},
        {"status": "REJECTED", "exited_at": None},
        {"status": "DENIED_ENTRY", "exited_at": None},
        {"status": "VEHICLE_EXITED", "exited_at": "2026-11-12T10:00:00Z"},
    ]

    metrics = _gate_security_metrics(inbound, [])

    assert metrics == {"totalEntries": 4, "vehiclesInside": 1, "totalExits": 1}


def test_gate_security_metrics_includes_pickup_waiting_for_exit():
    pickup_visits = [
        SimpleNamespace(status="INSIDE_FACILITY", exited_at=None),
        SimpleNamespace(status="READY_FOR_GATE_EXIT", exited_at=None),
        SimpleNamespace(status="VEHICLE_EXITED", exited_at="2026-11-12T11:00:00Z"),
    ]

    metrics = _gate_security_metrics([], pickup_visits)

    assert metrics == {"totalEntries": 3, "vehiclesInside": 2, "totalExits": 1}
