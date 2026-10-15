"""Complete canonical material and store-manager schema ownership."""

from alembic import op
import sqlalchemy as sa


revision = "0024_complete_material_store_schema"
down_revision = "0023_allow_supplier_fg_allocations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS material_stock (
                id UUID PRIMARY KEY,
                material_id UUID REFERENCES material(id) ON DELETE SET NULL,
                material_variant_id UUID REFERENCES material_variant(id) ON DELETE SET NULL,
                material_code VARCHAR(64) NOT NULL,
                material_name VARCHAR(256),
                variant_code VARCHAR(128),
                category VARCHAR(128),
                warehouse_id VARCHAR(64) DEFAULT 'Main Warehouse',
                on_hand NUMERIC(18, 4) NOT NULL DEFAULT 0,
                allocated NUMERIC(18, 4) NOT NULL DEFAULT 0,
                available NUMERIC(18, 4) NOT NULL DEFAULT 0,
                reorder_point NUMERIC(18, 4),
                uom VARCHAR(32) NOT NULL DEFAULT 'PCS',
                updated_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_stock_material_code ON material_stock (material_code)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_stock_material_id ON material_stock (material_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_stock_material_variant_id ON material_stock (material_variant_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_material_stock_variant_code ON material_stock (variant_code)"))

    op.execute(
        sa.text(
            "ALTER TABLE material_request ADD COLUMN IF NOT EXISTS suggested_supplier VARCHAR(255)"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE material_request ADD COLUMN IF NOT EXISTS attachments JSON NOT NULL DEFAULT '[]'::json"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE material_request ADD COLUMN IF NOT EXISTS approval_history JSON NOT NULL DEFAULT '[]'::json"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE material_request ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE"
        )
    )

    op.execute(
        sa.text(
            "ALTER TABLE store_manager_user ADD COLUMN IF NOT EXISTS role VARCHAR(64) NOT NULL DEFAULT 'Store Manager'"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE store_manager_user ADD COLUMN IF NOT EXISTS applications JSON NOT NULL DEFAULT '[\"WMS\"]'::json"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE store_manager_user ADD COLUMN IF NOT EXISTS auth_token_hash VARCHAR(128)"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE store_manager_user ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITHOUT TIME ZONE"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS position VARCHAR(64)"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS storage_type VARCHAR(64) NOT NULL DEFAULT 'GENERAL'"
        )
    )
    op.execute(sa.text("ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS maximum_weight NUMERIC(18, 4)"))
    op.execute(sa.text("ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS maximum_volume NUMERIC(18, 4)"))
    op.execute(sa.text("ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS allowed_material_category VARCHAR(128)"))
    op.execute(sa.text("ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS hazardous_material_permitted BOOLEAN NOT NULL DEFAULT FALSE"))
    op.execute(sa.text("ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS temperature_requirement VARCHAR(128)"))
    op.execute(sa.text("ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS qr_identifier VARCHAR(128)"))
    op.execute(sa.text("ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS occupied_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0"))
    op.execute(sa.text("ALTER TABLE store_bin ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE'"))
    op.execute(sa.text("ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1"))


def downgrade() -> None:
    # These columns/table may predate this corrective migration.  Do not
    # destructively remove them from existing installations.
    pass
