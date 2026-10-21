"""
FastAPI router for Kaizen AMS Assistant.
Exposes POST /api/v1/assistant/chat endpoint.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.database.session import UnitOfWork, get_uow
from app.modules.assistant.application.service import AssistantService, get_assistant_service
from app.modules.assistant.domain.schemas import AssistantChatRequest, AssistantChatResponse
from app.security.dependencies import CurrentUser, get_current_user

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


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
