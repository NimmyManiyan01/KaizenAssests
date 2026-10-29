"""Add the mapped payment_terms field to purchase_order."""

from alembic import op
import sqlalchemy as sa


revision = "20261030_purchase_order_payment_terms"
down_revision = "20261030_assembly_consumption_api"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("Purchase order compatibility migration requires PostgreSQL")

    inspector = sa.inspect(bind)
    if "purchase_order" not in inspector.get_table_names():
        raise RuntimeError("Cannot add payment_terms: purchase_order table does not exist")

    columns = {column["name"]: column for column in inspector.get_columns("purchase_order")}
    if "payment_terms" not in columns:
        op.add_column(
            "purchase_order",
            sa.Column("payment_terms", sa.String(length=128), nullable=True),
        )
    elif not isinstance(columns["payment_terms"]["type"], sa.String):
        raise RuntimeError("purchase_order.payment_terms exists with an incompatible type")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("purchase_order")}
    if "payment_terms" not in columns:
        return

    has_values = bind.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM purchase_order WHERE payment_terms IS NOT NULL)")
    ).scalar_one()
    if has_values:
        raise RuntimeError(
            "Cannot remove purchase_order.payment_terms while values exist; use a forward fix"
        )
    op.drop_column("purchase_order", "payment_terms")
