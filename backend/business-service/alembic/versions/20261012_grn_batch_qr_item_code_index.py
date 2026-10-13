"""Allow multiple batch QRs for the same material code."""

from alembic import op
import sqlalchemy as sa

revision = "20261012_grn_batch_qr_item_code_index"
down_revision = "20261012_grn_batch_qr_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Older deployments created the unique constraint/index with either name.
    bind.execute(sa.text(
        "ALTER TABLE grn_batch_qr DROP CONSTRAINT IF EXISTS ix_grn_batch_qr_item_code"
    ))
    bind.execute(sa.text("DROP INDEX IF EXISTS uq_grn_batch_qr_item_code"))
    bind.execute(sa.text("DROP INDEX IF EXISTS ix_grn_batch_qr_item_code"))
    bind.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_grn_batch_qr_item_code "
        "ON grn_batch_qr (item_code)"
    ))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DROP INDEX IF EXISTS ix_grn_batch_qr_item_code"))
    bind.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_grn_batch_qr_item_code "
        "ON grn_batch_qr (item_code)"
    ))
