"""Use zone and bin codes that do not contain store identifiers.

Revision ID: 20261016_zone_bin_codes
Revises: 3d6bfaf67660
"""

from __future__ import annotations

import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261016_zone_bin_codes"
down_revision: Union[str, Sequence[str], None] = "3d6bfaf67660"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(inspector: sa.Inspector, table: str) -> bool:
    return table in inspector.get_table_names()


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return _has_table(inspector, table) and column in {
        item["name"] for item in inspector.get_columns(table)
    }


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if not _has_table(inspector, "store_zone"):
        return

    zones = conn.execute(
        sa.text("SELECT id, store_id, zone_code FROM store_zone ORDER BY store_id, zone_code, id")
    ).mappings().all()
    zone_codes: dict[str, str] = {}
    zone_sequences: dict[str, int] = {}
    for row in zones:
        store_id = str(row["store_id"])
        zone_sequences[store_id] = zone_sequences.get(store_id, 0) + 1
        zone_codes[str(row["id"])] = f"ZONE-{zone_sequences[store_id]:03d}"

    # Temporary values avoid conflicts with the existing per-store unique constraint.
    for row in zones:
        conn.execute(
            sa.text("UPDATE store_zone SET zone_code = :code WHERE id = :id"),
            {"id": row["id"], "code": f"TMP-{str(row['id']).replace('-', '')}"},
        )
    for zone_id, code in zone_codes.items():
        conn.execute(
            sa.text("UPDATE store_zone SET zone_code = :code WHERE id = :id"),
            {"id": zone_id, "code": code},
        )
        for table, id_column, value_column in (
            ("putaway_task", "destination_zone_id", "destination_zone"),
            ("storage_location", "zone_id", "zone"),
        ):
            if _has_column(inspector, table, id_column) and _has_column(inspector, table, value_column):
                conn.execute(
                    sa.text(
                        f"UPDATE {table} SET {value_column} = :code WHERE {id_column} = :id"
                    ),
                    {"id": zone_id, "code": code},
                )

    if not _has_table(inspector, "store_bin"):
        return

    bins = conn.execute(
        sa.text(
            "SELECT id, zone_id, bin_code FROM store_bin ORDER BY zone_id, bin_code, id"
        )
    ).mappings().all()
    bin_codes: dict[str, str] = {}
    bin_sequences: dict[str, int] = {}
    used_bin_sequences: dict[str, set[int]] = {}
    for row in bins:
        bin_id = str(row["id"])
        zone_id = str(row["zone_id"])
        fallback_sequence = bin_sequences.get(zone_id, 0) + 1
        old_sequence = re.search(r"(\d+)$", str(row["bin_code"]))
        sequence = int(old_sequence.group(1)) if old_sequence else fallback_sequence
        used = used_bin_sequences.setdefault(zone_id, set())
        while sequence in used:
            sequence += 1
        used.add(sequence)
        bin_sequences[zone_id] = max(fallback_sequence, sequence)
        zone_code = zone_codes.get(zone_id)
        if zone_code is None:
            continue
        bin_codes[bin_id] = f"{zone_code}-BIN-{sequence:03d}"

    for row in bins:
        conn.execute(
            sa.text("UPDATE store_bin SET bin_code = :code WHERE id = :id"),
            {"id": row["id"], "code": f"TMP-{str(row['id']).replace('-', '')}"},
        )

    for row in bins:
        bin_id = str(row["id"])
        new_code = bin_codes.get(bin_id)
        if not new_code:
            continue
        new_qr = f"QR-{new_code}"
        conn.execute(
            sa.text(
                "UPDATE store_bin SET bin_code = :code, qr_identifier = :qr WHERE id = :id"
            ),
            {"id": row["id"], "code": new_code, "qr": new_qr},
        )

        # Keep current assignments and movement history aligned with the renamed bin.
        related_columns = (
            ("putaway_task", "destination_bin_id", ("destination_bin_code", "destination_bin")),
            ("storage_location", "bin_id", ("bin",)),
            ("putaway_location_assignment", "destination_bin_id", ("location_code",)),
            ("inventory_movement_history", "from_bin_id", ("from_location",)),
            ("inventory_movement_history", "to_bin_id", ("to_location",)),
        )
        for table, id_column, value_columns in related_columns:
            if not _has_column(inspector, table, id_column):
                continue
            assignments = [f"{column} = :code" for column in value_columns if _has_column(inspector, table, column)]
            if assignments:
                conn.execute(
                    sa.text(
                        f"UPDATE {table} SET {', '.join(assignments)} WHERE {id_column} = :id"
                    ),
                    {"id": row["id"], "code": new_code},
                )


def downgrade() -> None:
    # Location codes are externally printed/recorded; retain their stable new format.
    pass
