"""
Translates domain exceptions into HTTP responses - the FastAPI counterpart
of com.ams.common.web.GlobalExceptionHandler. Registered once on the app
in main.py; domain and application code never imports FastAPI/Starlette.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.common.domain.exceptions import DomainRuleViolationException, NotFoundException
from app.config.settings import get_settings
from app.logging.logger import get_logger

logger = get_logger(__name__)


def _error_body(message: str) -> dict:
    return {"message": message, "timestamp": datetime.now(timezone.utc).isoformat()}


def _cors_headers(request: Request) -> dict[str, str]:
    """Keep browser clients able to read centralized error responses.

    Starlette's top-level exception middleware sits outside application
    middleware, so an unhandled exception can bypass CORSMiddleware entirely.
    Only echo an origin that is explicitly configured as allowed.
    """
    origin = request.headers.get("origin")
    allowed_origins = get_settings().cors_allow_origins
    is_allowed = (
        bool(origin)
        and (
            origin in allowed_origins
            or "*" in allowed_origins
            or origin.endswith(".azurecontainerapps.io")
            or "localhost" in origin
            or "127.0.0.1" in origin
        )
    )
    if not is_allowed:
        return {}

    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainRuleViolationException)
    async def handle_domain_rule_violation(request: Request, exc: DomainRuleViolationException):
        return JSONResponse(status_code=400, content=_error_body(str(exc)), headers=_cors_headers(request))

    @app.exception_handler(ValueError)
    async def handle_value_error(request: Request, exc: ValueError):
        # Many domain rules use ValueError; treat them as 400 Bad Request
        return JSONResponse(status_code=400, content=_error_body(str(exc)), headers=_cors_headers(request))

    @app.exception_handler(NotFoundException)
    async def handle_not_found(request: Request, exc: NotFoundException):
        return JSONResponse(status_code=404, content=_error_body(str(exc)), headers=_cors_headers(request))

    from sqlalchemy.exc import DBAPIError, IntegrityError
    import re

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(request: Request, exc: IntegrityError):
        orig_msg = str(getattr(exc, "orig", exc))
        logger.warning("Database integrity constraint violation during %s: %s", request.url.path, orig_msg)
        first_line = orig_msg.splitlines()[0] if orig_msg else "Database constraint violation or unique conflict occurred."
        return JSONResponse(
            status_code=409,
            content=_error_body(f"Database constraint violation: {first_line}"),
            headers=_cors_headers(request),
        )

    @app.exception_handler(DBAPIError)
    async def handle_rack_database_rule(request: Request, exc: DBAPIError):
        message = str(getattr(exc, "orig", exc))
        match = re.search(r"Rack capacity exceeded\.[^\n]*|Rack capacity requires whole PCS quantities|Rack inventory quantity cannot be negative or over-available", message)
        if match:
            return JSONResponse(status_code=409, content=_error_body(match.group(0)), headers=_cors_headers(request))
        if "violates not-null constraint" in message or "violates unique constraint" in message or "violates foreign key constraint" in message or "check constraint" in message:
            first_line = message.splitlines()[0]
            logger.warning("Database constraint violation during %s: %s", request.url.path, first_line)
            return JSONResponse(status_code=409, content=_error_body(f"Database constraint violation: {first_line}"), headers=_cors_headers(request))
        if "RAISE EXCEPTION" in message or "ERROR:" in message:
            first_line = message.splitlines()[0].replace("ERROR: ", "").strip()
            return JSONResponse(status_code=409, content=_error_body(first_line), headers=_cors_headers(request))
        logger.exception("Database operation failed during %s: %s", request.url.path, message)
        return JSONResponse(status_code=500, content=_error_body("Internal server error"), headers=_cors_headers(request))

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception):
        logger.exception("Unhandled exception", extra={"extra_fields": {"path": str(request.url)}})
        return JSONResponse(
            status_code=500,
            content=_error_body("Internal server error"),
            headers=_cors_headers(request),
        )
