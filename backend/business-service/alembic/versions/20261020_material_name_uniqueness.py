"""Enforce normalized global material-name uniqueness.

Revision ID: 20261020_material_name_uniqueness
Revises: 20261016_asn_document_fields
"""

from alembic import op
import sqlalchemy as sa


revision = "20261020_material_name_uniqueness"
down_revision = "20261016_asn_document_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_material_normalized_name",
        "material",
        [sa.text("lower(btrim(material_name))")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_material_normalized_name", table_name="material")
