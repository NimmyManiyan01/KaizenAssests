"""
Authentication API router.
Provides development login (/auth/dev-login), supplier authentication,
password changing, and magic-link authentication for Nexus WMS / AMS.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import selectinload

from app.common.persistence.models import QuotationMagicLinkModel, SupplierUserModel
from app.config.settings import get_settings
from app.database.session import UnitOfWork, get_uow
from app.logging.logger import get_logger
from app.modules.warehouse.infrastructure.persistence.models import UserAccountModel, UserSessionModel

def _parse_device_summary(user_agent: str | None) -> str:
    if not user_agent:
        return "Unknown Device"
    ua = user_agent
    if "Mobile" in ua or "Android" in ua or "iPhone" in ua:
        return "Mobile Device"
    if "Edg" in ua or "Edge" in ua:
        return "Edge Browser"
    if "Chrome" in ua:
        return "Chrome Browser"
    if "Firefox" in ua:
        return "Firefox Browser"
    if "Safari" in ua:
        return "Safari Browser"
    return "Desktop Client"

from app.security.dependencies import CurrentUser, get_current_user
from app.security.passwords import hash_password, verify_with_legacy

logger = get_logger(__name__)

router = APIRouter()

MAGIC_LINK_DEFAULT_VALIDITY_SECONDS = 24 * 60 * 60  # 24 hours
_SHORT_CODE_CACHE: Dict[str, Dict[str, Any]] = {}


# --- Request / Response Schemas ---

class DevLoginRequest(BaseModel, extra="forbid"):
    username: str
    password: str


class SupplierLoginRequest(BaseModel, extra="forbid"):
    username: str
    password: str


class SupplierLoginResponse(BaseModel):
    token: str
    supplier_id: str
    must_change_password: bool
    username: str


class ChangePasswordRequest(BaseModel, extra="forbid"):
    username: str
    old_password: str
    new_password: str


class MagicLoginRequest(BaseModel):
    token: str


class MagicLoginResponse(BaseModel):
    token: str
    supplier_id: str
    supplierId: str
    username: str
    must_change_password: bool = False
    roles: List[str] = ["SUPPLIER"]
    rfq_id: Optional[str] = None
    po_id: Optional[str] = None
    link_type: Optional[str] = "RFQ"
    email: Optional[str] = None
    expires_in_hours: Optional[float] = None


# --- Magic Token Helpers ---

def _magic_link_secret() -> str:
    secret = get_settings().magic_link_secret.strip()
    if not secret:
        raise RuntimeError("MAGIC_LINK_SECRET must be configured")
    return secret

def verify_quotation_magic_token(token: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    if not token or "." not in token:
        return False, None, "Invalid token format."

    parts = token.split(".", 1)
    if len(parts) != 2:
        return False, None, "Invalid token structure."

    payload_b64, signature = parts
    expected_sig = hmac.new(
        _magic_link_secret().encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_sig, signature):
        return False, None, "Invalid token signature."

    try:
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload_json = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        payload = json.loads(payload_json)
    except Exception as e:
        return False, None, f"Failed to decode token payload: {e}"

    exp = payload.get("exp", 0)
    now = int(time.time())
    if now > exp:
        return False, payload, "Token has expired."

    return True, payload, None


async def resolve_quotation_short_code(session, code: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    clean_code = (code or "").strip()
    if not clean_code:
        return False, None, "Short code is required."

    cached = _SHORT_CODE_CACHE.get(clean_code)
    now = int(time.time())
    if cached:
        if now > cached.get("expires_at", 0):
            return False, cached, "Short code has expired."
        return True, cached, None

    try:
        stmt = select(QuotationMagicLinkModel).where(QuotationMagicLinkModel.code == clean_code)
        res = await session.execute(stmt)
        record = res.scalar_one_or_none()
        if not record:
            return False, None, "Link not found or invalid."

        if now > record.expires_at:
            return False, None, "Link has expired."

        data = {
            "sub": record.username,
            "supplier_id": record.supplier_id,
            "rfq_id": record.rfq_id,
            "po_id": record.po_id,
            "link_type": record.link_type,
            "email": record.email,
            "exp": record.expires_at,
        }
        _SHORT_CODE_CACHE[clean_code] = data
        return True, data, None
    except Exception as e:
        logger.warning(f"Error querying quotation_magic_link: {e}")
        return False, None, "Error resolving link."


async def resolve_magic_token_or_code(session, token_or_code: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    raw = (token_or_code or "").strip()
    if not raw:
        return False, None, "Token or link code is missing."

    if "." in raw:
        return verify_quotation_magic_token(raw)

    return await resolve_quotation_short_code(session, raw)


# --- Endpoints ---

@router.post("/dev-login")
@router.post("/login")
async def dev_login(
    request: DevLoginRequest,
    http_request: Request,
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """
    Authenticate an active staff account created through User Management.
    """
    settings = get_settings()
    # Enterprise alignment (R02): Database-backed authentication is supported across all
    # environments (including production). Dedicated enterprise SSO can disable it via DISABLE_DB_LOGIN.
    if getattr(settings, "disable_db_login", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Direct database login is disabled. Please use the configured enterprise identity provider.",
        )

    req_username = (request.username or "").strip()
    http_request.state.audit_actor = req_username or "Unknown"
    req_password = request.password or ""
    req_lower = req_username.lower()
    req_upper = req_username.upper()
    req_unspaced = req_lower.replace("_", " ")

    # Explicitly invalidate the retired development gate credential. This check
    # must run before database lookup so a stale account row cannot reactivate it.
    if req_upper == "EMP-8042" and req_password == "password":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # 1. Query UserAccountModel
    account_result = await uow.session.execute(
        select(UserAccountModel)
        .options(selectinload(UserAccountModel.warehouse))
        .where(
            or_(
                func.lower(UserAccountModel.username) == req_lower,
                func.upper(UserAccountModel.employee_id) == req_upper,
                func.lower(UserAccountModel.full_name) == req_lower,
                func.lower(UserAccountModel.full_name) == req_unspaced,
                func.replace(func.lower(UserAccountModel.full_name), " ", "_") == req_lower,
            )
        )
        .order_by(UserAccountModel.created_at.desc())
    )
    account = account_result.scalars().first()

    if account:
        http_request.state.audit_actor = account.username
        http_request.state.audit_employee_id = account.employee_id
        http_request.state.audit_roles = account.role
        if account.status and account.status.upper() != "ACTIVE":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account is inactive",
            )

        now = datetime.now(timezone.utc)
        locked_until = account.locked_until
        if locked_until and locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        if locked_until and locked_until > now:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        is_password_valid, needs_rehash = verify_with_legacy(req_password, account.password_hash)
        if not is_password_valid:
            account.failed_login_attempts = int(account.failed_login_attempts or 0) + 1
            if account.failed_login_attempts >= settings.login_max_failures:
                account.locked_until = now + timedelta(minutes=settings.login_lockout_minutes)
                account.failed_login_attempts = 0
            await uow.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        session_token = secrets.token_urlsafe(48)
        if needs_rehash:
            account.password_hash = hash_password(req_password)
        new_token_hash = hashlib.sha256(session_token.encode()).hexdigest()

        # Insert dedicated multi-session record
        client_ip = http_request.client.host if http_request and http_request.client else None
        user_agent = (http_request.headers.get("user-agent") or "")[:512] if http_request else None
        device_name = _parse_device_summary(user_agent)

        user_session = UserSessionModel(
            id=uuid.uuid4(),
            user_id=account.id,
            user_type="STAFF",
            token_hash=new_token_hash,
            client_ip=client_ip,
            user_agent=user_agent,
            device_name=device_name,
            created_at=now,
            last_activity_at=now,
            expires_at=now + timedelta(minutes=settings.local_session_lifetime_minutes),
            is_active=True,
        )
        uow.session.add(user_session)

        # Dual-write to legacy CSV for backward compatibility during rolling deploy
        existing_hashes = [h.strip() for h in (account.auth_token_hash or "").split(",") if h.strip()]
        active_hashes = [h for h in existing_hashes if h != new_token_hash][-9:] + [new_token_hash]
        account.auth_token_hash = ",".join(active_hashes)
        account.auth_token_expires_at = now + timedelta(minutes=settings.local_session_lifetime_minutes)
        account.failed_login_attempts = 0
        account.locked_until = None
        account.last_login = now
        await uow.commit()

        role_key = (account.role or "WAREHOUSE_OPERATOR").strip().upper().replace(" ", "_")
        role = {
            "SUPER_ADMIN": "ADMIN",
            "ADMIN_OFFICER": "ADMIN",
            "PROCUREMENT_MANAGER": "MANAGER",
            "PROCUREMENT_OFFICER": "PROCUREMENT",
            "WAREHOUSE_MANAGER": "WAREHOUSE_MANAGER",
            "WAREHOUSE_OPERATOR": "WAREHOUSE_OPERATOR",
        }.get(role_key, role_key)

        return {
            "token": f"mock-jwt-db-user-{session_token}",
            "username": account.username,
            "full_name": account.full_name,
            "employee_id": account.employee_id,
            "roles": [role],
            "warehouse_ref_id": str(account.warehouse_ref_id) if account.warehouse_ref_id else None,
            "warehouse_code": account.warehouse.warehouse_code if account.warehouse else None,
            "warehouse_name": account.warehouse.warehouse_name if account.warehouse else None,
            "applications": account.applications or [],
            "page_permissions": account.page_permissions or {},
            "expires_in": settings.local_session_lifetime_minutes * 60,
        }

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password",
    )


@router.post("/supplier-login", response_model=SupplierLoginResponse)
async def supplier_login(
    request: SupplierLoginRequest,
    http_request: Request,
    uow: UnitOfWork = Depends(get_uow),
) -> SupplierLoginResponse:
    http_request.state.audit_actor = (request.username or "").strip() or "Unknown"
    stmt = select(SupplierUserModel).where(SupplierUserModel.username == request.username)
    result = await uow.session.execute(stmt)
    user = result.scalars().first()

    password_valid, needs_rehash = verify_with_legacy(
        request.password, user.password_hash if user else ""
    )
    if not user or not password_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid supplier username or password",
        )

    if needs_rehash:
        user.password_hash = hash_password(request.password)

    settings = get_settings()
    session_token = secrets.token_urlsafe(48)
    new_token_hash = hashlib.sha256(session_token.encode()).hexdigest()
    now_utc = datetime.now(timezone.utc)

    client_ip = http_request.client.host if http_request and http_request.client else None
    user_agent = (http_request.headers.get("user-agent") or "")[:512] if http_request else None
    device_name = _parse_device_summary(user_agent)

    user_session = UserSessionModel(
        id=uuid.uuid4(),
        user_id=user.id,
        user_type="SUPPLIER",
        token_hash=new_token_hash,
        client_ip=client_ip,
        user_agent=user_agent,
        device_name=device_name,
        created_at=now_utc,
        last_activity_at=now_utc,
        expires_at=now_utc + timedelta(minutes=settings.local_session_lifetime_minutes),
        is_active=True,
    )
    uow.session.add(user_session)

    existing_hashes = [h.strip() for h in (user.auth_token_hash or "").split(",") if h.strip()]
    active_hashes = [h for h in existing_hashes if h != new_token_hash][-9:] + [new_token_hash]
    user.auth_token_hash = ",".join(active_hashes)
    user.auth_token_expires_at = now_utc + timedelta(
        minutes=settings.local_session_lifetime_minutes
    )
    await uow.commit()

    http_request.state.audit_actor = user.username
    http_request.state.audit_employee_id = str(user.id)
    http_request.state.audit_roles = "SUPPLIER"

    return SupplierLoginResponse(
        token=f"supplier-db-token-{session_token}",
        supplier_id=str(user.supplier_id),
        must_change_password=user.must_change_password,
        username=user.username,
    )


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    stmt = select(SupplierUserModel).where(SupplierUserModel.username == request.username)
    result = await uow.session.execute(stmt)
    user = result.scalars().first()
    password_valid, _ = verify_with_legacy(
        request.old_password, user.password_hash if user else ""
    )
    if not user or not password_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid old password",
        )

    user.password_hash = hash_password(request.new_password)
    user.must_change_password = False
    await uow.session.flush()
    await uow.commit()
    return {"success": True}


@router.post("/magic-login", response_model=MagicLoginResponse)
async def magic_login(
    request: MagicLoginRequest,
    http_request: Request,
    uow: UnitOfWork = Depends(get_uow),
) -> MagicLoginResponse:
    valid, payload, error_message = await resolve_magic_token_or_code(uow.session, request.token)
    if not valid or not payload:
        is_expired = "expired" in (error_message or "").lower()
        raise HTTPException(
            status_code=status.HTTP_410_GONE if is_expired else status.HTTP_400_BAD_REQUEST,
            detail=error_message or "Invalid or expired quotation access link.",
        )

    username = payload.get("sub")
    http_request.state.audit_actor = username or "Supplier"
    http_request.state.audit_roles = "SUPPLIER"
    supplier_id_str = payload.get("supplier_id")
    rfq_id_str = payload.get("rfq_id")
    po_id_str = payload.get("po_id")
    link_type_str = payload.get("link_type") or ("PO" if po_id_str else "RFQ")
    email = payload.get("email")
    exp = payload.get("exp", 0)

    stmt = select(SupplierUserModel).where(SupplierUserModel.username == username)
    result = await uow.session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user and supplier_id_str:
        try:
            sup_uuid = uuid.UUID(supplier_id_str)
            user_stmt = select(SupplierUserModel).where(SupplierUserModel.supplier_id == sup_uuid)
            res2 = await uow.session.execute(user_stmt)
            user = res2.scalar_one_or_none()
        except Exception:
            pass

    if not user and supplier_id_str:
        try:
            sup_uuid = uuid.UUID(supplier_id_str)
            user = SupplierUserModel(
                id=uuid.uuid4(),
                supplier_id=sup_uuid,
                username=username or f"sup_{supplier_id_str[:8]}",
                password_hash=hash_password(secrets.token_hex(16)),
                must_change_password=False,
            )
            uow.session.add(user)
            await uow.session.flush()
            await uow.commit()
        except Exception as prov_err:
            logger.warning(f"Could not persist supplier user in session: {prov_err}")
            try:
                await uow.session.rollback()
            except Exception:
                pass

    user_id_str = str(user.id) if user else str(uuid.uuid4())
    effective_supplier_id = str(user.supplier_id) if user else str(supplier_id_str or "")
    effective_username = user.username if user else (username or "supplier")
    http_request.state.audit_actor = effective_username
    http_request.state.audit_employee_id = user_id_str
    now = int(time.time())
    expires_in_hours = max(round((exp - now) / 3600, 1), 0.0)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to establish a supplier session",
        )
    session_token = secrets.token_urlsafe(48)
    new_token_hash = hashlib.sha256(session_token.encode()).hexdigest()
    now_utc = datetime.now(timezone.utc)
    exp_dt = datetime.fromtimestamp(exp, tz=timezone.utc)

    client_ip = http_request.client.host if http_request and http_request.client else None
    user_agent = (http_request.headers.get("user-agent") or "")[:512] if http_request else None
    device_name = _parse_device_summary(user_agent)

    user_session = UserSessionModel(
        id=uuid.uuid4(),
        user_id=user.id,
        user_type="SUPPLIER",
        token_hash=new_token_hash,
        client_ip=client_ip,
        user_agent=user_agent,
        device_name=device_name,
        created_at=now_utc,
        last_activity_at=now_utc,
        expires_at=exp_dt,
        is_active=True,
    )
    uow.session.add(user_session)

    existing_hashes = [h.strip() for h in (user.auth_token_hash or "").split(",") if h.strip()]
    active_hashes = [h for h in existing_hashes if h != new_token_hash][-9:] + [new_token_hash]
    user.auth_token_hash = ",".join(active_hashes)
    user.auth_token_expires_at = exp_dt
    await uow.commit()

    return MagicLoginResponse(
        token=f"supplier-db-token-{session_token}",
        supplier_id=effective_supplier_id,
        supplierId=effective_supplier_id,
        username=effective_username,
        must_change_password=False,
        roles=["SUPPLIER"],
        rfq_id=rfq_id_str,
        po_id=po_id_str,
        link_type=link_type_str,
        email=email,
        expires_in_hours=expires_in_hours,
    )


@router.post("/logout")
async def logout(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Revoke only the calling session before the client clears its copy."""
    now_utc = datetime.now(timezone.utc)

    # 1. Revoke caller's specific session in user_session
    if user.token_hash:
        await uow.session.execute(
            update(UserSessionModel)
            .where(UserSessionModel.token_hash == user.token_hash)
            .values(is_active=False, revoked_at=now_utc)
        )

    # 2. Selectively remove ONLY caller's token hash from legacy CSV
    account = (
        await uow.session.execute(
            select(UserAccountModel).where(UserAccountModel.employee_id == user.subject)
        )
    ).scalar_one_or_none()
    if account:
        if user.token_hash and account.auth_token_hash:
            remaining = [h.strip() for h in account.auth_token_hash.split(",") if h.strip() and h.strip() != user.token_hash]
            account.auth_token_hash = ",".join(remaining) if remaining else None
            if not account.auth_token_hash:
                account.auth_token_expires_at = None
        elif not user.token_hash:
            account.auth_token_hash = None
            account.auth_token_expires_at = None
        await uow.commit()
        return {"success": True, "username": user.username}

    if "SUPPLIER" in {role.upper() for role in user.roles}:
        try:
            supplier_user_id = uuid.UUID(user.subject)
        except ValueError:
            supplier_user_id = None
        if supplier_user_id:
            supplier_account = (
                await uow.session.execute(
                    select(SupplierUserModel).where(SupplierUserModel.id == supplier_user_id)
                )
            ).scalar_one_or_none()
            if supplier_account:
                if user.token_hash and supplier_account.auth_token_hash:
                    remaining = [h.strip() for h in supplier_account.auth_token_hash.split(",") if h.strip() and h.strip() != user.token_hash]
                    supplier_account.auth_token_hash = ",".join(remaining) if remaining else None
                    if not supplier_account.auth_token_hash:
                        supplier_account.auth_token_expires_at = None
                elif not user.token_hash:
                    supplier_account.auth_token_hash = None
                    supplier_account.auth_token_expires_at = None
                await uow.commit()
    return {"success": True, "username": user.username}


