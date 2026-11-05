"""
Global authentication enforcement middleware for Kaizen AMS Business Service (CHG-SEC-005).
Intercepts all HTTP requests and enforces authentication on non-whitelisted routes,
closing the unauthenticated API attack surface (VAL-SEC-006).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Set, Tuple

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config.settings import get_settings
from app.logging.logger import get_logger
from app.security.dependencies import is_test_bypass_enabled

logger = get_logger(__name__)

# Exact whitelisted routes that require zero authentication
PUBLIC_EXACT_ROUTES: Set[str] = {
    "/",
    "/health",
    "/health/live",
    "/health/ready",
    "/metrics",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
    "/api/v1/notifications/webhook",
    "/api/v1/assistant/chat/anonymous",
    "/api/debug-assembly",
}

# Prefix whitelisted routes (authentication life-cycle, static media, short-links)
PUBLIC_PREFIX_ROUTES: Tuple[str, ...] = (
    "/api/v1/auth/",
    "/media",
    "/static",
    "/q/",
    "/po/",
)


def is_public_route(path: str) -> bool:
    """Check if the requested path is explicitly exempted from authentication."""
    # Normalize trailing slash for exact matches (except root)
    clean_path = path.rstrip("/") if len(path) > 1 else path

    if clean_path in PUBLIC_EXACT_ROUTES or path in PUBLIC_EXACT_ROUTES:
        return True

    for prefix in PUBLIC_PREFIX_ROUTES:
        if path.startswith(prefix):
            return True

    return False


def _cors_headers(headers: Headers) -> dict[str, str]:
    """Echo allowed CORS origin on 401 responses to prevent browser opaque blocking."""
    origin = headers.get("origin")
    allowed_origins = get_settings().cors_allow_origins
    if not origin or (origin not in allowed_origins and "*" not in allowed_origins):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


class AuthenticationEnforcementMiddleware:
    """
    ASGI middleware ensuring that any request targeting non-public routes
    must present valid authentication credentials (Bearer token or test bypass header).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        # CORS preflight requests must never be rejected by auth middleware
        if method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if is_public_route(path):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        settings = get_settings()

        # 1. Check for standard Authorization: Bearer <token>
        auth_hdr = headers.get("authorization") or headers.get("Authorization")
        if auth_hdr and auth_hdr.strip().lower().startswith("bearer ") and len(auth_hdr.strip()) > 7:
            await self.app(scope, receive, send)
            return

        # 2. Check for permitted test bypass headers if explicitly enabled
        if is_test_bypass_enabled(settings):
            roles_hdr = headers.get("x-user-roles") or headers.get("x-user-role")
            if roles_hdr and roles_hdr.strip():
                await self.app(scope, receive, send)
                return

        # 3. Reject unauthenticated request with standard 401
        logger.warning(
            "AuthenticationEnforcementMiddleware: Rejected unauthenticated request to %s %s from client %s",
            method,
            path,
            scope.get("client"),
        )
        response = JSONResponse(
            status_code=401,
            content={
                "detail": "Missing bearer token or authentication credentials",
                "message": "Authentication required for this resource",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            headers=_cors_headers(headers),
        )
        await response(scope, receive, send)

