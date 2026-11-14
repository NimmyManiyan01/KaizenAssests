"""Normalize migrated finished-good parent and section codes."""

from alembic import op
import sqlalchemy as sa


revision = "20261114_normalize_fg_codes"
down_revision = "20261114_serialize_fg_units"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if not {"assembly_finished_goods", "finished_goods_section"}.issubset(tables):
        return

    metadata = sa.MetaData()
    fg = sa.Table("assembly_finished_goods", metadata, autoload_with=bind)
    section = sa.Table("finished_goods_section", metadata, autoload_with=bind)
    migrated = bind.execute(
        sa.select(fg.c.id, fg.c.section_main_id)
        .where(fg.c.section_main_id.like("FG-MIG-%"))
        .order_by(fg.c.posted_at, fg.c.id)
    ).all()
    if not migrated:
        return

    existing_codes = bind.execute(sa.select(fg.c.section_main_id).where(
        fg.c.section_main_id.like("FG-%"),
        ~fg.c.section_main_id.like("FG-MIG-%"),
    )).scalars().all()
    used_numbers = {
        int(code[3:]) for code in existing_codes
        if code and code.startswith("FG-") and code[3:].isdigit()
    }
    next_number = max(used_numbers, default=0) + 1

    for fg_id, _old_code in migrated:
        while next_number in used_numbers:
            next_number += 1
        new_code = f"FG-{next_number:04d}"
        bind.execute(fg.update().where(fg.c.id == fg_id).values(section_main_id=new_code))
        rows = bind.execute(sa.select(section.c.id, section.c.section_number).where(
            section.c.finished_goods_id == fg_id
        )).all()
        for section_id, section_number in rows:
            bind.execute(section.update().where(section.c.id == section_id).values(
                sub_id=f"{new_code}-S{section_number:02d}"
            ))
        used_numbers.add(next_number)
        next_number += 1

    if bind.dialect.name == "postgresql" and "fg_transport_main_number" in inspector.get_sequence_names():
        bind.execute(sa.text(
            "SELECT setval('fg_transport_main_number', :value, true)"
        ), {"value": max(used_numbers)})


def downgrade() -> None:
    # Sequential labels are permanent physical identities and must not be
    # rewritten back to temporary migration codes.
    pass
