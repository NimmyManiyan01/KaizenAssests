"""Add customer order capture for outbound dispatch."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261011_customer_orders"
down_revision = "20261011_merge_heads"
branch_labels = None
depends_on = None

def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("customer_order_customer"):
        op.create_table("customer_order_customer",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("contact_person", sa.String(128), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    if not inspector.has_table("customer_order"):
        op.create_table("customer_order",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_number", sa.String(64), nullable=False, unique=True),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customer_order_customer.id"), nullable=False),
        sa.Column("customer_po", sa.String(128), nullable=True), sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("expected_delivery_date", sa.Date(), nullable=False), sa.Column("status", sa.String(32), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    if not inspector.has_table("customer_order_item"):
        op.create_table("customer_order_item",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customer_order.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_code", sa.String(64), nullable=False), sa.Column("product_name", sa.String(255), nullable=False),
        sa.Column("ordered_quantity", sa.Numeric(18, 4), nullable=False), sa.Column("dispatched_quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("uom", sa.String(32), nullable=False))

def downgrade() -> None:
    op.drop_table("customer_order_item")
    op.drop_table("customer_order")
    op.drop_table("customer_order_customer")
