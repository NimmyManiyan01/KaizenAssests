"""Align pre-existing Assembly receipt IDs with UUID parent keys."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0014_fix_assembly_material_receipt_types"
down_revision: Union[str, None] = "0014_add_assembly_material_receipts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_uuid_column(column_name: str) -> bool:
    return bool(op.get_bind().execute(sa.text("""
        SELECT data_type = 'uuid'
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'assembly_material_receipt'
          AND column_name = :column_name
    """), {"column_name": column_name}).scalar())


def _validate_uuid_values(column_name: str) -> None:
    invalid = op.get_bind().execute(sa.text(f"""
        SELECT count(*) FROM assembly_material_receipt
        WHERE {column_name} IS NULL
           OR {column_name} !~* '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$'
    """)).scalar_one()
    if invalid:
        raise RuntimeError(
            f"Cannot safely convert assembly_material_receipt.{column_name}: "
            f"{invalid} value(s) are not valid UUIDs"
        )


def _validate_parent_references(column_name: str, parent_table: str) -> None:
    missing = op.get_bind().execute(sa.text(f"""
        SELECT count(*)
        FROM assembly_material_receipt r
        LEFT JOIN {parent_table} p ON p.id = r.{column_name}::uuid
        WHERE p.id IS NULL
    """)).scalar_one()
    if missing:
        raise RuntimeError(
            f"Cannot safely convert assembly_material_receipt.{column_name}: "
            f"{missing} value(s) do not reference an existing {parent_table}.id"
        )


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("assembly_material_receipt"):
        return

    for column_name, parent_table in (
        ("id", None),
        ("assembly_order_id", "assembly_order"),
        ("material_issue_id", "material_issue"),
    ):
        if _is_uuid_column(column_name):
            continue
        _validate_uuid_values(column_name)
        if parent_table:
            _validate_parent_references(column_name, parent_table)
        op.get_bind().execute(sa.text(
            f"ALTER TABLE assembly_material_receipt ALTER COLUMN {column_name} "
            f"TYPE UUID USING {column_name}::uuid"
        ))


def downgrade() -> None:
    # Do not weaken UUID relationships or rewrite existing receipt IDs.
    pass
