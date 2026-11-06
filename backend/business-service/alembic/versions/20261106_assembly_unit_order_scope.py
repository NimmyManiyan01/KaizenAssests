"""Scope assembly orders to the assigned assembly unit."""

from alembic import op
import sqlalchemy as sa


revision = "20261106_assembly_unit_order_scope"
down_revision = "20261106_supplier_profile_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_order" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("assembly_order")}
    if "assembly_unit_code" not in columns:
        op.add_column("assembly_order", sa.Column("assembly_unit_code", sa.String(length=64), nullable=True))
    indexes = {index["name"] for index in inspector.get_indexes("assembly_order")}
    if "ix_assembly_order_assembly_unit_code" not in indexes:
        op.create_index("ix_assembly_order_assembly_unit_code", "assembly_order", ["assembly_unit_code"])

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "user_account" in tables:
        op.execute(sa.text("""
            UPDATE assembly_order
               SET assembly_unit_code = (
                   SELECT user_account.assembly_unit_code
                     FROM user_account
                    WHERE upper(replace(user_account.role, ' ', '_')) IN ('ASSEMBLY_MANAGER', 'ASSEMBLY')
                      AND user_account.assembly_unit_code IS NOT NULL
                      AND trim(user_account.assembly_unit_code) <> ''
                      AND (
                          lower(user_account.username) = lower(assembly_order.created_by)
                          OR lower(user_account.employee_id) = lower(assembly_order.created_by)
                          OR lower(user_account.full_name) = lower(assembly_order.created_by)
                      )
                    ORDER BY user_account.created_at DESC
                    LIMIT 1
               )
             WHERE assembly_order.assembly_unit_code IS NULL
        """))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_order" not in inspector.get_table_names():
        return
    if "ix_assembly_order_assembly_unit_code" in {index["name"] for index in inspector.get_indexes("assembly_order")}:
        op.drop_index("ix_assembly_order_assembly_unit_code", table_name="assembly_order")
    if "assembly_unit_code" in {column["name"] for column in inspector.get_columns("assembly_order")}:
        op.drop_column("assembly_order", "assembly_unit_code")
