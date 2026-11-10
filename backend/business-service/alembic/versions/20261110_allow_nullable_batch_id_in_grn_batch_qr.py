"""Allow nullable batch_id in grn_batch_qr for material-level QR records.

Revision ID: 20261110_allow_nullable_batch_id_in_grn_batch_qr
Revises: 20261106_add_user_session_table
Create Date: 2026-11-10 10:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261110_allow_nullable_batch_id_in_grn_batch_qr"
down_revision: Union[str, None] = "20261106_add_user_session_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("grn_batch_qr"):
        return

    columns = {column["name"]: column for column in inspector.get_columns("grn_batch_qr")}
    if "batch_id" in columns:
        col_info = columns["batch_id"]
        # If batch_id has NOT NULL constraint, alter it to be nullable
        if not col_info.get("nullable", True):
            if bind.dialect.name == "postgresql":
                op.alter_column("grn_batch_qr", "batch_id", nullable=True)
            elif bind.dialect.name != "sqlite":
                op.alter_column("grn_batch_qr", "batch_id", nullable=True)


def downgrade() -> None:
    pass
