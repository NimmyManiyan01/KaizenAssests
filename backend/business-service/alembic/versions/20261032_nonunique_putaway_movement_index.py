"""Make the putaway task lookup index non-unique."""
from alembic import op
import sqlalchemy as sa


revision = "20261032_nonunique_putaway_movement_index"
down_revision = "20261031_multiple_putaway_movements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    indexes = sa.inspect(bind).get_indexes("putaway_movement")
    index = next((item for item in indexes if item.get("name") == "ix_putaway_movement_putaway_task_id"), None)
    if index and index.get("unique"):
        op.drop_index("ix_putaway_movement_putaway_task_id", table_name="putaway_movement")
        op.create_index("ix_putaway_movement_putaway_task_id", "putaway_movement", ["putaway_task_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    duplicate = bind.execute(sa.text(
        "SELECT putaway_task_id FROM putaway_movement "
        "WHERE putaway_task_id IS NOT NULL GROUP BY putaway_task_id HAVING count(*) > 1 LIMIT 1"
    )).first()
    if duplicate:
        raise RuntimeError(
            "Cannot restore a unique putaway movement index while multiple rows exist; use a forward migration."
        )
    indexes = sa.inspect(bind).get_indexes("putaway_movement")
    index = next((item for item in indexes if item.get("name") == "ix_putaway_movement_putaway_task_id"), None)
    if index and not index.get("unique"):
        op.drop_index("ix_putaway_movement_putaway_task_id", table_name="putaway_movement")
        op.create_index("ix_putaway_movement_putaway_task_id", "putaway_movement", ["putaway_task_id"], unique=True)
