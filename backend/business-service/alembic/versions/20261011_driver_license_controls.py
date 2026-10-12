"""Add driver license expiry and verification controls."""
from alembic import op
import sqlalchemy as sa

revision = "20261011_driver_license_controls"
down_revision = "20261011_dispatch_package_fields"
branch_labels = None
depends_on = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("driver")}
    if "license_expiry_date" not in columns:
        op.add_column("driver", sa.Column("license_expiry_date", sa.DateTime(), nullable=True))
    if "license_verified" not in columns:
        op.add_column("driver", sa.Column("license_verified", sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade() -> None:
    op.drop_column("driver", "license_verified")
    op.drop_column("driver", "license_expiry_date")
