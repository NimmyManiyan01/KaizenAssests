"""Add dock direction metadata for inbound and outbound workflows."""

from alembic import op
import sqlalchemy as sa


revision = "20261012_dock_direction"
down_revision = "20261011_driver_license_controls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("dock_masters")}
    if "direction" not in columns:
        op.add_column(
            "dock_masters",
            sa.Column("direction", sa.String(length=16), nullable=False, server_default="INBOUND"),
        )
        op.alter_column("dock_masters", "direction", server_default=None)


def downgrade() -> None:
    op.drop_column("dock_masters", "direction")
