"""Carry assembly unit ownership through finished-goods dispatch and gate exit."""

from alembic import op
import sqlalchemy as sa


revision = "20261106_assembly_lifecycle_unit"
down_revision = "20261106_assembly_unit_order_scope"
branch_labels = None
depends_on = None


def _add_column(table: str, name: str) -> None:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns(table)}
    if name not in columns:
        op.add_column(table, sa.Column(name, sa.String(length=64), nullable=True))
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}
    index_name = f"ix_{table}_{name}"
    if index_name not in indexes:
        op.create_index(index_name, table, [name])


def upgrade() -> None:
    _add_column("material_request", "assembly_unit_code")
    _add_column("finished_goods_request", "assembly_unit_code")
    _add_column("dispatch_order", "assembly_unit_code")
    _add_column("finished_goods_pickup_gate_visit", "assembly_unit_code")

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if {"material_request", "assembly_order"}.issubset(tables):
        op.execute(sa.text("""
            UPDATE material_request AS request
               SET assembly_unit_code = (
                   SELECT assembly_order.assembly_unit_code FROM assembly_order
                    WHERE assembly_order.material_request_id = request.id
                      AND assembly_order.assembly_unit_code IS NOT NULL
                    LIMIT 1
               )
             WHERE request.assembly_unit_code IS NULL
               AND EXISTS (
                   SELECT 1 FROM assembly_order
                    WHERE assembly_order.material_request_id = request.id
               )
        """))
    if {"finished_goods_request", "assembly_finished_goods", "assembly_order"}.issubset(tables):
        op.execute(sa.text("""
            UPDATE finished_goods_request AS request
               SET assembly_unit_code = (
                   SELECT assembly_order.assembly_unit_code
                     FROM assembly_finished_goods
                     JOIN assembly_order ON assembly_order.id = assembly_finished_goods.assembly_order_id
                    WHERE assembly_finished_goods.id = request.section_fg_id
               )
             WHERE request.assembly_unit_code IS NULL
               AND request.section_fg_id IS NOT NULL
        """))
    if {"finished_goods_request", "assembly_finished_goods_allocation", "assembly_finished_goods", "assembly_order"}.issubset(tables):
        op.execute(sa.text("""
            UPDATE finished_goods_request AS request
               SET assembly_unit_code = (
                   SELECT assembly_order.assembly_unit_code
                     FROM assembly_finished_goods_allocation
                     JOIN assembly_finished_goods ON assembly_finished_goods.id = assembly_finished_goods_allocation.finished_goods_id
                     JOIN assembly_order ON assembly_order.id = assembly_finished_goods.assembly_order_id
                    WHERE assembly_finished_goods_allocation.finished_goods_request_id = request.id
                      AND assembly_order.assembly_unit_code IS NOT NULL
                    ORDER BY assembly_finished_goods.posted_at, assembly_finished_goods.id
                    LIMIT 1
               )
             WHERE request.assembly_unit_code IS NULL
               AND EXISTS (
                   SELECT 1 FROM assembly_finished_goods_allocation
                    WHERE assembly_finished_goods_allocation.finished_goods_request_id = request.id
               )
        """))
    if {"dispatch_order", "finished_goods_request"}.issubset(tables):
        op.execute(sa.text("""
            UPDATE dispatch_order AS dispatch
               SET assembly_unit_code = (
                   SELECT request.assembly_unit_code FROM finished_goods_request AS request
                    WHERE request.request_number = dispatch.order_number
               )
             WHERE dispatch.assembly_unit_code IS NULL
        """))
    if {"finished_goods_pickup_gate_visit", "finished_goods_request"}.issubset(tables):
        op.execute(sa.text("""
            UPDATE finished_goods_pickup_gate_visit AS visit
               SET assembly_unit_code = (
                   SELECT request.assembly_unit_code FROM finished_goods_request AS request
                    WHERE request.id = visit.request_id
               )
             WHERE visit.assembly_unit_code IS NULL
        """))


def downgrade() -> None:
    for table in ("finished_goods_pickup_gate_visit", "dispatch_order", "finished_goods_request", "material_request"):
        inspector = sa.inspect(op.get_bind())
        if table not in inspector.get_table_names():
            continue
        index_name = f"ix_{table}_assembly_unit_code"
        if index_name in {index["name"] for index in inspector.get_indexes(table)}:
            op.drop_index(index_name, table_name=table)
        if "assembly_unit_code" in {column["name"] for column in inspector.get_columns(table)}:
            op.drop_column(table, "assembly_unit_code")
