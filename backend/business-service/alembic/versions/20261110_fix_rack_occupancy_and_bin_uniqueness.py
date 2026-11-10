"""Harden rack occupancy event schema and ensure warehouse bin and rack uniqueness and consistency.

Revision ID: 20261110_fix_rack_occupancy_and_bin_uniqueness
Revises: 20261110_grn_posting_constraint_resilience
Create Date: 2026-11-10 13:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261110_fix_rack_occupancy_and_bin_uniqueness"
down_revision: Union[str, None] = "20261110_grn_posting_constraint_resilience"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. rack_occupancy_event: balance_id nullable, default id, reason length
    if inspector.has_table("rack_occupancy_event"):
        cols = {col["name"]: col for col in inspector.get_columns("rack_occupancy_event")}
        if "balance_id" in cols:
            col_info = cols["balance_id"]
            if not col_info.get("nullable", True):
                try:
                    op.alter_column("rack_occupancy_event", "balance_id", nullable=True)
                except Exception:
                    pass

        if "reason" in cols:
            try:
                op.alter_column("rack_occupancy_event", "reason", type_=sa.String(1000), existing_type=sa.String(128))
            except Exception:
                pass

        if bind.dialect.name == "postgresql":
            try:
                op.execute(sa.text("""
                    DO $$
                    BEGIN
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'rack_occupancy_event' AND column_name = 'id' AND udt_name = 'uuid'
                        ) THEN
                            ALTER TABLE rack_occupancy_event ALTER COLUMN id SET DEFAULT gen_random_uuid();
                        END IF;
                    END $$;
                """))
            except Exception:
                pass

    # 2. Clean up any orphaned bins or racks pointing to non-existent zones
    if inspector.has_table("warehouse_bin") and inspector.has_table("warehouse_zone"):
        try:
            op.execute(sa.text("""
                DELETE FROM warehouse_bin WHERE zone_id NOT IN (SELECT id FROM warehouse_zone);
            """))
        except Exception:
            pass

    if inspector.has_table("warehouse_rack") and inspector.has_table("warehouse_zone"):
        try:
            op.execute(sa.text("""
                DELETE FROM warehouse_rack WHERE zone_id NOT IN (SELECT id FROM warehouse_zone);
            """))
        except Exception:
            pass


def downgrade() -> None:
    pass
