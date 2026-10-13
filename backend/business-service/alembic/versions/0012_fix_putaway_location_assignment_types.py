"""Align pre-existing putaway location assignment IDs with UUID parents."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012_fix_putaway_location_assignment_types"
down_revision: Union[str, None] = "0012_add_putaway_location_assignments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ID_COLUMNS = {
    "id": False,
    "putaway_task_id": False,
    "destination_store_id": True,
    "destination_zone_id": True,
    "destination_bin_id": True,
}


def _column_is_uuid(table_name: str, column_name: str) -> bool:
    result = op.get_bind().execute(sa.text("""
        SELECT data_type = 'uuid'
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = :table_name
          AND column_name = :column_name
    """), {"table_name": table_name, "column_name": column_name}).scalar()
    return bool(result)


def _ensure_values_convertible(column_name: str, nullable: bool) -> None:
    bind = op.get_bind()
    invalid = bind.execute(sa.text(f"""
        SELECT count(*)
        FROM putaway_location_assignment
        WHERE {column_name} IS NOT NULL
          AND ({column_name} !~* '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$')
    """)).scalar_one()
    if invalid:
        raise RuntimeError(
            f"Cannot safely convert putaway_location_assignment.{column_name}: "
            f"{invalid} value(s) are not UUIDs"
        )


def _ensure_references_exist(column_name: str, parent_table: str) -> None:
    missing = op.get_bind().execute(sa.text(f"""
        SELECT count(*)
        FROM putaway_location_assignment a
        LEFT JOIN {parent_table} p ON p.id = a.{column_name}::uuid
        WHERE a.{column_name} IS NOT NULL AND p.id IS NULL
    """)).scalar_one()
    if missing:
        raise RuntimeError(
            f"Cannot safely convert putaway_location_assignment.{column_name}: "
            f"{missing} value(s) do not reference an existing {parent_table}.id"
        )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("putaway_location_assignment"):
        return

    # Fresh installations already use UUID columns from 0012. Existing
    # installations created by the old revision are converted only after
    # validating every value and parent reference.
    for column_name, nullable in ID_COLUMNS.items():
        if _column_is_uuid("putaway_location_assignment", column_name):
            continue
        _ensure_values_convertible(column_name, nullable)
        if column_name == "putaway_task_id":
            _ensure_references_exist(column_name, "putaway_task")
        elif column_name == "destination_store_id":
            _ensure_references_exist(column_name, "store")
        elif column_name == "destination_zone_id":
            _ensure_references_exist(column_name, "store_zone")
        elif column_name == "destination_bin_id":
            _ensure_references_exist(column_name, "store_bin")
        bind.execute(sa.text(
            f"ALTER TABLE putaway_location_assignment ALTER COLUMN {column_name} "
            f"TYPE UUID USING {column_name}::uuid"
        ))


def downgrade() -> None:
    # Do not convert UUID identifiers back to strings or weaken referential
    # integrity during downgrade.
    pass
