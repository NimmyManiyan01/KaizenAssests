"""Real ASN-first API execution on PostgreSQL, rolled back after every test.

Only supplier/material/store master data (and optional historical PO fixtures)
are seeded. ASN, Gate, Dock, GRN, QC and batch QRs use application APIs.
"""
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import json
import uuid
import importlib.util
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.common.persistence.models import (
    AsnModel, MaterialModel, NotificationModel, PurchaseOrderItemModel,
    PurchaseOrderModel, SupplierModel,
)
from app.database.session import UnitOfWork, engine, get_uow
from app.main import app
from app.modules.gate.infrastructure.persistence.models import DockAssignmentModel
from app.modules.receiving.infrastructure.persistence.models import GrnModel, GrnBatchQrModel, InventoryReceiptPostingModel
from app.modules.storage.infrastructure.persistence.models import PutawayTaskModel
from app.modules.store.infrastructure.persistence.models import StoreModel


@pytest.fixture
async def receiving_context(tmp_path, monkeypatch):
    monkeypatch.setattr("app.modules.receiving.infrastructure.api.router.UPLOAD_DIR", str(tmp_path))
    async with engine.connect() as connection:
        actual = await connection.scalar(text("SELECT current_database()"))
        assert actual == "kaizenassests_test_fg_b978662c"
        await connection.rollback()
        transaction = await connection.begin()

        class IsolatedUnitOfWork(UnitOfWork):
            async def __aenter__(self):
                self.session = AsyncSession(bind=connection, expire_on_commit=False,
                                            join_transaction_mode="create_savepoint")
                return self

        async def isolated_uow():
            async with IsolatedUnitOfWork() as uow:
                yield uow

        suffix = uuid.uuid4().hex[:10].upper()
        supplier_id, other_supplier_id, material_id, store_id = [uuid.uuid4() for _ in range(4)]
        warehouse = f"WH-FINAL-{suffix}"
        code = f"MAT-FINAL-{suffix}"
        async with IsolatedUnitOfWork() as uow:
            for index, identifier in enumerate((supplier_id, other_supplier_id)):
                uow.session.add(SupplierModel(
                    id=identifier, supplier_name=f"Final Supplier {index} {suffix}",
                    registered_company_name=f"Final Supplier {index} {suffix}",
                    vendor_type="MANUFACTURER", category=["RAW_MATERIAL"],
                    industry="MANUFACTURING", gstin=f"FINAL{suffix}{index}",
                    supplier_code=f"FINAL-{suffix}-{index}", status="Active",
                ))
            uow.session.add(MaterialModel(id=material_id, material_code=code,
                material_name=f"Final Material {suffix}", category="RAW_MATERIAL",
                base_uom="PCS", status="Active"))
            uow.session.add(StoreModel(id=store_id, store_code=f"FINAL-{suffix}",
                store_name=f"Final Store {suffix}", warehouse_id=warehouse, status="ACTIVE"))
        previous = app.dependency_overrides.get(get_uow)
        app.dependency_overrides[get_uow] = isolated_uow
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
                yield dict(client=client, uow=IsolatedUnitOfWork, suffix=suffix,
                    supplier_id=supplier_id, other_supplier_id=other_supplier_id,
                    material_id=material_id, store_id=store_id, warehouse=warehouse,
                    code=code, database=actual)
        finally:
            if previous is None:
                app.dependency_overrides.pop(get_uow, None)
            else:
                app.dependency_overrides[get_uow] = previous
            await transaction.rollback()


def supplier_headers(identifier):
    return {"Authorization": f"Bearer supplier-mock-token-{uuid.uuid4()}-{identifier}"}


def asn_payload(context):
    return dict(shipment_date=date.today().isoformat(),
        expected_arrival_at=(date.today() + timedelta(days=1)).isoformat(),
        destination_warehouse_id=str(context["store_id"]),
        vehicle_number="KA02AH2755", driver_name="Aarav Sharma", driver_contact="9876543210",
        lines=[dict(material_id=str(context["material_id"]), item_code=context["code"],
            material_name=f"Final Material {context['suffix']}", uom="PCS", shipped_quantity=25)])


