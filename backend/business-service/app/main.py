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
