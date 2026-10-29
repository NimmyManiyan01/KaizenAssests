"""Local-only UI verification server, pinned to the disposable test database."""
import asyncio
from datetime import date
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit, urlunsplit
import uuid

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
TARGET = "kaizenassests_test_fg_b978662c"
configured = urlsplit(dotenv_values(ROOT / ".env")["DATABASE_URL"])
if configured.scheme not in {"postgresql", "postgresql+asyncpg"} or configured.path.strip("/") == TARGET:
    raise SystemExit("Unsafe configured database")
os.environ["DATABASE_URL"] = urlunsplit(configured._replace(path=f"/{TARGET}"))
os.environ["ENVIRONMENT"] = "test"

from sqlalchemy import select, text, delete
from app.database.session import session_scope
from app.main import app
from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel, AssemblyFinishedGoodsModel, AssemblyQualityInspectionModel, FinishedGoodsSectionModel
from app.modules.gate.infrastructure.persistence.models import FinishedGoodsPickupGateVisitModel
from app.common.persistence.models import FinishedGoodsRequestModel
from httpx import ASGITransport, AsyncClient
import uvicorn

order_id, source_id, qc_order_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
supplier = f"fg_browser_{uuid.uuid4().hex[:8]}"
fixture = {}


async def seed():
    async with session_scope() as db:
        if await db.scalar(text("SELECT current_database()")) != TARGET:
            raise RuntimeError("Unsafe database")
        db.add(AssemblyOrderModel(id=qc_order_id, order_number=f"QC-BROWSER-{qc_order_id.hex[:6]}", product_code="FG-VERIFY-QC",
            product_name="Browser QC Product", status="QC_PENDING", completed_quantity=1, planned_quantity=1, created_by="assembly_tester"))
        db.add(AssemblyOrderModel(id=order_id, order_number=f"BROWSER-{order_id.hex[:10]}", product_code="FG-VERIFY",
            product_name=f"Browser FG {order_id.hex[:6]}", status="QC_PENDING", completed_quantity=1, planned_quantity=1, created_by=supplier))
        db.add(FinishedGoodsRequestModel(id=source_id, request_number=f"BROWSER-SOURCE-{source_id.hex[:10]}", material_code="FG-VERIFY",
            material_name="Browser FG", quantity=1, warehouse="ASSEMBLY", requested_by=supplier, department="SUPPLIER",
            required_date=date.today(), supplier_id=supplier, work_order_id=order_id))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/assembly/quality/inspect", headers={"X-User-Roles": "QUALITY"}, json={
            "order_id": str(order_id), "passed_quantity": 1, "failed_quantity": 0, "rework_quantity": 0, "held_quantity": 0,
            "inspector_name": "Browser Inspector", "authorized_person_confirmed": True})
        response.raise_for_status()
        fixture.update(response.json()["finished_goods"])
        fixture["supplier"] = supplier
        fixture["qc_order_id"] = str(qc_order_id)
        fixture["qc_order_number"] = f"QC-BROWSER-{qc_order_id.hex[:6]}"
    print(f"UI verification database={TARGET}; FG={fixture['fg_id']}", flush=True)


async def cleanup():
    if not fixture.get("fg_id"):
        return
    fg_id = uuid.UUID(fixture["fg_id"])
    async with session_scope() as db:
        if await db.scalar(text("SELECT current_database()")) != TARGET:
            raise RuntimeError("Unsafe cleanup target")
        requests = (await db.scalars(select(FinishedGoodsRequestModel.id).where(FinishedGoodsRequestModel.section_fg_id == fg_id))).all()
        await db.execute(delete(FinishedGoodsSectionModel).where(FinishedGoodsSectionModel.finished_goods_id == fg_id))
        if requests:
            await db.execute(delete(FinishedGoodsPickupGateVisitModel).where(FinishedGoodsPickupGateVisitModel.request_id.in_(requests)))
            await db.execute(delete(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.id.in_(requests)))
        await db.execute(delete(AssemblyQualityInspectionModel).where(AssemblyQualityInspectionModel.assembly_order_id == order_id))
        await db.execute(delete(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.id == fg_id))
        await db.execute(delete(FinishedGoodsRequestModel).where(FinishedGoodsRequestModel.id == source_id))
        await db.execute(delete(AssemblyOrderModel).where(AssemblyOrderModel.id == order_id))
        await db.execute(delete(AssemblyOrderModel).where(AssemblyOrderModel.id == qc_order_id))


@app.get("/__verify_fg_fixture")
async def get_fixture():
    return fixture


@app.post("/__verify_fg_stop")
async def stop():
    server.should_exit = True
    return {"status": "stopping"}


if __name__ == "__main__":
    try:
        asyncio.run(seed())
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=18096, lifespan="off", log_level="warning"))
        server.run()
    finally:
        asyncio.run(cleanup())
