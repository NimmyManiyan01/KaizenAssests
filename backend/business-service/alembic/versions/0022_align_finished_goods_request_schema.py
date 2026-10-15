"""Align finished_goods_request with the current ORM model."""

from alembic import op
import sqlalchemy as sa


revision = "0022_align_finished_goods_request_schema"
down_revision = "0021_merge_workflow_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "finished_goods_request" not in tables:
        return

    existing = {column["name"] for column in inspector.get_columns("finished_goods_request")}
    additions = [
        ("material_code", sa.String(64)),
        ("material_name", sa.String(256)),
        ("variant_code", sa.String(128)),
        ("warehouse", sa.String(128)),
        ("department", sa.String(128)),
        ("priority", sa.String(32)),
        ("requested_date", sa.Date()),
        ("work_order_id", sa.UUID()),
        ("work_order_number", sa.String(64)),
        ("completed_quantity", sa.Numeric(18, 4)),
        ("updated_at", sa.DateTime()),
        ("supplier_id", sa.String(64)),
        ("supplier_name", sa.String(255)),
        ("vehicle_number", sa.String(64)),
        ("driver_name", sa.String(128)),
        ("driver_contact", sa.String(32)),
        ("expected_pickup_date", sa.Date()),
    ]
    for name, column_type in additions:
        if name not in existing:
            op.add_column("finished_goods_request", sa.Column(name, column_type, nullable=True))

    # Backfill the renamed legacy fields where they exist.
    if "finished_goods_code" in existing:
        op.execute(sa.text("UPDATE finished_goods_request SET material_code = finished_goods_code WHERE material_code IS NULL"))
    if "finished_goods_name" in existing:
        op.execute(sa.text("UPDATE finished_goods_request SET material_name = finished_goods_name WHERE material_name IS NULL"))
    if "warehouse_id" in existing:
        op.execute(sa.text("UPDATE finished_goods_request SET warehouse = warehouse_id WHERE warehouse IS NULL"))
    op.execute(sa.text("UPDATE finished_goods_request SET requested_date = required_date WHERE requested_date IS NULL"))
    op.execute(sa.text("UPDATE finished_goods_request SET updated_at = created_at WHERE updated_at IS NULL"))
    op.execute(sa.text("UPDATE finished_goods_request SET department = 'ASSEMBLY' WHERE department IS NULL"))
    op.execute(sa.text("UPDATE finished_goods_request SET priority = 'MEDIUM' WHERE priority IS NULL"))
    op.execute(sa.text("UPDATE finished_goods_request SET completed_quantity = 0 WHERE completed_quantity IS NULL"))


def downgrade() -> None:
    # Keep this migration non-destructive so existing request data is preserved.
    pass
