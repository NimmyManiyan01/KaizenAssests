"""Add transport sections without changing historical FG identities or data."""
from alembic import op
import sqlalchemy as sa
from app.database.base import GUID

revision = "20261036_fg_transport_sections"
down_revision = "20261035_putaway_batch_uniqueness"
branch_labels = None
depends_on = None


def upgrade():
    # Application create_all may have created the new table while leaving
    # existing tables unchanged. Also support a partially prepared schema.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("assembly_finished_goods")}
    for name, length in (("section_supplier_id", 64), ("section_main_id", 128)):
        if name not in columns:
            op.add_column("assembly_finished_goods", sa.Column(name, sa.String(length)))
    if not any(c["column_names"] == ["section_main_id"] for c in inspector.get_unique_constraints("assembly_finished_goods")):
        op.create_unique_constraint("uq_fg_section_main_id", "assembly_finished_goods", ["section_main_id"])
    request_columns = {c["name"] for c in inspector.get_columns("finished_goods_request")}
    if "section_fg_id" not in request_columns:
        op.add_column("finished_goods_request", sa.Column("section_fg_id", GUID()))
    if not any(c["constrained_columns"] == ["section_fg_id"] for c in inspector.get_foreign_keys("finished_goods_request")):
        op.create_foreign_key("fk_fg_pickup_section_fg", "finished_goods_request", "assembly_finished_goods", ["section_fg_id"], ["id"], ondelete="RESTRICT")
    from app.modules.assembly.infrastructure.persistence.models import FinishedGoodsSectionModel
    FinishedGoodsSectionModel.__table__.create(bind, checkfirst=True)


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM finished_goods_section")):
        raise RuntimeError("Cannot drop section dispatch history")
    op.drop_table("finished_goods_section")
    op.drop_column("finished_goods_request", "section_fg_id")
    op.drop_constraint("uq_fg_section_main_id", "assembly_finished_goods", type_="unique")
    op.drop_column("assembly_finished_goods", "section_main_id")
    op.drop_column("assembly_finished_goods", "section_supplier_id")
