"""Add an explicit per-order switch for verified material consumption."""

from alembic import op
import sqlalchemy as sa


revision = "20261030_assembly_consumption_api"
down_revision = "20261029_fg_consumption_traceability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("Assembly consumption workflow requires PostgreSQL")

    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("assembly_order")}
    if "traceability_required" not in columns:
        op.add_column(
            "assembly_order",
            sa.Column(
                "traceability_required",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
    else:
        column = next(
            column for column in sa.inspect(op.get_bind()).get_columns("assembly_order")
            if column["name"] == "traceability_required"
        )
        if not isinstance(column["type"], sa.Boolean):
            raise RuntimeError("assembly_order.traceability_required exists with an incompatible type")


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("assembly_order")}
    if "traceability_required" not in columns:
        return

    enabled_orders = op.get_bind().execute(
        sa.text("SELECT count(*) FROM assembly_order WHERE traceability_required IS TRUE")
    ).scalar_one()
    if enabled_orders:
        raise RuntimeError(
            "Cannot downgrade while assembly orders require verified consumption; "
            "the downgrade would erase their workflow state"
        )
    op.drop_column("assembly_order", "traceability_required")
