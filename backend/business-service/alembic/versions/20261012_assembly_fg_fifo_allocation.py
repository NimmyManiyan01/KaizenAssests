"""Persist Assembly finished-goods FIFO allocations."""
from alembic import op
import sqlalchemy as sa

revision = "20261012_assembly_fg_fifo_allocation"
down_revision = "20261012_replacement_asn_claim_link"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_finished_goods_allocation" not in inspector.get_table_names():
        op.create_table(
            "assembly_finished_goods_allocation",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("finished_goods_id", sa.Uuid(), sa.ForeignKey("assembly_finished_goods.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("dispatch_order_id", sa.Uuid(), sa.ForeignKey("dispatch_order.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("dispatch_item_id", sa.Uuid(), sa.ForeignKey("dispatch_item.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="ALLOCATED"),
            sa.Column("allocated_at", sa.DateTime(), nullable=False),
        )
    existing_indexes = {index["name"] for index in inspector.get_indexes("assembly_finished_goods_allocation")}
    for column in ("finished_goods_id", "dispatch_order_id", "dispatch_item_id", "status"):
        index_name = f"ix_assembly_fg_alloc_{column}"
        if index_name not in existing_indexes:
            op.create_index(index_name, "assembly_finished_goods_allocation", [column])

def downgrade() -> None:
    op.drop_table("assembly_finished_goods_allocation")
