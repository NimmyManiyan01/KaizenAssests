import unittest
from app.modules.receiving.infrastructure.persistence.repository_impl import next_grn_number

class GrnNumberSequenceTests(unittest.TestCase):
    def test_first(self):
        self.assertEqual(next_grn_number([], "2026"), "GRN-2026-001")
    def test_existing(self):
        self.assertEqual(next_grn_number(["GRN-2026-001", "GRN-2026-002"], "2026"), "GRN-2026-003")
    def test_deleted_gap(self):
        self.assertEqual(next_grn_number(["GRN-2026-001", "GRN-2026-003"], "2026"), "GRN-2026-004")
    def test_year_and_large_suffix(self):
        self.assertEqual(next_grn_number(["GRN-2025-999", "GRN-2026-1000"], "2026"), "GRN-2026-1001")

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
import uuid
from app.modules.receiving.infrastructure.persistence.repository_impl import SqlAlchemyGrnRepository

class EarlyGrnDraftTests(unittest.IsolatedAsyncioTestCase):
    async def test_repeated_asn_fetch_reuses_persisted_draft_number(self):
        draft = SimpleNamespace(id=uuid.uuid4(), status="DRAFT", grn_number="GRN-2026-003", lines=[object()])
        session = MagicMock()
        session.scalar = AsyncMock(return_value=draft.id)
        result = MagicMock()
        result.scalar_one_or_none.return_value=draft
        session.execute=AsyncMock(return_value=result)
        session.flush=AsyncMock()
        with patch("app.modules.receiving.infrastructure.persistence.repository_impl._resolve_real_supplier_names",new=AsyncMock(return_value=("Supplier","Supplier"))):
            saved=await SqlAlchemyGrnRepository(session).create_or_update_grn_header(receipt_type="ASN_RECEIPT",asn_number="ASN-2026-003",dock_number="RM-01",received_by="grn")
        self.assertIs(saved,draft)
        self.assertEqual(saved.grn_number,"GRN-2026-003")
        session.add.assert_not_called()

    async def test_completed_asn_cannot_create_another_receipt(self):
        draft = SimpleNamespace(id=uuid.uuid4(), status="COMPLETED", grn_number="GRN-2026-003")
        session = MagicMock();session.scalar=AsyncMock(return_value=draft.id)
        result=MagicMock();result.scalar_one_or_none.return_value=draft
        session.execute=AsyncMock(return_value=result)
        with patch("app.modules.receiving.infrastructure.persistence.repository_impl._resolve_real_supplier_names",new=AsyncMock(return_value=("Supplier","Supplier"))):
            with self.assertRaisesRegex(ValueError,"already received"):
                await SqlAlchemyGrnRepository(session).create_or_update_grn_header(receipt_type="ASN_RECEIPT",asn_number="ASN-2026-003",dock_number="RM-01",received_by="grn")
