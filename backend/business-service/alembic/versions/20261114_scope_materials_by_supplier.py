"""Backfill supplier ownership for supplier-created materials.

Revision ID: 20261114_supplier_material_scope
Revises: 20261114_system_admin_role
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_supplier_material_scope"
down_revision = "20261114_system_admin_role"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if not {"material", "supplier_user", "supplier_material_link"}.issubset(tables):
        return

    op.execute(
        sa.text(
            """
            INSERT INTO supplier_material_link (supplier_id, material_id)
            SELECT supplier_user.supplier_id, material.id
              FROM material
              JOIN supplier_user
                ON lower(supplier_user.username) = lower(material.created_by)
             WHERE material.created_by IS NOT NULL
            ON CONFLICT (supplier_id, material_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    pass
