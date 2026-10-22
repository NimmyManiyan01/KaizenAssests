"""Persist shared rack capacity and enforce occupancy at inventory writes."""
from alembic import op
revision = "20261021_rack_capacity"
down_revision = "20261016_zone_bin_codes"
branch_labels = None
depends_on = None

def upgrade():
    from app.modules.storage.application.rack_capacity import install_rack_capacity
    install_rack_capacity(op.get_bind())

def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.exec_driver_sql("DROP TRIGGER IF EXISTS rack_balance_change ON inventory_location_balance")
        bind.exec_driver_sql("DROP FUNCTION IF EXISTS maintain_rack_occupancy()")
    else:
        for event in ("insert", "update", "delete"):
            bind.exec_driver_sql("DROP TRIGGER IF EXISTS rack_balance_" + event)
    op.drop_table("rack_occupancy_event")
    op.drop_table("store_rack")
