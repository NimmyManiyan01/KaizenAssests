"""Database-free regression tests for legacy GRN allocation reconciliation."""

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException

from app.modules.dock.application.service import DockAllocationService


class DockCompletionReconciliationTests(unittest.IsolatedAsyncioTestCase):
    async def complete(self, status, evidence=None):
        self.request = SimpleNamespace(
            id=uuid.uuid4(), status=status, assigned_dock_id=uuid.uuid4(),
            existing_gate_pass_id="GE-2026-002", vehicle_number="KA02AH2900",
        )
        results = [Mock(scalar_one_or_none=Mock(return_value=self.request))]
        if status == "DOCK_ASSIGNED":
            results.append(Mock(scalar_one_or_none=Mock(return_value=evidence)))
        self.session = SimpleNamespace(
            execute=AsyncMock(side_effect=results), add=Mock(), commit=AsyncMock(),
        )
        return await DockAllocationService.complete_receiving(
            self.session, self.request.id, "grn-user",
        )

    async def test_completed_grn_reconciles_assigned_allocation(self):
        completed_at = datetime(2026, 10, 21, tzinfo=timezone.utc)
        result = await self.complete(
            "DOCK_ASSIGNED", SimpleNamespace(receiving_completed_at=completed_at),
        )
        self.assertEqual(result.status, "COMPLETED")
        self.assertEqual(result.completed_at, completed_at)
        history = self.session.add.call_args.args[0]
        self.assertEqual(history.previous_status, "DOCK_ASSIGNED")
        self.session.commit.assert_awaited_once()
        query = str(self.session.execute.call_args.args[0])
        for constraint in (
            "dock_masters.id =", "dock_masters.status =",
            "dock_assignment.vehicle_number =", "gate_entry.gate_entry_number =",
            "dock_assignment.prepared_grn_id IS NOT NULL",
            "dock_assignment.receiving_completed_at IS NOT NULL",
            "dock_assignment.dock_released_at IS NULL",
        ):
            self.assertIn(constraint, query)

    async def test_assigned_allocation_without_completion_evidence_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            await self.complete("DOCK_ASSIGNED")
        self.assertEqual(error.exception.status_code, 409)
        self.session.commit.assert_not_awaited()
        self.session.add.assert_not_called()

    async def test_normal_receiving_states_still_complete(self):
        for status in ("AT_DOCK", "OCCUPIED"):
            with self.subTest(status=status):
                result = await self.complete(status)
                self.assertEqual(result.status, "COMPLETED")
                self.assertIsNotNone(result.completed_at)
                self.assertEqual(self.session.execute.await_count, 1)

    async def test_other_states_remain_rejected(self):
        for status in ("AWAITING_DOCK", "RESERVED", "RELEASED", "CANCELLED"):
            with self.subTest(status=status), self.assertRaises(HTTPException):
                await self.complete(status)
            self.session.commit.assert_not_awaited()
