"""
Assigns a request-scoped correlation id (reused from incoming X-Correlation-Id or
X-Request-Id header when present) so every log line, database call, and external event
tied to a request can be joined by that id downstream in Azure Monitor / Application
Insights / ClickHouse / Log Analytics (CHG-AZ-004).
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_correlation_id_ctx_var: ContextVar[Optional[str]] = ContextVar("correlation_id", default=None)


def get_correlation_id() -> Optional[str]:
    """Retrieve the active request's correlation ID from the current async context."""
    return _correlation_id_ctx_var.get()


def set_correlation_id(correlation_id: str):
    """Explicitly set the correlation ID for the active async context (e.g. background tasks)."""
    return _correlation_id_ctx_var.set(correlation_id)


def reset_correlation_id(token) -> None:
    """Reset correlation ID context variable."""
    if token is not None:
        _correlation_id_ctx_var.reset(token)


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        correlation_id = (
            request.headers.get("X-Correlation-Id")
            or request.headers.get("X-Request-Id")
            or str(uuid.uuid4())
        )
        request.state.request_id = correlation_id
        request.state.correlation_id = correlation_id

        token = _correlation_id_ctx_var.set(correlation_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-Id"] = correlation_id
            response.headers["X-Correlation-Id"] = correlation_id
            return response
        finally:
            _correlation_id_ctx_var.reset(token)
