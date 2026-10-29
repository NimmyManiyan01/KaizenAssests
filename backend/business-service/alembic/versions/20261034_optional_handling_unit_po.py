"""Allow PO-free ASN receiving handling units."""
from alembic import op
import sqlalchemy as sa


revision = "20261034_optional_handling_unit_po"
down_revision = "20261033_asn_first_po_optional"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    op.alter_column("handling_unit", "po_number", existing_type=sa.String(length=64), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    if bind.execute(sa.text("SELECT 1 FROM handling_unit WHERE po_number IS NULL LIMIT 1")).first():
        raise RuntimeError(
            "Cannot restore handling_unit.po_number NOT NULL while ASN-first rows contain NULL; use a forward migration."
        )
    op.alter_column("handling_unit", "po_number", existing_type=sa.String(length=64), nullable=False)
