"""Create canonical Assembly line and BOM master tables.

Revision ID: 20261006_assembly_schema
Revises: 20261006_asn_logistics
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20261006_assembly_schema"
down_revision: Union[str, None] = "20261006_asn_logistics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _require_compatible_table(table_name: str, required_columns: set[str]) -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name):
        return
    actual = {column["name"] for column in inspector.get_columns(table_name)}
    missing = sorted(required_columns - actual)
    if missing:
        raise RuntimeError(
            f"Existing table {table_name!r} is incompatible with the canonical Assembly schema; "
            f"missing columns: {', '.join(missing)}"
        )


def _has_unique_key(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if any(
        constraint.get("column_names") == [column_name]
        for constraint in inspector.get_unique_constraints(table_name)
    ):
        return True
    return any(
        index.get("unique") and index.get("column_names") == [column_name]
        for index in inspector.get_indexes(table_name)
    )


def _has_bom_item_fk() -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(
        fk.get("referred_table") == "bill_of_materials"
        and fk.get("constrained_columns") == ["bom_id"]
        and fk.get("referred_columns") == ["id"]
        for fk in inspector.get_foreign_keys("bill_of_materials_item")
    )


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    inspector = sa.inspect(op.get_bind())
    existing_names = {index.get("name") for index in inspector.get_indexes(table_name)}
    if index_name not in existing_names:
        op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("assembly_line"):
        op.create_table(
            "assembly_line",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("code", sa.String(64), nullable=False),
            sa.Column("name", sa.String(128), nullable=False),
            sa.Column("work_centre_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("code", name="uq_assembly_line_code"),
        )
    else:
        _require_compatible_table(
            "assembly_line",
            {"id", "code", "name", "work_centre_id", "status", "created_at", "updated_at"},
        )
        if not _has_unique_key("assembly_line", "code"):
            raise RuntimeError("Existing table 'assembly_line' is missing its unique code constraint")

    inspector = sa.inspect(bind)
    if not inspector.has_table("bill_of_materials"):
        op.create_table(
            "bill_of_materials",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("bom_number", sa.String(64), nullable=False),
            sa.Column("product_code", sa.String(64), nullable=True),
            sa.Column("product_name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
            sa.Column("created_by", sa.String(128), nullable=False, server_default="Assembly"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("bom_number", name="uq_bill_of_materials_bom_number"),
        )
    else:
        _require_compatible_table(
            "bill_of_materials",
            {"id", "bom_number", "product_code", "product_name", "description", "status", "created_by", "created_at", "updated_at"},
        )
        if not _has_unique_key("bill_of_materials", "bom_number"):
            raise RuntimeError("Existing table 'bill_of_materials' is missing its unique BOM-number constraint")

    inspector = sa.inspect(bind)
    if not inspector.has_table("bill_of_materials_item"):
        op.create_table(
            "bill_of_materials_item",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("bom_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_name", sa.String(255), nullable=False),
            sa.Column("variant_code", sa.String(128), nullable=True),
            sa.Column("quantity_per_unit", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False, server_default="PCS"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(
                ["bom_id"], ["bill_of_materials.id"],
                name="fk_bill_of_materials_item_bom_id",
                ondelete="CASCADE",
            ),
        )
    else:
        _require_compatible_table(
            "bill_of_materials_item",
            {"id", "bom_id", "material_id", "material_code", "material_name", "variant_code", "quantity_per_unit", "uom", "notes", "created_at"},
        )
        if not _has_bom_item_fk():
            raise RuntimeError("Existing table 'bill_of_materials_item' is missing its BOM foreign key")

    _create_index_if_missing("ix_assembly_line_code", "assembly_line", ["code"])
    _create_index_if_missing("ix_bill_of_materials_bom_number", "bill_of_materials", ["bom_number"])
    _create_index_if_missing("ix_bill_of_materials_product_code", "bill_of_materials", ["product_code"])
    _create_index_if_missing("ix_bill_of_materials_product_name", "bill_of_materials", ["product_name"])
    _create_index_if_missing("ix_bill_of_materials_item_bom_id", "bill_of_materials_item", ["bom_id"])
    _create_index_if_missing("ix_bill_of_materials_item_material_code", "bill_of_materials_item", ["material_code"])


def downgrade() -> None:
    # These tables are shared Assembly master data and may predate this
    # revision in an existing deployment. Do not drop them or their records.
    pass
