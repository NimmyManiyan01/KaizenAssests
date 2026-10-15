"""Persist held finished-goods quantity during final QC."""
from alembic import op
import sqlalchemy as sa

revision = "0015_add_held_quantity_to_assembly_qc"
down_revision = "0014_fix_assembly_material_receipt_types"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_quality_inspection" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("assembly_quality_inspection")}
        if "held_quantity" not in columns:
            op.add_column("assembly_quality_inspection", sa.Column("held_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"))

def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_quality_inspection" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("assembly_quality_inspection")}
        if "held_quantity" in columns:
            op.drop_column("assembly_quality_inspection", "held_quantity")
