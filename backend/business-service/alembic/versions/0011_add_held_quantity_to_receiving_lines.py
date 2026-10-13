"""Persist QC-held quantity on inbound receiving lines."""
from alembic import op
import sqlalchemy as sa

revision = "0011_add_held_quantity_to_receiving_lines"
down_revision = "0010_add_facility_entry_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "receiving_line" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("receiving_line")}
        if "held_quantity" not in columns:
            op.add_column("receiving_line", sa.Column("held_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "receiving_line" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("receiving_line")}
        if "held_quantity" in columns:
            op.drop_column("receiving_line", "held_quantity")
