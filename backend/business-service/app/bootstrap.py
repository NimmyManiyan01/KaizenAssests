"""
System Bootstrap Routine.

Executed during application startup (in app.main:lifespan) to ensure the
primary warehouse configuration and root administrative account exist.
Operates idempotently across both PostgreSQL and SQLite.
"""
from __future__ import annotations

import uuid
from sqlalchemy import func, or_, select

from app.config.settings import get_settings
from app.database.session import AsyncSessionFactory
from app.logging.logger import get_logger
from app.modules.warehouse.infrastructure.persistence.models import UserAccountModel, WarehouseModel
from app.modules.dock.infrastructure.persistence.models import DockMasterModel
from app.modules.gate.infrastructure.persistence.models import DockModel
from app.security.passwords import hash_password

logger = get_logger(__name__)


async def bootstrap_system_data() -> None:
    """
    Ensure baseline system records exist on startup.
    Idempotent: will not overwrite or duplicate existing administrator or warehouse records.
    """
    settings = get_settings()
    if not settings.auto_bootstrap_admin:
        logger.debug("Auto bootstrap of system data is disabled via settings")
        return

    try:
        async with AsyncSessionFactory() as session:
            # 1. Ensure primary warehouse exists
            wh_stmt = select(WarehouseModel).limit(1)
            wh_res = await session.execute(wh_stmt)
            warehouse = wh_res.scalars().first()

            if not warehouse:
                warehouse = WarehouseModel(
                    id=uuid.uuid4(),
                    singleton_key=1,
                    warehouse_code="WH-001",
                    warehouse_name="Main Logistics Warehouse",
                    description="Primary Logistics & Inventory Facility",
                    warehouse_id="WH-001",
                    warehouse_operator_name="System Administrator",
                    status="ACTIVE",
                    warehouse_type="CENTRAL",
                )
                session.add(warehouse)
                await session.flush()
                logger.info("Bootstrap: Created primary warehouse '%s'", warehouse.warehouse_code)
            else:
                logger.debug("Bootstrap: Primary warehouse '%s' already exists", warehouse.warehouse_code)

            # The first receiving dock is a protected operational baseline.
            # Restore legacy soft-deleted RM-01 records instead of creating a
            # duplicate, and keep the gate-side dock status synchronized.
            default_dock = (
                await session.execute(
                    select(DockMasterModel).where(func.upper(DockMasterModel.dock_code) == "RM-01")
                )
            ).scalar_one_or_none()
            restored_default_dock = default_dock is not None and not default_dock.is_active
            if default_dock is None:
                default_dock = DockMasterModel(
                    dock_code="RM-01",
                    dock_name="Raw Material Dock 01",
                    dock_type="RAW_MATERIAL",
                    direction="INBOUND",
                    location="Main Logistics Warehouse",
                    description="Default inbound receiving dock",
                    status="AVAILABLE",
                    is_active=True,
                    warehouse_ref_id=warehouse.id,
                )
                session.add(default_dock)
                logger.info("Bootstrap: Created protected default receiving dock RM-01")
            elif restored_default_dock:
                default_dock.is_active = True
                default_dock.status = "AVAILABLE"
                if default_dock.warehouse_ref_id is None:
                    default_dock.warehouse_ref_id = warehouse.id
                logger.info("Bootstrap: Restored protected default receiving dock RM-01")

            gate_default_dock = (
                await session.execute(
                    select(DockModel).where(func.upper(DockModel.dock_number) == "RM-01")
                )
            ).scalar_one_or_none()
            if gate_default_dock is None:
                session.add(
                    DockModel(
                        dock_number="RM-01",
                        warehouse_id=warehouse.warehouse_code,
                        dock_type="RAW_MATERIAL",
                        capacity=1,
                        status="AVAILABLE",
                    )
                )
            elif restored_default_dock:
                gate_default_dock.status = "AVAILABLE"

            # 2. Check if an administrator user already exists
            admin_stmt = select(UserAccountModel).where(
                or_(
                    func.lower(UserAccountModel.username) == settings.admin_username.strip().lower(),
                    func.upper(UserAccountModel.role).in_(["ADMIN", "SUPER_ADMIN", "SUPERUSER"]),
                )
            ).limit(1)
            admin_res = await session.execute(admin_stmt)
            existing_admin = admin_res.scalars().first()

            if not existing_admin:
                admin_account = UserAccountModel(
                    id=uuid.uuid4(),
                    warehouse_ref_id=warehouse.id,
                    employee_id="EMP-ADMIN-001",
                    username=settings.admin_username.strip(),
                    full_name=settings.admin_full_name.strip(),
                    email=settings.admin_email.strip().lower(),
                    password_hash=hash_password(settings.admin_password),
                    role="SUPER_ADMIN",
                    applications=["WMS", "AMS"],
                    page_permissions={},
                    status="ACTIVE",
                    failed_login_attempts=0,
                )
                session.add(admin_account)
                logger.info(
                    "Bootstrap: Seeded default administrator '%s' (%s) with role SUPER_ADMIN",
                    admin_account.username,
                    admin_account.employee_id,
                )
            else:
                logger.debug("Bootstrap: Administrator account '%s' already exists", existing_admin.username)

            await session.commit()

    except Exception as exc:
        logger.warning("Bootstrap: System data bootstrap encountered an issue: %s", exc)

