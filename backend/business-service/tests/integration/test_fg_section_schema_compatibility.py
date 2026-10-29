"""Exercise an unmigrated schema only inside the allowlisted test database."""
import importlib.util
from pathlib import Path
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy import delete, text

from app.database.session import UnitOfWork, engine, get_uow, session_scope
from app.main import app
from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel, AssemblyFinishedGoodsModel


@pytest.mark.asyncio
async def test_unmigrated_fg_reads_and_partially_created_schema_migration():
    schema = "fg_schema_test_" + uuid.uuid4().hex
    order_id, fg_id = uuid.uuid4(), uuid.uuid4()
    original_qr = "FG|ORIGINAL-SCHEMA-TEST|" + fg_id.hex
    async with session_scope() as db:
        db.add(AssemblyOrderModel(id=order_id, order_number="SCHEMA-" + order_id.hex,
            product_name="Historical FG", created_by="test", completed_quantity=1))
        await db.flush()
        db.add(AssemblyFinishedGoodsModel(id=fg_id, assembly_order_id=order_id, product_code="SCHEMA-FG",
            product_name="Historical FG", quantity=1, status="QC_APPROVED", warehouse_id="ASSEMBLY",
            location_code="ASSEMBLY-STORAGE-01", on_hand_before=0, on_hand_after=1, qr_code=original_qr))

    previous = app.dependency_overrides.get(get_uow)
    try:
        async with engine.begin() as connection:
            actual = await connection.scalar(text("SELECT current_database()"))
            assert actual.startswith("kaizenassests_test_") or actual.endswith("_test")
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            for table in ("assembly_finished_goods", "finished_goods_request", "finished_goods_section"):
                await connection.execute(text(f'CREATE TABLE "{schema}".{table} (LIKE public.{table} INCLUDING ALL)'))
            await connection.execute(text(f'INSERT INTO "{schema}".assembly_finished_goods SELECT * FROM public.assembly_finished_goods WHERE id = :id'), {"id": fg_id})
            await connection.execute(text(f'ALTER TABLE "{schema}".assembly_finished_goods DROP COLUMN section_main_id, DROP COLUMN section_supplier_id'))
            await connection.execute(text(f'ALTER TABLE "{schema}".finished_goods_request DROP COLUMN section_fg_id'))

        class LegacyUow(UnitOfWork):
            async def __aenter__(self):
                await super().__aenter__()
                await self.session.execute(text("SET TRANSACTION READ ONLY"))
                await self.session.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
                return self

        async def legacy_uow():
            yield LegacyUow()

        app.dependency_overrides[get_uow] = legacy_uow
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = {"X-User-Roles": "ASSEMBLY"}
            paths = ["/api/v1/assembly/finished-goods?group_by=product",
                f"/api/v1/assembly/finished-goods/{fg_id}",
                f"/api/v1/assembly/finished-goods/{fg_id}/traceability",
                "/api/v1/assembly/finished-goods/inventory-summary"]
            for path in paths:
                response = await client.get(path, headers=headers)
                assert response.status_code == 200, (path, response.text)
                if path.endswith(str(fg_id)):
                    assert response.json()["qr_code"] == original_qr
                    assert response.json()["section_workflow_available"] is False
                    assert response.json()["dispatched_sections"] is None
            for path, role in (("/api/v1/assembly/fg-loading", "ASSEMBLY"),
                               ("/api/v1/assembly/supplier/pickup-finished-goods", "SUPPLIER")):
                response = await client.get(path, headers={"X-User-Roles": role})
                assert response.status_code == 503
                assert "20261037_fg_section_numbering" in response.json()["detail"]

        # Match the live failure: create_all already made the section table,
        # but existing FG/request tables were not altered. Upgrades must cope.
        def migrate(connection):
            root = Path(__file__).resolve().parents[2] / "alembic" / "versions"
            with Operations.context(MigrationContext.configure(connection)):
                for filename in ("20261036_fg_transport_sections.py", "20261037_fg_section_numbering.py"):
                    spec = importlib.util.spec_from_file_location("schema_test_migration", root / filename)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    module.upgrade()
                    module.upgrade()  # Safe retry after a partially prepared schema.

        async with engine.begin() as connection:
            await connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            await connection.run_sync(migrate)
            assert await connection.scalar(text("SELECT qr_code FROM assembly_finished_goods WHERE id=:id"), {"id": fg_id}) == original_qr
            assert await connection.scalar(text("SELECT count(*) FROM finished_goods_section")) == 0
            assert await connection.scalar(text("SELECT section_main_id FROM assembly_finished_goods WHERE id=:id"), {"id": fg_id}) is None
            assert await connection.scalar(text("SELECT to_regclass('fg_transport_main_number')::text")) == "fg_transport_main_number"
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_uow, None)
        else:
            app.dependency_overrides[get_uow] = previous
        async with engine.begin() as connection:
            # The schema name is a fixed test prefix plus a generated UUID.
            assert schema.startswith("fg_schema_test_") and schema[15:].isalnum()
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        async with session_scope() as db:
            await db.execute(delete(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.id == fg_id))
            await db.execute(delete(AssemblyOrderModel).where(AssemblyOrderModel.id == order_id))
