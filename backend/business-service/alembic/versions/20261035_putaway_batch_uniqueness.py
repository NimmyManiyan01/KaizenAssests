"""Align legacy putaway uniqueness with existing batch-aware posting/model."""
from alembic import op
import sqlalchemy as sa

revision = "20261035_putaway_batch_uniqueness"
down_revision = "20261034_optional_handling_unit_po"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    constraints = sa.inspect(bind).get_unique_constraints("putaway_task")
    if not any(c["column_names"] == ["grn_id", "item_code", "batch_number"] for c in constraints):
        op.create_unique_constraint("uq_putaway_task_grn_item_batch", "putaway_task",
                                    ["grn_id", "item_code", "batch_number"])
    for constraint in constraints:
        if constraint["column_names"] == ["grn_id", "item_code"]:
            op.drop_constraint(constraint["name"], "putaway_task", type_="unique")


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    if bind.execute(sa.text("SELECT 1 FROM putaway_task GROUP BY grn_id, item_code HAVING count(*) > 1 LIMIT 1")).first():
        raise RuntimeError("Cannot restore per-material uniqueness while multiple batch tasks exist")
    op.create_unique_constraint("uq_putaway_task_grn_item", "putaway_task", ["grn_id", "item_code"])
    constraints = sa.inspect(bind).get_unique_constraints("putaway_task")
    for constraint in constraints:
        if constraint["column_names"] == ["grn_id", "item_code", "batch_number"]:
            op.drop_constraint(constraint["name"], "putaway_task", type_="unique")
