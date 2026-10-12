"""Merge the existing dock branch with the pickup audit branch."""

revision = "20261011_merge_heads"
down_revision = ("20261009_dock_assignment_po_optional", "20261011_pickup_audit")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
