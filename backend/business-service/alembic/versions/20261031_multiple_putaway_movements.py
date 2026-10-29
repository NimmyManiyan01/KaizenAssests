"""Allow multiple partial putaway movements for one task.

Revision ID: 20261031_multiple_putaway_movements
Revises: 20261030_purchase_order_payment_terms
"""
from alembic import op
import sqlalchemy as sa


revision = "20261031_multiple_putaway_movements"
down_revision = "20261030_purchase_order_payment_terms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    inspector = sa.inspect(bind)
    if "putaway_movement" not in inspector.get_table_names():
        raise RuntimeError("putaway_movement table is missing")
    for constraint in inspector.get_unique_constraints("putaway_movement"):
        if constraint.get("column_names") == ["putaway_task_id"]:
            op.drop_constraint(constraint["name"], "putaway_movement", type_="unique")


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
            "Cannot restore one-movement-per-task constraint while multiple movement rows exist; "
            "use a forward migration."
        )
    constraints = sa.inspect(bind).get_unique_constraints("putaway_movement")
    if not any(item.get("column_names") == ["putaway_task_id"] for item in constraints):
        op.create_unique_constraint(
            "uq_putaway_movement_putaway_task_id", "putaway_movement", ["putaway_task_id"]
        )
