from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.dock.infrastructure.api.router import _reject_default_dock_removal, router


def test_default_dock_cannot_be_deleted() -> None:
    dock = SimpleNamespace(dock_code="rm-01")

    with pytest.raises(HTTPException, match="default receiving dock") as error:
        _reject_default_dock_removal(dock)

    assert error.value.status_code == 409


def test_default_dock_cannot_be_deactivated() -> None:
    dock = SimpleNamespace(dock_code="RM-01")

    with pytest.raises(HTTPException, match="default receiving dock"):
        _reject_default_dock_removal(dock, False)


def test_user_created_dock_can_be_deleted_or_deactivated() -> None:
    dock = SimpleNamespace(dock_code="RM-02")

    _reject_default_dock_removal(dock)
    _reject_default_dock_removal(dock, False)


def test_default_dock_can_remain_active_during_edit() -> None:
    dock = SimpleNamespace(dock_code="RM-01")

    _reject_default_dock_removal(dock, True)


def test_dock_activation_endpoint_is_registered() -> None:
    matching_routes = [
        route
        for route in router.routes
        if getattr(route, "path", "") == "/api/v1/warehouse/docks/{dock_id}/activation"
    ]

    assert len(matching_routes) == 1
    assert "PATCH" in matching_routes[0].methods


def test_complete_dock_management_registry_endpoint_is_registered() -> None:
    matching_routes = [
        route
        for route in router.routes
        if getattr(route, "path", "") == "/api/v1/warehouse/dock-management/registry"
    ]

    assert len(matching_routes) == 1
    assert "GET" in matching_routes[0].methods
