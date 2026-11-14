"""Add finalization, revision, and dispatch lifecycle to ASNs.

Revision ID: 20261114_asn_revision_lifecycle
Revises: 20261114_supplier_material_scope
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_asn_revision_lifecycle"
down_revision = "20261114_supplier_material_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("asn"):
        return
    columns = {column["name"] for column in inspector.get_columns("asn")}
    additions = (
        ("root_asn_id", sa.UUID()),
        ("revision_number", sa.Integer()),
        ("revision_reason", sa.String(length=500)),
        ("finalized_at", sa.DateTime()),
        ("superseded_at", sa.DateTime()),
        ("dispatched_at", sa.DateTime()),
    )
    for name, column_type in additions:
        if name not in columns:
            if name == "revision_number":
                op.add_column("asn", sa.Column(name, column_type, nullable=False, server_default="0"))
            else:
                op.add_column("asn", sa.Column(name, column_type, nullable=True))
    foreign_keys = {fk.get("name") for fk in inspector.get_foreign_keys("asn")}
    if "fk_asn_root_asn_id" not in foreign_keys:
        op.create_foreign_key("fk_asn_root_asn_id", "asn", "asn", ["root_asn_id"], ["id"], ondelete="RESTRICT")
    indexes = {index["name"] for index in inspector.get_indexes("asn")}
    if "ix_asn_root_asn_id" not in indexes:
        op.create_index("ix_asn_root_asn_id", "asn", ["root_asn_id"])


def downgrade() -> None:
    pass
