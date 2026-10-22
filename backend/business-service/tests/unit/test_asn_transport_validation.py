import asyncio
import tempfile
import unittest
import uuid
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.modules.gate.application.transport_validation import validate_transport, validate_gate_duplicates


class TransportTests(unittest.TestCase):
    def test_valid_formats_are_normalized(self):
        for vehicle in ("KA02AH2755", "KA-02-AH-2755", "KA 02 AH 2755", "TN09AB1234", "22BH1234AA", "ka02ah2755"):
            with self.subTest(vehicle=vehicle):
                result = validate_transport(vehicle, "R. D'Souza", "9876543210")
                self.assertEqual(result[0], vehicle.upper().replace("-", "").replace(" ", ""))
                self.assertEqual(result[1:], ("R. D'Souza", "9876543210"))

    def test_invalid_transport_is_rejected(self):
        invalid = [(v, "Kumar", "9876543210") for v in ("", "123456", "KA@02AH2755", "KA02AH275", "22BH1234A")]
        invalid += [("KA02AH2755", n, "9876543210") for n in ("", "A", "123", "Ram2", "....", "Ram@Kumar", "A" * 101)]
        invalid += [("KA02AH2755", "Kumar", n) for n in ("", "987654321", "98765432100", "98765a43210", "1234567890", "+919876543210", "98765-43210")]
        for values in invalid:
            with self.subTest(values=values), self.assertRaises(HTTPException) as error:
                validate_transport(*values)
            self.assertEqual(error.exception.status_code, 422)

    def test_name_boundaries_and_punctuation(self):
        for name in ("Al", "A" * 100, "Anne-Marie", "D’Souza", "Kumar, R."):
            self.assertEqual(validate_transport("KA02AH2755", name, "9876543210")[1], name)


class GateDuplicateTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        self.session = async_sessionmaker(self.engine)()
        await self.session.execute(text("CREATE TABLE gate_entry (gate_entry_number TEXT, asn_id TEXT, vehicle_number TEXT, status TEXT)"))
        self.asn_id = uuid.uuid4()

    async def asyncTearDown(self):
        await self.session.close()
        await self.engine.dispose()

    async def insert(self, status):
        await self.session.execute(text("INSERT INTO gate_entry VALUES ('GE-001', :asn, 'KA-02-AH-2755', :status)"),
                                   {"asn": str(self.asn_id), "status": status})

    async def test_same_vehicle_is_blocked_across_asns(self):
        await self.insert("AT_DOCK")
        with self.assertRaises(HTTPException) as error:
            await validate_gate_duplicates(self.session, "ka 02 ah 2755", uuid.uuid4())
        self.assertEqual(error.exception.status_code, 409)

    async def test_same_asn_cannot_create_second_pass_even_after_exit(self):
        await self.insert("GATE_EXIT_COMPLETED")
        with self.assertRaises(HTTPException) as error:
            await validate_gate_duplicates(self.session, "TN09AB1234", self.asn_id)
        self.assertIn("already exists for this ASN", error.exception.detail)

    async def test_repeat_delivery_after_exit_is_allowed_for_new_asn(self):
        await self.insert("GATE_EXIT_COMPLETED")
        await validate_gate_duplicates(self.session, "KA02AH2755", uuid.uuid4())

    async def test_rejected_admission_can_be_retried(self):
        await self.insert("REJECTED")
        await validate_gate_duplicates(self.session, "KA02AH2755", self.asn_id)

    async def test_different_vehicle_is_allowed(self):
        await self.insert("AT_DOCK")
        await validate_gate_duplicates(self.session, "TN09AB1234", uuid.uuid4())

    async def test_concurrent_gate_pass_requests_cannot_both_succeed(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "gate-test.db"
            engine = create_async_engine(f"sqlite+aiosqlite:///{database.as_posix()}")
            try:
                async with engine.begin() as connection:
                    await connection.execute(text("CREATE TABLE gate_entry (gate_entry_number TEXT, asn_id TEXT, vehicle_number TEXT, status TEXT)"))
                factory = async_sessionmaker(engine)

                async def admit(number):
                    async with factory() as session:
                        try:
                            await validate_gate_duplicates(session, "KA02AH2755", self.asn_id)
                            await session.execute(text("INSERT INTO gate_entry VALUES (:number, :asn, 'KA02AH2755', 'AT_DOCK')"),
                                                  {"number": number, "asn": str(self.asn_id)})
                            await session.commit()
                            return 201
                        except HTTPException as error:
                            await session.rollback()
                            return error.status_code

                self.assertEqual(sorted(await asyncio.gather(admit("GE-1"), admit("GE-2"))), [201, 409])
            finally:
                await engine.dispose()
