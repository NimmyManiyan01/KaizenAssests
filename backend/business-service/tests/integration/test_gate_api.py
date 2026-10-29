"""
Integration tests for FastAPI REST APIs:
- Gate Entry ANPR & OCR Preview (/api/gate/anpr-ocr-preview)
- Gate Entry Creation & Duplicate Prevention (/api/gate-entries)
- Gate Entry Verification/Approval (/api/gate-entries/{id}/verify)
- Gate Entry Retrieval (/api/gate-entries/{id})
- Reset Dev Entries (/api/gate-entries/reset-dev-entries)
- Receiving GRN Confirmation & Lookup (/api/receiving/grn)
- Health and Ops Endpoints (/health, /health/ready)
"""
import base64
from datetime import date, timedelta
from decimal import Decimal
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.common.persistence.models import PurchaseOrderItemModel, PurchaseOrderModel, SupplierModel
from app.database.session import AsyncSessionFactory
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac


@pytest_asyncio.fixture(autouse=True)
async def seed_gate_purchase_orders():
    """Provide deterministic PO master records for Gate API integration tests."""
    po_numbers = (
        "PO-1001",
        "PO-1003",
        "PO-1003-DIFF",
        "PO-1004",
        "PO-1005",
    )
    async with AsyncSessionFactory() as session:
        supplier = await session.scalar(
            select(SupplierModel).where(SupplierModel.supplier_code == "GATE-TEST-SUPPLIER")
        )
        if supplier is None:
            supplier = SupplierModel(
                id=uuid.uuid4(),
                supplier_name="Gate Test Supplier",
                registered_company_name="Gate Test Supplier Ltd",
                vendor_type="MANUFACTURER",
                category=["RAW_MATERIAL"],
                industry="MANUFACTURING",
                gstin="GATE-TEST-GSTIN-001",
                supplier_code="GATE-TEST-SUPPLIER",
                main_materials=["GATE-TEST-MATERIAL"],
                status="Active",
            )
            session.add(supplier)
            await session.flush()
        for po_number in po_numbers:
            purchase_order = await session.scalar(
                select(PurchaseOrderModel).where(PurchaseOrderModel.po_number == po_number)
            )
            if purchase_order is None:
                purchase_order = PurchaseOrderModel(
                    id=uuid.uuid4(),
                    po_number=po_number,
                    po_date=date.today(),
                    status="APPROVED",
                    supplier_id=supplier.id,
                    supplier_name="Gate Test Supplier",
                    total_amount=Decimal("100.00"),
                    expected_delivery_date=date.today() + timedelta(days=30),
                )
                session.add(purchase_order)
                await session.flush()
            else:
                purchase_order.supplier_id = supplier.id
                purchase_order.supplier_name = "Gate Test Supplier"
                purchase_order.status = "APPROVED"

            item = await session.scalar(
                select(PurchaseOrderItemModel).where(
                    PurchaseOrderItemModel.purchase_order_id == purchase_order.id
                )
            )
            if item is None:
                item = PurchaseOrderItemModel(
                    id=uuid.uuid4(),
                    purchase_order_id=purchase_order.id,
                    material_code="GATE-TEST-MATERIAL",
                    material_name="Gate Test Material",
                    quantity=Decimal("100"),
                    unit_price=Decimal("1"),
                    uom="PCS",
                )
                session.add(item)
        await session.commit()


@pytest.fixture
def gate_test_vehicle():
    return f"TS-09-EA-{uuid.uuid4().int % 10000:04d}"


import io
from PIL import Image

def make_dummy_image_base64() -> str:
    img = Image.new("RGB", (100, 100), color="white")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")



@pytest.mark.anyio
async def test_health_endpoints(client: AsyncClient):
    """Verify system health and readiness endpoints."""
    res_health = await client.get("/health")
    assert res_health.status_code == 200
    data = res_health.json()
    assert data["status"] == "UP"
    assert "service" in data

    res_ready = await client.get("/health/ready")
    assert res_ready.status_code == 200
    assert res_ready.json() == {"status": "READY"}


