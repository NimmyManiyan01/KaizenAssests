"""Persist outbound pickup gate-exit audit fields."""
from alembic import op
import sqlalchemy as sa

revision = "0020_add_pickup_gate_exit_fields"
down_revision = "0019_add_finished_goods_pickup_gate_visits"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "finished_goods_pickup_gate_visit" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("finished_goods_pickup_gate_visit")}
        for name, typ in [("exited_at", sa.DateTime(timezone=True)), ("exit_approved_by", sa.String(128)), ("documents_verified", sa.Boolean())]:
            if name not in cols: op.add_column("finished_goods_pickup_gate_visit", sa.Column(name, typ, nullable=False if name == "documents_verified" else True, server_default="false" if name == "documents_verified" else None))

def downgrade() -> None:
    pass
