"""Database-free route regression checks; runnable with unittest without DB fixtures."""
import unittest
from datetime import date
from decimal import Decimal

from pydantic import ValidationError
from app.modules.assembly.infrastructure.api.router import (
    router, CreateAssemblyMaterialRequestPayload,
)


class ManageOrdersRemovalTests(unittest.TestCase):
    def setUp(self):
        self.routes = {
            (method, route.path)
            for route in router.routes
            for method in route.methods
        }

    def test_management_endpoints_removed(self):
        for method, suffix in [
            ("GET", "/orders"), ("POST", "/orders"),
            ("GET", "/orders/{order_id}"),
            ("GET", "/orders/{order_id}/materials"), ("GET", "/lines"),
        ]:
            with self.subTest(method=method, path=suffix):
                self.assertNotIn((method, "/api/v1/assembly" + suffix), self.routes)

    def test_shared_workflow_endpoints_preserved(self):
        for method, suffix in [
            ("GET", "/dashboard"), ("GET", "/products"), ("POST", "/products"),
            ("GET", "/products/{product_code}/bom"),
            ("GET", "/material-requests"), ("POST", "/material-requests"),
            ("POST", "/material-requests/{request_id}/confirm-receipt"),
            ("GET", "/production/orders"),
            ("POST", "/orders/{order_id}/start-production"),
            ("POST", "/orders/{order_id}/complete-production"),
            ("GET", "/quality/inspections"), ("POST", "/quality/inspect"),
            ("GET", "/finished-goods"),
            ("POST", "/dispatch/{dispatch_id}/allocate-fifo"),
        ]:
            with self.subTest(method=method, path=suffix):
                self.assertIn((method, "/api/v1/assembly" + suffix), self.routes)

    def test_material_request_production_target_validation(self):
        payload = CreateAssemblyMaterialRequestPayload(
            product_code="FG-PIPE-001", target_quantity=Decimal("10"),
            required_date=date(2026, 10, 20),
        )
        self.assertEqual(payload.target_quantity, Decimal("10"))
        self.assertEqual(payload.assembly_line, "LINE-01")
        for quantity in [0, -1]:
            with self.subTest(quantity=quantity), self.assertRaises(ValidationError):
                CreateAssemblyMaterialRequestPayload(
                    product_code="FG-PIPE-001", target_quantity=quantity,
                    required_date=date(2026, 10, 20),
                )
