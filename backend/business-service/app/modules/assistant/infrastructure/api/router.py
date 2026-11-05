"""
FastAPI router for Kaizen AMS Assistant.
Exposes POST /api/v1/assistant/chat and rate-limited /api/v1/assistant/chat/anonymous endpoints.
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.database.session import UnitOfWork, get_uow
from app.modules.assistant.application.role_policy import allowed_categories, primary_role, suggestions_for_roles
from app.modules.assistant.application.service import AssistantService, get_assistant_service
from app.modules.assistant.domain.schemas import AssistantChatRequest, AssistantChatResponse
from app.security.dependencies import CurrentUser, get_current_user

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])

# Rate limit configuration for anonymous requests (CHG-SEC-006)
_ANON_RATE_LIMIT = 5  # Max 5 requests
_ANON_WINDOW_SECONDS = 60  # Per 60-second window
_anon_request_records: Dict[str, List[float]] = defaultdict(list)


def check_anonymous_rate_limit(client_ip: str) -> None:
    """
    Enforce strict IP-based sliding window rate limit for anonymous assistant chat.
    Prevents Gemini API token quota exhaustion and denial-of-wallet abuse (CHG-SEC-006).
    """
    now = time.time()
    cutoff = now - _ANON_WINDOW_SECONDS
    timestamps = [t for t in _anon_request_records[client_ip] if t > cutoff]
    if len(timestamps) >= _ANON_RATE_LIMIT:
        _anon_request_records[client_ip] = timestamps
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: maximum {_ANON_RATE_LIMIT} anonymous assistant requests per minute. Please sign in for unlimited access.",
        )
    timestamps.append(now)
    _anon_request_records[client_ip] = timestamps


@router.get("/capabilities")
async def capabilities(user: CurrentUser = Depends(get_current_user)) -> dict:
    """Use the authenticated role policy for client suggestions as well as lookups."""
    return {
        "role": primary_role(user.roles),
        "categories": sorted(allowed_categories(user.roles)),
        "suggestions": suggestions_for_roles(user.roles),
        "read_only": True,
    }


@router.post(
    "/chat",
    response_model=AssistantChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Chat with Kaizen AMS Warehouse Assistant",
    description="Answers warehouse operations questions with deterministic rules and authorized live data lookups.",
)
async def chat(
    request: AssistantChatRequest,
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantChatResponse:
    """
    Handle assistant conversation turns.
    Guarded by user authentication and standard UnitOfWork dependency.
    """
    return await service.generate_reply(
        request=request,
        user=user,
        session=uow.session,
    )


@router.post(
    "/chat/anonymous",
    response_model=AssistantChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Chat with Kaizen AMS Warehouse Assistant (Anonymous / Rate-limited)",
    description="Public assistant conversation endpoint with strict IP rate limiting (5 req/min, CHG-SEC-006).",
)
async def chat_anonymous(
    request: Request,
    chat_request: AssistantChatRequest,
    uow: UnitOfWork = Depends(get_uow),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantChatResponse:
    """
    Handle anonymous assistant conversation turns with strict IP rate limiting.
    Prevents API quota exhaustion and denial-of-wallet attacks (CHG-SEC-006).
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    check_anonymous_rate_limit(client_ip)

    anon_user = CurrentUser(
        subject="anonymous",
        username="anonymous",
        roles=["VIEWER"],
        permissions=["assistant:read"],
        raw_claims={},
    )
    return await service.generate_reply(
        request=chat_request,
        user=anon_user,
        session=uow.session,
    )
