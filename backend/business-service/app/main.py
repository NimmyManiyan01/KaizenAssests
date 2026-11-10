"""
FastAPI entrypoint for ams-wms-business-service.
"""
# Reload triggered for Notification router, Assembly, and seed-test-data registration
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.config.settings import get_settings
from app.kafka.producer import start_producer, stop_producer
from app.logging.logger import configure_logging, get_logger
from app.logging.telemetry import setup_telemetry
from app.middleware.auth_enforcement import AuthenticationEnforcementMiddleware
from app.middleware.error_handler import register_exception_handlers
from app.middleware.request_context import RequestContextMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.modules.dock.infrastructure.api.router import router as dock_router
from app.modules.gate.infrastructure.api.router import (
    preview_router as gate_preview_router,
    
    router as gate_router,
)
from app.modules.gate.infrastructure.api.dashboard import router as dashboard_router
from app.modules.gate.infrastructure.api.quality import router as quality_router
from app.modules.gate.infrastructure.api.damage_claims import router as damage_claims_router
from app.modules.notification.infrastructure.api.router import router as notification_router
from app.modules.receiving.infrastructure.api.router import router as receiving_router
from app.modules.returns.infrastructure.api.router import router as returns_router
from app.modules.storage.infrastructure.api.router import router as storage_router
from app.modules.assembly.infrastructure.api.router import router as assembly_router
from app.modules.dispatch.infrastructure.api.router import router as dispatch_router
from app.modules.search_router import router as search_router
from app.modules.storage.infrastructure.api.assembly_requisition_router import router as assembly_requisition_router
from app.modules.storage.infrastructure.api.inventory_router import inventory_router, storage_req_router, v1_inventory_router
from app.security.router import router as auth_router
from app.modules.assistant.infrastructure.api.router import router as assistant_router
from app.modules.warehouse.infrastructure.api.location_router import (
    warehouse_router as warehouse_location_router,
    zone_router as zone_location_router,
)
from app.middleware.audit_log import AuditLogMiddleware
from app.modules.admin.infrastructure.api.router import router as admin_router
from app.workers.notification_consumer import start_notification_consumer
from app.workers.outbox_relay import relay_once

configure_logging()
logger = get_logger(__name__)

