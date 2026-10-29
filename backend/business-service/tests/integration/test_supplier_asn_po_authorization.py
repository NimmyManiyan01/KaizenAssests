"""Supplier ASN PO ownership and reference validation on disposable PostgreSQL."""

from datetime import date, timedelta
from decimal import Decimal
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, or_, select, text

from app.common.persistence.models import (
    AsnModel,
    AsnLineModel,
    AsnDocumentModel,
    MaterialModel,
    NotificationModel,
    PurchaseOrderItemModel,
    PurchaseOrderModel,
    SupplierModel,
)
from app.database.session import AsyncSessionFactory
from app.main import app
from app.modules.gate.infrastructure.persistence.models import GateEntryModel


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture
async def po_suppliers_and_materials():
    suffix = uuid.uuid4().hex[:12].upper()
    supplier_ids = [uuid.uuid4(), uuid.uuid4()]
    material_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
    po_ids = [uuid.uuid4(), uuid.uuid4()]
    suppliers = [
        SupplierModel(
            id=supplier_ids[i], supplier_name=f"Phase 6D2 Supplier {i} {suffix}",
            registered_company_name=f"Phase 6D2 Supplier {i} {suffix} Ltd",
            vendor_type="MANUFACTURER", category=["RAW_MATERIAL"],
            industry="MANUFACTURING", gstin=f"P6D2{suffix}{i}",
            supplier_code=f"P6D2-S-{i}-{suffix}", status="Active",
        )
        for i in range(2)
    ]
    materials = [
        MaterialModel(
            id=material_ids[0], material_code=f"P6D2-A-{suffix}",
            material_name=f"Phase 6D2 Material A {suffix}", category="RAW_MATERIAL",
            base_uom="PCS", status="Active",
        ),
        MaterialModel(
            id=material_ids[1], material_code=f"P6D2-B-{suffix}",
            material_name=f"Phase 6D2 Material B {suffix}", category="RAW_MATERIAL",
            base_uom="PCS", status="Active",
        ),
        MaterialModel(
            id=material_ids[2], material_code=f"P6D2-C-{suffix}",
            material_name=f"Phase 6D2 Material C {suffix}", category="RAW_MATERIAL",
            base_uom="PCS", status="Active",
        ),
    ]
    po_numbers = [f"P6D2-PO-A-{suffix}", f"P6D2-PO-B-{suffix}"]
    async with AsyncSessionFactory() as session:
        db_name = (await session.execute(text("SELECT current_database()"))).scalar_one().lower()
        assert db_name.startswith("kaizenassests_test_") or db_name.endswith("_test")
        session.add_all([*suppliers, *materials])
        await session.flush()
        for index in range(2):
            session.add(PurchaseOrderModel(
                id=po_ids[index], po_number=po_numbers[index], po_date=date.today(),
                status="APPROVED", supplier_id=supplier_ids[index],
                supplier_name=suppliers[index].supplier_name, warehouse_id="MAIN",
                total_amount=Decimal("90"), expected_delivery_date=date.today() + timedelta(days=30),
                items=[
                    PurchaseOrderItemModel(
                        material_id=material_ids[0], material_code=materials[0].material_code,
                        material_name=materials[0].material_name, quantity=Decimal("25"),
                        unit_price=Decimal("2"), uom="PCS",
                    ),
                    PurchaseOrderItemModel(
                        material_id=material_ids[1], material_code=materials[1].material_code,
                        material_name=materials[1].material_name, quantity=Decimal("20"),
                        unit_price=Decimal("2"), uom="PCS",
                    ),
                ],
            ))
        await session.commit()

    data = {
        "suffix": suffix,
        "supplier_ids": supplier_ids,
        "material_ids": material_ids,
        "po_ids": po_ids,
        "po_numbers": po_numbers,
        "materials": materials,
    }
    try:
        yield data
    finally:
        async with AsyncSessionFactory() as session:
            asn_ids = list((await session.execute(
                select(AsnModel.id).where(AsnModel.supplier_id.in_(supplier_ids))
            )).scalars().all())
            if asn_ids:
                await session.execute(delete(GateEntryModel).where(GateEntryModel.asn_id.in_(asn_ids)))
                await session.execute(delete(AsnLineModel).where(AsnLineModel.asn_id.in_(asn_ids)))
                await session.execute(delete(AsnDocumentModel).where(AsnDocumentModel.asn_id.in_(asn_ids)))
                await session.execute(delete(NotificationModel).where(or_(*[
                    NotificationModel.idempotency_key.like(f"SUPPLIER_ASN_DISPATCHED:{asn_id}:%")
                    for asn_id in asn_ids
                ])))
                await session.execute(delete(AsnModel).where(AsnModel.id.in_(asn_ids)))
            await session.execute(delete(PurchaseOrderItemModel).where(PurchaseOrderItemModel.purchase_order_id.in_(po_ids)))
            await session.execute(delete(PurchaseOrderModel).where(PurchaseOrderModel.id.in_(po_ids)))
            await session.execute(delete(MaterialModel).where(MaterialModel.id.in_(material_ids)))
            await session.execute(delete(SupplierModel).where(SupplierModel.id.in_(supplier_ids)))
            await session.commit()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as http:
        yield http