@router.get("/sessions")
async def list_active_sessions(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> list[dict]:
    """List all active sessions for the calling user."""
    user_id = None
    account = (
        await uow.session.execute(
            select(UserAccountModel.id).where(UserAccountModel.employee_id == user.subject)
        )
    ).scalar_one_or_none()
    if account:
        user_id = account
    elif "SUPPLIER" in {r.upper() for r in user.roles}:
        try:
            user_id = uuid.UUID(user.subject)
        except ValueError:
            pass

    if not user_id:
        return []

    now_utc = datetime.now(timezone.utc)
    sessions = (
        await uow.session.execute(
            select(UserSessionModel)
            .where(
                UserSessionModel.user_id == user_id,
                UserSessionModel.is_active.is_(True),
                UserSessionModel.expires_at > now_utc,
                UserSessionModel.revoked_at.is_(None),
            )
            .order_by(UserSessionModel.created_at.desc())
        )
    ).scalars().all()

    return [
        {
            "id": str(s.id),
            "device_name": s.device_name or "Unknown Device",
            "client_ip": s.client_ip or "Unknown IP",
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "last_activity_at": s.last_activity_at.isoformat() if s.last_activity_at else None,
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "is_current": s.token_hash == user.token_hash,
        }
        for s in sessions
    ]


@router.post("/logout-others")
async def logout_other_sessions(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Revoke all active sessions for the user EXCEPT the calling session."""
    user_id = None
    account = (
        await uow.session.execute(
            select(UserAccountModel.id).where(UserAccountModel.employee_id == user.subject)
        )
    ).scalar_one_or_none()
    if account:
        user_id = account
    elif "SUPPLIER" in {r.upper() for r in user.roles}:
        try:
            user_id = uuid.UUID(user.subject)
        except ValueError:
            pass

    if user_id and user.token_hash:
        now_utc = datetime.now(timezone.utc)
        await uow.session.execute(
            update(UserSessionModel)
            .where(
                UserSessionModel.user_id == user_id,
                UserSessionModel.token_hash != user.token_hash,
                UserSessionModel.is_active.is_(True),
            )
            .values(is_active=False, revoked_at=now_utc)
        )
        if account:
            acc = await uow.session.get(UserAccountModel, user_id)
            if acc:
                acc.auth_token_hash = user.token_hash
        await uow.commit()
    return {"success": True, "message": "All other sessions have been logged out"}


@router.post("/logout-all")
async def logout_all_sessions(
    user: CurrentUser = Depends(get_current_user),
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Revoke all active sessions for the user across all devices."""
    user_id = None
    account = (
        await uow.session.execute(
            select(UserAccountModel.id).where(UserAccountModel.employee_id == user.subject)
        )
    ).scalar_one_or_none()
    if account:
        user_id = account
    elif "SUPPLIER" in {r.upper() for r in user.roles}:
        try:
            user_id = uuid.UUID(user.subject)
        except ValueError:
            pass

    if user_id:
        now_utc = datetime.now(timezone.utc)
        await uow.session.execute(
            update(UserSessionModel)
            .where(
                UserSessionModel.user_id == user_id,
                UserSessionModel.is_active.is_(True),
            )
            .values(is_active=False, revoked_at=now_utc)
        )
        if account:
            acc = await uow.session.get(UserAccountModel, user_id)
            if acc:
                acc.auth_token_hash = None
                acc.auth_token_expires_at = None
        await uow.commit()
    return {"success": True, "message": "All sessions have been logged out"}


@router.get("/verify-magic-token")
async def verify_magic_token_endpoint(
    token: str = Query(...),
    uow: UnitOfWork = Depends(get_uow),
):
    valid, payload, error_message = await resolve_magic_token_or_code(uow.session, token)
    if not valid or not payload:
        is_expired = "expired" in (error_message or "").lower()
        return {
            "valid": False,
            "expired": is_expired,
            "error": error_message,
        }

    now = int(time.time())
    exp = payload.get("exp", 0)
    return {
        "valid": True,
        "expired": False,
        "rfq_id": payload.get("rfq_id"),
        "po_id": payload.get("po_id"),
        "link_type": payload.get("link_type") or ("PO" if payload.get("po_id") else "RFQ"),
        "supplier_id": payload.get("supplier_id"),
        "username": payload.get("sub"),
        "email": payload.get("email"),
        "expires_at": exp,
        "expires_in_hours": max(round((exp - now) / 3600, 1), 0.0),
    }
