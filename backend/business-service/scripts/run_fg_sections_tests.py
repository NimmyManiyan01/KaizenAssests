"""Use only the existing explicitly named disposable PostgreSQL database."""
import asyncio
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit, urlunsplit
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
TARGET = "kaizenassests_test_fg_b978662c"
configured = urlsplit(dotenv_values(ROOT / ".env").get("DATABASE_URL", ""))
if configured.scheme not in {"postgresql", "postgresql+asyncpg"} or configured.path.strip("/").lower() == TARGET:
    raise SystemExit("Configured database must differ from disposable target")
target = urlunsplit(configured._replace(path=f"/{TARGET}"))
os.environ["DATABASE_URL"] = target
os.environ["KAIZENASSESTS_TEST_DATABASE_URL"] = target
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))


async def verify():
    engine = create_async_engine(target)
    try:
        async with engine.connect() as conn:
            if await conn.scalar(text("SELECT current_database()")) != TARGET:
                raise RuntimeError("Unsafe test target")
            return await conn.scalar(text("SELECT version_num FROM alembic_version"))
    finally:
        await engine.dispose()


revision = asyncio.run(verify())
if revision not in {"20261035_putaway_batch_uniqueness", "20261036_fg_transport_sections", "20261037_fg_section_numbering"}:
    raise SystemExit(f"Unexpected disposable revision: {revision}")
from alembic import command
from alembic.config import Config
command.upgrade(Config(str(ROOT / "alembic.ini")), "20261037_fg_section_numbering")
print(f"Verified disposable database: {TARGET}")
import pytest
raise SystemExit(pytest.main(sys.argv[1:] or ["tests/integration/test_fg_transport_sections.py", "-q"]))
