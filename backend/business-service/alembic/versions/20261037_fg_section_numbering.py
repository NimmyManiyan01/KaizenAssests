"""Concurrency-safe FG transport label numbers; original FG identity is untouched."""
from alembic import op
import sqlalchemy as sa

revision = "20261037_fg_section_numbering"
down_revision = "20261036_fg_transport_sections"
branch_labels = None
depends_on = None


def upgrade():
    sa.Sequence("fg_transport_main_number").create(op.get_bind(), checkfirst=True)


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM finished_goods_section")):
        raise RuntimeError("Cannot remove numbering while section labels exist")
    op.execute(sa.schema.DropSequence(sa.Sequence("fg_transport_main_number")))