def supplier_headers(supplier_id: uuid.UUID) -> dict[str, str]:
    user_id = uuid.uuid4()
    return {"Authorization": f"Bearer supplier-mock-token-{user_id}-{supplier_id}"}


def valid_payload(data, *, po_index=0):
    materials = data["materials"]
    return {
        "po_number": data["po_numbers"][po_index],
        "po_id": str(data["po_ids"][po_index]),
        "shipment_date": date.today().isoformat(),
        "expected_arrival_at": (date.today() + timedelta(days=1)).isoformat(),
        "vehicle_number": "KA02AH2755",
        "driver_name": "Aarav Sharma",
        "driver_contact": "9876543210",
        "lines": [
            {"material_id": str(data["material_ids"][0]), "item_code": materials[0].material_code,
             "material_name": materials[0].material_name, "uom": "PCS", "shipped_quantity": 25},
            {"material_id": str(data["material_ids"][1]), "item_code": materials[1].material_code,
             "material_name": materials[1].material_name, "uom": "PCS", "shipped_quantity": 20},
        ],
    }


async def count_asns_for_po(po_number: str) -> int:
    async with AsyncSessionFactory() as session:
        return int(await session.scalar(
            select(func.count()).select_from(AsnModel).where(AsnModel.po_number == po_number)
        ))


