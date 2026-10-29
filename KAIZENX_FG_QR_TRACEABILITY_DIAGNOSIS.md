# KAIZENX END-TO-END QR TRACEABILITY DIAGNOSIS REPORT
**Document Version:** 1.0.0  
**Status:** READ-ONLY ARCHITECTURAL DIAGNOSIS  
**System:** KaizenX AMS / WMS (Warehouse & Manufacturing Execution Platform)  
**Target:** Finished Goods (FG) to Raw Material QR Code Traceability & Genealogy  

---

## EXECUTIVE SUMMARY

This forensic diagnosis evaluates how raw material QR codes generated at the Goods Receipt Note (GRN) stage can be linked deterministically to the Finished Goods (FG) QR code generated at the Quality Control (QC) completion stage.

### Primary Architectural Findings:
1. **Material QRs Exist & Are Persisted**: Raw material QR identities are created during GRN Batch generation in `grn_batch_qr` (`GrnBatchQrModel`), encoding material code, batch number (`LOT-...`), GRN ID, and QC status.
2. **Finished Goods QRs Exist & Are Persisted**: Finished Goods QR identities are created upon passing final QC in `assembly_finished_goods` (`AssemblyFinishedGoodsModel`), encoding product code, order number, FG batch number (`FG-BAT-...`), and serial number (`SN-...`).
3. **The Traceability Chain Exists But Relies on Unstructured JSON**: The link from Finished Goods back to the Assembly Order is direct (`assembly_finished_goods.assembly_order_id`). From the Assembly Order back to Warehouse Picking and GRN batches, the data is captured in `pick_task.items` JSON and `inventory_movement_history.batch_lot`.
4. **The Consumption Model Has a Missing Link**: `assembly_material_consumption` currently records only `material_code` and `actual_consumed` quantity. It lacks a column for `material_qr` or `batch_number`, and enforces a single-material-per-order unique constraint (`uq_assembly_consumption_order_material`).
5. **Reconstruction is 100% Feasible Without Regenerating Identities**: Because `grn_batch_qr` preserves the original `qr_code` (`QR-BATCH-LOT-...`) and `qr_payload`, the original raw material QR codes can be reconstructed and reprinted with zero ID duplication.

---

## STEP 1 — GRN MATERIAL QR INVESTIGATION

