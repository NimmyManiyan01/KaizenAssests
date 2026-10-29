"""PostgreSQL integration coverage for batch-linked consumption traceability.

Run only against a disposable database named kaizenassests_test_* or *_test.
"""

from __future__ import annotations

import uuid
from datetime import datetime
import asyncio

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from httpx import ASGITransport, AsyncClient

from app.database.session import get_uow
from app.main import app
from app.modules.assembly.infrastructure.persistence.models import AssemblyOrderModel, AssemblyFinishedGoodsModel
from app.security.dependencies import CurrentUser, get_current_user

from tests.conftest import _get_test_database_url


@pytest.fixture
async def db():
    engine = create_async_engine(_get_test_database_url())
    try:
        # The application lifespan supplies this legacy ORM compatibility
        # column in deployed databases; pytest does not run that lifespan.
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE assembly_order ADD COLUMN IF NOT EXISTS putaway_status VARCHAR(32) NOT NULL DEFAULT 'PUTAWAY_PENDING'"))
            await conn.execute(text("ALTER TABLE grn_batch ADD COLUMN IF NOT EXISTS superseded BOOLEAN NOT NULL DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE inventory_movement_history ADD COLUMN IF NOT EXISTS confirmation_id VARCHAR(64)"))
            await conn.execute(text("ALTER TABLE inventory_movement_history ADD COLUMN IF NOT EXISTS confirmation_hash VARCHAR(64)"))
            await conn.execute(text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS held_quantity NUMERIC(18,4) NOT NULL DEFAULT 0"))
            await conn.execute(text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS rejected_reason TEXT"))
            await conn.execute(text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS damage_reason TEXT"))
            await conn.execute(text("ALTER TABLE grn_line ADD COLUMN IF NOT EXISTS held_reason TEXT"))
        yield engine
    finally:
        await engine.dispose()


async def seed_order(conn, *, material="STEEL-PIPE", batch_count=1, issue_qty=100):
    """Create a complete warehouse issue chain accepted by the DB validator."""
    new_id = lambda: uuid.uuid4()
    order_id, grn_id = new_id(), new_id()
    line_id, request_id, task_id, issue_id = new_id(), new_id(), new_id(), new_id()
    task_number = f"PT-{uuid.uuid4().hex[:12]}"
    issue_number = f"MI-{uuid.uuid4().hex[:12]}"
    request_number = f"REQ-{uuid.uuid4().hex[:8]}"
    await conn.execute(text("""INSERT INTO material_request
        (id,request_number,warehouse_id,department,requested_by,status,required_date)
        VALUES (:id,:number,'MAIN','Assembly','test','APPROVED',current_date)"""),
        {"id": request_id, "number": request_number})
    await conn.execute(text("INSERT INTO grn (id,status) VALUES (:id,'POSTED')"), {"id": grn_id})
    await conn.execute(text("""INSERT INTO grn_line (id,grn_id,item_code,received_quantity,good_quantity,
        quality_approved_quantity,balance_quantity) VALUES (:id,:grn,:material,:qty,:qty,:qty,:qty)"""),
        {"id": line_id, "grn": grn_id, "material": material, "qty": issue_qty})
    batches=[]
    for index in range(batch_count):
        batch_id, qr_id = new_id(), new_id()
        batch_number = f"LOT-{uuid.uuid4().hex[:10]}"
        qr_code = f"QR-{uuid.uuid4().hex}"
        await conn.execute(text("""INSERT INTO grn_batch (id,grn_line_id,batch_number,batch_quantity,created_by,created_at)
            VALUES (:id,:line,:number,:qty,'test',now())"""),
            {"id": batch_id, "line": line_id, "number": batch_number, "qty": issue_qty})
        await conn.execute(text("""INSERT INTO grn_batch_qr (id,batch_id,item_code,qr_code,qr_payload,generated_at)
            VALUES (:id,:batch,:material,:qr,:payload,now())"""),
            {"id": qr_id, "batch": batch_id, "material": material, "qr": qr_code,
             "payload": f"original-payload-{qr_code}"})
        batches.append({"id": batch_id, "number": batch_number, "qr_id": qr_id, "qr": qr_code})

    await conn.execute(text("""INSERT INTO pick_task
        (id,task_number,request_id,request_number,warehouse_id,department,items,status,created_by,created_at,destination)
        VALUES (:id,:number,:request,:request_number,'MAIN','Assembly','[]'::json,'COMPLETED','test',now(),'Assembly')"""),
        {"id": task_id, "number": task_number, "request": request_id, "request_number": request_number})
    await conn.execute(text("""INSERT INTO material_issue
        (id,issue_number,pick_task_id,request_id,department,items,issued_by,received_by,issued_at)
        SELECT :id,:number,:task,request_id,'Assembly','[]'::json,'test','test',now() FROM pick_task WHERE id=:task"""),
        {"id": issue_id, "number": issue_number, "task": task_id})
    # Use the application's client-side defaults rather than assuming that a
    # restored database has server defaults for every required order column.
    await conn.execute(AssemblyOrderModel.__table__.insert().values(
        id=order_id, order_number=f"ASM-{uuid.uuid4().hex[:10]}", pick_task_id=task_id,
        material_issue_id=issue_id, product_name="Test Product", created_by="test",
        items=[], assembly_steps=[], status="IN_PROGRESS"))
    for batch in batches:
        await conn.execute(text("""INSERT INTO inventory_movement_history
            (id,movement_type,material_code,material_name,batch_lot,from_location,to_location,quantity,uom,
             performed_by,warehouse_id,reference_document,performed_at)
            VALUES (:id,'TAKEAWAY',:material,:material,:batch,'WAREHOUSE','ASSEMBLY',:qty,'PCS','test','MAIN',:task,now())"""),
            {"id": new_id(), "material": material, "batch": batch["number"], "qty": issue_qty,
             "task": task_number})
    return {"order": order_id, "task": task_id, "task_number": task_number,
            "issue": issue_id, "issue_number": issue_number, "batches": batches}


async def insert_event(conn, setup, batch, *, qty=10, key=None, material="STEEL-PIPE", with_qr=True):
    event_id = uuid.uuid4()
    await conn.execute(text("""INSERT INTO assembly_material_consumption_event
        (id,assembly_order_id,material_code,grn_batch_id,grn_batch_qr_id,material_qr,
         idempotency_key,actual_consumed,uom,consumed_at,recorded_by)
        VALUES (:id,:order,:material,:batch,:qr_id,:qr,:key,:qty,'PCS',:at,'test')"""), {
        "id": event_id, "order": setup["order"], "material": material,
        "batch": batch["id"], "qr_id": batch["qr_id"] if with_qr else None,
        "qr": batch["qr"] if with_qr else None,
        "key": key or str(uuid.uuid4()), "qty": qty, "at": datetime.now(),
    })
    return event_id


async def make_order_ready_for_consumption(conn, setup, *, received=True, traceability_required=False):
    material = "STEEL-PIPE"
    total_issued = 100 * len(setup["batches"])
    batch = setup["batches"][0]
    await conn.execute(text("""UPDATE assembly_order SET status='IN_PRODUCTION',
        items=CAST(:items AS json), material_received_at=CASE WHEN :received THEN now() ELSE NULL END,
        traceability_required=:traceability WHERE id=:id"""), {
        "id": setup["order"], "received": received,
        "traceability": traceability_required,
        "items": '[{"material_code":"STEEL-PIPE","required_quantity":100,"issued_quantity":100,"received_quantity":100,"uom":"PCS"}]',
    })
    if received:
        await conn.execute(text("""INSERT INTO assembly_material_receipt
            (id,assembly_order_id,material_issue_id,material_code,material_qr,issued_quantity,received_quantity,
             uom,received_by,received_at)
            VALUES (:id,:order,:issue,:material,:qr,:issued,:received,'PCS','test',now())"""), {
            "id": uuid.uuid4(), "order": setup["order"], "issue": setup["issue"],
            "material": material, "qr": batch["qr"], "issued": total_issued, "received": total_issued,
        })


class _ApiUow:
    def __init__(self, session_factory):
        self.session_factory = session_factory
        self.session = None

    async def __aenter__(self):
        self.session = self.session_factory()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                await self.session.commit()
            else:
                await self.session.rollback()
        finally:
            await self.session.close()

    async def commit(self):
        await self.session.commit()

    async def rollback(self):
        await self.session.rollback()


@pytest.fixture
async def api_client(db):
    session_factory = async_sessionmaker(db, expire_on_commit=False)
    user = CurrentUser(subject="assembly-test", username="assembly-test", roles=["ASSEMBLY"], permissions=[], raw_claims={})

    async def override_uow():
        yield _ApiUow(session_factory)

    app.dependency_overrides[get_uow] = override_uow
    app.dependency_overrides[get_current_user] = lambda: user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, user
    app.dependency_overrides.pop(get_uow, None)
    app.dependency_overrides.pop(get_current_user, None)


def consumption_payload(batch, *, quantity=10, key=None, material="STEEL-PIPE", qr=None):
    return {
        "material_code": material,
        "grn_batch_id": str(batch["id"]),
        "material_qr": qr if qr is not None else batch["qr"],
        "actual_consumed": quantity,
        "uom": "PCS",
        "idempotency_key": key or str(uuid.uuid4()),
    }


async def seed_finished_goods(conn, setup, *, batch_number="FG-BATCH", quantity=1):
    fg_id = uuid.uuid4()
    batch_number = f"{batch_number}-{uuid.uuid4().hex[:8]}"
    order_number = await conn.scalar(text("SELECT order_number FROM assembly_order WHERE id=:id"), {"id": setup["order"]})
    await conn.execute(text("""UPDATE assembly_order SET product_code='FG-TEST', product_name='Test Finished Product',
        completed_quantity=:qty, status='COMPLETED' WHERE id=:id"""), {"id": setup["order"], "qty": quantity})
    qr_payload = f"FG|CODE:FG-TEST|NAME:Test Finished Product|ORDER:{order_number}|BATCH:{batch_number}|QTY:{quantity:g}|QC:QC_APPROVED|LOC:ASSEMBLY-STORAGE-01"
    await conn.execute(text("""INSERT INTO assembly_finished_goods
        (id,assembly_order_id,product_code,product_name,quantity,uom,status,warehouse_id,location_code,
         on_hand_before,on_hand_after,qr_code,serial_number,batch_number,posted_at,updated_at)
        VALUES (:id,:order,'FG-TEST','Test Finished Product',:qty,'PCS','QC_APPROVED','ASSEMBLY',
         'ASSEMBLY-STORAGE-01',0,:qty,:qr,:serial,:batch,now(),now())"""), {
        "id": fg_id, "order": setup["order"], "qty": quantity, "qr": qr_payload,
        "serial": f"SN-FG-{batch_number}", "batch": batch_number,
    })
    return {"id": fg_id, "batch_number": batch_number, "qr_payload": qr_payload,
            "serial_number": f"SN-FG-{batch_number}", "order_number": order_number}


@pytest.mark.asyncio
async def test_material_qr_verification_is_order_and_batch_specific(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn, batch_count=2)
        await make_order_ready_for_consumption(conn, setup)
    client, _ = api_client
    url = f"/api/v1/assembly/orders/{setup['order']}/material-consumption/verify"
    verified = await client.get(url, params={"scanned_qr": setup["batches"][0]["qr"]})
    assert verified.status_code == 200, verified.text
    assert verified.json()["grn_batch_id"] == str(setup["batches"][0]["id"])
    assert verified.json()["remaining_quantity"] == 100
    label_payload = f"Material Code: STEEL-PIPE\nBatch Number: {setup['batches'][0]['number']}\nBatch Quantity: 100 PCS"
    resolved_label = await client.get(url, params={"scanned_qr": label_payload})
    assert resolved_label.status_code == 200, resolved_label.text
    assert resolved_label.json()["material_qr"] == setup["batches"][0]["qr"]
    async with db.begin() as conn:
        await conn.execute(text("UPDATE assembly_order SET items='[]'::json WHERE id=:id"), {"id": setup["order"]})
    unassigned = await client.get(url, params={"scanned_qr": setup["batches"][0]["qr"]})
    assert unassigned.status_code == 409


@pytest.mark.asyncio
async def test_material_consumption_history_keeps_batch_events_separate(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn, batch_count=2)
        await make_order_ready_for_consumption(conn, setup, traceability_required=True)
        await insert_event(conn, setup, setup["batches"][0], qty=7)
        await insert_event(conn, setup, setup["batches"][1], qty=9)
    client, _ = api_client
    response = await client.get(f"/api/v1/assembly/orders/{setup['order']}/material-consumption")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["traceability_required"] is True
    assert body["can_complete"] is True
    assert len(body["events"]) == 2
    assert {event["grn_batch_id"] for event in body["events"]} == {
        str(setup["batches"][0]["id"]), str(setup["batches"][1]["id"])
    }


@pytest.mark.asyncio
async def test_event_links_original_batch_and_qr_and_keeps_qr_immutable(db):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        batch = setup["batches"][0]
        await insert_event(conn, setup, batch)
        status = await conn.scalar(text("SELECT traceability_status FROM assembly_material_consumption_traceability WHERE record_type='EVENT' AND assembly_order_id=:id"), {"id": setup["order"]})
        assert status == "VERIFIED"
        original = await conn.scalar(text("SELECT qr_payload FROM grn_batch_qr WHERE id=:id"), {"id": batch["qr_id"]})
        with pytest.raises(DBAPIError):
                async with conn.begin_nested():
                    await conn.execute(text("UPDATE grn_batch_qr SET qr_payload='replacement' WHERE id=:id"), {"id": batch["qr_id"]})
    async with db.connect() as conn:
        assert await conn.scalar(text("SELECT qr_payload FROM grn_batch_qr WHERE id=:id"), {"id": batch["qr_id"]}) == original


@pytest.mark.asyncio
async def test_same_material_supports_multiple_batches(db):
    async with db.begin() as conn:
        setup = await seed_order(conn, batch_count=2)
        await insert_event(conn, setup, setup["batches"][0], qty=10)
        await insert_event(conn, setup, setup["batches"][1], qty=15)
        rows = (await conn.execute(text("SELECT count(*), count(DISTINCT grn_batch_id) FROM assembly_material_consumption_event WHERE assembly_order_id=:id"), {"id": setup["order"]})).one()
        assert rows == (2, 2)


@pytest.mark.asyncio
async def test_invalid_batch_material_quantity_and_duplicate_are_rejected(db):
    async with db.begin() as conn:
        setup = await seed_order(conn)
    batch = setup["batches"][0]
    with pytest.raises(DBAPIError):
        async with db.begin() as conn:
            await insert_event(conn, setup, {**batch, "id": uuid.uuid4()}, key="bad-fk")
    with pytest.raises(DBAPIError):
        async with db.begin() as conn:
            await insert_event(conn, setup, batch, material="COPPER", key="bad-material")
    for quantity in (0, -1):
        with pytest.raises(DBAPIError):
            async with db.begin() as conn:
                await insert_event(conn, setup, setup["batches"][0], qty=quantity)
    with pytest.raises(DBAPIError):
        async with db.begin() as conn:
            await insert_event(conn, setup, setup["batches"][0], qty=101)
    duplicate_key = str(uuid.uuid4())
    async with db.begin() as conn:
        await insert_event(conn, setup, batch, key=duplicate_key)
    with pytest.raises(DBAPIError):
        async with db.begin() as conn:
            await insert_event(conn, setup, batch, key=duplicate_key)


@pytest.mark.asyncio
async def test_legacy_consumption_and_finished_goods_order_links_survive(db):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        legacy_id, finished_id = uuid.uuid4(), uuid.uuid4()
        await conn.execute(text("""INSERT INTO assembly_material_consumption
            (id,assembly_order_id,material_code,expected_per_unit,assembled_quantity,actual_consumed,uom,recorded_by,recorded_at,updated_at)
            VALUES (:id,:order,'STEEL-PIPE',2,4,8,'PCS','legacy',now(),now())"""),
            {"id": legacy_id, "order": setup["order"]})
        await conn.execute(AssemblyFinishedGoodsModel.__table__.insert().values(
            id=finished_id, assembly_order_id=setup["order"], product_code="FG-TEST",
            product_name="Test Product", quantity=4, uom="PCS", warehouse_id="MAIN",
            location_code="A-01", on_hand_before=0, on_hand_after=4))
        row = (await conn.execute(text("SELECT actual_consumed,traceability_status FROM assembly_material_consumption_traceability WHERE consumption_id=:id"), {"id": legacy_id})).one()
        assert row == (8, "UNLINKED")
        assert await conn.scalar(text("SELECT assembly_order_id FROM assembly_finished_goods WHERE id=:id"), {"id": finished_id}) == setup["order"]


@pytest.mark.asyncio
async def test_schema_has_fk_indexes_view_and_preserves_legacy_constraint(db):
    async with db.connect() as conn:
        assert await conn.scalar(text("SELECT to_regclass('public.assembly_material_consumption_traceability')"))
        indexes = set((await conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename='assembly_material_consumption_event'"))).scalars())
        assert "ix_assembly_material_consumption_event_batch" in indexes
        unique = set((await conn.execute(text("""SELECT conname FROM pg_constraint WHERE conrelid='assembly_material_consumption'::regclass AND contype='u'"""))).scalars())
        assert "uq_assembly_consumption_order_material" in unique


@pytest.mark.asyncio
async def test_consumption_api_records_partial_use_and_does_not_deduct_warehouse_stock(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup)
        batch = setup["batches"][0]
        movement_count_before = await conn.scalar(text("SELECT count(*) FROM inventory_movement_history WHERE reference_document=:task"), {"task": setup["task_number"]})
    client, _ = api_client
    response = await client.post(f"/api/v1/assembly/orders/{setup['order']}/material-consumption", json=consumption_payload(batch, quantity=60))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["consumed_quantity"] == 60
    assert body["remaining_quantity"] == 40
    assert body["traceability_status"] == "VERIFIED"
    assert body["original_material_qr_reference"] == batch["qr"]
    async with db.connect() as conn:
        assert await conn.scalar(text("SELECT count(*) FROM inventory_movement_history WHERE reference_document=:task"), {"task": setup["task_number"]}) == movement_count_before
        assert await conn.scalar(text("SELECT count(*) FROM assembly_material_consumption_event WHERE assembly_order_id=:id"), {"id": setup["order"]}) == 1


@pytest.mark.asyncio
async def test_consumption_api_supports_multiple_batches_and_subsequent_partial_use(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn, batch_count=2)
        await make_order_ready_for_consumption(conn, setup)
    client, _ = api_client
    first = await client.post(f"/api/v1/assembly/orders/{setup['order']}/material-consumption", json=consumption_payload(setup["batches"][0], quantity=10))
    second = await client.post(f"/api/v1/assembly/orders/{setup['order']}/material-consumption", json=consumption_payload(setup["batches"][1], quantity=15))
    third = await client.post(f"/api/v1/assembly/orders/{setup['order']}/material-consumption", json=consumption_payload(setup["batches"][0], quantity=20))
    assert first.status_code == second.status_code == third.status_code == 201
    assert first.json()["remaining_quantity"] == 90
    assert second.json()["remaining_quantity"] == 85
    assert third.json()["remaining_quantity"] == 70
    async with db.connect() as conn:
        result = (await conn.execute(text("SELECT count(*), count(DISTINCT grn_batch_id) FROM assembly_material_consumption_event WHERE assembly_order_id=:id"), {"id": setup["order"]})).one()
        assert result == (3, 2)


@pytest.mark.asyncio
async def test_consumption_api_rejects_invalid_qr_batch_material_and_unissued_material(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn, batch_count=2)
        await make_order_ready_for_consumption(conn, setup)
        await conn.execute(text("DELETE FROM inventory_movement_history WHERE batch_lot=:batch AND reference_document=:task"),
                           {"batch": setup["batches"][1]["number"], "task": setup["task_number"]})
    client, _ = api_client
    url = f"/api/v1/assembly/orders/{setup['order']}/material-consumption"
    invalid_qr = await client.post(url, json=consumption_payload(setup["batches"][0], qr="QR-NOT-REAL"))
    wrong_batch = await client.post(url, json=consumption_payload(setup["batches"][1], qr=setup["batches"][0]["qr"]))
    unlisted_material = await client.post(url, json=consumption_payload(setup["batches"][0], material="OTHER-MATERIAL"))
    unissued_batch = await client.post(url, json=consumption_payload(setup["batches"][1]))
    assert invalid_qr.status_code == 422
    assert wrong_batch.status_code == 422
    assert unlisted_material.status_code == 422
    assert unissued_batch.status_code == 409
    async with db.connect() as conn:
        assert await conn.scalar(text("SELECT count(*) FROM assembly_material_consumption_event WHERE assembly_order_id=:id"), {"id": setup["order"]}) == 0


@pytest.mark.asyncio
async def test_consumption_api_requires_assembly_receipt_and_authorized_operator(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup, received=False)
    client, user = api_client
    url = f"/api/v1/assembly/orders/{setup['order']}/material-consumption"
    no_receipt = await client.post(url, json=consumption_payload(setup["batches"][0]))
    user.roles[:] = ["WAREHOUSE"]
    unauthorized = await client.post(url, json=consumption_payload(setup["batches"][0]))
    assert no_receipt.status_code == 409
    assert unauthorized.status_code == 403


@pytest.mark.asyncio
async def test_start_production_marks_qr_receipt_as_traceability_workflow(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup)
        await conn.execute(text("UPDATE assembly_order SET status='MATERIAL_READY', traceability_required=false WHERE id=:id"), {"id": setup["order"]})
    client, _ = api_client
    response = await client.post(f"/api/v1/assembly/orders/{setup['order']}/start-production")
    assert response.status_code == 200, response.text
    async with db.connect() as conn:
        assert await conn.scalar(text("SELECT traceability_required FROM assembly_order WHERE id=:id"), {"id": setup["order"]}) is True


@pytest.mark.asyncio
async def test_consumption_api_is_idempotent_and_rejects_overconsumption(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup)
    client, _ = api_client
    url = f"/api/v1/assembly/orders/{setup['order']}/material-consumption"
    payload = consumption_payload(setup["batches"][0], quantity=60)
    first = await client.post(url, json=payload)
    retry = await client.post(url, json=payload)
    conflicting_retry = await client.post(url, json={**payload, "actual_consumed": 11})
    over = await client.post(url, json=consumption_payload(setup["batches"][0], quantity=41))
    assert first.status_code == retry.status_code == 201
    assert first.json()["consumption_event_id"] == retry.json()["consumption_event_id"]
    assert retry.json()["remaining_quantity"] == 40
    assert conflicting_retry.status_code == 409
    assert over.status_code == 409
    async with db.connect() as conn:
        assert await conn.scalar(text("SELECT count(*) FROM assembly_material_consumption_event WHERE assembly_order_id=:id"), {"id": setup["order"]}) == 1


@pytest.mark.asyncio
async def test_concurrent_consumption_requests_cannot_overconsume(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup)
    client, _ = api_client
    url = f"/api/v1/assembly/orders/{setup['order']}/material-consumption"
    responses = await asyncio.gather(*[
        client.post(url, json=consumption_payload(setup["batches"][0], quantity=60))
        for _ in range(2)
    ])
    assert sorted(response.status_code for response in responses) == [201, 409]
    async with db.connect() as conn:
        assert await conn.scalar(text("SELECT sum(actual_consumed) FROM assembly_material_consumption_event WHERE assembly_order_id=:id"), {"id": setup["order"]}) == 60


@pytest.mark.asyncio
async def test_traceability_order_requires_events_before_completion_and_uses_actual_sum(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup, traceability_required=True)
    client, _ = api_client
    complete_url = f"/api/v1/assembly/orders/{setup['order']}/complete-production"
    blocked = await client.post(complete_url, json={"produced_quantity": 1})
    assert blocked.status_code == 409
    consumed = await client.post(
        f"/api/v1/assembly/orders/{setup['order']}/material-consumption",
        json=consumption_payload(setup["batches"][0], quantity=60),
    )
    assert consumed.status_code == 201, consumed.text
    completed = await client.post(complete_url, json={"produced_quantity": 1})
    assert completed.status_code == 200, completed.text
    assert completed.json()["order_status"] == "QC_PENDING"
    async with db.connect() as conn:
        aggregate = (await conn.execute(text("SELECT actual_consumed FROM assembly_material_consumption WHERE assembly_order_id=:id AND material_code='STEEL-PIPE'"), {"id": setup["order"]})).scalar_one()
        assert aggregate == 60


@pytest.mark.asyncio
async def test_legacy_order_completion_remains_compatible(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup, traceability_required=False)
    client, _ = api_client
    response = await client.post(f"/api/v1/assembly/orders/{setup['order']}/complete-production", json={"produced_quantity": 1})
    assert response.status_code == 200, response.text
    async with db.connect() as conn:
        actual = await conn.scalar(text("SELECT actual_consumed FROM assembly_material_consumption WHERE assembly_order_id=:id"), {"id": setup["order"]})
        assert actual == 100
        assert await conn.scalar(text("SELECT count(*) FROM assembly_material_consumption_event WHERE assembly_order_id=:id"), {"id": setup["order"]}) == 0


@pytest.mark.asyncio
async def test_finished_goods_traceability_returns_verified_qr_grn_supplier_and_event_history(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn, batch_count=2)
        await make_order_ready_for_consumption(conn, setup, traceability_required=True)
        fg = await seed_finished_goods(conn, setup)
        grn_number = f"GRN-TRACE-{uuid.uuid4().hex[:8]}"
        await conn.execute(text("UPDATE grn SET grn_number=:number,supplier_name='Supplier Alpha',supplier_company_name='Supplier Alpha Ltd' WHERE id=(SELECT grn_id FROM grn_line WHERE id=(SELECT grn_line_id FROM grn_batch WHERE id=:batch))"), {"number": grn_number, "batch": setup["batches"][0]["id"]})
        await conn.execute(text("UPDATE grn_line SET material_name='Steel Pipe' WHERE item_code='STEEL-PIPE'"))
        await insert_event(conn, setup, setup["batches"][0], qty=10)
        await insert_event(conn, setup, setup["batches"][0], qty=5)
        await insert_event(conn, setup, setup["batches"][1], qty=15)
        original_qr_payload = await conn.scalar(text("SELECT qr_payload FROM grn_batch_qr WHERE id=:id"), {"id": setup["batches"][0]["qr_id"]})
    client, _ = api_client
    response = await client.get(f"/api/v1/assembly/finished-goods/{fg['id']}/traceability")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["traceability"]["overall_status"] == "COMPLETE"
    assert body["traceability"]["total_material_batches"] == 2
    assert body["traceability"]["verified_material_batches"] == 2
    assert body["finished_goods"]["fg_batch_number"] == fg["batch_number"]
    assert body["assembly"]["assembly_order_number"] == fg["order_number"]
    first_batch = next(entry for entry in body["consumed_materials"] if entry["batch_number"] == setup["batches"][0]["number"])
    assert first_batch["material_name"] == "Steel Pipe"
    assert first_batch["original_qr_payload"] == original_qr_payload
    assert first_batch["quantity_consumed"] == 15
    assert len(first_batch["consumption_event_ids"]) == 2
    assert first_batch["grn_reference"]["grn_number"] == grn_number
    assert first_batch["supplier"]["supplier_name"] == "Supplier Alpha Ltd"
    assert len(body["consumption_events"]) == 3


@pytest.mark.asyncio
async def test_finished_goods_traceability_resolves_existing_qr_serial_and_batch(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup)
        fg = await seed_finished_goods(conn, setup)
        await insert_event(conn, setup, setup["batches"][0], qty=10)
    client, _ = api_client
    for identity in (fg["qr_payload"], fg["serial_number"], fg["batch_number"]):
        response = await client.get(f"/api/v1/assembly/finished-goods/{identity}/traceability")
        assert response.status_code == 200, response.text
        assert response.json()["finished_goods"]["fg_id"] == str(fg["id"])


@pytest.mark.asyncio
async def test_finished_goods_traceability_reports_partial_unlinked_and_unavailable(db, api_client):
    async with db.begin() as conn:
        partial_setup = await seed_order(conn, batch_count=2)
        await make_order_ready_for_consumption(conn, partial_setup, traceability_required=True)
        partial_fg = await seed_finished_goods(conn, partial_setup, batch_number="FG-PARTIAL")
        await insert_event(conn, partial_setup, partial_setup["batches"][0], qty=10)
        await insert_event(conn, partial_setup, partial_setup["batches"][1], qty=5, with_qr=False)
        legacy_setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, legacy_setup)
        legacy_fg = await seed_finished_goods(conn, legacy_setup, batch_number="FG-LEGACY")
        await conn.execute(text("""INSERT INTO assembly_material_consumption
            (id,assembly_order_id,material_code,expected_per_unit,assembled_quantity,actual_consumed,uom,recorded_by,recorded_at,updated_at)
            VALUES (:id,:order,'STEEL-PIPE',1,1,8,'PCS','legacy',now(),now())"""), {"id": uuid.uuid4(), "order": legacy_setup["order"]})
        empty_setup = await seed_order(conn)
        empty_fg = await seed_finished_goods(conn, empty_setup, batch_number="FG-NODATA")
    client, _ = api_client
    partial = await client.get(f"/api/v1/assembly/finished-goods/{partial_fg['id']}/traceability")
    unlinked = await client.get(f"/api/v1/assembly/finished-goods/{legacy_fg['id']}/traceability")
    unavailable = await client.get(f"/api/v1/assembly/finished-goods/{empty_fg['id']}/traceability")
    assert partial.json()["traceability"]["overall_status"] == "PARTIAL"
    assert partial.json()["traceability"]["unlinked_material_records"] == 1
    assert unlinked.json()["traceability"]["overall_status"] == "UNLINKED"
    assert unlinked.json()["unlinked_material_records"][0]["quantity_consumed"] == 8
    assert unavailable.json()["traceability"]["overall_status"] == "NOT_AVAILABLE"


@pytest.mark.asyncio
async def test_finished_goods_traceability_handles_invalid_malformed_ambiguous_and_unauthorized(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup)
        fg = await seed_finished_goods(conn, setup)
        second_setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, second_setup)
        second_fg = await seed_finished_goods(conn, second_setup, batch_number="FG-AMBIGUOUS")
        await conn.execute(text("UPDATE assembly_finished_goods SET qr_code=:qr WHERE id=:id"), {"qr": fg["qr_payload"], "id": second_fg["id"]})
    client, _ = api_client
    base = "/api/v1/assembly/finished-goods"
    assert (await client.get(f"{base}/not-a-fg/traceability")).status_code == 404
    assert (await client.get(f"{base}/FG%7CORDER:missing/traceability")).status_code == 400
    assert (await client.get(f"{base}/{fg['qr_payload']}/traceability")).status_code == 409
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(subject="supplier-test", username="supplier-test", roles=["SUPPLIER"], permissions=[], raw_claims={})
    assert (await client.get(f"{base}/{fg['id']}/traceability")).status_code == 403


@pytest.mark.asyncio
async def test_finished_goods_traceability_is_read_only_and_requires_stored_qr_payload(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup)
        fg = await seed_finished_goods(conn, setup)
        # Simulate an incomplete historical QR row; once linked to an event,
        # the Phase 1 trigger correctly protects this original payload.
        await conn.execute(text("UPDATE grn_batch_qr SET qr_payload='' WHERE id=:id"), {"id": setup["batches"][0]["qr_id"]})
        await insert_event(conn, setup, setup["batches"][0], qty=10)
        before = (await conn.execute(text("SELECT qr_code,qr_payload FROM grn_batch_qr WHERE id=:id"), {"id": setup["batches"][0]["qr_id"]})).one()
    client, _ = api_client
    response = await client.get(f"/api/v1/assembly/finished-goods/{fg['id']}/traceability")
    assert response.status_code == 200
    assert response.json()["traceability"]["overall_status"] == "UNLINKED"
    async with db.connect() as conn:
        after = (await conn.execute(text("SELECT qr_code,qr_payload FROM grn_batch_qr WHERE id=:id"), {"id": setup["batches"][0]["qr_id"]})).one()
    assert tuple(after) == tuple(before)


@pytest.mark.asyncio
async def test_existing_finished_goods_detail_endpoint_remains_compatible(db, api_client):
    async with db.begin() as conn:
        setup = await seed_order(conn)
        await make_order_ready_for_consumption(conn, setup)
        fg = await seed_finished_goods(conn, setup)
    client, _ = api_client
    response = await client.get(f"/api/v1/assembly/finished-goods/{fg['id']}")
    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(fg["id"])
    assert response.json()["qr_code"] == fg["qr_payload"]
