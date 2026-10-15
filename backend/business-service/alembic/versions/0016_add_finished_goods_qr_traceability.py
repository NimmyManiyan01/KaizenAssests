"""Add finished-goods batch identity and QR verification audit fields."""
from alembic import op
import sqlalchemy as sa

revision = "0016_add_finished_goods_qr_traceability"
down_revision = "0015_add_held_quantity_to_assembly_qc"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_finished_goods" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("assembly_finished_goods")}
        if "batch_number" not in columns:
            op.add_column("assembly_finished_goods", sa.Column("batch_number", sa.String(128), nullable=True))
            op.create_index("ix_assembly_finished_goods_batch_number", "assembly_finished_goods", ["batch_number"], unique=True)
        if "qr_verified_at" not in columns:
            op.add_column("assembly_finished_goods", sa.Column("qr_verified_at", sa.DateTime(), nullable=True))
        if "qr_verified_by" not in columns:
            op.add_column("assembly_finished_goods", sa.Column("qr_verified_by", sa.String(128), nullable=True))

def downgrade() -> None:
    pass
