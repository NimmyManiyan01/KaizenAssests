import unittest
from datetime import date

from fastapi import HTTPException

from app.modules.assembly.infrastructure.api.router import (
    SupplierFinishedGoodsDispatchRequestPayload,
)
from app.modules.gate.application.transport_validation import validate_transport


class SupplierDispatchTransportTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "product_code": "FG-PIPE-001",
            "product_name": "Finished Pipe",
            "quantity": 2,
            "vehicle_number": "KA-02-AH-2755",
            "driver_name": "Ravi Kumar",
            "driver_contact": "9876543210",
            "transport_entries": [
                {
                    "vehicle_number": "KA-02-AH-2755",
                    "driver_name": "Ravi Kumar",
                    "driver_contact": "9876543210",
                },
                {
                    "vehicle_number": "22BH1234AA",
                    "driver_name": "Asha Devi",
                    "driver_contact": "8765432109",
                },
            ],
            "expected_pickup_date": date.today().isoformat(),
        }

    def test_payload_accepts_and_validates_multiple_transport_pairs(self):
        payload = SupplierFinishedGoodsDispatchRequestPayload.model_validate(self.payload)
        normalized = [
            validate_transport(entry.vehicle_number, entry.driver_name, entry.driver_contact)
            for entry in payload.transport_entries or []
        ]
        self.assertEqual(len(normalized), 2)
        self.assertEqual(normalized[0], ("KA02AH2755", "Ravi Kumar", "9876543210"))
        self.assertEqual(normalized[1], ("22BH1234AA", "Asha Devi", "8765432109"))

    def test_transport_validation_rejects_digits_in_driver_name(self):
        with self.assertRaises(HTTPException):
            validate_transport("KA02AH2755", "Ravi123 Kumar", "9876543210")

    def test_transport_validation_rejects_invalid_contact_for_any_pair(self):
        with self.assertRaises(HTTPException):
            validate_transport("22BH1234AA", "Asha Devi", "1234567890")


if __name__ == "__main__":
    unittest.main()
