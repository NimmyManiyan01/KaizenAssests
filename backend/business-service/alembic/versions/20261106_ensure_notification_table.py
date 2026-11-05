"""ensure notification table exists for NotificationModel

Revision ID: 20261106_ensure_notification_table
Revises: 20261105_perf_indexes
Create Date: 2026-11-06 00:30:00
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20261106_ensure_notification_table"
down_revision: Union[str, None] = "20261105_perf_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("notification"):
        op.create_table(
            "notification",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_role", sa.String(32), nullable=False),
            sa.Column("title", sa.String(256), nullable=False),
            sa.Column("message", sa.Text, nullable=False),
            sa.Column("link", sa.String(512), nullable=True),
            sa.Column("is_read", sa.Boolean, default=False, nullable=False),
            sa.Column("dock_code", sa.String(64), nullable=True),
            sa.Column("dock_name", sa.String(128), nullable=True),
            sa.Column("dock_location", sa.String(128), nullable=True),
            sa.Column("dock_type", sa.String(64), nullable=True),
            sa.Column("warehouse_name", sa.String(128), nullable=True),
            sa.Column("allocation_time", sa.DateTime, nullable=True),
            sa.Column("gate_pass_number", sa.String(64), nullable=True),
            sa.Column("vehicle_number", sa.String(64), nullable=True),
            sa.Column("driver_name", sa.String(128), nullable=True),
            sa.Column("driver_phone", sa.String(32), nullable=True),
            sa.Column("asn_number", sa.String(64), nullable=True),
            sa.Column("po_number", sa.String(64), nullable=True),
            sa.Column("grn_number", sa.String(64), nullable=True),
            sa.Column("supplier_name", sa.String(255), nullable=True),
            sa.Column("notification_type", sa.String(64), nullable=True),
            sa.Column("idempotency_key", sa.String(255), nullable=True),
            sa.Column("payload_json", sa.Text, nullable=True),
            sa.Column("details", sa.JSON, nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        )
        op.create_index("ix_notification_user_role", "notification", ["user_role"])
        op.create_index("ix_notification_created_at", "notification", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("notification"):
        op.drop_table("notification")

