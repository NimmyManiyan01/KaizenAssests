"""Persist empty pickup vehicle gate visits linked to FG requests."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0019_add_finished_goods_pickup_gate_visits"
down_revision = "0018_add_request_fifo_allocations"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "finished_goods_pickup_gate_visit" not in inspector.get_table_names():
        op.create_table("finished_goods_pickup_gate_visit",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("finished_goods_request.id", ondelete="RESTRICT"), nullable=False, unique=True),
            sa.Column("gate_pass_number", sa.String(6), nullable=False, unique=True),
            sa.Column("supplier_id", sa.String(64), nullable=True), sa.Column("supplier_name", sa.String(255), nullable=False),
            sa.Column("vehicle_number", sa.String(32), nullable=False), sa.Column("driver_name", sa.String(128), nullable=False), sa.Column("driver_contact", sa.String(32), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="INSIDE_FACILITY"), sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=False), sa.Column("entered_at", sa.DateTime(timezone=True), nullable=True), sa.Column("security_officer", sa.String(128), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))

def downgrade() -> None:
    op.drop_table("finished_goods_pickup_gate_visit")
