"""Add a configurable capacity UOM to warehouse racks.

Revision ID: 20261114_rack_capacity_uom
Revises: 20261114_asn_revision_lifecycle
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_rack_capacity_uom"
down_revision = "20261114_asn_revision_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("warehouse_rack"):
        return
    columns = {column["name"] for column in inspector.get_columns("warehouse_rack")}
    if "capacity_uom" not in columns:
        op.add_column(
            "warehouse_rack",
            sa.Column("capacity_uom", sa.String(length=32), nullable=False, server_default="PCS"),
        )
    op.execute("UPDATE warehouse_rack SET capacity_uom = upper(coalesce(nullif(trim(capacity_uom), ''), 'PCS'))")

    # Recreate the stock-boundary triggers so they validate against each rack's UOM.
    from app.modules.storage.application.rack_capacity import install_rack_capacity
    install_rack_capacity(bind)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("warehouse_rack"):
        columns = {column["name"] for column in inspector.get_columns("warehouse_rack")}
        if "capacity_uom" in columns:
            op.drop_column("warehouse_rack", "capacity_uom")