@pytest.mark.anyio
@pytest.mark.parametrize("reference_mode", ["both", "number_only", "id_only"])
async def test_supplier_creates_asn_for_own_multimaterial_po(client, po_suppliers_and_materials, reference_mode):
    data = po_suppliers_and_materials
    payload = valid_payload(data)
    if reference_mode == "number_only":
        payload.pop("po_id")
    elif reference_mode == "id_only":
        payload.pop("po_number")
    response = await client.post(
        "/api/gate/asns", json=payload,
        headers=supplier_headers(data["supplier_ids"][0]),
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["po_number"] == data["po_numbers"][0]
    assert result["supplier_id"] == str(data["supplier_ids"][0])
    assert len(result["lines"]) == 2
    assert {line["item_code"]: float(line["shipped_quantity"]) for line in result["lines"]} == {
        data["materials"][0].material_code: 25,
        data["materials"][1].material_code: 20,
    }
    async with AsyncSessionFactory() as session:
        asn = await session.scalar(select(AsnModel).where(AsnModel.asn_number == result["asn_number"]))
        assert asn is not None
        assert asn.supplier_id == data["supplier_ids"][0]
        assert asn.po_id == str(data["po_ids"][0])
        assert asn.po_number == data["po_numbers"][0]
        lines = list((await session.scalars(select(AsnLineModel).where(AsnLineModel.asn_id == asn.id))).all())
        assert len(lines) == 2


@pytest.mark.anyio
async def test_supplier_creates_asn_without_purchase_order(client, po_suppliers_and_materials):
    data = po_suppliers_and_materials
    payload = valid_payload(data)
    payload.pop("po_id")
    payload.pop("po_number")
    payload["supplier_id"] = str(data["supplier_ids"][1])
    response = await client.post(
        "/api/gate/asns", json=payload,
        headers=supplier_headers(data["supplier_ids"][0]),
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["supplier_id"] == str(data["supplier_ids"][0])
    assert result["po_id"] is None
    assert result["po_number"] is None
    assert len(result["lines"]) == 2
    async with AsyncSessionFactory() as session:
        asn = await session.scalar(select(AsnModel).where(AsnModel.asn_number == result["asn_number"]))
        assert asn is not None
        assert asn.supplier_id == data["supplier_ids"][0]
        assert asn.po_id is None
        assert asn.po_number is None

    gate_payload = {"asnReference": result["asn_number"]}
    gate_response = await client.post("/api/gate-entries", json=gate_payload)
    assert gate_response.status_code == 201, gate_response.text
    gate_entry = gate_response.json()
    assert gate_entry["asnId"] == result["id"]
    assert gate_entry["poNumber"] is None
    duplicate_response = await client.post("/api/gate-entries", json=gate_payload)
    assert duplicate_response.status_code == 409, duplicate_response.text


@pytest.mark.anyio
async def test_gate_entry_preserves_historical_asn_purchase_order(client, po_suppliers_and_materials):
    data = po_suppliers_and_materials
    created = await client.post(
        "/api/gate/asns", json=valid_payload(data),
        headers=supplier_headers(data["supplier_ids"][0]),
    )
    assert created.status_code == 201, created.text
    response = await client.post("/api/gate-entries", json={"asnReference": created.json()["asn_number"]})
    assert response.status_code == 201, response.text
    assert response.json()["poNumber"] == data["po_numbers"][0]
    assert response.json()["asnId"] == created.json()["id"]


@pytest.mark.anyio
@pytest.mark.parametrize("reference", ["ASN-STABILIZATION-DOES-NOT-EXIST", "00000000-0000-0000-0000-000000000000"])
async def test_gate_entry_rejects_invalid_asn_reference(client, reference):
    response = await client.post("/api/gate-entries", json={"asnReference": reference})
    assert response.status_code == 404, response.text


@pytest.mark.anyio
async def test_supplier_cannot_reference_another_suppliers_po(client, po_suppliers_and_materials):
    data = po_suppliers_and_materials
    before = await count_asns_for_po(data["po_numbers"][1])
    response = await client.post(
        "/api/gate/asns", json={**valid_payload(data, po_index=1), "supplier_id": str(data["supplier_ids"][1])},
        headers=supplier_headers(data["supplier_ids"][0]),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Purchase order not found or unavailable"
    assert await count_asns_for_po(data["po_numbers"][1]) == before


@pytest.mark.anyio
@pytest.mark.parametrize("case", ["nonexistent", "malformed", "mismatched_pair"])
async def test_invalid_po_references_are_rejected_without_asn(client, po_suppliers_and_materials, case):
    data = po_suppliers_and_materials
    payload = valid_payload(data)
    if case == "nonexistent":
        payload["po_number"] = f"MISSING-{data['suffix']}"
        payload.pop("po_id")
    elif case == "malformed":
        payload["po_id"] = "not-a-uuid"
        payload.pop("po_number")
    else:
        payload["po_id"] = str(data["po_ids"][1])
    before = await count_asns_for_po(data["po_numbers"][0])
    response = await client.post(
        "/api/gate/asns", json=payload,
        headers=supplier_headers(data["supplier_ids"][0]),
    )
    assert response.status_code in {404, 422}
    assert await count_asns_for_po(data["po_numbers"][0]) == before


@pytest.mark.anyio
async def test_material_not_on_po_is_rejected_without_asn(client, po_suppliers_and_materials):
    data = po_suppliers_and_materials
    payload = valid_payload(data)
    unlisted = data["materials"][2]
    payload["lines"][0].update({
        "material_id": str(data["material_ids"][2]),
        "item_code": unlisted.material_code,
        "material_name": unlisted.material_name,
    })
    before = await count_asns_for_po(data["po_numbers"][0])
    response = await client.post(
        "/api/gate/asns", json=payload,
        headers=supplier_headers(data["supplier_ids"][0]),
    )
    assert response.status_code == 422
    assert "not on the purchase order" in response.json()["detail"]
    assert await count_asns_for_po(data["po_numbers"][0]) == before


@pytest.mark.anyio
@pytest.mark.parametrize("operation", ["cancel", "delete"])
@pytest.mark.parametrize("po_linked", [True, False])
async def test_supplier_cannot_mutate_another_suppliers_asn(client, po_suppliers_and_materials, operation, po_linked):
    data = po_suppliers_and_materials
    payload = valid_payload(data)
    if not po_linked:
        payload.pop("po_id")
        payload.pop("po_number")
    created = await client.post(
        "/api/gate/asns", json=payload,
        headers=supplier_headers(data["supplier_ids"][0]),
    )
    assert created.status_code == 201, created.text
    asn_number = created.json()["asn_number"]

    if operation == "cancel":
        response = await client.post(
            f"/api/gate/asns/{asn_number}/cancel",
            headers=supplier_headers(data["supplier_ids"][1]),
        )
    else:
        response = await client.delete(
            f"/api/gate/asns/{asn_number}",
            headers=supplier_headers(data["supplier_ids"][1]),
        )
    assert response.status_code == 404

    async with AsyncSessionFactory() as session:
        asn = await session.scalar(select(AsnModel).where(AsnModel.asn_number == asn_number))
        assert asn is not None
        assert asn.supplier_id == data["supplier_ids"][0]
        assert asn.status == "SUBMITTED"


@pytest.mark.anyio
@pytest.mark.parametrize("po_linked", [True, False])
async def test_supplier_asn_reads_are_scoped_to_authenticated_owner(client, po_suppliers_and_materials, po_linked):
    data = po_suppliers_and_materials
    payload = valid_payload(data)
    if not po_linked:
        payload.pop("po_id")
        payload.pop("po_number")
    owner = supplier_headers(data["supplier_ids"][0])
    other = supplier_headers(data["supplier_ids"][1])
    created = await client.post("/api/gate/asns", json=payload, headers=owner)
    assert created.status_code == 201, created.text
    asn = created.json()
    for reference in (asn["id"], asn["asn_number"]):
        detail_url = f"/api/gate/asn/{reference}"
        own_detail = await client.get(detail_url, headers=owner)
        assert own_detail.status_code == 200, own_detail.text
        assert own_detail.json()["id"] == asn["id"]
        assert (await client.get(detail_url, headers=other)).status_code == 404
        assert (await client.get(f"/api/gate/asns/{reference}/pdf", headers=other)).status_code == 404
    own_pdf = await client.get(f"/api/gate/asns/{asn['id']}/pdf", headers=owner)
    assert own_pdf.status_code == 200, own_pdf.text
    assert own_pdf.content.startswith(b"%PDF")
    own_list = await client.get("/api/gate/expected-deliveries", headers=owner)
    assert own_list.status_code == 200
    assert asn["id"] in {row["id"] for row in own_list.json()}
    assert all(row["supplier_id"] == str(data["supplier_ids"][0]) for row in own_list.json())
    for url in ("/api/gate/expected-deliveries", f"/api/gate/expected-deliveries?supplier_id={data['supplier_ids'][0]}"):
        other_list = await client.get(url, headers=other)
        assert other_list.status_code == 200
        assert asn["id"] not in {row["id"] for row in other_list.json()}


@pytest.mark.anyio
async def test_unauthenticated_or_non_supplier_request_is_rejected(client, po_suppliers_and_materials):
    data = po_suppliers_and_materials
    before = await count_asns_for_po(data["po_numbers"][0])
    response = await client.post("/api/gate/asns", json=valid_payload(data))
    assert response.status_code == 403
    assert await count_asns_for_po(data["po_numbers"][0]) == before
