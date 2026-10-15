"""Align grn_batch_qr with the canonical QR model before indexing item_code."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261012_grn_batch_qr_schema"
down_revision: Union[str, None] = "20261012_dispatch_gate_exit_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("grn_batch_qr"):
        raise RuntimeError(
            "Cannot align grn_batch_qr: the expected table does not exist. "
            "The GRN workflow migration chain is incomplete."
        )

    columns = {column["name"] for column in inspector.get_columns("grn_batch_qr")}
    if "item_code" not in columns:
        bind.execute(sa.text("ALTER TABLE grn_batch_qr ADD COLUMN item_code VARCHAR(64)"))

    # Preserve existing QR identifiers and derive the material identity from
    # the existing batch -> GRN line relationship. Never invent a code.
    bind.execute(sa.text("""
        UPDATE grn_batch_qr qr
        SET item_code = gl.item_code
        FROM grn_batch gb
        JOIN grn_line gl ON gl.id = gb.grn_line_id
        WHERE qr.batch_id = gb.id
          AND qr.item_code IS NULL
    """))

    unresolved = bind.execute(sa.text(
        "SELECT count(*) FROM grn_batch_qr WHERE item_code IS NULL"
    )).scalar_one()
    if unresolved:
        raise RuntimeError(
            "Cannot safely populate grn_batch_qr.item_code for "
            f"{unresolved} existing row(s); no destructive or guessed backfill was performed."
        )

    bind.execute(sa.text(
        "ALTER TABLE grn_batch_qr ALTER COLUMN item_code SET NOT NULL"
    ))


def downgrade() -> None:
    # Do not remove a canonical identity column or existing data during
    # downgrade. The following index migration owns only its index.
    pass
