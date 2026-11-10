"""Align putaway task and location assignment schema with warehouse configuration and update rack occupancy trigger.

Revision ID: 20261110_fix_putaway_task_and_rack_occupancy
Revises: 20261110_fix_rack_occupancy_and_bin_uniqueness
Create Date: 2026-11-10 15:45:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261110_fix_putaway_task_and_rack_occupancy"
down_revision: Union[str, None] = "20261110_fix_rack_occupancy_and_bin_uniqueness"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. Align putaway_location_assignment columns
    if inspector.has_table("putaway_location_assignment"):
        cols = {c["name"] for c in inspector.get_columns("putaway_location_assignment")}
        if "destination_store_id" in cols and "destination_warehouse_ref_id" not in cols:
            try:
                op.alter_column("putaway_location_assignment", "destination_store_id", new_column_name="destination_warehouse_ref_id")
            except Exception:
                pass
        elif "destination_warehouse_ref_id" not in cols:
            try:
                op.add_column(
                    "putaway_location_assignment",
                    sa.Column(
                        "destination_warehouse_ref_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_configuration.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

    # 2. Align putaway_task columns
    if inspector.has_table("putaway_task"):
        cols = {c["name"] for c in inspector.get_columns("putaway_task")}
        if "destination_store_id" in cols and "destination_warehouse_ref_id" not in cols:
            try:
                op.alter_column("putaway_task", "destination_store_id", new_column_name="destination_warehouse_ref_id")
            except Exception:
                pass
        elif "destination_warehouse_ref_id" not in cols:
            try:
                op.add_column(
                    "putaway_task",
                    sa.Column(
                        "destination_warehouse_ref_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_configuration.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

        if "destination_bin_id" not in cols:
            try:
                op.add_column(
                    "putaway_task",
                    sa.Column(
                        "destination_bin_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_bin.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

        if "destination_bin_code" not in cols:
            try:
                op.add_column("putaway_task", sa.Column("destination_bin_code", sa.String(128), nullable=True))
            except Exception:
                pass

        if "destination_location_id" not in cols:
            try:
                op.add_column(
                    "putaway_task",
                    sa.Column(
                        "destination_location_id",
                        sa.UUID(),
                        sa.ForeignKey("storage_location.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

        if "destination_zone_id" not in cols:
            try:
                op.add_column(
                    "putaway_task",
                    sa.Column(
                        "destination_zone_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_zone.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

        # Drop legacy foreign keys pointing to old store_* tables
        for fk_name in ["fk_putaway_task_destination_store_id", "fk_putaway_task_destination_zone_id", "fk_putaway_task_destination_bin_id"]:
            try:
                op.drop_constraint(fk_name, "putaway_task", type_="foreignkey")
            except Exception:
                pass

    # 3. Align storage_location columns
    if inspector.has_table("storage_location"):
        cols = {c["name"] for c in inspector.get_columns("storage_location")}
        if "store_id" in cols and "warehouse_ref_id" not in cols:
            try:
                op.alter_column("storage_location", "store_id", new_column_name="warehouse_ref_id")
            except Exception:
                pass
        elif "warehouse_ref_id" not in cols:
            try:
                op.add_column(
                    "storage_location",
                    sa.Column(
                        "warehouse_ref_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_configuration.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

        if "zone_id" not in cols:
            try:
                op.add_column(
                    "storage_location",
                    sa.Column(
                        "zone_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_zone.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

        if "bin_id" not in cols:
            try:
                op.add_column(
                    "storage_location",
                    sa.Column(
                        "bin_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_bin.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

        for fk_name in ["fk_storage_location_store_id", "fk_storage_location_zone_id", "fk_storage_location_bin_id"]:
            try:
                op.drop_constraint(fk_name, "storage_location", type_="foreignkey")
            except Exception:
                pass

    # 4. Align inventory_movement_history columns
    if inspector.has_table("inventory_movement_history"):
        cols = {c["name"] for c in inspector.get_columns("inventory_movement_history")}
        if "store_id" in cols and "warehouse_ref_id" not in cols:
            try:
                op.alter_column("inventory_movement_history", "store_id", new_column_name="warehouse_ref_id")
            except Exception:
                pass
        elif "warehouse_ref_id" not in cols:
            try:
                op.add_column(
                    "inventory_movement_history",
                    sa.Column(
                        "warehouse_ref_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_configuration.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                )
            except Exception:
                pass

        if "store_code" in cols and "warehouse_code" not in cols:
            try:
                op.alter_column("inventory_movement_history", "store_code", new_column_name="warehouse_code")
            except Exception:
                pass
        elif "warehouse_code" not in cols:
            try:
                op.add_column("inventory_movement_history", sa.Column("warehouse_code", sa.String(64), nullable=True))
            except Exception:
                pass

        for fk_name in ["fk_inventory_movement_history_store_id", "fk_inventory_movement_history_from_bin_id", "fk_inventory_movement_history_to_bin_id"]:
            try:
                op.drop_constraint(fk_name, "inventory_movement_history", type_="foreignkey")
            except Exception:
                pass

    # 5. Align material_stock columns
    if inspector.has_table("material_stock"):
        cols = {c["name"] for c in inspector.get_columns("material_stock")}
        if "location_id" not in cols:
            try:
                op.add_column("material_stock", sa.Column("location_id", sa.UUID(), nullable=True))
            except Exception:
                pass

    # 3. Update maintain_rack_occupancy function in PostgreSQL
    if bind.dialect.name == "postgresql":
        try:
            from app.modules.storage.application.rack_capacity import _install_postgres
            _install_postgres(bind)
        except Exception:
            pass


def downgrade() -> None:
    pass