@pytest.mark.parametrize("po_linked", [False, True])
async def test_asn_dispatch_notifies_operational_roles_with_persisted_shipment(receiving_context, po_linked):
    c = receiving_context
    payload = asn_payload(c)
    po_number = None
    if po_linked:
        po_number = f"PO-FINAL-{c['suffix']}"
        async with c["uow"]() as uow:
            uow.session.add(PurchaseOrderModel(id=uuid.uuid4(), po_number=po_number,
                po_date=date.today(), supplier_id=c["supplier_id"],
                supplier_name=f"Final Supplier 0 {c['suffix']}", status="APPROVED",
                warehouse_id=c["warehouse"], items=[PurchaseOrderItemModel(
                    material_id=c["material_id"], material_code=c["code"],
                    material_name=f"Final Material {c['suffix']}", quantity=25, unit_price=2, uom="PCS")]))
        payload["po_number"] = po_number
    response = await c["client"].post("/api/gate/asns", json=payload,
        headers=supplier_headers(c["supplier_id"]))
    assert response.status_code == 201, response.text
    asn = response.json()
    async with c["uow"]() as uow:
        rows = (await uow.session.scalars(select(NotificationModel).where(
            NotificationModel.idempotency_key.like(f"SUPPLIER_ASN_DISPATCHED:{asn['id']}:%")
        ))).all()
        assert len(rows) == 2
        assert {row.user_role for row in rows} == {"GATE_SECURITY", "WAREHOUSE"}
        for row in rows:
            assert row.asn_number == asn["asn_number"]
            assert row.po_number == po_number
            assert row.supplier_name == f"Final Supplier 0 {c['suffix']}"
            assert row.vehicle_number == "KA02AH2755"
            assert row.driver_name == "Aarav Sharma"
            assert row.driver_phone == "9876543210"
            data = json.loads(row.payload_json)
            assert data["asn_id"] == asn["id"]
            assert data["supplier_name"] == row.supplier_name
            assert data["lines"] == [{"material": c["code"], "quantity": 25.0, "uom": "PCS"}]
            assert c["code"] in row.message and asn["asn_number"] in row.message


async def test_po_free_asn_gate_dock_grn_posting_and_original_batch_qr(receiving_context):
    c = receiving_context
    client = c["client"]
    evidence = []

    async def call(method, url, payload=None, headers=None, expected=200):
        response = await client.request(method, url, json=payload, headers=headers)
        evidence.append(dict(method=method, url=url, status=response.status_code))
        print("API_EVIDENCE " + json.dumps(evidence[-1]))
        assert response.status_code == expected, f"{url}: {response.text}"
        return response.json()

    asn = await call("POST", "/api/gate/asns", asn_payload(c), supplier_headers(c["supplier_id"]), 201)
    assert asn["po_id"] is None and asn["po_number"] is None
    assert asn["supplier_id"] == str(c["supplier_id"])
    await call("GET", f"/api/gate/asn/{asn['id']}", headers=supplier_headers(c["other_supplier_id"]), expected=404)
    wh = {"X-User-Roles": "WAREHOUSE", "X-User-Name": "final_verification"}
    gate = await call("POST", "/api/gate-entries", {"asnReference": asn["asn_number"]}, wh, 201)
    assert gate["poNumber"] is None
    gate_id = gate["id"]
    dock = await call("POST", "/api/gate-entries/docks", dict(
        dock_number=f"FINAL-{c['suffix']}", warehouse_id=c["warehouse"],
        dock_type="RAW_MATERIAL", capacity=1), wh, 201)
    assignment = await call("POST", f"/api/gate-entries/{gate_id}/assign-dock",
        {"dockId": dock["id"], "storeId": str(c["store_id"])}, wh)
    assert assignment["po_id"] is None
    for action in ("start-dock-movement", "dock-check-in", "start-unloading"):
        await call("POST", f"/api/gate-entries/{gate_id}/{action}", headers=wh)
    await call("PUT", f"/api/gate-entries/{gate_id}/receiving-quantities",
        {"items": [{"itemCode": c["code"], "receivedQuantity": 25}]}, wh)
    await call("PUT", f"/api/gate-entries/{gate_id}/material-conditions", {"items": [dict(
        itemCode=c["code"], goodQuantity=25, physicalConditionOk=True, packagingOk=True,
        specificationsOk=True, serialBatchVerified=True, inspectionRequired=True)]}, wh)
    await call("POST", f"/api/gate-entries/{gate_id}/quality-inspection", {"decision": "PASS"}, wh)
    await call("POST", f"/api/gate-entries/{gate_id}/handling-units", headers=wh)
    header = await call("POST", "/api/receiving/grn/header", dict(receipt_type="ASN_RECEIPT",
        asn_number=asn["asn_number"], gate_entry_id=gate_id,
        dock_number=f"FINAL-{c['suffix']}"), wh)
    grn_id = header["grnId"]
    assert header["poId"] is None and header["poNumber"] is None
    await call("PUT", f"/api/receiving/grn/{grn_id}/lines", {"lines": [dict(
        item_code=c["code"], good_quantity=25, damaged_quantity=0)]}, wh)
    detail = await call("GET", f"/api/receiving/grn/{grn_id}", headers=wh)
    line_id = detail["lines"][0]["grnLineId"]
    await call("POST", f"/api/receiving/grn/{grn_id}/quality", {"lines": [dict(
        grn_line_id=line_id, quality_result="PASS", accepted_quantity=25, quality_approved_quantity=25)]}, wh)
    batches = await call("POST", f"/api/receiving/grn/lines/{line_id}/batches",
        [{"batch_quantity": 10}, {"batch_quantity": 15}], wh)
    assert len(batches) == 2
    assert [Decimal(str(b["batch"]["batchQuantity"])) for b in batches] == [Decimal(10), Decimal(15)]
    assert all(b["qr"] and b["qr"]["qrPayload"] for b in batches)
    pdf = await client.get(f"/api/gate/asns/{asn['id']}/pdf", headers=supplier_headers(c["supplier_id"]))
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    uploaded = await client.post(f"/api/receiving/grn/{grn_id}/documents", headers=wh,
        data={"document_type": "ASN"}, files={"file": ("supplier-asn.pdf", pdf.content, "application/pdf")})
    print("API_EVIDENCE " + json.dumps(dict(method="POST", url=f"/api/receiving/grn/{grn_id}/documents", status=uploaded.status_code)))
    assert uploaded.status_code == 200, uploaded.text
    async with c["uow"]() as uow:
        for b in batches:
            qr = await uow.session.get(GrnBatchQrModel, uuid.UUID(b["qr"]["qrId"]))
            assert str(qr.batch_id) == b["batch"]["batchId"]
            assert qr.qr_code == b["qr"]["qrCode"]
            assert qr.qr_payload == b["qr"]["qrPayload"]
            print("QR_EVIDENCE " + json.dumps(dict(database=c["database"], asn=asn["asn_number"],
                gate=gate_id, grn=grn_id, batch=b["batch"]["batchNumber"], qr=qr.qr_code,
                payload_sha256=hashlib.sha256(qr.qr_payload.encode()).hexdigest(), po=None)))
    await call("POST", f"/api/receiving/grn/{grn_id}/complete", {}, wh)
    # A retry must not post stock/tasks again or regenerate original QRs.
    await call("POST", f"/api/receiving/grn/{grn_id}/complete", {}, wh)
    async with c["uow"]() as uow:
        persisted = await uow.session.get(GrnModel, uuid.UUID(grn_id))
        assert persisted.status == "COMPLETED"
        assert persisted.posted_at is not None
        assert persisted.po_id is None and persisted.po_number is None
        postings = (await uow.session.scalars(select(InventoryReceiptPostingModel).where(
            InventoryReceiptPostingModel.grn_id == persisted.id))).all()
        assert len(postings) == 1 and postings[0].posted_quantity == Decimal(25)
        assert postings[0].po_id is None and postings[0].po_number is None
        tasks = (await uow.session.scalars(select(PutawayTaskModel).where(
            PutawayTaskModel.grn_id == persisted.id))).all()
        assert len(tasks) == 2
        assert {task.batch_number for task in tasks} == {b["batch"]["batchNumber"] for b in batches}
        assert sorted(task.quantity for task in tasks) == [Decimal(10), Decimal(15)]
        for b in batches:
            qr = await uow.session.get(GrnBatchQrModel, uuid.UUID(b["qr"]["qrId"]))
            assert qr.qr_code == b["qr"]["qrCode"]
            assert qr.qr_payload == b["qr"]["qrPayload"]


