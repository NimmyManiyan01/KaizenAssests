"""Isolated QC API/database tests: pytest --noconftest this_file."""
from datetime import datetime, timezone
from decimal import Decimal
import uuid

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.database.session import get_uow
from app.modules.assembly.infrastructure.api.router import QualityInspectionPayload, router
from app.modules.assembly.infrastructure.persistence.models import (
    AssemblyOrderModel, AssemblyQualityInspectionModel, AssemblyFinishedGoodsModel,
)
from app.security.dependencies import CurrentUser, get_current_user


def payload(**changes):
    return {"order_id": "ASM-QC-1", "passed_quantity": 10,
            "inspector_name": "Asha Kumar", "authorized_person_confirmed": True, **changes}


@pytest.mark.parametrize("name", ["", "   ", "A", "123", "A<script>", "X" * 129])
def test_invalid_inspector_names(name):
    with pytest.raises(ValidationError):
        QualityInspectionPayload(**payload(inspector_name=name))


@pytest.mark.parametrize("name", ["Asha Kumar", "Anne-Marie O'Neil", "Dr. Rao", "Jos\u00e9 Silva", "\u674e\u660e"])
def test_valid_inspector_names(name):
    assert QualityInspectionPayload(**payload(inspector_name="  " + name + "  ")).inspector_name == name


@pytest.mark.parametrize("confirmed", [False, None, "true", 1])
def test_confirmation_must_be_true_boolean(confirmed):
    with pytest.raises(ValidationError):
        QualityInspectionPayload(**payload(authorized_person_confirmed=confirmed))


@pytest.mark.parametrize("missing", ["inspector_name", "authorized_person_confirmed"])
def test_inspector_and_confirmation_are_mandatory(missing):
    body = payload()
    del body[missing]
    with pytest.raises(ValidationError):
        QualityInspectionPayload(**body)


class TestUow:
    __test__ = False

    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if exc_type:
            await self.session.rollback()

    async def commit(self):
        await self.session.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize("roles,permissions,changes,expected", [
    (["ASSEMBLY_MANAGER"], [], {}, 200),
    (["QC"], [], {}, 200),
    (["QC"], [], {"inspected_by_user_id": "spoofed-user", "inspected_at": "2000-01-01"}, 200),
    ([], ["assembly:quality:inspect"], {}, 200),
    (["WAREHOUSE"], [], {}, 403),
    (["SUPPLIER"], [], {}, 403),
    (["DISPATCH"], [], {}, 403),
    (["ASSEMBLY_MANAGER"], [], {"authorized_person_confirmed": False}, 422),
    (["ASSEMBLY_MANAGER"], [], {"inspector_name": "  "}, 422),
    (["ASSEMBLY_MANAGER"], [], {"passed_quantity": 9}, 400),
    (["ASSEMBLY_MANAGER"], [], {"passed_quantity": -1}, 422),
    (["ASSEMBLY_MANAGER"], [], {"passed_quantity": 6, "failed_quantity": 1, "rework_quantity": 2, "held_quantity": 1}, 200),
])
async def test_qc_permissions_balance_and_persisted_audit(roles, permissions, changes, expected):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [AssemblyOrderModel.__table__, AssemblyQualityInspectionModel.__table__, AssemblyFinishedGoodsModel.__table__]
    try:
        async with engine.begin() as conn:
            for table in tables:
                await conn.run_sync(table.create)
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            order = AssemblyOrderModel(id=uuid.uuid4(), order_number="ASM-QC-1", product_code="PUMP",
                                       product_name="Pump", completed_quantity=Decimal("10"),
                                       planned_quantity=Decimal("10"), status="QC_PENDING", created_by="maker")
            session.add(order)
            await session.commit()
            user = CurrentUser(subject="authenticated-user-42", username="logged_in_manager",
                               roles=roles, permissions=permissions, raw_claims={})
            app = FastAPI()
            app.include_router(router)
            app.dependency_overrides[get_current_user] = lambda: user
            app.dependency_overrides[get_uow] = lambda: TestUow(session)
            before = datetime.now(timezone.utc).replace(tzinfo=None)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/assembly/quality/inspect", json=payload(**changes))
            assert response.status_code == expected, response.text
            inspection = await session.scalar(select(AssemblyQualityInspectionModel))
            fg = await session.scalar(select(AssemblyFinishedGoodsModel))
            if expected != 200:
                assert inspection is None
                assert fg is None
            else:
                assert inspection.inspected_by == "Asha Kumar"
                assert inspection.inspected_by_user_id == "authenticated-user-42"
                assert inspection.authorized_person_confirmed is True
                assert inspection.inspected_at >= before
                assert fg.quantity == changes.get("passed_quantity", 10)
                assert fg.qr_code and fg.status == "QC_APPROVED"
                assert response.json()["inspected_by_user_id"] == user.subject
    finally:
        await engine.dispose()
