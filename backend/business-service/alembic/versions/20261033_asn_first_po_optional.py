"""Make legacy PO references optional for ASN-first receiving."""
from alembic import op
import sqlalchemy as sa


revision = "20261033_asn_first_po_optional"
down_revision = "20261032_nonunique_putaway_movement_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    op.alter_column("gate_entry", "po_number", existing_type=sa.String(length=64), nullable=True)
    op.alter_column("gate_entry", "po_document_path", existing_type=sa.String(length=256), nullable=True)
    op.alter_column("damage_report", "po_number", existing_type=sa.String(length=64), nullable=True)
    op.alter_column("vehicle_exit_approval", "po_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise RuntimeError("This migration is supported only on PostgreSQL")
    for table, column in (
        ("gate_entry", "po_number"),
        ("gate_entry", "po_document_path"),
        ("damage_report", "po_number"),
        ("vehicle_exit_approval", "po_id"),
    ):
        if bind.execute(sa.text(f'SELECT 1 FROM "{table}" WHERE "{column}" IS NULL LIMIT 1')).first():
            raise RuntimeError(
                f"Cannot restore {table}.{column} NOT NULL while ASN-first rows contain NULL; use a forward migration."
            )
    op.alter_column("vehicle_exit_approval", "po_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("damage_report", "po_number", existing_type=sa.String(length=64), nullable=False)
    op.alter_column("gate_entry", "po_document_path", existing_type=sa.String(length=256), nullable=False)
    op.alter_column("gate_entry", "po_number", existing_type=sa.String(length=64), nullable=False)
