"""Merge the workflow migration branch with the existing assembly branch."""

revision = "0021_merge_workflow_heads"
down_revision = ("0020_add_pickup_gate_exit_fields", "20261012_assembly_fg_fifo_allocation")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
