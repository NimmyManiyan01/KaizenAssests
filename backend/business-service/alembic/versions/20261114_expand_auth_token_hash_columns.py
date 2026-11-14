"""Allow persisted multi-session token hashes.

Revision ID: 20261114_expand_auth_hashes
Revises: 20261114_user_warehouse_ref
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_expand_auth_hashes"
down_revision = "20261114_user_warehouse_ref"
branch_labels = None
depends_on = None


def _alter_if_present(table_name: str, existing_type: sa.types.TypeEngine) -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name):
        return
    columns = {column["name"] for column in inspector.get_columns(table_name)}
    if "auth_token_hash" in columns:
        op.alter_column(
            table_name,
            "auth_token_hash",
            existing_type=existing_type,
            type_=sa.Text(),
            existing_nullable=True,
        )


def upgrade() -> None:
    _alter_if_present("user_account", sa.String(length=128))
    _alter_if_present("supplier_user", sa.String(length=64))


def downgrade() -> None:
    # Keep downgrade safe for existing multi-session values by retaining TEXT.
    pass
