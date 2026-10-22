"""Database-free supplier claim ownership regression coverage."""

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException

from app.modules.gate.infrastructure.api.damage_claims import supplier_id_for_user
from app.security.dependencies import CurrentUser


class DamageClaimSupplierResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def resolve(self, results, environment="local", username="supplier_partner", claim="sup-00001"):
        user = CurrentUser("supplier", username, ["SUPPLIER"], [], {"supplier_id": claim})
        self.session = SimpleNamespace(execute=AsyncMock(side_effect=[
            Mock(scalar_one_or_none=Mock(return_value=value)) for value in results
        ]))
        with patch("app.config.settings.get_settings", return_value=SimpleNamespace(environment=environment)):
            return await supplier_id_for_user(user, SimpleNamespace(session=self.session))

    async def test_legacy_local_login_resolves_registered_supplier(self):
        supplier_id = uuid.uuid4()
        self.assertEqual(await self.resolve([None, None, supplier_id]), supplier_id)
        query = self.session.execute.call_args.args[0]
        self.assertIn("SUP-DEFAULT", query.compile().params.values())

    async def test_legacy_fallback_is_disabled_in_production(self):
        self.assertIsNone(await self.resolve([None, None], environment="production"))
        self.assertEqual(self.session.execute.await_count, 2)

    async def test_other_accounts_and_unknown_claims_do_not_use_default(self):
        self.assertIsNone(await self.resolve([None, None], username="another_supplier"))
        self.assertIsNone(await self.resolve([None, None], claim="unknown-supplier"))

    async def test_registered_mapping_is_preserved(self):
        supplier_id = uuid.uuid4()
        self.assertEqual(await self.resolve([supplier_id, None]), supplier_id)
        self.assertEqual(self.session.execute.await_count, 2)

    async def test_conflicting_identity_remains_forbidden(self):
        with self.assertRaises(HTTPException) as error:
            await self.resolve([uuid.uuid4()], claim=str(uuid.uuid4()))
        self.assertEqual(error.exception.status_code, 403)
