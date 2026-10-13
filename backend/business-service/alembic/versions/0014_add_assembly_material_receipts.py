"""Persist assembly material receipt confirmations."""
from alembic import op
import sqlalchemy as sa

revision = "0014_add_assembly_material_receipts"
down_revision = "0013_add_approved_quantity_to_material_request_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_material_receipt" not in inspector.get_table_names():
        op.create_table(
            "assembly_material_receipt",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("assembly_order_id", sa.UUID(), sa.ForeignKey("assembly_order.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("material_issue_id", sa.UUID(), sa.ForeignKey("material_issue.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_qr", sa.String(128), nullable=True),
            sa.Column("issued_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("received_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False),
            sa.Column("received_by", sa.String(128), nullable=False),
            sa.Column("received_at", sa.DateTime(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.UniqueConstraint("assembly_order_id", "material_code", name="uq_assembly_receipt_order_material"),
        )
        op.create_index("ix_assembly_material_receipt_assembly_order_id", "assembly_material_receipt", ["assembly_order_id"])
        op.create_index("ix_assembly_material_receipt_material_issue_id", "assembly_material_receipt", ["material_issue_id"])


def downgrade() -> None:
    op.drop_table("assembly_material_receipt")