### 1.1 Where Material QR Codes Are Generated
- **Backend Service**: `business-service` (FastAPI), within module `app.modules.receiving`.
- **Implementation File**: [`app/modules/receiving/infrastructure/persistence/repository_impl.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/receiving/infrastructure/persistence/repository_impl.py#L1475-L1585).
- **Core Function**: `SqlAlchemyGrnRepository.create_batches_for_line(grn_line_id, batch_quantities, created_by)`.
- **API Endpoint**: `POST /api/v1/receiving/lines/{grn_line_id}/batches` in [`app/modules/receiving/infrastructure/api/router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/receiving/infrastructure/api/router.py#L586-L638).
- **Frontend Rendering**: [`frontend/src/routes/grn.tsx`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/frontend/src/routes/grn.tsx#L276) via client-side `qrcode` library (`QRCode.toCanvas()`).

### 1.2 Storage Models & Database Tables
Material QR codes are stored in PostgreSQL across two primary models in [`app/modules/receiving/infrastructure/persistence/models.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/receiving/infrastructure/persistence/models.py):

1. **`GrnBatchQrModel` (Table: `grn_batch_qr`)** (Lines 805–863):
   - `id`: `GUID` (UUID), Primary Key
   - `batch_id`: `GUID`, Foreign Key referencing `grn_batch.id` (`ondelete="SET NULL"`), nullable
   - `item_code`: `VARCHAR(64)`, Indexed, Non-unique
   - `qr_code`: `VARCHAR(128)`, Unique, Indexed (Identifier string)
   - `qr_payload`: `TEXT`, Full serialized payload
   - `generated_at`: `TIMESTAMP WITH TIME ZONE`

2. **`GrnDamageQrModel` (Table: `grn_damage_qr`)** (Lines 954–1025):
   - Stores QR codes for damaged/rejected lots moved to quarantine.

### 1.3 QR Granularity & Identity Format
Material QR codes are generated at two distinct granularities:
1. **Material-Level QR**:
   - `qr_code`: `QR-MAT-{item_code}`
   - `batch_id`: `NULL`
   - Serves as a generic material master barcode.
2. **Batch / Lot-Level QR (Authoritative for Traceability)**:
   - `qr_code`: `QR-BATCH-{batch_number}`
   - `batch_id`: UUID pointing to `grn_batch.id`
   - Generated per QC-accepted batch with generated format: `LOT-{item_code}-{YYYYMMDD}-{4HEX}` (e.g., `LOT-PMP-CAS-001-20261028-A4F2`).
   - **Raw materials do not receive individual serialized unit QRs; they are tracked per batch/lot.**

### 1.4 Encoded QR Payload Structure
In [`repository_impl.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/receiving/infrastructure/persistence/repository_impl.py#L1573-L1580), the batch QR payload is structured as human-readable key-value lines:
```text
Material Code: {line.item_code}
Material Name: {line.material_name or line.item_code}
GRN ID: {line.grn_id}
Batch: {batch.batch_number}
Batch Quantity: {batch.batch_quantity} {line.uom or 'PCS'}
Status: QC_ACCEPTED
```

### 1.5 Linkage to GRN Records
```
grn (id)
  ▲
  │ (FK: grn_id)
grn_line (id, item_code)
  ▲
  │ (FK: grn_line_id)
grn_batch (id, batch_number)
  ▲
  │ (FK: batch_id)
grn_batch_qr (id, qr_code, qr_payload)
```
- Direct foreign keys link `grn_batch_qr.batch_id` → `grn_batch.id` → `grn_line.id` → `grn.id`.
- The GRN UUID is also embedded directly in the `qr_payload`.

### 1.6 Retrieval and Reprinting Capabilities
- **API**: `GET /api/v1/receiving/{grn_id}` returns the nested hierarchy with all lines, batches, and batch QRs.
- **Lookup API**: `POST /api/v1/receiving/qr/lookup` accepts any scanned string (such as `QR-BATCH-LOT-...`) and parses it to locate the exact GRN, supplier, material name, and inspection status.
- **Reprinting**: Feasible at any time because the exact `qr_payload` is stored in the database.

---

## STEP 2 — WAREHOUSE MATERIAL ISSUANCE

### 2.1 Material Requisition by Assembly
- **Initiation**: `POST /api/v1/assembly/material-requests` ([`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L1080-L1130)).
- **Mechanism**: Explodes active Bill of Materials ([`BillOfMaterialsItemModel`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/persistence/models.py#L242-L260)) for the target product, creating:
  - `MaterialRequestModel` (Table: `material_request`, status: `PENDING`)
  - `MaterialRequestItemModel` (Table: `material_request_item`)
  - `AssemblyOrderModel` (Table: `assembly_order`, status: `MATERIAL_PENDING`)

### 2.2 Warehouse Issuance Mechanisms
Two paths exist in the backend:

1. **Direct Requisition Issuance (`POST /material-requests/{id}/warehouse-issue`)** ([`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L2085-L2200)):
   - Automated server-side issuance without barcode scanning.
   - Generates `PickTaskModel` (`task_number: PT-YYYY-XXXXXX`, status: `COMPLETED`).
   - Generates `MaterialIssueModel` (`issue_number: ISS-YYYY-XXXXXX`).
   - Decrements `InventoryLocationBalanceModel` (rack balance) and `MaterialStockModel` (aggregate stock).
   - **Limitation**: Does not capture individual batch IDs or QR scans; records only `material_code` and issued quantity.

2. **Physical QR Scan Picking (`POST /material-requests/picking-tasks/{task_id}/complete`)** ([`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L1570-L1825)):
   - **QR Scanning**: Requires `payload.material_scan` and `payload.zone_scan`.
   - **FIFO Validation**: Inspects `InventoryMovementHistoryModel` to determine the oldest active batch (`batch_lot`). Rejects picking if the scanned batch is not the oldest available batch.
   - **QR Identity Storage**:
     - Updates `PickTaskModel.items`: appends `material_scan`, `zone_scan`, and `batch_number` into the JSON object.
     - Creates `InventoryMovementHistoryModel`:
       - `movement_type`: `"TAKEAWAY"`
       - `material_qr`: Scanned string (truncated to 128 chars)
       - `batch_lot`: Scanned batch number
       - `grn_number`: `location_balance.last_grn_number`
       - `to_location`: `"ASSEMBLY"`
     - Updates `AssemblyOrderModel.items`: stores the items array with `material_scan` and `batch_number`.

### 2.3 Issuance Traceability Assessment
- **Can the system identify exactly which material QR identities were issued?**
  - **YES, IF** the warehouse completed the pick via `complete_assembly_picking_task`. The scanned QR and batch number are preserved in `PickTaskModel.items` and `InventoryMovementHistoryModel`.
  - **NO, IF** issued via the direct `warehouse-issue` endpoint, as it only decrements aggregate rack stock without recording batch identities.

---

## STEP 3 — ASSEMBLY LINE RECEIPT

### 3.1 Line Receipt Confirmation Flow
- **API Endpoint**: `POST /api/v1/assembly/material-requests/{request_id}/confirm-receipt` ([`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L2298-L2480)).
- **Trigger**: Assembly line supervisor or operator checks materials at the line storage cage.
- **Validations**:
  - Requires prior warehouse issue (`order.status == 'MATERIAL_ISSUED'`).
  - Prevents duplicate confirmation (checks for existing `AssemblyMaterialReceiptModel` record).
  - Validates $\text{received\_quantity} \le \text{issued\_quantity}$.
  - Transitions `AssemblyOrderModel.status` to `MATERIAL_READY`.

### 3.2 Material QR Linkage in Receipt
In [`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L2431-L2437):
```python
uow.session.add(AssemblyMaterialReceiptModel(
    id=uuid.uuid4(),
    assembly_order_id=order.id,
    material_issue_id=order.material_issue_id,
    material_code=code,
    material_qr=next((x.material_scan for x in payload.received_items if x.material_code == code), None),
    issued_quantity=Decimal(str(issued_qty)),
    received_quantity=received_decimal,
    uom=itm.get("uom", "PCS"),
    received_by=user_name,
    received_at=now,
    remarks=payload.remarks if payload else None,
))
```
- **Finding**: [`AssemblyMaterialReceiptModel`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/persistence/models.py#L70-L85) includes a dedicated `material_qr` column (`String(128)`, nullable).
- If the operator submits the scanned QR code in `received_items[].material_scan`, it is recorded here.
- If the operator confirms receipt without scanning (or using the simplified flow), `material_qr` is stored as `NULL`.
- There is no foreign key linking `AssemblyMaterialReceiptModel` to `grn_batch.id` or `grn_batch_qr.id`.

---

## STEP 4 — PRODUCTION MATERIAL CONSUMPTION

### 4.1 Production Execution Flow
1. **Start Production**: `POST /api/v1/assembly/orders/{order_id}/start-production` ([`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L2565-L2600))
   - Sets `order.status = "IN_PRODUCTION"`, records `started_at` and `assigned_operator`.
2. **Complete Production**: `POST /api/v1/assembly/orders/{order_id}/complete-production` ([`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L2635-L2725))
   - Records `produced_quantity` and sets `order.status = "QC_PENDING"`.
   - Iterates through `order.items` and creates or updates `AssemblyMaterialConsumptionModel` records.

### 4.2 Material Consumption Inspection
In [`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L2697-L2718):
```python
for item in (order.items or []):
    code = item.get("material_code")
    actual = Decimal(str(item.get("issued_quantity", item.get("required_quantity", 0)) or 0))
    uow.session.add(AssemblyMaterialConsumptionModel(
        id=uuid.uuid4(),
        assembly_order_id=order.id,
        material_code=code,
        expected_per_unit=(actual / order.planned_quantity) if order.planned_quantity else actual,
        assembled_quantity=payload.produced_quantity,
        actual_consumed=actual,
        uom=item.get("uom", "PCS"),
        recorded_by=operator,
        recorded_at=now,
    ))
```

### 4.3 Detailed Schema of `AssemblyMaterialConsumptionModel`
([`models.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/persistence/models.py#L101-L120)):
- `id`: `GUID` (PK)
- `assembly_order_id`: `GUID` (FK to `assembly_order.id`)
- `material_code`: `VARCHAR(64)`
- `expected_per_unit`: `NUMERIC(18, 4)`
- `assembled_quantity`: `NUMERIC(18, 4)`
- `actual_consumed`: `NUMERIC(18, 4)`
- `uom`: `VARCHAR(32)`
- `recorded_by`: `VARCHAR(128)`
- `recorded_at`: `TIMESTAMP`
- **Table Constraint**: `UniqueConstraint("assembly_order_id", "material_code", name="uq_assembly_consumption_order_material")`

### 4.4 Critical Finding: Actual Consumption vs. Requisition
- **The application DOES NOT record point-of-use physical QR scans at assembly stations.**
- `AssemblyMaterialConsumptionModel` is auto-populated upon production completion using the `issued_quantity` from the warehouse issue.
- **Missing Fields**: `AssemblyMaterialConsumptionModel` does **not** contain columns for `material_qr`, `batch_number`, or a foreign key to `grn_batch`.
- **Constraint Limitation**: The table constraint `uq_assembly_consumption_order_material` restricts each work order to exactly one row per material code, making it impossible to record multiple raw material batches for a single work order without a schema update.

---

## STEP 5 — FINISHED GOODS QR GENERATION

### 5.1 Generation Trigger & Business Logic
- **Trigger**: `POST /api/v1/assembly/quality/inspect` ([`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L2900-L3080)).
- **Rule**: When Quality Control approves produced goods (`passed_quantity > 0`), the backend automatically creates an [`AssemblyFinishedGoodsModel`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/persistence/models.py#L183-L210) record.

### 5.2 FG Identifiers & QR Encoding
In [`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py#L3028-L3055):
```python
unique_token = uuid.uuid4().hex[:8].upper()
batch_number = f"FG-BAT-{now.strftime('%Y%m%d')}-{unique_token}"
qr_payload_str = (
    f"FG|CODE:{order.product_code}|NAME:{order.product_name}|"
    f"ORDER:{order.order_number}|BATCH:{batch_number}|"
    f"QTY:{payload.passed_quantity:g}|QC:QC_APPROVED|LOC:ASSEMBLY-STORAGE-01"
)
serial_str = f"SN-{order.product_code or 'FG'}-{order.order_number}-{unique_token}"
```
- **Encoded Data**: Product Code, Product Name, Assembly Order Number, FG Batch Number, Quantity, QC Approval Status, and Floor Location.
- **Link to Work Order**: Stored directly in `assembly_finished_goods.assembly_order_id` (UUID foreign key).
- **One Order = One FG Record**: `assembly_finished_goods.assembly_order_id` has a `unique=True` database constraint. One assembly order cannot produce multiple separate FG batch rows in the current schema.

### 5.3 Frontend Viewing & Printing
- **Route**: [`frontend/src/routes/assembly.finished-goods.tsx`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/frontend/src/routes/assembly.finished-goods.tsx).
- **Functions**:
  - `handleOpenPrintModal()` (Line 90): Fetches `GET /api/v1/assembly/finished-goods/{id}` and generates a high-resolution QR image using `QRCode.toDataURL(detail.qr_code)`.
  - `handlePrint()` (Line 114): Opens a dedicated print window with standard label formatting (`.label-box`) including company headers, barcode, serial, batch, and inspector signature.
  - `handleDownloadLabel()` (Line 154): Downloads the QR code PNG image directly.
- **Preservation of Identity**: The QR code is stored as text in PostgreSQL and never altered on reprint.

---

## STEP 6 — DATABASE RELATIONSHIP ANALYSIS

### Relationship Map Across the Full Lifecycle

| Step | Source Table | Destination Table | Join Condition / Key Fields | Relationship Status | Traceability Sufficiency |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Inwarding** | `grn` | `grn_line` | `grn_line.grn_id = grn.id` | **Exists** (Relational FK) | Sufficient |
| **2. Batching** | `grn_line` | `grn_batch` | `grn_batch.grn_line_id = grn_line.id` | **Exists** (Relational FK) | Sufficient |
| **3. Material QR** | `grn_batch` | `grn_batch_qr` | `grn_batch_qr.batch_id = grn_batch.id` | **Exists** (Relational FK) | Sufficient |
| **4. Warehouse Issue** | `material_request` | `assembly_order` | `assembly_order.material_request_id = material_request.id` | **Exists** (Relational FK) | Sufficient |
| **5. Picking** | `assembly_order` | `pick_task` | `assembly_order.pick_task_id = pick_task.id` | **Exists** (Relational FK) | Sufficient |
| **6. Scanned Material** | `pick_task` | `grn_batch_qr` | `pick_task.items[].material_scan` $\approx$ `grn_batch_qr.qr_code` | **Loose JSON string match** (No Relational FK) | **Partial**: Captured in JSON text |
| **7. Line Receipt** | `assembly_order` | `assembly_material_receipt` | `assembly_material_receipt.assembly_order_id = assembly_order.id` | **Exists** (Relational FK) | Sufficient for Order link |
| **8. Receipt QR** | `assembly_material_receipt` | `grn_batch_qr` | `assembly_material_receipt.material_qr = grn_batch_qr.qr_code` | **Loose string match** (No Relational FK) | **Partial**: Nullable string field |
| **9. Consumption** | `assembly_order` | `assembly_material_consumption` | `assembly_material_consumption.assembly_order_id = assembly_order.id` | **Exists** (Relational FK) | Sufficient for Order link |
| **10. Consumed QR** | `assembly_material_consumption` | `grn_batch_qr` | *None* | **MISSING** | **Broken**: No batch/QR field on consumption |
| **11. QC & FG** | `assembly_order` | `assembly_finished_goods` | `assembly_finished_goods.assembly_order_id = assembly_order.id` | **Exists** (Relational FK, Unique) | Sufficient |

### Identification of Missing Links
1. **Direct Link**: `assembly_finished_goods` does not directly reference `assembly_material_consumption` or `assembly_material_receipt`. They are sibling records joined through `assembly_order_id`.
2. **Missing Columns on Consumption**: `assembly_material_consumption` has no `batch_number`, `material_qr`, or `grn_batch_id` column.
3. **Implicit Bridge**: The linkage between the Finished Good and the Raw Material QR currently survives through:
   $$\text{assembly\_finished\_goods} \xrightarrow{\text{assembly\_order\_id}} \text{assembly\_order} \xrightarrow{\text{pick\_task\_id}} \text{pick\_task.items[].batch\_number} \xrightarrow{} \text{grn\_batch.batch\_number} \xrightarrow{} \text{grn\_batch\_qr}$$

---

## STEP 7 — QR VIEWING AND PRINTING

### 7.1 Existing Printing Assets
1. **Frontend QRCode Engine**: `qrcode` npm package is installed and actively used across `grn.tsx` and `assembly.finished-goods.tsx`.
2. **Deterministic Payload Reconstruction**:
   - Material QR: Reconstructible from `grn_batch_qr.qr_payload` or `grn_batch_qr.qr_code`.
   - FG QR: Reconstructible from `assembly_finished_goods.qr_code`.
3. **Print Layout Components**:
   - `assembly.finished-goods.tsx` contains an established CSS print layout (`.label-box`) formatted for standard 4" x 6" / 3" x 3" industrial thermal barcode printers.
   - `grn.tsx` contains a multi-card printable grid for bulk printing batch labels.
4. **Bulk Printing Capability**:
   - Currently implemented in `grn.tsx` (`handlePrintAll`).
   - Not yet implemented in the Assembly Finished Goods module.
5. **Identity Preservation**:
   - Re-rendering uses the stored payload string. It **never generates new tokens or database rows**, guaranteeing absolute identity preservation.

---

## STEP 8 — TRACEABILITY FEASIBILITY CLASSIFICATION

| # | Traceability Capability | Status | Detailed Architectural Evidence |
| :---: | :--- | :---: | :--- |
| **1** | **Scan FG QR → Open FG Traceability Page** | **PARTIALLY IMPLEMENTED** | Backend can resolve FG by QR/Batch/Order number (`GET /finished-goods/{id}`), but there is no dedicated Traceability UI route or page. |
| **2** | **FG Batch → Assembly Work Order** | **ALREADY IMPLEMENTED** | `assembly_finished_goods.assembly_order_id` links directly to `assembly_order.id`. Verified in [`models.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/persistence/models.py#L188). |
| **3** | **Assembly Work Order → Actual Material Consumption** | **PARTIALLY IMPLEMENTED** | `assembly_material_consumption` records quantities per `material_code`, but does not track individual physical batch lot splits. |
| **4** | **Actual Consumption → Original Material QR** | **PARTIALLY IMPLEMENTED** | `AssemblyMaterialReceiptModel.material_qr` and `pick_task.items[].material_scan` store the QR string, but `assembly_material_consumption` lacks the field. |
| **5** | **Original Material QR → GRN** | **ALREADY IMPLEMENTED** | `grn_batch_qr` has foreign key to `grn_batch.id`, which joins to `grn_line` and `grn`. Verified in [`repository_impl.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/receiving/infrastructure/persistence/repository_impl.py#L1542-L1583). |
| **6** | **GRN → Supplier** | **ALREADY IMPLEMENTED** | `grn.po_id` / `grn.supplier_id` links directly to `supplier` table and PO records. |
| **7** | **View Original Material QR** | **PARTIALLY IMPLEMENTED** | Supported on the GRN page (`grn.tsx`), but currently inaccessible from Finished Goods or Assembly views. |
| **8** | **Print Original Material QR** | **PARTIALLY IMPLEMENTED** | Print logic exists in `grn.tsx`, but no bridge allows printing raw material QRs directly from an FG record. |
| **9** | **Download Original Material QR** | **PARTIALLY IMPLEMENTED** | `QRCode.toDataURL()` download pattern works in `grn.tsx`, but not linked to Finished Goods. |
| **10** | **Print All Original Material QRs** | **NOT IMPLEMENTED** | Bulk printing exists within a single GRN, but no endpoint or UI exists to batch-print all component QRs for a Finished Good. |

---

## STEP 9 — RECOMMENDED MINIMAL CHANGES (READ-ONLY PROPOSAL)

To achieve end-to-end QR traceability without refactoring operational modules, the following minimal, surgical changes are recommended:

### 1. Database Schema Enhancements (Non-breaking)
- **Table: `assembly_material_consumption`**:
  - Add `batch_number`: `VARCHAR(64)` (nullable) — to record the raw material batch number.
  - Add `material_qr`: `VARCHAR(128)` (nullable) — to store the exact scanned raw material QR code.
  - Add `grn_batch_id`: `GUID` (nullable) — foreign key referencing `grn_batch.id` (`ondelete="SET NULL"`).
  - Alter constraint: Replace `uq_assembly_consumption_order_material` with `uq_assembly_consumption_order_material_batch` (permitting multi-batch consumption for large runs).

### 2. Backend Enhancements
- **New Endpoint**: `GET /api/v1/assembly/finished-goods/{fg_id}/traceability` in [`router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py):
  1. Accepts `fg_id` (UUID, batch number, or serial number).
  2. Resolves `AssemblyFinishedGoodsModel` and linked `AssemblyOrderModel`.
  3. Queries raw material batch linkages by prioritizing:
     - Direct `assembly_material_consumption` (if populated).
     - Fallback: `AssemblyMaterialReceiptModel` and `PickTaskModel.items` (extracting `batch_number` and `material_scan`).
  4. Joins `grn_batch` and `grn_batch_qr` to retrieve original `qr_code` and `qr_payload`.
  5. Joins `grn` and `supplier` to obtain inwarding dates, PO numbers, and vendor details.
  6. Returns a consolidated genealogy tree payload.

### 3. Frontend Enhancements
- **New Route**: `/assembly/traceability/$fgId` or modal in [`frontend/src/routes/assembly.finished-goods.tsx`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/frontend/src/routes/assembly.finished-goods.tsx).
- **Features**:
  - **FG Information Banner**: Product name, Serial, Batch, Manufacturing date, and QC Inspector.
  - **Consumed Raw Materials Table**:
    - Material Code & Description
    - Consumed Quantity & UOM
    - Raw Material Batch / Lot Number
    - Origin GRN Number & Supplier Name
    - Individual Actions:
      - **View QR**: Opens modal rendering original `qr_payload` via `QRCode.toCanvas()`.
      - **Print QR**: Prints label in the existing 3" x 3" format.
      - **Download QR**: Downloads `<batch>-qr.png`.
  - **Bulk Action**:
    - **"Print All Material QRs"**: Generates a combined multi-label print preview containing all component QRs for the work order.

### 4. Traceability Security & Integrity Controls
- Restrict traceability API access to authenticated roles (`ASSEMBLY_MANAGER`, `WAREHOUSE`, `QUALITY`, `ADMIN`).
- Make raw material QR payloads immutable: never re-hash or overwrite existing `grn_batch_qr` rows.

---

## STEP 10 — SUMMARY OF FILES REQUIRING FUTURE MODIFICATION

| Layer | File Path | Scope of Future Modification |
| :--- | :--- | :--- |
| **DB Migration** | `backend/business-service/alembic/versions/0024_add_traceability_to_consumption.py` | Add `batch_number`, `material_qr`, and `grn_batch_id` columns to `assembly_material_consumption`. |
| **Backend Model** | [`backend/business-service/app/modules/assembly/infrastructure/persistence/models.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/persistence/models.py) | Update `AssemblyMaterialConsumptionModel` to include the new fields. |
| **Backend API** | [`backend/business-service/app/modules/assembly/infrastructure/api/router.py`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/backend/business-service/app/modules/assembly/infrastructure/api/router.py) | Add `GET /finished-goods/{fg_id}/traceability` endpoint and update `complete_production` to populate batch details. |
| **Frontend API** | [`frontend/src/lib/api-client.ts`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/frontend/src/lib/api-client.ts) | Add `getFinishedGoodsTraceability(fgId: string)` client method. |
| **Frontend UI** | [`frontend/src/routes/assembly.finished-goods.tsx`](file:///C:/Users/Kavya%20G/OneDrive/Desktop/kgs/KaizenAssests/frontend/src/routes/assembly.finished-goods.tsx) | Add "Traceability" action button and Traceability modal with View/Print/Download and "Print All" capabilities. |

---

## CONCLUSION

The KaizenX platform already possesses all essential primitives for full end-to-end QR traceability:
- GRN raw material QRs are persistently stored with complete payloads.
- Finished Goods QRs are persistently stored with work order references.
- Warehouse picking captures the raw material batch numbers and material scans.

Connecting the two ends requires **only a lightweight read-side aggregation endpoint and a dedicated frontend traceability view**. No existing working modules need to be rewritten, and no QR identities will be duplicated.

---
*Report generated in strict Read-Only mode. No application code, databases, or migrations were modified.*

