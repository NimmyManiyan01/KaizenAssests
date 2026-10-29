"""Allow multiple pickup gate visits for one finished-goods dispatch."""

from alembic import op
import sqlalchemy as sa


revision = "20261028_multiple_pickup_gate_visits"
down_revision = "20261027_fg_transport_list"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "finished_goods_pickup_gate_visit" not in inspector.get_table_names():
        return
    for constraint in inspector.get_unique_constraints("finished_goods_pickup_gate_visit"):
        if constraint.get("column_names") == ["request_id"] and constraint.get("name"):
            op.drop_constraint(
                constraint["name"],
                "finished_goods_pickup_gate_visit",
                type_="unique",
            )
    inspector = sa.inspect(op.get_bind())
    for index in inspector.get_indexes("finished_goods_pickup_gate_visit"):
        if (
            index.get("unique")
            and index.get("column_names") == ["request_id"]
            and not index.get("duplicates_constraint")
            and index.get("name")
        ):
            op.drop_index(index["name"], table_name="finished_goods_pickup_gate_visit")


def downgrade() -> None:
    bind = op.get_bind()
    duplicate_exists = bind.execute(sa.text("""
        SELECT 1
        FROM finished_goods_pickup_gate_visit
        GROUP BY request_id
        HAVING count(*) > 1
        LIMIT 1
    """)).scalar()
    if duplicate_exists:
        raise RuntimeError("Cannot restore one-visit-per-dispatch while duplicate visits exist")
    op.create_unique_constraint(
        "uq_finished_goods_pickup_gate_visit_request_id",
        "finished_goods_pickup_gate_visit",
        ["request_id"],
    )
