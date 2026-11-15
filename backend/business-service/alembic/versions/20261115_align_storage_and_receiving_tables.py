"""Align storage (cycle_count, cycle_count_item, stock_adjustment, material_return) and receiving session schemas with ORM domain models.

Revision ID: 20261115_align_storage_and_receiving_tables
Revises: 20261114_normalize_fg_codes
Create Date: 2026-11-15 07:45:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20261115_align_storage_and_receiving_tables"
down_revision: Union[str, None] = "20261114_normalize_fg_codes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    guid_type = sa.UUID() if bind.dialect.name == "postgresql" else sa.String(36)

    # 1. cycle_count_item
    if inspector.has_table("cycle_count_item"):
        cnt = bind.execute(sa.text("SELECT COUNT(*) FROM cycle_count_item")).scalar()
        if cnt == 0:
            op.drop_table("cycle_count_item")

    # 2. cycle_count
    if inspector.has_table("cycle_count"):
        cnt = bind.execute(sa.text("SELECT COUNT(*) FROM cycle_count")).scalar()
        if cnt == 0:
            op.drop_table("cycle_count")

    # 3. stock_adjustment
    if inspector.has_table("stock_adjustment"):
        cnt = bind.execute(sa.text("SELECT COUNT(*) FROM stock_adjustment")).scalar()
        if cnt == 0:
            op.drop_table("stock_adjustment")

    # 4. material_return
    if inspector.has_table("material_return"):
        cnt = bind.execute(sa.text("SELECT COUNT(*) FROM material_return")).scalar()
        if cnt == 0:
            op.drop_table("material_return")

    # 5. grn_receiving_session
    if inspector.has_table("grn_receiving_session"):
        cnt = bind.execute(sa.text("SELECT COUNT(*) FROM grn_receiving_session")).scalar()
        if cnt == 0:
            op.drop_table("grn_receiving_session")

    # Recreate tables matching ORM models
    inspector = sa.inspect(bind)

    # --- cycle_count ---
    if not inspector.has_table("cycle_count"):
        op.create_table(
            "cycle_count",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("count_number", sa.String(64), nullable=False, unique=True),
            sa.Column("zone_code", sa.String(64), nullable=False),
            sa.Column("rack", sa.String(64), nullable=True),
            sa.Column("assigned_operator", sa.String(128), nullable=False),
            sa.Column("status", sa.String(64), nullable=False, server_default="ASSIGNED"),
            sa.Column("total_items", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("variance_items_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by", sa.String(128), nullable=False, server_default="SYSTEM"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_cycle_count_count_number", "cycle_count", ["count_number"], unique=True)
        op.create_index("ix_cycle_count_status", "cycle_count", ["status"])
    else:
        columns = {c["name"] for c in inspector.get_columns("cycle_count")}
        if "created_by" not in columns:
            op.add_column("cycle_count", sa.Column("created_by", sa.String(128), nullable=False, server_default="SYSTEM"))

    # --- cycle_count_item ---
    if not inspector.has_table("cycle_count_item"):
        op.create_table(
            "cycle_count_item",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("cycle_count_id", guid_type, sa.ForeignKey("cycle_count.id", ondelete="CASCADE"), nullable=False),
            sa.Column("bin_code", sa.String(64), nullable=False),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("batch_number", sa.String(64), nullable=True),
            sa.Column("system_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("physical_quantity", sa.Numeric(18, 4), nullable=True),
            sa.Column("variance_quantity", sa.Numeric(18, 4), nullable=True),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("status", sa.String(64), nullable=False, server_default="PENDING_COUNT"),
            sa.Column("notes", sa.Text(), nullable=True),
        )
        op.create_index("ix_cycle_count_item_cycle_count_id", "cycle_count_item", ["cycle_count_id"])

    # --- stock_adjustment ---
    if not inspector.has_table("stock_adjustment"):
        op.create_table(
            "stock_adjustment",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("adjustment_number", sa.String(64), nullable=False, unique=True),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("batch_number", sa.String(64), nullable=True),
            sa.Column("location_code", sa.String(128), nullable=False),
            sa.Column("current_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("adjustment_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("new_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("reason", sa.String(128), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("evidence_url", sa.String(512), nullable=True),
            sa.Column("requester", sa.String(128), nullable=False),
            sa.Column("approver", sa.String(128), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="APPROVED"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_stock_adjustment_adjustment_number", "stock_adjustment", ["adjustment_number"], unique=True)
        op.create_index("ix_stock_adjustment_material_code", "stock_adjustment", ["material_code"])
        op.create_index("ix_stock_adjustment_status", "stock_adjustment", ["status"])

    # --- material_return ---
    if not inspector.has_table("material_return"):
        op.create_table(
            "material_return",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("return_number", sa.String(64), nullable=False, unique=True),
            sa.Column("issue_number", sa.String(64), nullable=True),
            sa.Column("assembly_line", sa.String(128), nullable=False, server_default="Assembly Line 02"),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("batch_number", sa.String(64), nullable=True),
            sa.Column("issued_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("used_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("returned_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("condition", sa.String(32), nullable=False, server_default="GOOD"),
            sa.Column("disposition", sa.String(64), nullable=False, server_default="RETURN_TO_INVENTORY"),
            sa.Column("returned_by", sa.String(128), nullable=False),
            sa.Column("received_by", sa.String(128), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="PROCESSED"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_material_return_return_number", "material_return", ["return_number"], unique=True)
        op.create_index("ix_material_return_issue_number", "material_return", ["issue_number"])
        op.create_index("ix_material_return_material_code", "material_return", ["material_code"])
        op.create_index("ix_material_return_status", "material_return", ["status"])

    # --- grn_receiving_session ---
    if not inspector.has_table("grn_receiving_session"):
        op.create_table(
            "grn_receiving_session",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("grn_id", guid_type, sa.ForeignKey("grn.id", ondelete="CASCADE"), nullable=False),
            sa.Column("gate_entry_id", guid_type, sa.ForeignKey("gate_entry.id"), nullable=False),
            sa.Column("asn_id", guid_type, sa.ForeignKey("asn.id"), nullable=True),
            sa.Column("vehicle_number", sa.String(64), nullable=False),
            sa.Column("driver_name", sa.String(128), nullable=True),
            sa.Column("session_date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_grn_receiving_session_grn_id", "grn_receiving_session", ["grn_id"])
        op.create_index("ix_grn_receiving_session_gate_entry_id", "grn_receiving_session", ["gate_entry_id"])


def downgrade() -> None:
    pass
