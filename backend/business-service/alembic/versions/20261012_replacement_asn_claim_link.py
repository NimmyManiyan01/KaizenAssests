"""Link replacement ASNs to supplier damage claims."""

from alembic import op
import sqlalchemy as sa

revision = "20261012_replacement_asn_claim_link"
down_revision = "20261012_grn_supplier_damage_claim_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    asn_columns = {column["name"] for column in inspector.get_columns("asn")}
    if "claim_id" not in asn_columns:
        op.add_column(
            "asn",
            sa.Column(
                "claim_id",
                sa.Uuid(),
                sa.ForeignKey("supplier_damage_claim.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_asn_claim_id", "asn", ["claim_id"])

    shipment_columns = {column["name"] for column in inspector.get_columns("replacement_shipment")}
    if "asn_id" not in shipment_columns:
        op.add_column(
            "replacement_shipment",
            sa.Column(
                "asn_id",
                sa.Uuid(),
                sa.ForeignKey("asn.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_unique_constraint("uq_replacement_shipment_asn_id", "replacement_shipment", ["asn_id"])
        op.create_index("ix_replacement_shipment_asn_id", "replacement_shipment", ["asn_id"])


def downgrade() -> None:
    op.drop_index("ix_replacement_shipment_asn_id", table_name="replacement_shipment")
    op.drop_constraint("uq_replacement_shipment_asn_id", "replacement_shipment", type_="unique")
    op.drop_column("replacement_shipment", "asn_id")
    op.drop_index("ix_asn_claim_id", table_name="asn")
    op.drop_column("asn", "claim_id")
