# PostgreSQL Database Architecture & Infrastructure Audit

## 1. Executive Summary & Context

This document establishes the verified database architecture, connection pooling, ORM mapping, migration framework, and initialization routines for the Kaizen Warehouse Management System (`ams-wms-business-service`).

The production database is hosted on **Microsoft Azure Database for PostgreSQL Flexible Server** running **PostgreSQL 16.15**. The application employs an asynchronous Python stack using **FastAPI**, **SQLAlchemy 2.1 (AsyncEngine)**, and **asyncpg**, managed by **Alembic 1.20** for database schema migrations.

---

## 2. Infrastructure & Connection Topology

### 2.1 Azure Production Environment
- **Host**: `kaizen-wms-psql.postgres.database.azure.com`
- **Port**: `5432`
- **Production Database**: `ams_business`
- **Server Version**: `PostgreSQL 16.15 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 13.2.0, 64-bit`
- **SSL/TLS Requirement**: `sslmode=require` (Mandatory TLS encryption)
- **Active Admin User**: `ams_admin` (`rolcreatedb: True`, `rolcreaterole: True`, `rolsuper: False`)
- **Container App Ingress Binding**: Azure Container App `kaizen-wms-backend` connects via internal environment secret `DATABASE_URL=postgresql+asyncpg://ams_admin:***@kaizen-wms-psql.postgres.database.azure.com:5432/ams_business?ssl=require`

### 2.2 Connection Pooling & Lifecycle
- **Configuration File**: `backend/business-service/app/database/session.py` & `app/config/settings.py`
- **Engine Type**: `create_async_engine` (Asyncpg dialect)
- **Pool Size**: `10` persistent connections
- **Max Overflow**: `20` additional burst connections (Max 30 per pod)
- **Pool Recycle**: `1800` seconds (30 minutes) to eliminate stale Azure gateway connections
- **Pre-Ping**: `pool_pre_ping=True` (Validates connection liveliness with `SELECT 1` before checkout)
- **Transaction Model**: Explicit **Unit of Work (UoW)** pattern scoped per HTTP request. Each transaction commits upon clean request exit and rolls back on unhandled exceptions.

```mermaid
flowchart TD
    Client["Client / Frontend"] --> API["FastAPI Request Handler"]
    API --> UoW["Unit of Work (AsyncSession)"]
    UoW --> Pool["SQLAlchemy AsyncEngine Pool (Size: 10, Max: 30)"]
    Pool --> AzurePG["Azure PostgreSQL Flexible Server (16.15)"]
    UoW --> Commit["Clean Exit: Commit Transaction"]
    UoW --> Rollback["Exception: Rollback Transaction"]
```

---

## 3. ORM Model Inventory & Domain Architecture

The business domain is decomposed into 15 functional modules, defining **111 SQLAlchemy ORM models** inheriting from a unified declarative base (`app.database.base.Base`) with strict naming conventions for constraints (`NAMING_CONVENTION` with `ix_`, `uq_`, `ck_`, `fk_`, `pk_`).

| Domain / Module | Source File | Registered ORM Tables | Key Entities |
|---|---|---|---|
| **Warehouse Core** | `app/modules/warehouse/.../models.py` | 5 | `warehouse_configuration`, `warehouse_zone`, `warehouse_rack`, `warehouse_bin`, `warehouse_dock` |
| **Identity & Access** | `app/modules/warehouse/.../models.py` | 2 | `user_account`, `supplier_user` |
| **Inbound Gate** | `app/modules/gate/.../models.py` | 7 | `gate_entry`, `gate_exit`, `driver`, `vehicle`, `vehicle_exit_approval`, `gate_entry_audit_log`, `handling_unit` |
| **Dock Management** | `app/modules/dock/.../models.py` | 5 | `dock_masters`, `dock_assignment`, `dock_status_history`, `dock_allocation_requests`, `dock_allocation_history` |
| **Receiving & ASN** | `app/modules/receiving/.../models.py` | 13 | `asn`, `asn_line`, `asn_document`, `grn`, `grn_line`, `grn_batch`, `grn_batch_qr`, `grn_document`, `grn_damage_lot`, `grn_damage_qr`, `grn_damage_evidence`, `grn_receiving_session`, `damage_report` |
| **Storage & Inventory**| `app/modules/storage/.../models.py` | 16 | `storage_location`, `material_stock`, `inventory_location_balance`, `inventory_movement_history`, `inventory_receipt_posting`, `inventory_issue_transaction`, `putaway_task`, `putaway_movement`, `putaway_location_assignment`, `pick_task`, `pickup_task`, `stock_adjustment`, `cycle_count`, `cycle_count_item`, `material_issue`, `material_return` |
| **Assembly & Manufacturing** | `app/modules/assembly/.../models.py` | 21 | `assembly_order`, `assembly_unit`, `assembly_line`, `assembly_team`, `bill_of_materials`, `bill_of_materials_item`, `assembly_material_receipt`, `assembly_material_consumption`, `assembly_material_consumption_event`, `assembly_material_reservation`, `assembly_stock_reservation`, `assembly_finished_goods`, `assembly_finished_goods_allocation`, `assembly_routing_revision`, `assembly_routing_operation`, `assembly_quality_inspection`, `assembly_rework_order`, `assembly_scrap`, `finished_goods_request`, `finished_goods_section`, `finished_goods_pickup_gate_visit` |
| **Dispatch & Outbound** | `app/modules/dispatch/.../models.py` | 3 | `dispatch_order`, `dispatch_item`, `dispatch_pod` |
| **Supplier & Procurement** | `app/common/persistence/models.py` | 21 | `supplier`, `supplier_contact`, `supplier_address`, `supplier_bank_info`, `supplier_document`, `supplier_material_link`, `supplier_damage_claim`, `supplier_return`, `material`, `material_variant`, `material_request`, `material_request_item`, `purchase_order`, `purchase_order_item`, `po_revision`, `po_approval_history`, `rfq`, `rfq_item`, `rfq_supplier_link`, `quotation`, `quotation_line`, `quotation_document`, `quotation_magic_link` |
| **Events & Outbox** | `app/events/outbox_model.py` | 1 | `outbox_event` |
| **Notification** | `app/modules/notification/.../models.py` | 2 | `notification`, `notification_log` |
| **Quality & Quarantine** | `app/modules/quarantine/.../models.py` | 2 | `quarantine_record`, `quarantine_audit` |
| **Returns & Claims** | `app/modules/returns/.../models.py` | 4 | `return_request`, `return_line`, `replacement_request`, `replacement_shipment` |
| **System Audit** | `app/modules/admin/.../models.py` | 1 | `system_audit_log` |

