"""Persist multiple validated transport pairs for supplier FG dispatches."""

from alembic import op
import sqlalchemy as sa


revision = "20261027_fg_transport_list"
down_revision = (
    "20261016_qc_inspector_audit",
    "20261021_rack_capacity",
    "b4e9e5db57cc",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("finished_goods_request")
    }
    if "transport_entries" not in columns:
        op.add_column(
            "finished_goods_request",
            sa.Column("transport_entries", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("finished_goods_request")
    }
    if "transport_entries" in columns:
        op.drop_column("finished_goods_request", "transport_entries")
