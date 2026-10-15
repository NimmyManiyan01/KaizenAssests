"""Allow finished-goods reservations to be tied to supplier requests."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0018_add_request_fifo_allocations"
down_revision = "0017_add_supplier_fg_dispatch_request_fields"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_finished_goods_allocation" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("assembly_finished_goods_allocation")}
        if "finished_goods_request_id" not in cols:
            op.add_column("assembly_finished_goods_allocation", sa.Column("finished_goods_request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("finished_goods_request.id", ondelete="RESTRICT"), nullable=True))
        # Existing dispatch allocations remain valid; request allocations use the nullable dispatch order column.
        try: op.alter_column("assembly_finished_goods_allocation", "dispatch_order_id", nullable=True)
        except Exception: pass

def downgrade() -> None:
    pass
