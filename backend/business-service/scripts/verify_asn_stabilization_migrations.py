"""Exercise the two real ASN migrations in a rolled-back disposable schema only."""
import asyncio
import importlib.util
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from alembic.config import Config
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = "kaizenassests_test_fg_b978662c"
configured = urlsplit(dotenv_values(ROOT / ".env")["DATABASE_URL"])
assert configured.scheme in {"postgresql", "postgresql+asyncpg"}
assert configured.path.strip("/").lower() != EXPECTED.lower()
target = urlunsplit(configured._replace(path=f"/{EXPECTED}"))
schema = "asn_migration_check_" + uuid.uuid4().hex
columns = {("gate_entry", "po_number"), ("gate_entry", "po_document_path"),
           ("damage_report", "po_number"), ("vehicle_exit_approval", "po_id"),
           ("handling_unit", "po_number")}


def exercise(connection):
    modules = []
    for name in ("20261033_asn_first_po_optional", "20261034_optional_handling_unit_po"):
        spec = importlib.util.spec_from_file_location(name, ROOT / "alembic" / "versions" / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
    # Minimal pre-migration schema: the real migration functions run unchanged.
    for ddl in (
        "CREATE TABLE purchase_order (id UUID PRIMARY KEY)",
        "CREATE TABLE gate_entry (po_number VARCHAR(64) NOT NULL, po_document_path VARCHAR(256) NOT NULL, business_required TEXT NOT NULL)",
        "CREATE TABLE damage_report (po_number VARCHAR(64) NOT NULL)",
        "CREATE TABLE vehicle_exit_approval (po_id UUID NOT NULL REFERENCES purchase_order(id))",
        "CREATE TABLE handling_unit (po_number VARCHAR(64) NOT NULL)",
    ):
        connection.execute(text(ddl))
    historical_id = uuid.uuid4()
    connection.execute(text("INSERT INTO purchase_order VALUES (:id)"), {"id": historical_id})
    connection.execute(text("INSERT INTO vehicle_exit_approval VALUES (:id)"), {"id": historical_id})

    def snapshot():
        return {(r.table_name, r.column_name): r.is_nullable for r in connection.execute(text(
            "SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema=:schema"
        ), {"schema": schema})}

    before = snapshot()
    with Operations.context(MigrationContext.configure(connection)):
        for module in modules:
            module.upgrade()
        after = snapshot()
        assert {key for key in before if before[key] != after[key]} == columns
        assert all(after[key] == "YES" for key in columns)
        assert connection.scalar(text("SELECT po_id FROM vehicle_exit_approval")) == historical_id
        assert connection.scalar(text("SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid='vehicle_exit_approval'::regclass")) == 1
        for module in reversed(modules):
            module.downgrade()
        assert snapshot() == before
        for module in modules:
            module.upgrade()
        # Each nullable column independently prevents the corresponding downgrade.
        for table, column in sorted(columns):
            savepoint = connection.begin_nested()
            try:
                if table == "gate_entry":
                    other = "po_document_path" if column == "po_number" else "po_number"
                    connection.execute(text(f"INSERT INTO gate_entry ({column},{other},business_required) VALUES (NULL,'legacy','required')"))
                else:
                    connection.execute(text(f"INSERT INTO {table} ({column}) VALUES (NULL)"))
                module = modules[1] if table == "handling_unit" else modules[0]
                try:
                    module.downgrade()
                except RuntimeError as error:
                    assert f"{table}.{column}" in str(error)
                else:
                    raise AssertionError(f"Downgrade accepted NULL in {table}.{column}")
            finally:
                savepoint.rollback()
    print("migration_upgrade_exact_nullable_changes=5")
    print("historical_po_row_and_foreign_key_preserved=True")
    print("empty_nullable_columns_downgrade_and_reupgrade=passed")
    print("null_downgrade_guards=5 passed")


async def main():
    engine = create_async_engine(target)
    try:
        async with engine.connect() as connection:
            assert await connection.scalar(text("SELECT current_database()")) == EXPECTED
            head = await connection.scalar(text("SELECT version_num FROM public.alembic_version"))
            scripts = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
            assert scripts.get_current_head() == head == "20261034_optional_handling_unit_po"
            print(f"verified_disposable_database={EXPECTED}; head={head}")
            try:
                await connection.run_sync(exercise)
            finally:
                await connection.rollback()
            assert not await connection.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=:schema)"), {"schema": schema})
            print("verification_schema_rolled_back=True; public_schema_untouched=True")
    finally:
        await engine.dispose()


asyncio.run(main())
