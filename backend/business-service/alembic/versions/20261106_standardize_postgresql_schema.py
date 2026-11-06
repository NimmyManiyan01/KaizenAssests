"""Standardize PostgreSQL schema, resolve verified drifts, and create unmigrated tables.

Revision ID: 20261106_standardize_postgresql_schema
Revises: 20261106_hard_delete_docks
Create Date: 2026-11-06 21:55:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20261106_standardize_postgresql_schema"
down_revision: Union[str, None] = "20261106_hard_delete_docks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    guid_type = sa.UUID(as_uuid=True) if bind.dialect.name == "postgresql" else sa.String(36)

    # =========================================================================
    # PART 1: Create 14 Unmigrated Tables
    # =========================================================================

    # 1. assembly_stock_reservation
    if "assembly_stock_reservation" not in existing_tables:
        op.create_table(
            "assembly_stock_reservation",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("requisition_id", guid_type, nullable=False),
            sa.Column("requisition_item_id", guid_type, nullable=False),
            sa.Column("requisition_number", sa.String(64), nullable=False),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("required_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("reserved_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False),
            sa.Column("status", sa.String(64), nullable=False),
            sa.Column("warehouse_ref_id", guid_type, nullable=True),
            sa.Column("warehouse_code", sa.String(64), nullable=True),
            sa.Column("warehouse_name", sa.String(256), nullable=True),
            sa.Column("zone_code", sa.String(64), nullable=True),
            sa.Column("bin_code", sa.String(64), nullable=True),
            sa.Column("location_code", sa.String(64), nullable=True),
            sa.Column("storage_location_id", guid_type, nullable=True),
            sa.Column("allocations", sa.JSON(), nullable=False),
            sa.Column("reserved_by", sa.String(128), nullable=False),
            sa.Column("reserved_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_assembly_stock_reservation_status", "assembly_stock_reservation", ["status"])
        op.create_index("ix_assembly_stock_reservation_requisition_id", "assembly_stock_reservation", ["requisition_id"])
        op.create_index("ix_assembly_stock_reservation_warehouse_ref_id", "assembly_stock_reservation", ["warehouse_ref_id"])
        op.create_index("ix_assembly_stock_reservation_material_code", "assembly_stock_reservation", ["material_code"])

    # 2. assembly_routing_operation
    if "assembly_routing_operation" not in existing_tables:
        op.create_table(
            "assembly_routing_operation",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("routing_revision_id", guid_type, nullable=False),
            sa.Column("operation_code", sa.String(64), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("operation_name", sa.String(255), nullable=False),
            sa.Column("work_centre_id", guid_type, nullable=True),
            sa.Column("expected_duration_minutes", sa.Integer(), nullable=True),
            sa.Column("required_skill", sa.String(128), nullable=True),
            sa.Column("qc_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("work_instruction", sa.Text(), nullable=True),
            sa.Column("sop_reference", sa.String(128), nullable=True),
            sa.Column("tool_requirement", sa.Text(), nullable=True),
            sa.Column("safety_instruction", sa.Text(), nullable=True),
            sa.Column("required_materials", sa.JSON(), nullable=False),
            sa.Column("process_parameters", sa.JSON(), nullable=False),
            sa.Column("quality_checkpoints", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_assembly_routing_operation_routing_revision_id", "assembly_routing_operation", ["routing_revision_id"])

    # 3. assembly_routing_revision
    if "assembly_routing_revision" not in existing_tables:
        op.create_table(
            "assembly_routing_revision",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("routing_code", sa.String(64), nullable=False),
            sa.Column("product_code", sa.String(64), nullable=False),
            sa.Column("revision_code", sa.String(64), nullable=False),
            sa.Column("revision_number", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=True),
            sa.Column("effective_to", sa.Date(), nullable=True),
            sa.Column("created_by", sa.String(128), nullable=True),
            sa.Column("approved_by", sa.String(128), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_assembly_routing_revision_routing_code", "assembly_routing_revision", ["routing_code"])
        op.create_index("ix_assembly_routing_revision_product_code", "assembly_routing_revision", ["product_code"])

    # 4. cycle_count
    if "cycle_count" not in existing_tables:
        op.create_table(
            "cycle_count",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("count_number", sa.String(64), nullable=False),
            sa.Column("warehouse_id", guid_type, nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("planned_date", sa.Date(), nullable=False),
            sa.Column("completed_date", sa.Date(), nullable=True),
            sa.Column("created_by", sa.String(128), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_cycle_count_count_number", "cycle_count", ["count_number"], unique=True)
        op.create_index("ix_cycle_count_warehouse_id", "cycle_count", ["warehouse_id"])

    # 5. cycle_count_item
    if "cycle_count_item" not in existing_tables:
        op.create_table(
            "cycle_count_item",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("count_id", guid_type, nullable=False),
            sa.Column("location_id", guid_type, nullable=False),
            sa.Column("material_id", guid_type, nullable=False),
            sa.Column("system_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("counted_quantity", sa.Numeric(18, 4), nullable=True),
            sa.Column("discrepancy", sa.Numeric(18, 4), nullable=True),
            sa.Column("counted_by", sa.String(128), nullable=True),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_cycle_count_item_count_id", "cycle_count_item", ["count_id"])
        op.create_index("ix_cycle_count_item_location_id", "cycle_count_item", ["location_id"])
        op.create_index("ix_cycle_count_item_material_id", "cycle_count_item", ["material_id"])

    # 6. stock_adjustment
    if "stock_adjustment" not in existing_tables:
        op.create_table(
            "stock_adjustment",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("adjustment_number", sa.String(64), nullable=False),
            sa.Column("warehouse_id", guid_type, nullable=False),
            sa.Column("location_id", guid_type, nullable=False),
            sa.Column("material_id", guid_type, nullable=False),
            sa.Column("material_variant_id", guid_type, nullable=True),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("material_name", sa.String(256), nullable=False),
            sa.Column("variant_code", sa.String(64), nullable=True),
            sa.Column("quantity_before", sa.Numeric(18, 4), nullable=False),
            sa.Column("quantity_adjusted", sa.Numeric(18, 4), nullable=False),
            sa.Column("quantity_after", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=False),
            sa.Column("reason_code", sa.String(64), nullable=False),
            sa.Column("reason_description", sa.Text(), nullable=True),
            sa.Column("reference_document", sa.String(64), nullable=True),
            sa.Column("adjusted_by", sa.String(128), nullable=False),
            sa.Column("adjusted_at", sa.DateTime(), nullable=False),
            sa.Column("approved_by", sa.String(128), nullable=True),
            sa.Column("approved_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_stock_adjustment_adjustment_number", "stock_adjustment", ["adjustment_number"], unique=True)
        op.create_index("ix_stock_adjustment_material_code", "stock_adjustment", ["material_code"])

    # 7. material_return
    if "material_return" not in existing_tables:
        op.create_table(
            "material_return",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("return_number", sa.String(64), nullable=False),
            sa.Column("requisition_id", guid_type, nullable=False),
            sa.Column("material_id", guid_type, nullable=False),
            sa.Column("returned_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("destination_location_id", guid_type, nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("returned_by", sa.String(128), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_material_return_return_number", "material_return", ["return_number"], unique=True)
        op.create_index("ix_material_return_requisition_id", "material_return", ["requisition_id"])

    # 8. grn_receiving_session
    if "grn_receiving_session" not in existing_tables:
        op.create_table(
            "grn_receiving_session",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("grn_id", guid_type, nullable=False),
            sa.Column("operator_id", guid_type, nullable=False),
            sa.Column("operator_name", sa.String(128), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("ended_at", sa.DateTime(), nullable=True),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_grn_receiving_session_grn_id", "grn_receiving_session", ["grn_id"])

    # 9. grn_damage_lot
    if "grn_damage_lot" not in existing_tables:
        op.create_table(
            "grn_damage_lot",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("grn_id", guid_type, nullable=False),
            sa.Column("grn_line_id", guid_type, nullable=False),
            sa.Column("damage_lot_number", sa.String(64), nullable=False),
            sa.Column("damaged_quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(32), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("qa_status", sa.String(32), nullable=True),
            sa.Column("quarantine_location", sa.String(64), nullable=True),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("created_by", sa.String(128), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_grn_damage_lot_grn_line_id", "grn_damage_lot", ["grn_line_id"])
        op.create_index("ix_grn_damage_lot_damage_lot_number", "grn_damage_lot", ["damage_lot_number"], unique=True)

    # 10. grn_damage_qr
    if "grn_damage_qr" not in existing_tables:
        op.create_table(
            "grn_damage_qr",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("damage_lot_id", guid_type, nullable=False),
            sa.Column("grn_line_id", guid_type, nullable=False),
            sa.Column("grn_number", sa.String(64), nullable=False),
            sa.Column("item_code", sa.String(64), nullable=False),
            sa.Column("qr_code", sa.String(128), nullable=False),
            sa.Column("qr_payload", sa.Text(), nullable=False),
            sa.Column("generated_by", sa.String(128), nullable=True),
            sa.Column("generated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_grn_damage_qr_qr_code", "grn_damage_qr", ["qr_code"], unique=True)
        op.create_index("ix_grn_damage_qr_item_code", "grn_damage_qr", ["item_code"])
        op.create_index("ix_grn_damage_qr_damage_lot_id", "grn_damage_qr", ["damage_lot_id"], unique=True)

    # 11. quotation_magic_link
    if "quotation_magic_link" not in existing_tables:
        op.create_table(
            "quotation_magic_link",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("token", sa.String(128), nullable=False),
            sa.Column("rfq_id", guid_type, nullable=False),
            sa.Column("supplier_id", guid_type, nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_quotation_magic_link_token", "quotation_magic_link", ["token"], unique=True)

    # 12. purchase_order_item
    if "purchase_order_item" not in existing_tables:
        op.create_table(
            "purchase_order_item",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("purchase_order_id", guid_type, nullable=False),
            sa.Column("material_id", guid_type, nullable=True),
            sa.Column("material_variant_id", guid_type, nullable=True),
            sa.Column("material_code", sa.String(64), nullable=False),
            sa.Column("variant_code", sa.String(128), nullable=True),
            sa.Column("material_name", sa.String(255), nullable=True),
            sa.Column("category", sa.String(128), nullable=True),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
            sa.Column("unit_price", sa.Numeric(18, 4), nullable=False),
            sa.Column("discount", sa.Numeric(18, 4), nullable=False, server_default=sa.text("0")),
            sa.Column("tax", sa.Numeric(18, 4), nullable=False, server_default=sa.text("0")),
            sa.Column("uom", sa.String(32), nullable=False),
        )
        op.create_index("ix_purchase_order_item_purchase_order_id", "purchase_order_item", ["purchase_order_id"])

    # 13. po_revision
    if "po_revision" not in existing_tables:
        op.create_table(
            "po_revision",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("purchase_order_id", guid_type, nullable=False),
            sa.Column("revision_number", sa.Integer(), nullable=False),
            sa.Column("changed_field", sa.String(128), nullable=False),
            sa.Column("old_value", sa.Text(), nullable=True),
            sa.Column("new_value", sa.Text(), nullable=True),
            sa.Column("changed_by", sa.String(128), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("changed_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_po_revision_purchase_order_id", "po_revision", ["purchase_order_id"])

    # 14. po_approval_history
    if "po_approval_history" not in existing_tables:
        op.create_table(
            "po_approval_history",
            sa.Column("id", guid_type, primary_key=True),
            sa.Column("purchase_order_id", guid_type, nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("actor_name", sa.String(128), nullable=False),
            sa.Column("comments", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_po_approval_history_purchase_order_id", "po_approval_history", ["purchase_order_id"])

    # =========================================================================
    # PART 2: Add Missing Columns to Existing Tables (Defensive / Idempotent)
    # =========================================================================

    def add_column_if_missing(table_name: str, col: sa.Column):
        if table_name in existing_tables:
            cols = {c["name"] for c in inspector.get_columns(table_name)}
            if col.name not in cols:
                op.add_column(table_name, col)

    # 1. asn
    add_column_if_missing("asn", sa.Column("challan_date", sa.Date(), nullable=True))
    add_column_if_missing("asn", sa.Column("challan_number", sa.String(64), nullable=True))
    add_column_if_missing("asn", sa.Column("invoice_date", sa.Date(), nullable=True))
    add_column_if_missing("asn", sa.Column("invoice_number", sa.String(64), nullable=True))

    # 2. assembly_order
    add_column_if_missing("assembly_order", sa.Column("putaway_status", sa.String(32), nullable=True))

    # 3. assembly_requisition_item
    add_column_if_missing("assembly_requisition_item", sa.Column("custom_material_name", sa.String(256), nullable=True))
    add_column_if_missing("assembly_requisition_item", sa.Column("is_custom", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    add_column_if_missing("assembly_requisition_item", sa.Column("reserved_quantity", sa.Numeric(18, 4), nullable=False, server_default=sa.text("0")))

    # 4. dock_assignment
    add_column_if_missing("dock_assignment", sa.Column("quality_issue_status", sa.String(32), nullable=True))
    add_column_if_missing("dock_assignment", sa.Column("quality_issue_filename", sa.String(256), nullable=True))
    add_column_if_missing("dock_assignment", sa.Column("quality_issue_content_type", sa.String(64), nullable=True))
    add_column_if_missing("dock_assignment", sa.Column("quality_issue_image_data", sa.Text(), nullable=True))
    add_column_if_missing("dock_assignment", sa.Column("quality_issue_sent_at", sa.DateTime(), nullable=True))
    add_column_if_missing("dock_assignment", sa.Column("quality_issue_forwarded_at", sa.DateTime(), nullable=True))

    # 5. grn_batch
    add_column_if_missing("grn_batch", sa.Column("superseded", sa.Boolean(), nullable=False, server_default=sa.text("false")))

    # 6. grn_line
    add_column_if_missing("grn_line", sa.Column("held_quantity", sa.Numeric(18, 4), nullable=True, server_default=sa.text("0")))
    add_column_if_missing("grn_line", sa.Column("held_reason", sa.String(256), nullable=True))
    add_column_if_missing("grn_line", sa.Column("damage_reason", sa.String(256), nullable=True))
    add_column_if_missing("grn_line", sa.Column("rejected_reason", sa.String(256), nullable=True))

    # 7. inventory_movement_history
    add_column_if_missing("inventory_movement_history", sa.Column("confirmation_id", sa.String(64), nullable=True))
    add_column_if_missing("inventory_movement_history", sa.Column("confirmation_hash", sa.String(128), nullable=True))

    # 8. material_request_item
    add_column_if_missing("material_request_item", sa.Column("custom_material_name", sa.String(256), nullable=True))
    add_column_if_missing("material_request_item", sa.Column("is_custom", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    add_column_if_missing("material_request_item", sa.Column("material_id", guid_type, nullable=True))
    add_column_if_missing("material_request_item", sa.Column("material_variant_id", guid_type, nullable=True))
    add_column_if_missing("material_request_item", sa.Column("variant_code", sa.String(64), nullable=True))

    # 9. material_stock
    add_column_if_missing("material_stock", sa.Column("location_id", guid_type, nullable=True))
    add_column_if_missing("material_stock", sa.Column("created_at", sa.DateTime(), nullable=True, server_default=sa.func.now()))

    # 10. purchase_order
    add_column_if_missing("purchase_order", sa.Column("freight_charges", sa.Numeric(18, 4), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("procurement_officer", sa.String(128), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("selected_by", sa.String(128), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("tax_amount", sa.Numeric(18, 4), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("supplier_email", sa.String(128), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("supplier_contact_person", sa.String(128), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("delivery_terms", sa.String(256), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("discount_amount", sa.Numeric(18, 4), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("supplier_phone", sa.String(64), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("attachments", sa.JSON(), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("subtotal", sa.Numeric(18, 4), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("selection_date", sa.DateTime(), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("supplier_code", sa.String(64), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("department", sa.String(64), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("notes", sa.Text(), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("supplier_gstin", sa.String(64), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("delivery_warehouse_name", sa.String(256), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("billing_address", sa.Text(), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("supplier_address", sa.Text(), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("selection_reason", sa.Text(), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("warranty", sa.String(256), nullable=True))
    add_column_if_missing("purchase_order", sa.Column("procurement_comments", sa.Text(), nullable=True))

    # 11. quotation
    add_column_if_missing("quotation", sa.Column("additional_charges", sa.Numeric(18, 4), nullable=True))
    add_column_if_missing("quotation", sa.Column("warranty", sa.String(256), nullable=True))

    # 12. supplier_document
    add_column_if_missing("supplier_document", sa.Column("upload_id", sa.String(64), nullable=True))


def downgrade() -> None:
    raise RuntimeError(
        "This data-preserving PostgreSQL standardization is forward-only. "
        "Dropping verified operational tables and columns would discard live business data."
    )