---

## 4. Migration Architecture & Current Revision Status

### 4.1 Framework & Configuration
- **Migration Framework**: Alembic 1.20.1
- **Configuration**: `alembic.ini` and `alembic/env.py`
- **Execution Mode**: Async connection using `do_run_migrations` with `AsyncEngine`
- **Version Table**: `public.alembic_version` (`version_num VARCHAR(128)` primary key)
- **Repository Revisions**: **166** migration script files in `alembic/versions/`
- **Base Revision**: `0001` (`0001_init_receiving.py`)
- **Current Head**: `20261106_hard_delete_docks`
- **Azure PostgreSQL Status**: Azure PostgreSQL database is currently at revision `20261106_hard_delete_docks`.

### 4.2 Migration Continuity Analysis
- The Alembic migration DAG converges cleanly into a single head: `20261106_hard_delete_docks`.
- However, historical migration coverage has critical blind spots: **14 tables** defined in the application ORM models and several columns on core tables were added directly in application code without generating corresponding Alembic migration steps.

---

## 5. Startup Routines & Schema Reconciliation Mechanisms

### 5.1 FastAPI Lifespan Startup Hooks (`app/main.py`)
During application boot, the FastAPI lifespan executes:
1. **Single Warehouse Check**: Queries for legacy table `store`; halts if present.
2. **Sequence Reconciliation**: Checks for `fg_transport_main_number` sequence and resynchronizes its next value against `assembly_finished_goods.section_main_id`.
3. **Raw DDL Execution on `supplier` Table (Lines 89-105)**:
   ```sql
   ALTER TABLE supplier ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(128);
   ALTER TABLE supplier ADD COLUMN IF NOT EXISTS credit_period_days INTEGER;
   ALTER TABLE supplier ADD COLUMN IF NOT EXISTS updated_by VARCHAR(64);
   ALTER TABLE supplier ALTER COLUMN category DROP NOT NULL;
   ALTER TABLE supplier ALTER COLUMN category TYPE JSON USING (...);
   ```
4. **Data Bootstrapping (`app/bootstrap.py`)**:
   Idempotently checks for the default warehouse (`WH-001`) and super-administrator account (`admin` / `EMP-ADMIN-001`).

### 5.2 Identified Architectural Risks & Vulnerabilities
1. **Startup DDL Race Condition**: Running `ALTER TABLE` statements in `lifespan` across horizontally autoscaling Container App replicas causes table locks and potential deadlocks during concurrent container boots.
2. **Untracked Schema Modifications**: DDL executed at runtime bypasses Alembic version tracking, creating discrepancies between repository migrations and database state.
3. **Missing Columns Undefined in PostgreSQL**: 12 tables have missing columns in production that are actively referenced by FastAPI route handlers, causing SQL `UndefinedColumn` runtime 500 errors.
4. **14 Unmigrated ORM Tables**: ORM models exist in code for features like Cycle Counting, Material Returns, Routing Operations, and Stock Adjustments that do not exist in Azure PostgreSQL.

---

## 6. Audit Verdict

The database architecture is solid in terms of connection pooling, UoW patterns, and asynchronous execution, but suffers from **schema drift** between ORM models, migration history, and the live Azure database.

Proceed to **Phase 2: Schema Drift Analysis** to itemize every table and column discrepancy.

