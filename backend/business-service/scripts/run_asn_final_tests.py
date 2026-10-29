"""Verify the disposable PostgreSQL target before migrations or pytest imports."""
import asyncio
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit, urlunsplit

from alembic import command
from alembic.config import Config
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = "kaizenassests_test_fg_b978662c"
HEAD = "20261035_putaway_batch_uniqueness"
configured = urlsplit(dotenv_values(ROOT / ".env").get("DATABASE_URL", ""))
if configured.scheme not in {"postgresql", "postgresql+asyncpg"} or configured.path.strip("/").lower() == EXPECTED:
    raise SystemExit("STOP: configured URL is not PostgreSQL or equals the disposable target")
target = urlunsplit(configured._replace(path=f"/{EXPECTED}"))


async def verify():
    engine = create_async_engine(target)
    try:
        async with engine.connect() as conn:
            actual = await conn.scalar(text("SELECT current_database()"))
            if actual != EXPECTED:
                raise SystemExit("STOP: unexpected database")
            revision = await conn.scalar(text("SELECT version_num FROM alembic_version"))
            nullable = (await conn.execute(text("""
                SELECT table_name, column_name, is_nullable FROM information_schema.columns
                WHERE table_schema='public' AND (
                  (table_name='gate_entry' AND column_name IN ('po_number','po_document_path')) OR
                  (table_name='damage_report' AND column_name='po_number') OR
                  (table_name='vehicle_exit_approval' AND column_name='po_id') OR
                  (table_name='handling_unit' AND column_name='po_number'))
            """))).all()
            if len(nullable) != 5 or any(row.is_nullable != "YES" for row in nullable):
                raise SystemExit("STOP: ASN-first nullable schema mismatch")
            if not await conn.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid='public.vehicle_exit_approval'::regclass AND confrelid='public.purchase_order'::regclass)")):
                raise SystemExit("STOP: historical PO foreign key is missing")
            return revision
    finally:
        await engine.dispose()


os.chdir(ROOT)
before = asyncio.run(verify())
os.environ["DATABASE_URL"] = target
os.environ["KAIZENASSESTS_TEST_DATABASE_URL"] = target
if sys.argv[1:] == ["--upgrade-disposable"]:
    if before != "20261034_optional_handling_unit_po":
        raise SystemExit(f"STOP: unexpected predecessor {before!r}")
    command.upgrade(Config(str(ROOT / "alembic.ini")), HEAD)
    if asyncio.run(verify()) != HEAD:
        raise SystemExit("STOP: migration head mismatch")
    print(f"disposable_database={EXPECTED}; configured_database={configured.path.strip('/')}; before={before}; after={HEAD}; nullable_PO_fields=5; historical_PO_FK=True")
else:
    if before != HEAD:
        raise SystemExit(f"STOP: unexpected test database revision {before!r}")
    print(f"verified_disposable_database={EXPECTED}; configured_database={configured.path.strip('/')}; head={before}")
    import pytest
    raise SystemExit(pytest.main(sys.argv[1:]))
