"""Allow supplier damage claims to originate from completed GRN lines."""
from alembic import op
import sqlalchemy as sa

revision = "20261012_grn_supplier_damage_claim_source"
down_revision = "20261012_grn_batch_qr_item_code_index"
branch_labels = None
depends_on = None

def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("supplier_damage_claim")}
    if "source_grn_id" not in columns:
        op.add_column("supplier_damage_claim", sa.Column("source_grn_id", sa.Uuid(), sa.ForeignKey("grn.id", ondelete="RESTRICT"), nullable=True))
    if "source_grn_line_id" not in columns:
        op.add_column("supplier_damage_claim", sa.Column("source_grn_line_id", sa.Uuid(), sa.ForeignKey("grn_line.id", ondelete="RESTRICT"), nullable=True))
    op.alter_column("supplier_damage_claim", "damage_report_id", nullable=True)
    inspector = sa.inspect(bind)
    unique_names = {c["name"] for c in inspector.get_unique_constraints("supplier_damage_claim")}
    if "uq_supplier_damage_claim_source_grn_line" not in unique_names:
        op.create_unique_constraint("uq_supplier_damage_claim_source_grn_line", "supplier_damage_claim", ["source_grn_line_id"])

def downgrade() -> None:
    op.drop_constraint("uq_supplier_damage_claim_source_grn_line", "supplier_damage_claim", type_="unique")
    op.drop_column("supplier_damage_claim", "source_grn_line_id")
    op.drop_column("supplier_damage_claim", "source_grn_id")
    op.alter_column("supplier_damage_claim", "damage_report_id", nullable=False)
