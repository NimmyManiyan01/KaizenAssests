"""Persist exact warehouse picking audit references."""
from alembic import op
import sqlalchemy as sa

revision = "20261011_pickup_audit"
down_revision = "20261008_assembly_phase3_rec"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pickup_task", sa.Column("picked_material_qr", sa.String(length=128), nullable=True))
    op.add_column("pickup_task", sa.Column("picked_rack_qr", sa.String(length=128), nullable=True))
    op.add_column("pickup_task", sa.Column("picked_batch_number", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("pickup_task", "picked_batch_number")
    op.drop_column("pickup_task", "picked_rack_qr")
    op.drop_column("pickup_task", "picked_material_qr")
