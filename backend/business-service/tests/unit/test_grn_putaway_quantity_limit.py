import unittest
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.modules.storage.application.putaway_quantity import validate_grn_putaway_quantity


class GrnPutawayQuantityLimitTests(unittest.IsolatedAsyncioTestCase):
    async def check(self, accepted, stored, requested):
        session = SimpleNamespace(scalar=AsyncMock(side_effect=[uuid.uuid4(), accepted, stored]))
        await validate_grn_putaway_quantity(session, uuid.uuid4(), "MAT-BATT-003", Decimal(requested))

    async def test_exact_accepted_quantity_is_allowed(self):
        await self.check(80, 0, "80")

    async def test_more_than_accepted_is_rejected_even_if_task_allows_it(self):
        with self.assertRaises(HTTPException) as error:
            await self.check(80, 0, "90")
        self.assertEqual(error.exception.status_code, 422)

    async def test_partial_putaways_share_the_accepted_limit(self):
        await self.check(80, 30, "50")
        with self.assertRaises(HTTPException):
            await self.check(80, 30, "51")

    async def test_completed_or_previously_overstored_receipts_allow_no_more(self):
        for stored in (80, 90):
            with self.subTest(stored=stored), self.assertRaises(HTTPException):
                await self.check(80, stored, "1")

    async def test_zero_accepted_does_not_fall_back_to_received_quantity(self):
        with self.assertRaises(HTTPException):
            await self.check(0, 0, "1")

    async def test_finished_goods_without_grn_are_unaffected(self):
        session = SimpleNamespace(scalar=AsyncMock())
        await validate_grn_putaway_quantity(session, None, "FG-001", Decimal("80"))
        session.scalar.assert_not_awaited()
