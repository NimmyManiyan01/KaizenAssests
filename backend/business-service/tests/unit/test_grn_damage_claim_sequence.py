import unittest
from app.modules.receiving.infrastructure.api.router import next_damage_claim_sequence

class GrnDamageClaimSequenceTests(unittest.TestCase):
    def test_backdated_claims_do_not_reuse_numbers(self):
        self.assertEqual(next_damage_claim_sequence(["DC-00005", "DC-00002", "DC-00003"]),6)
    def test_deleted_gaps(self):
        self.assertEqual(next_damage_claim_sequence(["DC-00001", "DC-00003"]),4)
    def test_empty_and_invalid(self):
        self.assertEqual(next_damage_claim_sequence([]),1)
        self.assertEqual(next_damage_claim_sequence([None,"DC-bad","OTHER-99"]),1)
    def test_large_suffix(self):
        self.assertEqual(next_damage_claim_sequence(["DC-99999","DC-100000"]),100001)
