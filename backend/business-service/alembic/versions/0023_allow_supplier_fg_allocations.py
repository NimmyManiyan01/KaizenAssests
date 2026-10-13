"""Allow finished-goods allocations to belong to supplier requests."""

from alembic import op
import sqlalchemy as sa


revision = "0023_allow_supplier_fg_allocations"
down_revision = "0022_align_finished_goods_request_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "assembly_finished_goods_allocation" not in sa.inspect(bind).get_table_names():
        return
    op.alter_column("assembly_finished_goods_allocation", "dispatch_item_id", nullable=True)


def downgrade() -> None:
    # Existing supplier allocations may not have a dispatch item.
    pass
