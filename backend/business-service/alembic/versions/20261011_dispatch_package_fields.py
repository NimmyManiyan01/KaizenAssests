"""Persist dispatch package details."""
from alembic import op
import sqlalchemy as sa

revision = "20261011_dispatch_package_fields"
down_revision = "20261011_customer_orders"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {column["name"] for column in inspector.get_columns("dispatch_item")}
    if "package_number" not in existing:
        op.add_column("dispatch_item", sa.Column("package_number", sa.String(128), nullable=True))
    if "package_type" not in existing:
        op.add_column("dispatch_item", sa.Column("package_type", sa.String(64), nullable=True))
    if "package_count" not in existing:
        op.add_column("dispatch_item", sa.Column("package_count", sa.Numeric(18, 4), nullable=True))

def downgrade() -> None:
    op.drop_column("dispatch_item", "package_count")
    op.drop_column("dispatch_item", "package_type")
    op.drop_column("dispatch_item", "package_number")
