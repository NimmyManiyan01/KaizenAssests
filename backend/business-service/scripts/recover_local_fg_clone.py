"""Recover only a missing disposable clone; never overwrite any database."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
from verify_fg_database_clone import load_manifest, clone_snapshot, pg_environment, quote, BIN, HEAD, save


async def main():
    path, info, source, target = load_manifest(ROOT / "backups/fg-safe-clone-202610290741304887b0/manifest.json")
    archive = path.parent / "ams_business.dump"
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == info["backup_sha256"]
    protected_before = await clone_snapshot(source)
    baseline = json.loads((path.parent / "source-snapshot.json").read_text())
    qa = json.loads((path.parent / "local-fg-verification.json").read_text())
    retained = create_async_engine(source.set(database=info["regression_database"]))
    records = {}
    try:
        async with retained.connect() as c:
            await c.execute(text("SET TRANSACTION READ ONLY"))
            for table, column, value in (
                ("assembly_order", "id", qa["order_id"]),
                ("assembly_quality_inspection", "assembly_order_id", qa["order_id"]),
                ("assembly_finished_goods", "id", qa["fg_id"]),
                ("finished_goods_section", "finished_goods_id", qa["fg_id"]),
            ):
                records[table] = (await c.execute(text(f'SELECT to_jsonb(r)::text FROM {quote(table)} r WHERE {quote(column)}=:id'), {"id": value})).scalars().all()
            assert len(records["assembly_finished_goods"]) == 1 and len(records["finished_goods_section"]) == 8
            assert json.loads(records["assembly_finished_goods"][0])["qr_code"] == qa["qr_code"]
            assert {json.loads(r)["qr_identity"] for r in records["finished_goods_section"]} == {r["qr_identity"] for r in qa["sections"]}
            assert all(json.loads(r)["status"] == "AVAILABLE" and not json.loads(r)["gate_visit_id"] for r in records["finished_goods_section"])
            sequence_value = await c.scalar(text("SELECT last_value FROM fg_transport_main_number"))
            await c.rollback()
    finally:
        await retained.dispose()
    admin = create_async_engine(source.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as c:
            assert not await c.scalar(text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": target.database}), "Clone exists; refusing overwrite"
            await c.execute(text(f'CREATE DATABASE {quote(target.database)} TEMPLATE template0'))
    finally:
        await admin.dispose()
    restore = await asyncio.create_subprocess_exec(str(BIN / "pg_restore.exe"), "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--dbname="+target.database, str(archive),
        env=pg_environment(target), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await restore.communicate()
    assert restore.returncode == 0, err.decode(errors="replace")
    assert await clone_snapshot(target) == baseline
    env = dict(os.environ, DATABASE_URL=target.render_as_string(hide_password=False), ENVIRONMENT="test")
    migrate = await asyncio.create_subprocess_exec(sys.executable, "-m", "alembic", "upgrade", HEAD, env=env, cwd=ROOT,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await migrate.communicate()
    (path.parent / "clone-recovery-migration.log").write_bytes(out+err)
    assert migrate.returncode == 0, "Clone migration failed"
    engine = create_async_engine(target)
    try:
        async with engine.begin() as c:
            assert await c.scalar(text("SELECT current_database()")) == target.database
            for table, rows in records.items():
                for row in rows:
                    await c.execute(text(f'INSERT INTO {quote(table)} SELECT * FROM jsonb_populate_record(NULL::{quote(table)},CAST(:row AS jsonb))'), {"row": row})
            await c.execute(text("SELECT setval('fg_transport_main_number', :value, true)"), {"value": max(3, sequence_value)})
    finally:
        await engine.dispose()
    assert await clone_snapshot(source, protected_before["columns"]) == protected_before
    save(path.parent / "clone-recovery.json", {"database": target.database, "archive_verified": True,
        "original_restore_matches_138_tables": True, "historical_fg_count": 5, "qa_fg_preserved": qa["fg_id"],
        "qa_section_qr_identities_preserved": 8, "source_left_as_found": True,
        "note": "Recovery performed only because the disposable clone was absent. Protected source was not restored or changed."})
    print("Recovered missing disposable clone: original five FGs and retained QA FG/eight QR identities preserved; source left unchanged", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
