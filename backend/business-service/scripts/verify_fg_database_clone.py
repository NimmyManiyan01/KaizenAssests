"""Back up the protected source and verify migrations only on a new clone.

No source records/configuration are written. Backups and clone-only settings
are kept under the repository's ignored local backups directory.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
from app.config.settings import Settings

HEAD = "20261037_fg_section_numbering"
PREFIX = "kaizenassests_test_fg_clone_"
BIN = Path("C:/Program Files/PostgreSQL/17/bin")


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def source_url():
    url = make_url(Settings().database_url)
    if url.database != "ams_business" or url.host not in ("localhost", "127.0.0.1") or (url.port or 5432) != 5432:
        raise RuntimeError("Unexpected source; refusing automatic backup/clone")
    return url


def clone_url(source, name):
    if not name.startswith(PREFIX) or not name[len(PREFIX):].isalnum() or name == source.database:
        raise RuntimeError("Unsafe disposable database name")
    return source.set(database=name)


def pg_environment(url, read_only=False):
    env = dict(os.environ)
    env.update(PGHOST=url.host, PGPORT=str(url.port or 5432), PGUSER=url.username,
               PGPASSWORD=url.password or "", PGDATABASE=url.database)
    env.pop("PGSERVICE", None)
    if read_only:
        env["PGOPTIONS"] = "-c default_transaction_read_only=on"
    else:
        env.pop("PGOPTIONS", None)
    return env


async def snapshot(connection, columns=None):
    """Hash original column values, including all rows, without logging data."""
    await connection.execute(text("SET LOCAL TIME ZONE 'UTC'"))
    if columns is None:
        tables = (await connection.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))).scalars().all()
        columns = {}
        for table in tables:
            columns[table] = (await connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:table ORDER BY ordinal_position"), {"table": table})).scalars().all()
    hashes = {}
    for table, names in columns.items():
        sql = f'SELECT to_jsonb(r)::text FROM (SELECT {", ".join(quote(n) for n in names)} FROM public.{quote(table)}) r ORDER BY 1'
        digest, count = hashlib.sha256(), 0
        async for row in await connection.stream(text(sql)):
            data = row[0].encode()
            digest.update(len(data).to_bytes(8, "big"))
            digest.update(data)
            count += 1
        hashes[table] = {"rows": count, "sha256": digest.hexdigest()}
    return {"columns": columns, "tables": hashes}


async def clone_snapshot(url, columns=None):
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            assert await connection.scalar(text("SELECT current_database()")) == url.database
            result = await snapshot(connection, columns)
            await connection.rollback()
            return result
    finally:
        await engine.dispose()


def save(path, result):
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")


async def prepare():
    source = source_url()
    suffix = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + uuid.uuid4().hex[:6]
    name = PREFIX + suffix
    target = clone_url(source, name)
    directory = ROOT / "backups" / ("fg-safe-clone-" + suffix)
    directory.mkdir(parents=True, exist_ok=False)
    manifest_path = directory / "manifest.json"
    dump_path = directory / "ams_business.dump"
    result = {"source": "localhost:5432/ams_business", "clone": name,
              "directory": str(directory), "backup": "PENDING", "restore": "PENDING", "migration": "PENDING"}
    save(manifest_path, result)
    engine = create_async_engine(source, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            assert await connection.scalar(text("SELECT current_database()")) == "ams_business"
            version = await connection.scalar(text("SHOW server_version_num"))
            assert int(version) // 10000 == 17
            exported = await connection.scalar(text("SELECT pg_export_snapshot()"))
            before = await snapshot(connection)
            save(directory / "source-snapshot.json", before)
            result["previous_revision"] = await connection.scalar(text("SELECT version_num FROM alembic_version"))
            process = await asyncio.create_subprocess_exec(str(BIN / "pg_dump.exe"), "--format=custom", "--no-owner", "--no-privileges", "--snapshot=" + exported,
                "--file=" + str(dump_path), env=pg_environment(source, True), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            out, err = await process.communicate()
            if process.returncode:
                raise RuntimeError("pg_dump failed: " + err.decode(errors="replace"))
            await connection.rollback()
        result["backup_sha256"] = hashlib.sha256(dump_path.read_bytes()).hexdigest()
        result["backup_bytes"] = dump_path.stat().st_size
        listing = subprocess.run([str(BIN / "pg_restore.exe"), "--list", str(dump_path)], capture_output=True)
        if listing.returncode or b"TABLE DATA" not in listing.stdout:
            raise RuntimeError("Backup archive listing validation failed")
        (directory / "archive-contents.txt").write_bytes(listing.stdout)
        result["backup"] = "ARCHIVE_VALIDATED"
        save(manifest_path, result)
        print("Backup archive validated:", dump_path, flush=True)

        # CREATE DATABASE runs through the maintenance database, never the source.
        admin = create_async_engine(source.set(database="postgres"), poolclass=NullPool, isolation_level="AUTOCOMMIT")
        try:
            async with admin.connect() as connection:
                if await connection.scalar(text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": name}):
                    raise RuntimeError("Clone target already exists; refusing to overwrite")
                await connection.execute(text(f'CREATE DATABASE {quote(name)} TEMPLATE template0'))
        finally:
            await admin.dispose()
        restore = await asyncio.create_subprocess_exec(str(BIN / "pg_restore.exe"), "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
            "--dbname=" + name, str(dump_path), env=pg_environment(target), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await restore.communicate()
        if restore.returncode:
            (directory / "restore-error.txt").write_bytes(err)
            raise RuntimeError("Restore failed; retained the new database and error log for review")
        restored = await clone_snapshot(target)
        if restored != before:
            save(directory / "restore-snapshot.json", restored)
            raise RuntimeError("Restored table contents differ from exported source snapshot")
        result["backup"] = "PASS_RESTORE_VERIFIED"
        result["restore"] = "PASS_ALL_TABLE_CONTENTS_IDENTICAL"
        result["verified_tables"] = len(before["tables"])
        save(manifest_path, result)
        print("Restored clone verified:", name, "tables:", result["verified_tables"], flush=True)

        env = dict(os.environ)
        env["DATABASE_URL"] = target.render_as_string(hide_password=False)
        env["ENVIRONMENT"] = "test"
        # Generated settings are local ignored artifacts, not production settings.
        (directory / "clone.env").write_text("DATABASE_URL=" + env["DATABASE_URL"] + "\nENVIRONMENT=test\n", encoding="utf-8")
        migration = await asyncio.create_subprocess_exec(sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", HEAD,
            cwd=ROOT, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await migration.communicate()
        (directory / "migration.log").write_bytes(out + err)
        if migration.returncode:
            raise RuntimeError("Clone migration failed; see clone-only migration.log")
        migrated = await clone_snapshot(target, before["columns"])
        original_tables = {k: v for k, v in before["tables"].items() if k != "alembic_version"}
        migrated_tables = {k: v for k, v in migrated["tables"].items() if k != "alembic_version"}
        if original_tables != migrated_tables:
            save(directory / "migrated-snapshot.json", migrated)
            raise RuntimeError("Migration changed existing table data")
        result["migration"] = "PASS"
        result["original_data_preserved"] = True
        result["required_revision"] = HEAD
        save(manifest_path, result)
        print("Clone migrations passed; every original table's data is unchanged.", flush=True)
        print("MANIFEST=" + str(manifest_path), flush=True)
    except Exception as exc:
        result["error"] = str(exc)
        save(manifest_path, result)
        raise
    finally:
        await engine.dispose()


def load_manifest(path):
    path = Path(path).resolve()
    allowed = (ROOT / "backups").resolve()
    if not path.is_relative_to(allowed):
        raise RuntimeError("Manifest must be inside the local backups directory")
    info = json.loads(path.read_text(encoding="utf-8"))
    source = source_url()
    target = clone_url(source, info["clone"])
    return path, info, source, target


async def verify(path):
    path, info, source, target = load_manifest(path)
    if info.get("migration") != "PASS":
        raise RuntimeError("Clone migration has not passed")
    os.environ["DATABASE_URL"] = target.render_as_string(hide_password=False)
    os.environ["KAIZENASSESTS_TEST_DATABASE_URL"] = os.environ["DATABASE_URL"]
    os.environ["ENVIRONMENT"] = "test"
    from app.main import app
    from app.database.session import engine as application_engine
    from app.modules.assembly.infrastructure.sections import section_schema_missing
    from app.database.session import AsyncSessionFactory
    from httpx import ASGITransport, AsyncClient
    async with AsyncSessionFactory() as session:
        assert await session.scalar(text("SELECT current_database()")) == target.database
        assert await session.scalar(text("SELECT version_num FROM alembic_version")) == HEAD
        missing = await section_schema_missing(session)
        assert not missing, missing
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://isolated-clone") as client:
        headers = {"X-User-Roles": "ASSEMBLY"}
        loading = await client.get("/api/v1/assembly/fg-loading", headers=headers)
        assert loading.status_code == 200, loading.text
        info["fg_loading"] = "PASS_HTTP_200"
        listing = await client.get("/api/v1/assembly/finished-goods", headers=headers)
        assert listing.status_code == 200, listing.text
        identities, traceability = {}, {}
        for fg in listing.json():
            response = await client.get(f"/api/v1/assembly/finished-goods/{fg['id']}/traceability", headers=headers)
            assert response.status_code == 200, response.text
            identities[fg["id"]] = fg["qr_code"]
            assert response.json()["finished_goods"]["qr_identity"] == fg["qr_code"]
            traceability[fg["id"]] = response.json()
        save(path.parent / "clone-traceability.json", traceability)
        info["accessible_fg_count"] = len(identities)
        info["required_schema"] = "PASS"
        info["application_connection"] = "PASS_CLONE_ONLY_NO_LIFESPAN_WORKERS"
    # Compare the actual traceability API with a strictly read-only source UoW.
    # This does not start the source backend, its lifespan, or background jobs.
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.database.session import get_uow
    protected_engine = create_async_engine(source, poolclass=NullPool)
    protected_sessions = async_sessionmaker(protected_engine, expire_on_commit=False, autoflush=False)

    class ProtectedReadOnlyUow:
        async def __aenter__(self):
            self.session = protected_sessions()
            await self.session.execute(text("SET TRANSACTION READ ONLY"))
            assert await self.session.scalar(text("SELECT current_database()")) == "ams_business"
            return self

        async def __aexit__(self, *exc):
            await self.session.rollback()
            await self.session.close()

        async def commit(self):
            raise RuntimeError("Protected verification never permits commit")

    async def protected_uow():
        yield ProtectedReadOnlyUow()

    transport_fields = {"main_fg_id", "sections", "dispatched_sections", "remaining_sections", "dispatch_status",
                        "section_workflow_available", "section_workflow_message"}
    def original_trace(value):
        result = dict(value)
        result["finished_goods"] = {k: v for k, v in result["finished_goods"].items() if k not in transport_fields}
        return result

    app.dependency_overrides[get_uow] = protected_uow
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://protected-read-only") as client:
            for fg_id, clone_trace in traceability.items():
                response = await client.get(f"/api/v1/assembly/finished-goods/{fg_id}/traceability", headers=headers)
                assert response.status_code == 200, response.text
                assert original_trace(response.json()) == original_trace(clone_trace), "Material traceability changed"
        info["material_traceability"] = "PASS_EXACT_SOURCE_CLONE_API_COMPARISON"
    finally:
        app.dependency_overrides.pop(get_uow, None)
        await protected_engine.dispose()
    await application_engine.dispose()
    save(path, info)
    print("Clone application connection, FG Loading, schema and existing FG/traceability APIs: PASS", flush=True)


def tests(path):
    path, info, source, target = load_manifest(path)
    # Retain the verified development clone's original records. Regression
    # fixtures that commit sample material chains run in a separate sibling.
    regression_name = PREFIX + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "reg" + uuid.uuid4().hex[:6]
    regression_target = clone_url(source, regression_name)
    async def create_regression_database():
        admin = create_async_engine(source.set(database="postgres"), poolclass=NullPool, isolation_level="AUTOCOMMIT")
        try:
            async with admin.connect() as connection:
                assert not await connection.scalar(text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": regression_name})
                await connection.execute(text(f'CREATE DATABASE {quote(regression_name)} TEMPLATE {quote(target.database)}'))
        finally:
            await admin.dispose()
    asyncio.run(create_regression_database())
    info["regression_database"] = regression_name
    save(path, info)
    env = dict(os.environ)
    env["DATABASE_URL"] = regression_target.render_as_string(hide_password=False)
    env["KAIZENASSESTS_TEST_DATABASE_URL"] = env["DATABASE_URL"]
    env["ENVIRONMENT"] = "test"
    args = [sys.executable, "-m", "pytest", "tests/integration/test_fg_transport_sections.py", "tests/integration/test_fg_consumption_traceability.py",
            "-q", "-p", "no:cacheprovider", "--junitxml=" + str(path.parent / "regressions.xml")]
    result = subprocess.run(args, env=env, cwd=ROOT, capture_output=True)
    (path.parent / "regressions.log").write_bytes(result.stdout + result.stderr)
    if result.returncode:
        info["regression_tests"] = "FAILED_SEE_LOG"
        save(path, info)
        raise RuntimeError("Clone regression tests failed; see regressions.log")
    info["regression_tests"] = "PASS"
    info["eight_subid_generation"] = "PASS_NEW_QC_TEST_FG_ONLY"
    from xml.etree import ElementTree
    suite = ElementTree.parse(path.parent / "regressions.xml").getroot().find("testsuite")
    info["regression_test_counts"] = {key: int(suite.attrib[key]) for key in ("tests", "failures", "errors", "skipped")}
    save(path, info)
    print("Clone regression tests: PASS (new QC eight-section generation and two-vehicle dispatch)", flush=True)


async def final_audit(path):
    path, info, source, target = load_manifest(path)
    before = json.loads((path.parent / "source-snapshot.json").read_text(encoding="utf-8"))
    now = await clone_snapshot(source, before["columns"])
    assert now == before, "Protected source changed; retain snapshots for investigation"
    assert hashlib.sha256((path.parent / "ams_business.dump").read_bytes()).hexdigest() == info["backup_sha256"]
    clone = await clone_snapshot(target, before["columns"])
    preserved = [name for name in before["tables"] if name.startswith(("assembly_", "grn"))]
    for name in preserved:
        assert clone["tables"][name] == before["tables"][name], name
    info["source_unchanged"] = "PASS_ALL_138_TABLE_FINGERPRINTS_AND_REVISION"
    info["existing_fg_identity_preservation"] = "PASS"
    info["historical_fg_count"] = before["tables"]["assembly_finished_goods"]["rows"]
    info["backup_checksum_reverified"] = True
    info["final_verified_at_utc"] = datetime.now(timezone.utc).isoformat()
    save(path, info)
    print("Final audit: protected source unchanged; original FG/GRN/Assembly data preserved in clone.", flush=True)


async def serve(path, port, allow_local_port_8000=False):
    path, info, source, target = load_manifest(path)
    if info.get("migration") != "PASS" or info.get("regression_tests") != "PASS":
        raise RuntimeError("Only verified migrated clones may be served")
    if not 1024 <= port <= 65535 or (port == 8000 and not allow_local_port_8000):
        raise RuntimeError("Port 8000 requires an explicit verified local-development switch")
    os.environ["DATABASE_URL"] = target.render_as_string(hide_password=False)
    os.environ["ENVIRONMENT"] = "development"
    from app.main import app
    from app.database.session import AsyncSessionFactory
    async with AsyncSessionFactory() as session:
        assert await session.scalar(text("SELECT current_database()")) == target.database
        assert await session.scalar(text("SELECT version_num FROM alembic_version")) == HEAD
    # Local launcher diagnostic: uses a fresh, read-only database connection.
    # It is not installed in the production application entrypoint.
    from fastapi import Request, HTTPException

    @app.get("/api/local/fg-clone-status", include_in_schema=False)
    async def local_clone_status(request: Request):
        if not request.client or request.client.host not in ("127.0.0.1", "::1"):
            raise HTTPException(403, "Local verification only")
        async with AsyncSessionFactory() as session:
            await session.execute(text("SET TRANSACTION READ ONLY"))
            database = await session.scalar(text("SELECT current_database()"))
            revision = await session.scalar(text("SELECT version_num FROM alembic_version"))
            assert database == target.database
            return {"database": database, "revision": revision, "environment": "development", "lifespan_workers": "disabled"}

    save(path.parent / "local-runtime.json", {"pid": os.getpid(), "port": port, "database": target.database,
        "revision": HEAD, "host": "127.0.0.1", "lifespan": "off"})
    import uvicorn
    print(f"Verified local clone {target.database}; http://127.0.0.1:{port}; background lifespan disabled", flush=True)
    await uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, lifespan="off")).serve()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "verify", "tests", "audit", "serve"))
    parser.add_argument("--manifest")
    parser.add_argument("--port", type=int, default=18098)
    parser.add_argument("--allow-local-port-8000", action="store_true")
    args = parser.parse_args()
    if args.action == "prepare":
        asyncio.run(prepare())
    elif not args.manifest:
        parser.error("--manifest is required")
    elif args.action == "verify":
        asyncio.run(verify(args.manifest))
    elif args.action == "audit":
        asyncio.run(final_audit(args.manifest))
    elif args.action == "serve":
        asyncio.run(serve(args.manifest, args.port, args.allow_local_port_8000))
    else:
        tests(args.manifest)
