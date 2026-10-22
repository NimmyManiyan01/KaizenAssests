"""Record authenticated QC inspector identity and authorization confirmation."""
from alembic import context, op
import sqlalchemy as sa

revision = "20261016_qc_inspector_audit"
down_revision = "3d6bfaf67660"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Local SQLite startup may already have added these two columns.
    columns = set() if context.is_offline_mode() else {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("assembly_quality_inspection")
    }
    if "inspected_by_user_id" not in columns:
        op.add_column("assembly_quality_inspection", sa.Column("inspected_by_user_id", sa.String(255), nullable=True))
    if "authorized_person_confirmed" not in columns:
        op.add_column("assembly_quality_inspection", sa.Column("authorized_person_confirmed", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    op.drop_column("assembly_quality_inspection", "authorized_person_confirmed")
    op.drop_column("assembly_quality_inspection", "inspected_by_user_id")
