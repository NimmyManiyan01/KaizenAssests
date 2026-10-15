"""Persist warehouse-approved quantity per assembly material request line."""
from alembic import op
import sqlalchemy as sa

revision = "0013_add_approved_quantity_to_material_request_items"
down_revision = "0012_fix_putaway_location_assignment_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "material_request_item" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("material_request_item")}
        if "approved_quantity" not in columns:
            op.add_column("material_request_item", sa.Column("approved_quantity", sa.Numeric(18, 4), nullable=False, server_default="0"))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "material_request_item" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("material_request_item")}
        if "approved_quantity" in columns:
            op.drop_column("material_request_item", "approved_quantity")
