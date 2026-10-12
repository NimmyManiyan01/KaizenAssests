"""Persist outbound gate-exit verification audit details."""

from alembic import op
import sqlalchemy as sa

revision = "20261012_dispatch_gate_exit_audit"
down_revision = "20261012_dock_direction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("dispatch_order")}
    additions = [
        ("gate_exit_vehicle_verified", sa.Boolean(), False),
        ("gate_exit_driver_verified", sa.Boolean(), False),
        ("gate_exit_loaded_goods_verified", sa.Boolean(), False),
        ("gate_exit_security_officer", sa.String(128), None),
        ("gate_exit_remarks", sa.Text(), None),
        ("gate_exit_completed_at", sa.DateTime(timezone=True), None),
    ]
    for name, column_type, default in additions:
        if name not in columns:
            kwargs = {"nullable": False, "server_default": sa.false()} if default is False else {"nullable": True}
            op.add_column("dispatch_order", sa.Column(name, column_type, **kwargs))
            if default is False:
                op.alter_column("dispatch_order", name, server_default=None)


def downgrade() -> None:
    for name in ("gate_exit_completed_at", "gate_exit_remarks", "gate_exit_security_officer", "gate_exit_loaded_goods_verified", "gate_exit_driver_verified", "gate_exit_vehicle_verified"):
        op.drop_column("dispatch_order", name)
