"""Reconcile the Supplier ORM contract with the legacy production table.

Preserves category values while converting legacy text to JSON arrays.
Adds only nullable profile fields; creates no users or business records.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261106_supplier_profile_fields"
down_revision: Union[str, None] = "20261106_ensure_notification_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROFILE_COLUMNS = (
    ("payment_terms", sa.String(128)),
    ("credit_period_days", sa.Integer()),
    ("updated_by", sa.String(64)),
)

def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("supplier"):
        raise RuntimeError("supplier table is missing; apply the base supplier migrations first")
    columns = {c["name"]: c for c in inspector.get_columns("supplier")}
    for name, column_type in PROFILE_COLUMNS:
        if name not in columns:
            op.add_column("supplier", sa.Column(name, column_type, nullable=True))
        elif not isinstance(columns[name]["type"], type(column_type)):
            raise RuntimeError("supplier." + name + " has an incompatible existing type")
    category = columns.get("category")
    if category is None:
        raise RuntimeError("supplier.category is missing; refusing to invent existing supplier categories")
    if not isinstance(category["type"], sa.JSON):
        if bind.dialect.name != "postgresql" or not isinstance(category["type"], sa.String):
            raise RuntimeError("supplier.category needs an explicit migration for its current type")
        # Temporary function lives only for this database session. It handles
        # plain labels, JSON arrays, blank values and malformed legacy JSON.
        bind.exec_driver_sql("""
            CREATE OR REPLACE FUNCTION pg_temp.supplier_category_to_json(value text)
            RETURNS json LANGUAGE plpgsql IMMUTABLE AS $$
            DECLARE parsed json;
            BEGIN
                IF value IS NULL THEN RETURN NULL; END IF;
                IF btrim(value) = '' THEN RETURN '[]'::json; END IF;
                BEGIN
                    parsed := value::json;
                    IF json_typeof(parsed) = 'array' THEN RETURN parsed; END IF;
                EXCEPTION WHEN invalid_text_representation THEN
                    NULL;
                END;
                RETURN json_build_array(value);
            END;
            $$
        """)
        op.alter_column(
            "supplier", "category", existing_type=category["type"],
            type_=sa.JSON(), nullable=True,
            postgresql_using="pg_temp.supplier_category_to_json(category)",
        )
    elif not category["nullable"]:
        op.alter_column("supplier", "category", existing_type=category["type"], nullable=True)

def downgrade() -> None:
    raise RuntimeError(
        "This data-preserving supplier reconciliation is forward-only. "
        "Dropping profile fields or flattening category arrays would discard data."
    )
