"""Add ASN invoice and challan document fields required by the current ORM."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20261016_asn_document_fields"
down_revision: str | None = "3d6bfaf67660"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("asn")}
    definitions = {
        "invoice_number": sa.Column("invoice_number", sa.String(128), nullable=True),
        "invoice_date": sa.Column("invoice_date", sa.Date(), nullable=True),
        "challan_number": sa.Column("challan_number", sa.String(128), nullable=True),
        "challan_date": sa.Column("challan_date", sa.Date(), nullable=True),
    }
    for name, column in definitions.items():
        if name not in columns:
            op.add_column("asn", column)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("asn")}
    for name in ("challan_date", "challan_number", "invoice_date", "invoice_number"):
        if name in columns:
            op.drop_column("asn", name)
