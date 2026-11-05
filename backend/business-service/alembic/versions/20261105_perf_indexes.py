"""Add composite B-tree performance indexes for high-volume operational queries (CHG-PERF-002).

Revision ID: 20261105_perf_indexes
Revises: 20261101_supplier_sessions
"""

from alembic import op
import sqlalchemy as sa


revision = "20261105_perf_indexes"
down_revision = "20261101_supplier_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. gate_entry: composite index on (status, created_at)
    ge_indexes = {idx["name"] for idx in inspector.get_indexes("gate_entry")}
    if "ix_gate_entry_status_created" not in ge_indexes:
        op.create_index(
            "ix_gate_entry_status_created",
            "gate_entry",
            ["status", "created_at"],
        )

    # 2. dock_allocation_requests: composite index on (assigned_dock_id, status)
    dock_indexes = {idx["name"] for idx in inspector.get_indexes("dock_allocation_requests")}
    if "ix_dock_alloc_dock_status" not in dock_indexes:
        op.create_index(
            "ix_dock_alloc_dock_status",
            "dock_allocation_requests",
            ["assigned_dock_id", "status"],
        )

    # 3. inventory_location_balance: composite index on (warehouse_id, material_code)
    inv_indexes = {idx["name"] for idx in inspector.get_indexes("inventory_location_balance")}
    if "ix_inv_balance_wh_mat" not in inv_indexes:
        op.create_index(
            "ix_inv_balance_wh_mat",
            "inventory_location_balance",
            ["warehouse_id", "material_code"],
        )

    # 4. asn: composite index on (supplier_id, status)
    asn_indexes = {idx["name"] for idx in inspector.get_indexes("asn")}
    if "ix_asn_supplier_status" not in asn_indexes:
        op.create_index(
            "ix_asn_supplier_status",
            "asn",
            ["supplier_id", "status"],
        )


def downgrade() -> None:
    op.drop_index("ix_asn_supplier_status", table_name="asn")
    op.drop_index("ix_inv_balance_wh_mat", table_name="inventory_location_balance")
    op.drop_index("ix_dock_alloc_dock_status", table_name="dock_allocation_requests")
    op.drop_index("ix_gate_entry_status_created", table_name="gate_entry")

