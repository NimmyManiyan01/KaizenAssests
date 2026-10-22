import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from pydantic import ValidationError
from app.modules.assembly.infrastructure.api.router import SupplierFinishedGoodsDispatchRequestPayload


class PickupDateTests(unittest.TestCase):
    def payload(self, value):
        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 10, 21, 0, 0, tzinfo=timezone.utc)
        with patch("app.modules.assembly.infrastructure.api.router.datetime", FixedDatetime):
            return SupplierFinishedGoodsDispatchRequestPayload(
                product_code="CAR", product_name="Car", quantity=10, vehicle_number="KA02AH2755",
                driver_name="Kumar", driver_contact="9876543210", expected_pickup_date=value,
            )

    def test_invalid_dates_are_rejected(self):
        for value in (None, "", "2026-02-30", "2026-10-20", "21/10/2026", "2026-10-21T00:00:00", 1792540800):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.payload(value)

    def test_today_and_future_dates_are_accepted(self):
        for value in ("2026-10-21", "2026-10-22", "2028-02-29"):
            with self.subTest(value=value):
                self.assertEqual(self.payload(value).expected_pickup_date.isoformat(), value)