@pytest.mark.anyio
async def test_anpr_ocr_preview_full_match(client: AsyncClient):
    """Test /api/gate/po-ocr-preview with matched PO returning PO_VERIFIED status."""
    img_b64 = make_dummy_image_base64()
    payload = {
        "poNumberOverride": "PO-1001",
        "documentImageBase64": img_b64,
    }

    response = await client.post("/api/gate/po-ocr-preview", json=payload)
    assert response.status_code == 200, f"Preview failed: {response.text}"
    data = response.json()

    assert data["computedStatus"] == "PO_VERIFIED"
    assert len(data["mismatchedFields"]) == 0
    assert data["ocrResult"]["poNumber"] == "PO-1001"
    assert data["poRecord"]["poNumber"] == "PO-1001"


@pytest.mark.anyio
async def test_purchase_order_lookup_endpoint(client: AsyncClient):
    """Verify the canonical purchase-order lookup returns a stored PO."""
    response = await client.get("/api/gate/purchase-orders/PO-1001")
    assert response.status_code == 200, f"PO List failed: {response.text}"
    records = response.json()
    assert records["poNumber"] == "PO-1001"
    assert records["supplierName"] == "Gate Test Supplier"



@pytest.mark.anyio
async def test_anpr_ocr_preview_unscheduled_arrival(client: AsyncClient):
    """Test preview with unknown PO triggering UNSCHEDULED_ARRIVAL."""
    img_b64 = make_dummy_image_base64()
    payload = {
        "poNumberOverride": "PO-UNKNOWN-9999",
        "documentImageBase64": img_b64,
    }

    response = await client.post("/api/gate/po-ocr-preview", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["computedStatus"] == "UNSCHEDULED_ARRIVAL"
    assert data["poRecord"] is None


@pytest.mark.anyio
async def test_gate_entry_lifecycle_create_verify_lookup(client: AsyncClient, gate_test_vehicle: str):
    """Test Gate Entry create, lookup and supervisor approval."""
    img_b64 = make_dummy_image_base64()
    create_payload = {
        "vehiclePlate": gate_test_vehicle,
        "poNumber": "PO-1001",
        "supplierName": "Gate Test Supplier",
        "totalQuantity": 100,
        "documentImageBase64": img_b64,
    }

    create_res = await client.post("/api/gate-entries", json=create_payload)
    assert create_res.status_code == 201, f"Create failed: {create_res.text}"
    created_data = create_res.json()

    entry_id = created_data["id"]
    gate_entry_number = created_data["gateEntryNumber"]
    assert entry_id is not None
    assert gate_entry_number and len(gate_entry_number) == 6
    assert created_data["vehiclePlate"] == gate_test_vehicle
    assert created_data["poNumber"] == "PO-1001"
    assert created_data["status"] == "AWAITING_DOCK"
    assert created_data["ocrResult"] is not None


    # 3. Lookup Gate Entry by ID
    get_res = await client.get(f"/api/gate-entries/{entry_id}")
    assert get_res.status_code == 200
    fetched_data = get_res.json()
    assert fetched_data["id"] == entry_id
    assert fetched_data["gateEntryNumber"] == gate_entry_number

    # 4. Supervisor Verification (APPROVE)
    verify_payload = {
        "action": "APPROVE",
        "remarks": "Driver credentials and physical seal intact",
        "reason": "Security protocol checklist complete",
    }
    verify_res = await client.post(f"/api/gate-entries/{entry_id}/verify", json=verify_payload)
    assert verify_res.status_code == 200
    verified_data = verify_res.json()
    assert verified_data["status"] == "APPROVED"
    assert verified_data["verifiedBy"] is not None


@pytest.mark.anyio
async def test_duplicate_active_gate_entry_rejection(client: AsyncClient, gate_test_vehicle: str):
    """Test duplicate active PO rejection and a second PO for the same vehicle."""
    img_b64 = make_dummy_image_base64()
    payload = {
        "vehiclePlate": gate_test_vehicle,
        "poNumber": "PO-1003",
        "supplierName": "Gate Test Supplier",
        "totalQuantity": 100,
        "anprImageBase64": img_b64,
        "documentImageBase64": img_b64,
    }

    # 2. First creation succeeds
    res1 = await client.post("/api/gate-entries", json=payload)
    assert res1.status_code == 201

    # 3. An active entry for this vehicle blocks another attempt with HTTP 409.
    res2 = await client.post("/api/gate-entries", json=payload)
    assert res2.status_code == 409
    err_data = res2.json()
    assert "already has active Gate Pass" in err_data["detail"]

    # The same vehicle remains blocked even when another PO is supplied.
    payload_diff_po = {
        "vehiclePlate": gate_test_vehicle,
        "poNumber": "PO-1003-DIFF",
        "supplierName": "Gate Test Supplier",
        "totalQuantity": 100,
        "anprImageBase64": img_b64,
        "documentImageBase64": img_b64,
    }
    res3 = await client.post("/api/gate-entries", json=payload_diff_po)
    assert res3.status_code == 409
    assert "already has active Gate Pass" in res3.json()["detail"]


@pytest.mark.anyio
async def test_supervisor_rejection_flow(client: AsyncClient, gate_test_vehicle: str):
    """Test supervisor rejection workflow."""
    img_b64 = make_dummy_image_base64()
    create_payload = {
        "vehiclePlate": gate_test_vehicle,
        "poNumber": "PO-1004",
        "supplierName": "Gate Test Supplier",
        "totalQuantity": 100,
        "anprImageBase64": img_b64,
        "documentImageBase64": img_b64,
    }

    create_res = await client.post("/api/gate-entries", json=create_payload)
    assert create_res.status_code == 201
    entry_id = create_res.json()["id"]

    reject_payload = {
        "action": "REJECT",
        "remarks": "Tampered seal detected on cargo container",
        "reason": "Security protocol violation",
    }
    reject_res = await client.post(f"/api/gate-entries/{entry_id}/verify", json=reject_payload)
    assert reject_res.status_code == 200
    data = reject_res.json()
    assert data["status"] == "REJECTED"


@pytest.mark.anyio
async def test_verify_gate_entry_move_to_unscheduled(client: AsyncClient, gate_test_vehicle: str):
    """Test /api/gate-entries/{entry_id}/verify with UNSCHEDULED_ARRIVAL action."""
    img_b64 = make_dummy_image_base64()
    create_payload = {
        "vehiclePlate": gate_test_vehicle,
        "poNumber": "PO-1005",
        "supplierName": "Gate Test Supplier",
        "totalQuantity": 100,
        "documentImageBase64": img_b64,
    }

    create_res = await client.post("/api/gate-entries", json=create_payload)
    assert create_res.status_code == 201
    entry_id = create_res.json()["id"]

    verify_payload = {
        "action": "UNSCHEDULED_ARRIVAL",
        "remarks": "Reclassified as unscheduled arrival after pending review",
        "reason": "Supervisor override",
    }
    verify_res = await client.post(f"/api/gate-entries/{entry_id}/verify", json=verify_payload)
    assert verify_res.status_code == 200
    data = verify_res.json()
    assert data["status"] == "UNSCHEDULED_ARRIVAL"



@pytest.mark.anyio
async def test_ocr_scan_endpoint(client: AsyncClient):
    """Test /api/gate/ocr/scan endpoint returns structured preview JSON."""
    img_b64 = make_dummy_image_base64()
    res = await client.post("/api/gate/ocr/scan", json={"documentImageBase64": img_b64})
    assert res.status_code == 200
    data = res.json()
    assert "ocrResult" in data
    assert "computedStatus" in data
