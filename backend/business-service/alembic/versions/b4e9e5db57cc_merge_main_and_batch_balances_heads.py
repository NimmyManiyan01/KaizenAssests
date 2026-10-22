"""merge main and batch balances heads

Revision ID: b4e9e5db57cc
Revises: 0024_complete_material_store_schema, 20261007_batch_balances
Create Date: 2026-10-15 10:30:01.980714
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4e9e5db57cc'
down_revision: Union[str, None] = ('0024_complete_material_store_schema', '20261007_batch_balances')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
