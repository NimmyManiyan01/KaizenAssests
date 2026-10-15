"""Add supplier and pickup details to finished-goods dispatch requests."""
from alembic import op
import sqlalchemy as sa

revision = "0017_add_supplier_fg_dispatch_request_fields"
down_revision = "0016_add_finished_goods_qr_traceability"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "finished_goods_request" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("finished_goods_request")}
        for name, typ in [("supplier_id", sa.String(64)), ("supplier_name", sa.String(255)), ("vehicle_number", sa.String(64)), ("driver_name", sa.String(128)), ("driver_contact", sa.String(32)), ("expected_pickup_date", sa.Date())]:
            if name not in cols: op.add_column("finished_goods_request", sa.Column(name, typ, nullable=True))

def downgrade() -> None:
    pass
