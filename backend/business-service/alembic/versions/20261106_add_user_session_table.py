"""Add user_session table for enterprise multi-device and concurrent login support.

Revision ID: 20261106_add_user_session_table
Revises: 20261106_standardize_postgresql_schema
Create Date: 2026-11-06 22:45:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261106_add_user_session_table"
down_revision: Union[str, None] = "20261106_standardize_postgresql_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    guid_type = sa.UUID(as_uuid=True) if bind.dialect.name == "postgresql" else sa.String(36)

    if "user_session" not in existing_tables:
        op.create_table(
            "user_session",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("user_id", guid_type, nullable=False),
            sa.Column("user_type", sa.String(32), nullable=False, server_default="STAFF"),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("client_ip", sa.String(45), nullable=True),
            sa.Column("user_agent", sa.String(512), nullable=True),
            sa.Column("device_name", sa.String(128), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.UniqueConstraint("token_hash", name="uq_user_session_token_hash"),
        )
        op.create_index("ix_user_session_token_hash", "user_session", ["token_hash"])
        op.create_index("ix_user_session_user_lookup", "user_session", ["user_id", "is_active", "expires_at"])
        op.create_index("ix_user_session_active_status", "user_session", ["is_active", "expires_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "user_session" in existing_tables:
        op.drop_table("user_session")
