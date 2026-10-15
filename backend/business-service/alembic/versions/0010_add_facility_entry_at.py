"""Persist the actual facility-entry timestamp for inbound gate movement."""
from alembic import op
import sqlalchemy as sa

revision = "0010_add_facility_entry_at"
down_revision = "0009_update_dock_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "gate_entry" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("gate_entry")}
        if "facility_entry_at" not in columns:
            op.add_column("gate_entry", sa.Column("facility_entry_at", sa.DateTime(timezone=True), nullable=True))
            op.create_index("ix_gate_entry_facility_entry_at", "gate_entry", ["facility_entry_at"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "gate_entry" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("gate_entry")}
        if "facility_entry_at" in columns:
            op.drop_index("ix_gate_entry_facility_entry_at", table_name="gate_entry")
            op.drop_column("gate_entry", "facility_entry_at")
