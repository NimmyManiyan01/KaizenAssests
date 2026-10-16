"""Database-free warehouse resolution regressions; run with unittest."""
import unittest
from unittest.mock import AsyncMock, MagicMock
from app.modules.receiving.infrastructure.persistence.repository_impl import _warehouse_for_receiving_dock


class ReceivingDockWarehouseTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolves_configured_dock_warehouse(self):
        result = MagicMock()
        result.scalar_one_or_none.return_value = " WH-RM "
        session = AsyncMock()
        session.execute.return_value = result
        self.assertEqual(await _warehouse_for_receiving_dock(session, " RM-01 "), "WH-RM")
        query = session.execute.call_args.args[0]
        self.assertEqual(query.compile().params["dock_number_1"], "RM-01")

    async def test_unknown_dock_does_not_invent_warehouse(self):
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        session = AsyncMock()
        session.execute.return_value = result
        self.assertIsNone(await _warehouse_for_receiving_dock(session, "UNKNOWN"))

    async def test_missing_dock_does_not_query_or_choose_default(self):
        session = AsyncMock()
        for dock in [None, "", "  "]:
            self.assertIsNone(await _warehouse_for_receiving_dock(session, dock))
        session.execute.assert_not_called()
