"""Remove the retired customer-orders module tables."""

from alembic import op
import sqlalchemy as sa


revision = "20261015_remove_customer_orders"
down_revision = "20261011_dispatch_package_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in ("customer_order_item", "customer_order", "customer_order_customer"):
        if table in inspector.get_table_names():
            op.drop_table(table)


def downgrade() -> None:
    # The retired module is intentionally not recreated.
    pass
