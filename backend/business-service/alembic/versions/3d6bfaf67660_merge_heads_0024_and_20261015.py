"""Merge heads 0024 and 20261015

Revision ID: 3d6bfaf67660
Revises: 0024_complete_material_store_schema, 20261015_remove_customer_orders
Create Date: 2026-10-15 20:55:44.786393
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3d6bfaf67660'
down_revision: Union[str, None] = ('0024_complete_material_store_schema', '20261015_remove_customer_orders')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
