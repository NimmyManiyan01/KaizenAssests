import unittest
from app.modules.store.infrastructure.api.location_router import next_rack_code, BinCreateRequest

class AutoRackCodeTests(unittest.TestCase):
    def test_first_rack(self):
        self.assertEqual(next_rack_code([]),"RACK-001")
    def test_existing_and_gaps(self):
        self.assertEqual(next_rack_code(["RACK-001","RACK-003"]),"RACK-004")
    def test_legacy_format(self):
        self.assertEqual(next_rack_code(["RACK-03","rack-007",None]),"RACK-008")
    def test_rack_and_position_may_be_omitted(self):
        request=BinCreateRequest(bin_name="BIN",bin_code="ZONE-A-BIN-001",capacity=80)
        self.assertIsNone(request.rack)
        self.assertIsNone(request.position)