scheduler = AsyncIOScheduler()
_consumer_task: asyncio.Task | None = None
_producer_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    global _consumer_task, _producer_task

    # Preflight check: verify single-warehouse migration status
    from sqlalchemy import inspect
    from app.database.session import engine

    try:
        async with engine.connect() as connection:
            tables = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
            if "store" in tables:
                raise RuntimeError("Run scripts/migrate_single_warehouse.py before starting this version of the service")
            if connection.dialect.name == "postgresql":
                from sqlalchemy import text
                try:
                    await connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
                    await connection.commit()
                except Exception as e:
                    logger.debug("Note creating pgcrypto extension: %s", e)

                seq_exists = await connection.scalar(text("SELECT to_regclass('public.fg_transport_main_number')"))
                if seq_exists is not None:
                    await connection.execute(
                        text(
                            "SELECT setval('fg_transport_main_number', GREATEST("
                            "(SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM fg_transport_main_number), "
                            "COALESCE((SELECT MAX(CAST(NULLIF(regexp_replace(section_main_id, '^.*-', ''), '') AS INTEGER)) "
                            "FROM assembly_finished_goods WHERE section_main_id IS NOT NULL), 0) + 1), false)"
                        )
                    )
                    await connection.commit()

                if "grn_batch_qr" in tables:
                    try:
                        await connection.execute(
                            text("ALTER TABLE grn_batch_qr ALTER COLUMN batch_id DROP NOT NULL")
                        )
                        await connection.commit()
                    except Exception as e:
                        logger.debug("Note dropping not-null on grn_batch_qr.batch_id: %s", e)

                if "rack_occupancy_event" in tables:
                    try:
                        await connection.execute(
                            text("ALTER TABLE rack_occupancy_event ALTER COLUMN balance_id DROP NOT NULL")
                        )
                        await connection.commit()
                    except Exception as e:
                        logger.debug("Note dropping not-null on rack_occupancy_event.balance_id: %s", e)
                    try:
                        await connection.execute(
                            text("ALTER TABLE rack_occupancy_event ALTER COLUMN id SET DEFAULT gen_random_uuid()")
                        )
                        await connection.commit()
                    except Exception as e:
                        logger.debug("Note setting default on rack_occupancy_event.id: %s", e)

                if "putaway_location_assignment" in tables:
                    try:
                        pla_cols = await connection.run_sync(
                            lambda conn: {c["name"] for c in inspect(conn).get_columns("putaway_location_assignment")}
                        )
                        if "destination_store_id" in pla_cols and "destination_warehouse_ref_id" not in pla_cols:
                            await connection.execute(
                                text('ALTER TABLE putaway_location_assignment RENAME COLUMN destination_store_id TO destination_warehouse_ref_id')
                            )
                            await connection.commit()
                        elif "destination_warehouse_ref_id" not in pla_cols:
                            await connection.execute(
                                text('ALTER TABLE putaway_location_assignment ADD COLUMN destination_warehouse_ref_id UUID REFERENCES warehouse_configuration(id) ON DELETE SET NULL')
                            )
                            await connection.commit()
                        # Drop legacy foreign keys pointing to old store_* tables
                        for fk_name in ["fk_putaway_location_assignment_destination_store_id", "fk_putaway_location_assignment_destination_zone_id", "fk_putaway_location_assignment_destination_bin_id"]:
                            try:
                                await connection.execute(text(f'ALTER TABLE putaway_location_assignment DROP CONSTRAINT IF EXISTS {fk_name}'))
                                await connection.commit()
                            except Exception:
                                pass
                    except Exception as e:
                        logger.debug("Note aligning putaway_location_assignment columns: %s", e)

                if "putaway_task" in tables:
                    try:
                        pt_cols = await connection.run_sync(
                            lambda conn: {c["name"] for c in inspect(conn).get_columns("putaway_task")}
                        )
                        if "destination_store_id" in pt_cols and "destination_warehouse_ref_id" not in pt_cols:
                            await connection.execute(
                                text('ALTER TABLE putaway_task RENAME COLUMN destination_store_id TO destination_warehouse_ref_id')
                            )
                            await connection.commit()
                        elif "destination_warehouse_ref_id" not in pt_cols:
                            await connection.execute(
                                text('ALTER TABLE putaway_task ADD COLUMN destination_warehouse_ref_id UUID REFERENCES warehouse_configuration(id) ON DELETE SET NULL')
                            )
                            await connection.commit()

                        if "destination_bin_id" not in pt_cols:
                            await connection.execute(
                                text('ALTER TABLE putaway_task ADD COLUMN destination_bin_id UUID REFERENCES warehouse_bin(id) ON DELETE SET NULL')
                            )
                            await connection.commit()
                        if "destination_bin_code" not in pt_cols:
                            await connection.execute(
                                text('ALTER TABLE putaway_task ADD COLUMN destination_bin_code VARCHAR(128)')
                            )
                            await connection.commit()
                        if "destination_location_id" not in pt_cols:
                            await connection.execute(
                                text('ALTER TABLE putaway_task ADD COLUMN destination_location_id UUID REFERENCES storage_location(id) ON DELETE SET NULL')
                            )
                            await connection.commit()
                        if "destination_zone_id" not in pt_cols:
                            await connection.execute(
                                text('ALTER TABLE putaway_task ADD COLUMN destination_zone_id UUID REFERENCES warehouse_zone(id) ON DELETE SET NULL')
                            )
                            await connection.commit()

                        # Drop legacy foreign keys pointing to old store_* tables
                        for fk_name in ["fk_putaway_task_destination_store_id", "fk_putaway_task_destination_zone_id", "fk_putaway_task_destination_bin_id"]:
                            try:
                                await connection.execute(text(f'ALTER TABLE putaway_task DROP CONSTRAINT IF EXISTS {fk_name}'))
                                await connection.commit()
                            except Exception:
                                pass
                    except Exception as e:
                        logger.debug("Note aligning putaway_task columns: %s", e)

                if "storage_location" in tables:
                    try:
                        sl_cols = await connection.run_sync(
                            lambda conn: {c["name"] for c in inspect(conn).get_columns("storage_location")}
                        )
                        if "store_id" in sl_cols and "warehouse_ref_id" not in sl_cols:
                            await connection.execute(
                                text('ALTER TABLE storage_location RENAME COLUMN store_id TO warehouse_ref_id')
                            )
                            await connection.commit()
                        elif "warehouse_ref_id" not in sl_cols:
                            await connection.execute(
                                text('ALTER TABLE storage_location ADD COLUMN warehouse_ref_id UUID REFERENCES warehouse_configuration(id) ON DELETE SET NULL')
                            )
                            await connection.commit()

                        if "zone_id" not in sl_cols:
                            await connection.execute(
                                text('ALTER TABLE storage_location ADD COLUMN zone_id UUID REFERENCES warehouse_zone(id) ON DELETE SET NULL')
                            )
                            await connection.commit()
                        if "bin_id" not in sl_cols:
                            await connection.execute(
                                text('ALTER TABLE storage_location ADD COLUMN bin_id UUID REFERENCES warehouse_bin(id) ON DELETE SET NULL')
                            )
                            await connection.commit()

                        # Drop legacy foreign keys pointing to old store_* tables
                        for fk_name in ["fk_storage_location_store_id", "fk_storage_location_zone_id", "fk_storage_location_bin_id"]:
                            try:
                                await connection.execute(text(f'ALTER TABLE storage_location DROP CONSTRAINT IF EXISTS {fk_name}'))
                                await connection.commit()
                            except Exception:
                                pass
                    except Exception as e:
                        logger.debug("Note aligning storage_location columns: %s", e)

                if "inventory_movement_history" in tables:
                    try:
                        imh_cols = await connection.run_sync(
                            lambda conn: {c["name"] for c in inspect(conn).get_columns("inventory_movement_history")}
                        )
                        if "store_id" in imh_cols and "warehouse_ref_id" not in imh_cols:
                            await connection.execute(
                                text('ALTER TABLE inventory_movement_history RENAME COLUMN store_id TO warehouse_ref_id')
                            )
                            await connection.commit()
                        elif "warehouse_ref_id" not in imh_cols:
                            await connection.execute(
                                text('ALTER TABLE inventory_movement_history ADD COLUMN warehouse_ref_id UUID REFERENCES warehouse_configuration(id) ON DELETE SET NULL')
                            )
                            await connection.commit()

                        if "store_code" in imh_cols and "warehouse_code" not in imh_cols:
                            await connection.execute(
                                text('ALTER TABLE inventory_movement_history RENAME COLUMN store_code TO warehouse_code')
                            )
                            await connection.commit()
                        elif "warehouse_code" not in imh_cols:
                            await connection.execute(
                                text('ALTER TABLE inventory_movement_history ADD COLUMN warehouse_code VARCHAR(64)')
                            )
                            await connection.commit()

                        # Drop legacy foreign keys pointing to old store_* tables
                        for fk_name in ["fk_inventory_movement_history_store_id", "fk_inventory_movement_history_from_bin_id", "fk_inventory_movement_history_to_bin_id"]:
                            try:
                                await connection.execute(text(f'ALTER TABLE inventory_movement_history DROP CONSTRAINT IF EXISTS {fk_name}'))
                                await connection.commit()
                            except Exception:
                                pass
                    except Exception as e:
                        logger.debug("Note aligning inventory_movement_history columns: %s", e)

                if "material_stock" in tables:
                    try:
                        ms_cols = await connection.run_sync(
                            lambda conn: {c["name"] for c in inspect(conn).get_columns("material_stock")}
                        )
                        if "location_id" not in ms_cols:
                            await connection.execute(
                                text('ALTER TABLE material_stock ADD COLUMN location_id UUID')
                            )
                            await connection.commit()
                    except Exception as e:
                        logger.debug("Note aligning material_stock columns: %s", e)

                if "inventory_location_balance" in tables and "warehouse_rack" in tables:
                    try:
                        from app.modules.storage.application.rack_capacity import _install_postgres
                        await connection.run_sync(_install_postgres)
                        await connection.commit()
                    except Exception as e:
                        logger.debug("Note reinstalling postgres rack trigger: %s", e)

                # Supplier schema is version-controlled via Alembic migrations
                # (20261106_supplier_profile_fields & 20261106_standardize_postgresql_schema).
                # Runtime DDL is retired to prevent ACCESS EXCLUSIVE locking during multi-pod boot.
    except Exception as exc:
        logger.debug("Database preflight check note: %s", exc)

    async def start_kafka_background() -> None:
        try:
            await start_producer()
        except Exception as exc:
            logger.debug("Kafka producer start skipped (Kafka offline or unavailable): %s", exc)

    _producer_task = asyncio.create_task(start_kafka_background())
    scheduler.add_job(
        relay_once,
        "interval",
        seconds=settings.outbox_poll_interval_seconds,
        id="outbox-relay",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()

    try:
        _consumer_task = asyncio.create_task(start_notification_consumer())
    except Exception as exc:
        logger.debug("Notification consumer task failed to start: %s", exc)

    from app.bootstrap import bootstrap_system_data
    try:
        await bootstrap_system_data()
    except Exception as exc:
        logger.warning("Bootstrap system data note: %s", exc)

    setup_telemetry(app)
    logger.info(
        "business-service started",
        extra={"extra_fields": {"environment": settings.environment}},
    )

    yield

    scheduler.shutdown(wait=False)
    if _consumer_task is not None:
        _consumer_task.cancel()
    if _producer_task is not None and not _producer_task.done():
        _producer_task.cancel()
    try:
        await stop_producer()
    except Exception:
        pass
    logger.info("business-service stopped")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="AMS/WMS Business Service",
        description="Python business backend: inventory, warehouse, receiving, returns, gate entry, and related domains.",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.enable_api_docs else None,
        redoc_url="/redoc" if settings.enable_api_docs else None,
        openapi_url="/openapi.json" if settings.enable_api_docs else None,
    )

    # --- CORS Configuration -----------------------------------------------
    # Robustly handle origins from settings (could be List[str] or comma-separated string)
    raw_origins = settings.cors_allow_origins
    if isinstance(raw_origins, str):
        try:
            import json
            origins = json.loads(raw_origins)
        except Exception:
            origins = [o.strip().strip("[]'\"") for o in raw_origins.split(",") if o.strip().strip("[]'\"")]
    else:
        origins = list(raw_origins)

    is_local = settings.environment.lower() in {"local", "dev", "development", "test"}
    if is_local:
        for o in [
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "http://localhost:5173",
        ]:
            if o not in origins:
                origins.append(o)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
    if settings.force_https:
        app.add_middleware(HTTPSRedirectMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AuditLogMiddleware)
    app.add_middleware(AuthenticationEnforcementMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=r"https://.*\.azurecontainerapps\.io|https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    register_exception_handlers(app)

    from app.modules.warehouse.infrastructure.api.router import router as warehouse_router
    app.include_router(warehouse_router)
    # Zone/bin URLs are owned by location_router, including rack persistence
    # and occupancy responses. Do not register legacy duplicate handlers.
    app.include_router(dock_router)
    app.include_router(receiving_router)
    app.include_router(returns_router)
    app.include_router(storage_router)
    app.include_router(notification_router)
    app.include_router(gate_router)
    app.include_router(gate_preview_router)
    app.include_router(dashboard_router)
    app.include_router(quality_router)
    app.include_router(damage_claims_router)
    app.include_router(assembly_router)
    app.include_router(dispatch_router)
    app.include_router(search_router)
    app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(admin_router)
    from app.modules.reporting.router import router as reporting_router
    app.include_router(reporting_router)
    app.include_router(assistant_router)
    app.include_router(warehouse_location_router)
    app.include_router(zone_location_router)

    if is_local:
        @app.get("/api/debug-assembly", include_in_schema=False)
        async def debug_assembly():
            return {"status": "ok"}
    app.include_router(assembly_requisition_router)
    app.include_router(inventory_router)
    app.include_router(storage_req_router)
    app.include_router(v1_inventory_router)

    from fastapi.staticfiles import StaticFiles
    import os
    os.makedirs("media_uploads", exist_ok=True)
    app.mount("/media", StaticFiles(directory="media_uploads"), name="media")

    @app.get("/q/{code}")
    async def redirect_short_link_root(code: str):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"http://localhost:8080/q/{code}", status_code=307)

    @app.get("/po/{code}")
    async def redirect_po_short_link_root(code: str):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"http://localhost:8080/po/{code}", status_code=307)

    @app.get("/health", tags=["ops"])
    @app.get("/health/live", tags=["ops"])
    async def health() -> dict:
        """Liveness probe: verifies process is alive."""
        return {
            "status": "UP",
            "service": settings.service_name,
            "environment": settings.environment,
        }

    @app.get("/health/ready", tags=["ops"])
    async def readiness(response: Response) -> dict:
        """
        Readiness probe for Azure Container Apps / Kubernetes.
        Verifies:
        1. Async database engine ping (SELECT 1).
        2. Database connection pool capacity.
        3. Background scheduler running state.
        Returns HTTP 200 when READY, or HTTP 503 when NOT_READY.
        """
        checks: dict = {}
        all_healthy = True

        try:
            from sqlalchemy import text
            from app.database.session import engine

            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))

            pool = engine.pool
            pool_info = {
                "size": getattr(pool, "size", lambda: 0)(),
                "checked_in": getattr(pool, "checkedin", lambda: 0)(),
                "checked_out": getattr(pool, "checkedout", lambda: 0)(),
                "overflow": getattr(pool, "overflow", lambda: 0)(),
            }
            checks["database"] = {
                "status": "HEALTHY",
                "pool": pool_info,
            }
        except Exception as exc:
            all_healthy = False
            checks["database"] = {
                "status": "UNHEALTHY",
                "error": str(exc),
            }

        checks["scheduler"] = {
            "status": "HEALTHY" if scheduler.running else "STOPPED"
        }

        if not all_healthy:
            response.status_code = 503
            return {
                "status": "NOT_READY",
                "service": settings.service_name,
                "checks": checks,
            }

        return {
            "status": "READY",
            "service": settings.service_name,
            "checks": checks,
        }

    if settings.prometheus_enabled:
        from prometheus_fastapi_instrumentator import Instrumentator

        Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

    return app


app = create_app()
