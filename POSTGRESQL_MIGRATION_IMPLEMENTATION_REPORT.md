# PostgreSQL Migration Implementation Report

## 1. Executive Summary & Objective

This report details the implementation of migration revision `20261106_standardize_postgresql_schema`, designed to eliminate schema drift between SQLAlchemy ORM models and the PostgreSQL database on Microsoft Azure.

---

## 2. Implemented Schema Modifications

### 2.1 Newly Created Operational Tables (14 Tables)

| # | Table Name | Primary Key | Key Columns & Types | Indexes Created |
|---|---|---|---|---|
| 1 | `assembly_stock_reservation` | `id (UUID)` | `requisition_id`, `material_code`, `required_quantity`, `reserved_quantity`, `status` | `ix_status`, `ix_requisition_id`, `ix_warehouse_ref_id`, `ix_material_code` |
| 2 | `assembly_routing_operation` | `id (UUID)` | `routing_revision_id`, `operation_code`, `sequence`, `work_centre_id`, `qc_required` | `ix_routing_revision_id` |
| 3 | `assembly_routing_revision` | `id (UUID)` | `routing_code`, `product_code`, `revision_code`, `revision_number`, `status` | `ix_routing_code`, `ix_product_code` |
| 4 | `cycle_count` | `id (UUID)` | `count_number`, `warehouse_id`, `status`, `planned_date` | `ix_count_number` (UNIQUE), `ix_warehouse_id` |
| 5 | `cycle_count_item` | `id (UUID)` | `count_id`, `location_id`, `material_id`, `system_quantity`, `counted_quantity` | `ix_count_id`, `ix_location_id`, `ix_material_id` |
| 6 | `stock_adjustment` | `id (UUID)` | `adjustment_number`, `warehouse_id`, `material_code`, `quantity_adjusted`, `reason_code` | `ix_adjustment_number` (UNIQUE), `ix_material_code` |
| 7 | `material_return` | `id (UUID)` | `return_number`, `requisition_id`, `material_id`, `returned_quantity`, `destination_location_id` | `ix_return_number` (UNIQUE), `ix_requisition_id` |
| 8 | `grn_receiving_session` | `id (UUID)` | `grn_id`, `operator_id`, `operator_name`, `started_at`, `status` | `ix_grn_id` |
| 9 | `grn_damage_lot` | `id (UUID)` | `grn_id`, `grn_line_id`, `damage_lot_number`, `damaged_quantity`, `status` | `ix_grn_line_id`, `ix_damage_lot_number` (UNIQUE) |
| 10| `grn_damage_qr` | `id (UUID)` | `damage_lot_id`, `grn_line_id`, `grn_number`, `qr_code`, `qr_payload` | `ix_qr_code` (UNIQUE), `ix_item_code`, `ix_damage_lot_id` (UNIQUE) |
| 11| `quotation_magic_link` | `id (UUID)` | `token`, `rfq_id`, `supplier_id`, `expires_at`, `used_at` | `ix_token` (UNIQUE) |
| 12| `purchase_order_item` | `id (UUID)` | `purchase_order_id`, `material_code`, `quantity`, `unit_price`, `discount`, `tax` | `ix_purchase_order_id` |
| 13| `po_revision` | `id (UUID)` | `purchase_order_id`, `revision_number`, `changed_field`, `old_value`, `new_value` | `ix_purchase_order_id` |
| 14| `po_approval_history` | `id (UUID)` | `purchase_order_id`, `status`, `actor_name`, `comments` | `ix_purchase_order_id` |

---

### 2.2 Reconciled Columns on Existing Tables (12 Tables)

| # | Table Name | Added Columns & Data Types | Nullability & Default | Backward Compatibility |
|---|---|---|---|---|
| 1 | `asn` | `challan_date (DATE)`, `challan_number (VARCHAR)`, `invoice_date (DATE)`, `invoice_number (VARCHAR)` | Nullable | Fully Compatible |
| 2 | `assembly_order` | `putaway_status (VARCHAR)` | Nullable | Fully Compatible |
| 3 | `assembly_requisition_item` | `custom_material_name (VARCHAR)`, `is_custom (BOOLEAN)`, `reserved_quantity (NUMERIC)` | Safe server defaults (`false`, `0`) | Fully Compatible |
| 4 | `dock_assignment` | `quality_issue_status`, `quality_issue_filename`, `quality_issue_content_type`, `quality_issue_image_data`, `quality_issue_sent_at`, `quality_issue_forwarded_at` | Nullable | Fully Compatible |
| 5 | `grn_batch` | `superseded (BOOLEAN)` | Default: `false` | Fully Compatible |
| 6 | `grn_line` | `held_quantity (NUMERIC)`, `held_reason (VARCHAR)`, `damage_reason (VARCHAR)`, `rejected_reason (VARCHAR)` | Default `0` / Nullable | Fully Compatible |
| 7 | `inventory_movement_history` | `confirmation_id (VARCHAR)`, `confirmation_hash (VARCHAR)` | Nullable | Fully Compatible |
| 8 | `material_request_item` | `custom_material_name`, `is_custom (BOOLEAN)`, `material_id (UUID)`, `material_variant_id (UUID)`, `variant_code` | Default `false` / Nullable | Fully Compatible |
| 9 | `material_stock` | `location_id (UUID)`, `created_at (TIMESTAMP)` | Default `NOW()` / Nullable | Fully Compatible |
| 10| `purchase_order` | Procurement, billing, supplier details (22 fields) | Nullable / JSON | Fully Compatible |
| 11| `quotation` | `additional_charges (NUMERIC)`, `warranty (VARCHAR)` | Nullable | Fully Compatible |
| 12| `supplier_document` | `upload_id (VARCHAR)` | Nullable | Fully Compatible |

---

### 2.3 Decoupling of Runtime Startup DDL
- **File Modified**: `backend/business-service/app/main.py`
- **Change**: Removed redundant `ALTER TABLE supplier ADD COLUMN IF NOT EXISTS ...` and `ALTER TABLE supplier ALTER COLUMN category TYPE JSON ...` statements from application lifespan startup.
- **Safety Benefit**: Eliminates `ACCESS EXCLUSIVE` table locking risk during horizontal container autoscaling or rolling deployments.
