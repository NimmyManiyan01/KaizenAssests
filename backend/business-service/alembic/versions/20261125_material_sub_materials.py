"""Store package sub-material names on the material master."""

import sqlalchemy as sa
from alembic import op

revision = "20261125_material_sub_materials"
down_revision = "20261114_normalize_fg_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("material", sa.Column("sub_materials", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("material", "sub_materials")
