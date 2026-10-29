"""Verify the switched local API; create one explicitly labelled clone-only QA FG."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
from verify_fg_database_clone import load_manifest, clone_snapshot, quote
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from httpx import AsyncClient

MANIFEST = ROOT / "backups/fg-safe-clone-202610290741304887b0/manifest.json"
STATE = MANIFEST.parent / "local-fg-verification.json"


async def main():
    _, manifest, source, target = load_manifest(MANIFEST)
    headers = {"X-User-Roles": "ASSEMBLY", "X-User-Name": "Local Setup Verification"}
    async with AsyncClient(base_url="http://localhost:8000", timeout=30) as client:
        status = await client.get("/api/local/fg-clone-status")
        status.raise_for_status()
        assert status.json()["database"] == target.database
        assert status.json()["revision"] == "20261037_fg_section_numbering"
        print("Running backend database verified:", target.database, flush=True)
        os.environ["DATABASE_URL"] = target.render_as_string(hide_password=False)
        os.environ["ENVIRONMENT"] = "development"
        from app.main import app  # Register complete model metadata; no lifespan is run.
        from app.database.session import AsyncSessionFactory, engine
        from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel
        state = json.loads(STATE.read_text()) if STATE.exists() else {"order_id": str(uuid.uuid4()), "purpose": "Local clone setup verification only"}
        STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
        if not state.get("fg_id"):
            async with AsyncSessionFactory() as session:
                assert await session.scalar(text("SELECT current_database()")) == target.database
                order = await session.get(AssemblyOrderModel, uuid.UUID(state["order_id"]))
                if not order:
                    session.add(AssemblyOrderModel(id=uuid.UUID(state["order_id"]),
                        order_number="LOCAL-VERIFY-" + uuid.UUID(state["order_id"]).hex[:10],
                        product_code="LOCAL-FG-VERIFY", product_name="Local clone setup verification FG",
                        status="QC_PENDING", planned_quantity=1, completed_quantity=1,
                        created_by="Local Setup Verification", notes="QA data created only in the disposable development clone; not a historical FG."))
                    await session.commit()
            response = await client.post("/api/v1/assembly/quality/inspect", headers={"X-User-Roles": "QUALITY", "X-User-Name": "Local Setup Verification"},
                json={"order_id": state["order_id"], "passed_quantity": 1, "failed_quantity": 0, "rework_quantity": 0,
                      "held_quantity": 0, "inspector_name": "Local Setup Verification", "authorized_person_confirmed": True})
            response.raise_for_status()
            state.update(response.json()["finished_goods"])
            STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
        detail = await client.get(f"/api/v1/assembly/finished-goods/{state['fg_id']}", headers=headers)
        detail.raise_for_status()
        result = detail.json()
        assert result["qr_code"] == state["qr_code"]
        assert len(result["sections"]) == 8
        assert len({r["qr_identity"] for r in result["sections"]}) == 8
        assert [r["sub_id"] for r in result["sections"]] == [f"{result['main_fg_id']}-S{i:02d}" for i in range(1, 9)]
        print("New QC-approved verification FG:", result["main_fg_id"], "unique sections=8", flush=True)
        original = json.loads((MANIFEST.parent / "clone-traceability.json").read_text())
        transport = {"main_fg_id", "sections", "dispatched_sections", "remaining_sections", "dispatch_status", "section_workflow_available", "section_workflow_message"}
        def original_only(value):
            value = dict(value)
            value["finished_goods"] = {k: v for k, v in value["finished_goods"].items() if k not in transport}
            return value
        for fg_id, baseline in original.items():
            current = await client.get(f"/api/v1/assembly/finished-goods/{fg_id}/traceability", headers=headers)
            current.raise_for_status()
            assert original_only(current.json()) == original_only(baseline)
        print("All five existing FG QR identities and material traceability preserved", flush=True)
        loading = await client.get("/api/v1/assembly/fg-loading", headers=headers)
        loading.raise_for_status()
        state.update(fg_loading_http=loading.status_code, existing_fg_count_preserved=len(original), clone_database=target.database,
                     sections=result["sections"], main_fg_id=result["main_fg_id"], product_name=result["product_name"])
        STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
        await engine.dispose()
    baseline = json.loads((MANIFEST.parent / "source-snapshot.json").read_text())
    assert await clone_snapshot(source, baseline["columns"]) == baseline, "Protected source changed"
    clone_engine = create_async_engine(target)
    try:
        async with clone_engine.connect() as connection:
            await connection.execute(text("SET TRANSACTION READ ONLY"))
            await connection.execute(text("SET LOCAL TIME ZONE 'UTC'"))
            columns = baseline["columns"]["assembly_finished_goods"]
            sql = f'SELECT to_jsonb(r)::text FROM (SELECT {", ".join(quote(c) for c in columns)} FROM assembly_finished_goods WHERE id <> :verification_id) r ORDER BY 1'
            digest, count = hashlib.sha256(), 0
            for row in (await connection.execute(text(sql), {"verification_id": uuid.UUID(state["fg_id"])})).all():
                data = row[0].encode()
                digest.update(len(data).to_bytes(8, "big"))
                digest.update(data)
                count += 1
            assert {"rows": count, "sha256": digest.hexdigest()} == baseline["tables"]["assembly_finished_goods"]
            historical_sections = await connection.scalar(text("SELECT count(*) FROM finished_goods_section WHERE finished_goods_id <> :id"), {"id": uuid.UUID(state["fg_id"])})
            assert historical_sections == 0
            await connection.rollback()
    finally:
        await clone_engine.dispose()
    state["source_unchanged"] = True
    state["original_fg_all_columns_preserved"] = True
    state["historical_backfill_performed"] = False
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    print("Protected ams_business: all 138 table contents and revision unchanged", flush=True)
    print("Original five clone FG records: every original column preserved; zero historical Sub-IDs added", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
