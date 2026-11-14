"""Serialize each finished-good unit and remove one-FG-per-order constraint."""

from alembic import op
import sqlalchemy as sa
import uuid


revision = "20261114_serialize_fg_units"
down_revision = "20261114_rack_capacity_uom"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "assembly_finished_goods" not in inspector.get_table_names():
        return

    indexes = {index["name"]: index for index in inspector.get_indexes("assembly_finished_goods")}
    order_index = indexes.get("ix_assembly_fg_order")
    if order_index and order_index.get("unique"):
        op.drop_index("ix_assembly_fg_order", table_name="assembly_finished_goods")
        op.create_index("ix_assembly_fg_order", "assembly_finished_goods", ["assembly_order_id"], unique=False)
    unique_constraints = {constraint["name"]: constraint for constraint in inspector.get_unique_constraints("assembly_finished_goods")}
    if "uq_assembly_finished_goods_assembly_order_id" in unique_constraints:
        op.drop_constraint("uq_assembly_finished_goods_assembly_order_id", "assembly_finished_goods", type_="unique")

    tables = set(inspector.get_table_names())
    if "finished_goods_section" not in tables:
        return
    metadata = sa.MetaData()
    fg = sa.Table("assembly_finished_goods", metadata, autoload_with=bind)
    section = sa.Table("finished_goods_section", metadata, autoload_with=bind)
    allocation = sa.Table("assembly_finished_goods_allocation", metadata, autoload_with=bind) if "assembly_finished_goods_allocation" in tables else None
    rows = bind.execute(sa.select(fg).where(fg.c.quantity > 1)).mappings().all()
    for row in rows:
        quantity = int(row["quantity"])
        if row["quantity"] != quantity:
            continue
        if allocation is not None and bind.execute(sa.select(sa.func.count()).select_from(allocation).where(
            allocation.c.finished_goods_id == row["id"]
        )).scalar_one():
            continue
        original_serial = row.get("serial_number") or f"SN-{row['id']}"
        original_qr = row.get("qr_code") or f"FG|ID:{row['id']}"
        bind.execute(fg.update().where(fg.c.id == row["id"]).values(
            quantity=1, on_hand_after=1,
            serial_number=f"{original_serial}-U0001",
            qr_code=f"{original_qr}|UNIT:1|QTY:1",
        ))
        existing_sections = bind.execute(sa.select(sa.func.count()).select_from(section).where(
            section.c.finished_goods_id == row["id"]
        )).scalar_one()
        if not existing_sections:
            original_token = uuid.uuid4().hex[:12].upper()
            bind.execute(section.insert(), [{
                "id": uuid.uuid4(), "finished_goods_id": row["id"], "section_number": number,
                "sub_id": f"FG-MIG-{original_token}-S{number:02d}",
                "qr_identity": f"FGSECTION|{row['id']}|S{number:02d}|{uuid.uuid4().hex}",
                "status": "AVAILABLE",
            } for number in range(1, 9)])
        for unit_number in range(2, quantity + 1):
            new_id = uuid.uuid4()
            token = uuid.uuid4().hex[:12].upper()
            values = {column.name: row[column.name] for column in fg.columns if column.name in row}
            values.update({
                "id": new_id, "quantity": 1, "on_hand_before": 0, "on_hand_after": 1,
                "section_main_id": f"FG-MIG-{token}",
                "serial_number": f"{original_serial}-U{unit_number:04d}",
                "batch_number": f"{row.get('batch_number') or 'FG-MIG'}-U{unit_number:04d}-{token[:4]}",
                "qr_code": f"{original_qr}|UNIT:{unit_number}|QTY:1|TOKEN:{token}",
            })
            bind.execute(fg.insert().values(**values))
            bind.execute(section.insert(), [{
                "id": uuid.uuid4(), "finished_goods_id": new_id, "section_number": number,
                "sub_id": f"FG-MIG-{token}-S{number:02d}",
                "qr_identity": f"FGSECTION|{new_id}|S{number:02d}|{uuid.uuid4().hex}",
                "status": "AVAILABLE",
            } for number in range(1, 9)])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "assembly_finished_goods" not in inspector.get_table_names():
        return
    duplicate_orders = bind.execute(sa.text("""
        SELECT assembly_order_id FROM assembly_finished_goods
        GROUP BY assembly_order_id HAVING COUNT(*) > 1 LIMIT 1
    """)).first()
    if duplicate_orders:
        raise RuntimeError("Cannot restore one-finished-good-per-order constraint after unit serialization")
    indexes = {index["name"]: index for index in inspector.get_indexes("assembly_finished_goods")}
    if "ix_assembly_fg_order" in indexes:
        op.drop_index("ix_assembly_fg_order", table_name="assembly_finished_goods")
    op.create_index("ix_assembly_fg_order", "assembly_finished_goods", ["assembly_order_id"], unique=True)
