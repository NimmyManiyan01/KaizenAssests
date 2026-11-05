"""Add persisted login lockout and session-expiry fields.

Revision ID: 20261101_harden_auth
Revises: 20261028_system_audit, 20261037_fg_section_numbering
"""

from alembic import op
import sqlalchemy as sa


revision = "20261101_harden_auth"
down_revision = ("20261028_system_audit", "20261037_fg_section_numbering")
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    tables = sa.inspect(conn).get_table_names()
    if "store" in tables:
        from app.database.single_warehouse_migration import migrate
        migrate(conn)
        from app.modules.storage.application.rack_capacity import install_rack_capacity
        install_rack_capacity(conn)
    columns = {column["name"] for column in sa.inspect(conn).get_columns("user_account")}
    if "auth_token_expires_at" not in columns:
        op.add_column("user_account", sa.Column("auth_token_expires_at", sa.DateTime(timezone=True)))
    if "failed_login_attempts" not in columns:
        op.add_column(
            "user_account",
            sa.Column("failed_login_attempts", sa.Integer(), server_default="0", nullable=False),
        )
    if "locked_until" not in columns:
        op.add_column("user_account", sa.Column("locked_until", sa.DateTime(timezone=True)))

def downgrade() -> None:
    op.drop_column("user_account", "locked_until")
    op.drop_column("user_account", "failed_login_attempts")
    op.drop_column("user_account", "auth_token_expires_at")
