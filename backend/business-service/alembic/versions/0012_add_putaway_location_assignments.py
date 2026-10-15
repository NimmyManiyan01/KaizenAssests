"""Persist split putaway location assignments."""
from alembic import op
import sqlalchemy as sa

revision = "0012_add_putaway_location_assignments"
down_revision = "0011_add_held_quantity_to_receiving_lines"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "putaway_location_assignment" not in inspector.get_table_names():
        op.create_table(
            "putaway_location_assignment",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("putaway_task_id", sa.UUID(), sa.ForeignKey("putaway_task.id", ondelete="CASCADE"), nullable=False),
            sa.Column("destination_store_id", sa.UUID(), sa.ForeignKey("store.id", ondelete="SET NULL"), nullable=True),
            sa.Column("destination_zone_id", sa.UUID(), sa.ForeignKey("store_zone.id", ondelete="SET NULL"), nullable=True),
            sa.Column("destination_bin_id", sa.UUID(), sa.ForeignKey("store_bin.id", ondelete="SET NULL"), nullable=True),
            sa.Column("location_code", sa.String(128), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("assigned_by", sa.String(128), nullable=False),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("putaway_task_id", "destination_bin_id", name="uq_putaway_task_location"),
        )
        op.create_index("ix_putaway_location_assignment_putaway_task_id", "putaway_location_assignment", ["putaway_task_id"])
        op.create_index("ix_putaway_location_assignment_destination_bin_id", "putaway_location_assignment", ["destination_bin_id"])


def downgrade() -> None:
    op.drop_table("putaway_location_assignment")
