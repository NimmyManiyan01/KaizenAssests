"""Regression checks in a local PostgreSQL schema rolled back on completion.

Never connects to Azure and never changes existing application tables.
"""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.engine import make_url
from app.main import app
from app.database.base import Base
from app.database.session import engine
from app.config.settings import get_settings
from app.common.persistence.models import SupplierModel, SupplierUserModel
from app.modules.warehouse.infrastructure.persistence.models import UserAccountModel
from app.modules.admin.infrastructure.api.router import create_user, UserCreate
from app.security.dependencies import CurrentUser
from app.security.passwords import verify_password

spec = importlib.util.spec_from_file_location(
    "supplier_profile_migration", ROOT / "alembic/versions/20261106_supplier_profile_fields.py"
)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

def run_migration(connection):
    with Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()

async def main():
    url = make_url(get_settings().database_url)
    if url.host not in {"localhost", "127.0.0.1"}:
        raise RuntimeError("Verification is restricted to local PostgreSQL")
    schema = "supplier_migration_check_" + uuid.uuid4().hex[:12]
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text('CREATE SCHEMA "' + schema + '"'))
            await connection.execute(text('SET LOCAL search_path TO "' + schema + '"'))
            assert await connection.scalar(text("SELECT current_schema()")) == schema
            await connection.run_sync(Base.metadata.create_all)
            for name in ("payment_terms", "credit_period_days", "updated_by"):
                await connection.execute(text('ALTER TABLE supplier DROP COLUMN "' + name + '"'))
            await connection.execute(text("ALTER TABLE supplier ALTER COLUMN category TYPE VARCHAR(64) USING category::text"))
            await connection.execute(text("ALTER TABLE supplier ALTER COLUMN category SET NOT NULL"))
            cases = [
                ("legacy_plain", "Chemical", ["Chemical"]),
                ("legacy_array", '["Electrical","Mechanical"]', ["Electrical","Mechanical"]),
                ("legacy_blank", "", []),
                ("legacy_malformed", "[legacy", ["[legacy"]),
            ]
            for code, category, _ in cases:
                await connection.execute(text("""
                    INSERT INTO supplier
                    (id,supplier_name,registered_company_name,vendor_type,category,industry,gstin,
                     supplier_code,rating,performance_score,status,created_at,updated_at)
                    VALUES (:id,:name,:name,'MANUFACTURER',:category,'GENERAL',:code,:code,0,0,'Active',NOW(),NOW())
                """), {"id":uuid.uuid4(),"name":code,"category":category,"code":code})
            savepoint = await connection.begin_nested()
            try:
                await connection.execute(select(SupplierModel))
                raise AssertionError("Expected the production missing-column error")
            except ProgrammingError as exc:
                assert "payment_terms" in str(exc)
                print("PASS reproduced production missing payment_terms error", flush=True)
            finally:
                await savepoint.rollback()
            await connection.run_sync(run_migration)
            await connection.run_sync(run_migration)
            values=(await connection.execute(text("SELECT supplier_code,category FROM supplier"))).all()
            actual={row[0]:row[1] for row in values}
            assert actual=={code:expected for code,_,expected in cases},actual
            print("PASS idempotent migration; legacy category values preserved",flush=True)
            session=AsyncSession(bind=connection,expire_on_commit=False)
            class Uow:
                def __init__(self): self.session=session
                async def commit(self): await self.session.flush()
            payload=UserCreate(username="migration_supplier_check",full_name="Migration supplier verification",
                email="migration-supplier@example.invalid",password="VerificationOnly-2026",
                role="SUPPLIER",page_permissions={"/supplier-dashboard":"WRITE","/reports":"READ"})
            result=await create_user(payload,CurrentUser("verification","verification",["ADMIN"],[],{}),Uow())
            assert result["role"]=="SUPPLIER"
            supplier=(await session.execute(select(SupplierModel).where(SupplierModel.supplier_name==payload.full_name))).scalar_one()
            supplier_user=(await session.execute(select(SupplierUserModel).where(SupplierUserModel.username==payload.username))).scalar_one()
            assert supplier_user.supplier_id==supplier.id
            assert supplier.category==[]
            assert verify_password(payload.password,supplier_user.password_hash)
            await session.close()
            print("PASS real create-user handler creates linked account, supplier and supplier login",flush=True)
        finally:
            await transaction.rollback()
    async with engine.connect() as connection:
        remains=await connection.scalar(text("SELECT count(*) FROM information_schema.schemata WHERE schema_name=:name"),{"name":schema})
        assert remains==0
    await engine.dispose()
    print("PASS verification schema and all verification rows rolled back; application data untouched",flush=True)

asyncio.run(main())