async def test_putaway_batch_migration_preserves_rows_and_guards_downgrade(receiving_context):
    async with receiving_context["uow"]() as uow:
        def verify(session):
            conn = session.connection()
            schema = "final_migration_" + uuid.uuid4().hex
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            conn.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            conn.execute(text("CREATE TABLE putaway_task (grn_id UUID NOT NULL, item_code TEXT NOT NULL, batch_number TEXT, CONSTRAINT uq_putaway_task_grn_item UNIQUE(grn_id,item_code))"))
            identifier = uuid.uuid4()
            conn.execute(text("INSERT INTO putaway_task VALUES (:id,'MATERIAL','BATCH-A')"), {"id": identifier})
            path = Path(__file__).resolve().parents[2] / "alembic/versions/20261035_putaway_batch_uniqueness.py"
            spec = importlib.util.spec_from_file_location("putaway_batch_migration", path)
            migration = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(migration)
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                conn.execute(text("INSERT INTO putaway_task VALUES (:id,'MATERIAL','BATCH-B')"), {"id": identifier})
                assert conn.scalar(text("SELECT count(*) FROM putaway_task")) == 2
                with pytest.raises(RuntimeError, match="multiple batch tasks"):
                    migration.downgrade()
                with conn.begin_nested() as savepoint:
                    with pytest.raises(IntegrityError):
                        conn.execute(text("INSERT INTO putaway_task VALUES (:id,'MATERIAL','BATCH-A')"), {"id": identifier})
                    savepoint.rollback()
                conn.execute(text("DELETE FROM putaway_task WHERE batch_number='BATCH-B'"))
                migration.downgrade()
                assert conn.scalar(text("SELECT batch_number FROM putaway_task")) == "BATCH-A"
                migration.upgrade()
        await uow.session.run_sync(verify)
