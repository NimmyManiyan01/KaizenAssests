"""Store the seeded system administrator with the canonical ADMIN role.

Revision ID: 20261114_system_admin_role
Revises: 20261114_expand_auth_hashes
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_system_admin_role"
down_revision = "20261114_expand_auth_hashes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_account"):
        return

    op.execute(
        sa.text(
            """
            UPDATE user_account
               SET role = 'ADMIN'
             WHERE upper(role) = 'SUPER_ADMIN'
               AND (employee_id = 'EMP-ADMIN-001' OR lower(username) = 'admin')
            """
        )
    )


def downgrade() -> None:
    pass
