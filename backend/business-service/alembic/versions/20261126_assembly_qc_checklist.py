"""Store the assembly QC checklist and its camera evidence."""

import sqlalchemy as sa
from alembic import op

revision = "20261126_assembly_qc_checklist"
down_revision = "20261126_numeric_zone_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assembly_quality_inspection", sa.Column("checklist", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("assembly_quality_inspection", "checklist")
