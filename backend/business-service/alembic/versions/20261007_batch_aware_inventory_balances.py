"""Track material batches independently at each storage location.

Revision ID: 20261007_batch_balances
Revises: 20261006_asn_logistics
"""

from alembic import op
import sqlalchemy as sa


revision = "20261007_batch_balances"
down_revision = "20261006_asn_logistics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "store_bin" in tables:
        bin_columns = {column["name"] for column in sa.inspect(bind).get_columns("store_bin")}
        if "qr_identifier" not in bin_columns:
            op.add_column("store_bin", sa.Column("qr_identifier", sa.String(length=128), nullable=True))
        bin_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("store_bin")}
        if "ix_store_bin_qr_identifier" not in bin_indexes:
            op.create_index("ix_store_bin_qr_identifier", "store_bin", ["qr_identifier"], unique=True)
    if "material_stock" in tables:
        stock_columns = {column["name"] for column in sa.inspect(bind).get_columns("material_stock")}
        for canonical_column, legacy_column in (
            ("on_hand_quantity", "on_hand"),
            ("allocated_quantity", "allocated"),
            ("available_quantity", "available"),
        ):
            if canonical_column not in stock_columns:
                op.add_column(
                    "material_stock",
                    sa.Column(canonical_column, sa.Numeric(precision=18, scale=4), nullable=True),
                )
                if legacy_column in stock_columns:
                    op.execute(sa.text(
                        f"UPDATE material_stock SET {canonical_column} = COALESCE({legacy_column}, 0)"
                    ))
                else:
                    op.execute(sa.text(f"UPDATE material_stock SET {canonical_column} = 0"))
                op.alter_column(
                    "material_stock",
                    canonical_column,
                    existing_type=sa.Numeric(precision=18, scale=4),
                    nullable=False,
                    server_default="0",
                )
                stock_columns.add(canonical_column)
    if "inventory_location_balance" not in tables:
        return

    columns = {column["name"] for column in sa.inspect(bind).get_columns("inventory_location_balance")}
    if "batch_number" not in columns:
        op.add_column(
            "inventory_location_balance",
            sa.Column("batch_number", sa.String(length=128), nullable=True),
        )

    # Historic balances were aggregated across their source batches. Preserve
    # their quantities and mark the unknown lineage explicitly instead of
    # assigning the entire aggregate to a guessed batch.
    op.execute(
        sa.text(
            "UPDATE inventory_location_balance "
            "SET batch_number = 'UNTRACKED' WHERE batch_number IS NULL OR batch_number = ''"
        )
    )

    constraints = {
        constraint.get("name")
        for constraint in sa.inspect(bind).get_unique_constraints("inventory_location_balance")
    }
    if "uq_inventory_location_material_bin" in constraints:
        op.drop_constraint(
            "uq_inventory_location_material_bin",
            "inventory_location_balance",
            type_="unique",
        )
    if "uq_inventory_location_material_bin_batch" not in constraints:
        op.create_unique_constraint(
            "uq_inventory_location_material_bin_batch",
            "inventory_location_balance",
            ["material_code", "storage_location_id", "batch_number"],
        )

    current_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("inventory_location_balance")}
    if "ix_inventory_location_balance_batch_number" not in current_indexes:
        op.create_index(
            "ix_inventory_location_balance_batch_number",
            "inventory_location_balance",
            ["batch_number"],
        )
    op.alter_column(
        "inventory_location_balance",
        "batch_number",
        existing_type=sa.String(length=128),
        nullable=False,
        server_default="UNTRACKED",
    )

    if "putaway_movement" in tables:
        putaway_columns = {column["name"] for column in sa.inspect(bind).get_columns("putaway_movement")}
        if "confirmation_id" not in putaway_columns:
            op.add_column("putaway_movement", sa.Column("confirmation_id", sa.String(length=64), nullable=True))
            op.create_index("ix_putaway_movement_confirmation_id", "putaway_movement", ["confirmation_id"], unique=True)
        if "confirmation_hash" not in putaway_columns:
            op.add_column("putaway_movement", sa.Column("confirmation_hash", sa.String(length=64), nullable=True))

    if "inventory_issue_transaction" in tables:
        issue_columns = {column["name"] for column in sa.inspect(bind).get_columns("inventory_issue_transaction")}
        if "batch_number" not in issue_columns:
            op.add_column(
                "inventory_issue_transaction",
                sa.Column("batch_number", sa.String(length=128), nullable=True),
            )
            op.create_index(
                "ix_inventory_issue_transaction_batch_number",
                "inventory_issue_transaction",
                ["batch_number"],
            )
        if "source_location_id" not in issue_columns:
            op.add_column(
                "inventory_issue_transaction",
                sa.Column("source_location_id", sa.Uuid(), nullable=True),
            )
            op.create_foreign_key(
                "fk_inventory_issue_transaction_source_location",
                "inventory_issue_transaction",
                "storage_location",
                ["source_location_id"],
                ["id"],
                ondelete="SET NULL",
            )
            op.create_index(
                "ix_inventory_issue_transaction_source_location_id",
                "inventory_issue_transaction",
                ["source_location_id"],
            )
        if "confirmation_id" not in issue_columns:
            op.add_column("inventory_issue_transaction", sa.Column("confirmation_id", sa.String(length=64), nullable=True))
            op.create_index("ix_inventory_issue_transaction_confirmation_id", "inventory_issue_transaction", ["confirmation_id"], unique=True)
        if "confirmation_hash" not in issue_columns:
            op.add_column("inventory_issue_transaction", sa.Column("confirmation_hash", sa.String(length=64), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "inventory_location_balance" not in tables:
        return
    columns = {column["name"] for column in sa.inspect(bind).get_columns("inventory_location_balance")}
    if "batch_number" not in columns:
        return

    duplicate_locations = bind.execute(
        sa.text(
            "SELECT 1 FROM inventory_location_balance "
            "GROUP BY material_code, storage_location_id HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicate_locations:
        raise RuntimeError(
            "Cannot downgrade batch-aware inventory while multiple batches occupy a location; "
            "merge those balances explicitly before downgrading."
        )
    tracked_batches = bind.execute(
        sa.text("SELECT 1 FROM inventory_location_balance WHERE batch_number <> 'UNTRACKED' LIMIT 1")
    ).first()
    if tracked_batches:
        raise RuntimeError("Cannot downgrade while inventory balances retain actual batch identities")

    constraints = {
        constraint.get("name")
        for constraint in sa.inspect(bind).get_unique_constraints("inventory_location_balance")
    }
    if "uq_inventory_location_material_bin_batch" in constraints:
        op.drop_constraint(
            "uq_inventory_location_material_bin_batch",
            "inventory_location_balance",
            type_="unique",
        )
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("inventory_location_balance")}
    if "ix_inventory_location_balance_batch_number" in indexes:
        op.drop_index("ix_inventory_location_balance_batch_number", table_name="inventory_location_balance")
    op.drop_column("inventory_location_balance", "batch_number")
    op.create_unique_constraint(
        "uq_inventory_location_material_bin",
        "inventory_location_balance",
        ["material_code", "storage_location_id"],
    )
    if "putaway_movement" in tables:
        putaway_columns = {column["name"] for column in sa.inspect(bind).get_columns("putaway_movement")}
        if "confirmation_id" in putaway_columns:
            indexes = {index["name"] for index in sa.inspect(bind).get_indexes("putaway_movement")}
            if "ix_putaway_movement_confirmation_id" in indexes:
                op.drop_index("ix_putaway_movement_confirmation_id", table_name="putaway_movement")
            op.drop_column("putaway_movement", "confirmation_id")
        if "confirmation_hash" in putaway_columns:
            op.drop_column("putaway_movement", "confirmation_hash")
    issue_tables = set(sa.inspect(bind).get_table_names())
    if "inventory_issue_transaction" in issue_tables:
        issue_columns = {column["name"] for column in sa.inspect(bind).get_columns("inventory_issue_transaction")}
        if "batch_number" in issue_columns:
            indexes = {index["name"] for index in sa.inspect(bind).get_indexes("inventory_issue_transaction")}
            if "ix_inventory_issue_transaction_batch_number" in indexes:
                op.drop_index("ix_inventory_issue_transaction_batch_number", table_name="inventory_issue_transaction")
            op.drop_column("inventory_issue_transaction", "batch_number")
        if "source_location_id" in issue_columns:
            indexes = {index["name"] for index in sa.inspect(bind).get_indexes("inventory_issue_transaction")}
            if "ix_inventory_issue_transaction_source_location_id" in indexes:
                op.drop_index("ix_inventory_issue_transaction_source_location_id", table_name="inventory_issue_transaction")
            op.drop_constraint("fk_inventory_issue_transaction_source_location", "inventory_issue_transaction", type_="foreignkey")
            op.drop_column("inventory_issue_transaction", "source_location_id")
        if "confirmation_id" in issue_columns:
            indexes = {index["name"] for index in sa.inspect(bind).get_indexes("inventory_issue_transaction")}
            if "ix_inventory_issue_transaction_confirmation_id" in indexes:
                op.drop_index("ix_inventory_issue_transaction_confirmation_id", table_name="inventory_issue_transaction")
            op.drop_column("inventory_issue_transaction", "confirmation_id")
        if "confirmation_hash" in issue_columns:
            op.drop_column("inventory_issue_transaction", "confirmation_hash")
