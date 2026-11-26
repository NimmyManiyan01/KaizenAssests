"""Persist rejected package sub-materials on GRN lines."""

import sqlalchemy as sa
from alembic import op

revision = "20261126_grn_package_checklist"
down_revision = "20261125_material_sub_materials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("grn_line", sa.Column("rejected_sub_materials", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("grn_line", "rejected_sub_materials")
