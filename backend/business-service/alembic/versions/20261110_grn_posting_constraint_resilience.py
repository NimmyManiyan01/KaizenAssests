"""Harden GRN posting and completion constraints across inventory_receipt_posting and putaway_task.

Revision ID: 20261110_grn_posting_constraint_resilience
Revises: 20261110_allow_nullable_batch_id_in_grn_batch_qr
Create Date: 2026-11-10 12:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261110_grn_posting_constraint_resilience"
down_revision: Union[str, None] = "20261110_allow_nullable_batch_id_in_grn_batch_qr"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. inventory_receipt_posting: ensure nullable po/asn/supplier/warehouse columns
    if inspector.has_table("inventory_receipt_posting"):
        irp_columns = {col["name"]: col for col in inspector.get_columns("inventory_receipt_posting")}
        for col_name in ["po_id", "po_number", "asn_id", "asn_number", "supplier_name", "warehouse_id"]:
            if col_name in irp_columns:
                col_info = irp_columns[col_name]
                if not col_info.get("nullable", True):
                    try:
                        op.alter_column("inventory_receipt_posting", col_name, nullable=True)
                    except Exception:
                        pass

    # 2. putaway_task: ensure batch_number column exists and remove obsolete unbatched unique constraint
    if inspector.has_table("putaway_task"):
        pt_columns = {col["name"]: col for col in inspector.get_columns("putaway_task")}
        if "batch_number" not in pt_columns:
            try:
                op.add_column("putaway_task", sa.Column("batch_number", sa.String(128), nullable=True))
            except Exception:
                pass

        # Drop legacy single-material constraint on putaway_task if present
        try:
            constraints = inspector.get_unique_constraints("putaway_task")
            for c in constraints:
                if c.get("column_names") == ["grn_id", "item_code"]:
                    op.drop_constraint(c["name"], "putaway_task", type_="unique")
        except Exception:
            pass

        # Also check unique indexes
        try:
            indexes = inspector.get_indexes("putaway_task")
            for idx in indexes:
                if idx.get("unique") and idx.get("column_names") == ["grn_id", "item_code"]:
                    op.drop_index(idx["name"], "putaway_task")
        except Exception:
            pass

        # Ensure uq_putaway_task_grn_item_batch exists
        try:
            constraints = inspector.get_unique_constraints("putaway_task")
            has_batch_uq = any(c.get("column_names") == ["grn_id", "item_code", "batch_number"] for c in constraints)
            if not has_batch_uq and bind.dialect.name == "postgresql":
                op.create_unique_constraint(
                    "uq_putaway_task_grn_item_batch",
                    "putaway_task",
                    ["grn_id", "item_code", "batch_number"],
                )
        except Exception:
            pass


def downgrade() -> None:
    pass
