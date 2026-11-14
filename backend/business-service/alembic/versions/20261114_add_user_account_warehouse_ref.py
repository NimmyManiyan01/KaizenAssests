"""Add the warehouse reference expected by the user-account ORM model.

Revision ID: 20261114_user_warehouse_ref
Revises: 20261110_fix_putaway_task_and_rack_occupancy
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_user_warehouse_ref"
down_revision = "20261110_fix_putaway_task_and_rack_occupancy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_account"):
        return

    columns = {column["name"] for column in inspector.get_columns("user_account")}
    if "warehouse_ref_id" not in columns:
        op.add_column("user_account", sa.Column("warehouse_ref_id", sa.UUID(), nullable=True))
        op.create_foreign_key(
            "fk_user_account_warehouse_ref_id",
            "user_account",
            "warehouse_configuration",
            ["warehouse_ref_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        op.create_index(
            "ix_user_account_warehouse_ref_id",
            "user_account",
            ["warehouse_ref_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_account"):
        return

    columns = {column["name"] for column in inspector.get_columns("user_account")}
    if "warehouse_ref_id" in columns:
        op.drop_index("ix_user_account_warehouse_ref_id", table_name="user_account")
        op.drop_constraint("fk_user_account_warehouse_ref_id", "user_account", type_="foreignkey")
        op.drop_column("user_account", "warehouse_ref_id")
