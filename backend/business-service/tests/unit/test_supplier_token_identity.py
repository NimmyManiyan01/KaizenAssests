import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request
from app.security.dependencies import get_current_user


class SupplierTokenIdentityTests(unittest.IsolatedAsyncioTestCase):
    async def test_browser_role_headers_do_not_discard_supplier_identity(self):
        user_id = "4ba750d2-579f-4efb-b6ef-6fe86b68b575"
        supplier_id = "b6151813-3a0b-44de-a168-d4e8d1e95a8d"
        request = Request({"type": "http", "headers": [(b"x-user-roles", b"SUPPLIER"), (b"x-user-name", b"supplier")]})
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=f"supplier-mock-token-{user_id}-{supplier_id}")
        with patch("app.security.dependencies.get_settings", return_value=SimpleNamespace(environment="development")):
            user = await get_current_user(request, credentials)
        self.assertEqual(user.subject, user_id)
        self.assertEqual(user.raw_claims["supplier_id"], supplier_id)

    async def test_supplier_token_cannot_be_elevated_with_role_headers(self):
        request = Request({"type": "http", "headers": [(b"x-user-roles", b"ADMIN")]})
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="supplier-mock-token-4ba750d2-579f-4efb-b6ef-6fe86b68b575-b6151813-3a0b-44de-a168-d4e8d1e95a8d")
        with patch("app.security.dependencies.get_settings", return_value=SimpleNamespace(environment="development")):
            user = await get_current_user(request, credentials)
        self.assertEqual(user.roles, ["SUPPLIER"])

    async def test_existing_header_only_fixture_identity_remains_supported(self):
        request = Request({"type": "http", "headers": [(b"x-user-roles", b"SUPPLIER"), (b"x-user-id", b"test-supplier")]})
        with patch("app.security.dependencies.get_settings", return_value=SimpleNamespace(environment="test")):
            user = await get_current_user(request, None)
        self.assertEqual(user.subject, "test-supplier")


if __name__ == "__main__":
    unittest.main()
