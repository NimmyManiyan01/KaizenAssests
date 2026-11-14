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


def _best_effort(bind, operation) -> None:
    """Run optional legacy-schema DDL without poisoning PostgreSQL's transaction."""
    try:
        with bind.begin_nested():
            operation()
    except Exception:
        pass


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. Align putaway_location_assignment columns
    if inspector.has_table("putaway_location_assignment"):
        cols = {c["name"] for c in inspector.get_columns("putaway_location_assignment")}
        if "destination_store_id" in cols and "destination_warehouse_ref_id" not in cols:
            _best_effort(bind, lambda: op.alter_column("putaway_location_assignment", "destination_store_id", new_column_name="destination_warehouse_ref_id"))
        elif "destination_warehouse_ref_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "putaway_location_assignment",
                    sa.Column(
                        "destination_warehouse_ref_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_configuration.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

    # 2. Align putaway_task columns
    if inspector.has_table("putaway_task"):
        cols = {c["name"] for c in inspector.get_columns("putaway_task")}
        if "destination_store_id" in cols and "destination_warehouse_ref_id" not in cols:
            _best_effort(bind, lambda: op.alter_column("putaway_task", "destination_store_id", new_column_name="destination_warehouse_ref_id"))
        elif "destination_warehouse_ref_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "putaway_task",
                    sa.Column(
                        "destination_warehouse_ref_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_configuration.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

        if "destination_bin_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "putaway_task",
                    sa.Column(
                        "destination_bin_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_bin.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

        if "destination_bin_code" not in cols:
            _best_effort(bind, lambda: op.add_column("putaway_task", sa.Column("destination_bin_code", sa.String(128), nullable=True)))

        if "destination_location_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "putaway_task",
                    sa.Column(
                        "destination_location_id",
                        sa.UUID(),
                        sa.ForeignKey("storage_location.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

        if "destination_zone_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "putaway_task",
                    sa.Column(
                        "destination_zone_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_zone.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

        # Drop legacy foreign keys pointing to old store_* tables
        for fk_name in ["fk_putaway_task_destination_store_id", "fk_putaway_task_destination_zone_id", "fk_putaway_task_destination_bin_id"]:
            _best_effort(bind, lambda fk_name=fk_name: op.drop_constraint(fk_name, "putaway_task", type_="foreignkey"))

    # 3. Align storage_location columns
    if inspector.has_table("storage_location"):
        cols = {c["name"] for c in inspector.get_columns("storage_location")}
        if "store_id" in cols and "warehouse_ref_id" not in cols:
            _best_effort(bind, lambda: op.alter_column("storage_location", "store_id", new_column_name="warehouse_ref_id"))
        elif "warehouse_ref_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "storage_location",
                    sa.Column(
                        "warehouse_ref_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_configuration.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

        if "zone_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "storage_location",
                    sa.Column(
                        "zone_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_zone.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

        if "bin_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "storage_location",
                    sa.Column(
                        "bin_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_bin.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

        for fk_name in ["fk_storage_location_store_id", "fk_storage_location_zone_id", "fk_storage_location_bin_id"]:
            _best_effort(bind, lambda fk_name=fk_name: op.drop_constraint(fk_name, "storage_location", type_="foreignkey"))

    # 4. Align inventory_movement_history columns
    if inspector.has_table("inventory_movement_history"):
        cols = {c["name"] for c in inspector.get_columns("inventory_movement_history")}
        if "store_id" in cols and "warehouse_ref_id" not in cols:
            _best_effort(bind, lambda: op.alter_column("inventory_movement_history", "store_id", new_column_name="warehouse_ref_id"))
        elif "warehouse_ref_id" not in cols:
            _best_effort(bind, lambda: op.add_column(
                    "inventory_movement_history",
                    sa.Column(
                        "warehouse_ref_id",
                        sa.UUID(),
                        sa.ForeignKey("warehouse_configuration.id", ondelete="SET NULL"),
                        nullable=True,
                    ),
                ))

        if "store_code" in cols and "warehouse_code" not in cols:
            _best_effort(bind, lambda: op.alter_column("inventory_movement_history", "store_code", new_column_name="warehouse_code"))
        elif "warehouse_code" not in cols:
            _best_effort(bind, lambda: op.add_column("inventory_movement_history", sa.Column("warehouse_code", sa.String(64), nullable=True)))

        for fk_name in ["fk_inventory_movement_history_store_id", "fk_inventory_movement_history_from_bin_id", "fk_inventory_movement_history_to_bin_id"]:
            _best_effort(bind, lambda fk_name=fk_name: op.drop_constraint(fk_name, "inventory_movement_history", type_="foreignkey"))

    # 5. Align material_stock columns
    if inspector.has_table("material_stock"):
        cols = {c["name"] for c in inspector.get_columns("material_stock")}
        if "location_id" not in cols:
            _best_effort(bind, lambda: op.add_column("material_stock", sa.Column("location_id", sa.UUID(), nullable=True)))

    # 3. Update maintain_rack_occupancy function in PostgreSQL
    if bind.dialect.name == "postgresql":
        def install_rack_occupancy() -> None:
            from app.modules.storage.application.rack_capacity import _install_postgres
            _install_postgres(bind)

        _best_effort(bind, install_rack_occupancy)


def downgrade() -> None:
    pass
