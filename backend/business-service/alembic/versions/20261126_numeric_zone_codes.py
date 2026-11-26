"""Standardize warehouse zone codes while preserving bin and rack identifiers."""

import re
from collections import defaultdict

from alembic import op
import sqlalchemy as sa

revision = "20261126_numeric_zone_codes"
down_revision = "20261126_grn_package_checklist"
branch_labels = None
depends_on = None


def _sequence(code: str) -> int:
    if match := re.fullmatch(r"ZONE-(\d+)", code):
        return int(match[1])
    if match := re.fullmatch(r"ZONE-([A-Z]+)", code):
        number = 0
        for letter in match[1]:
            number = number * 26 + ord(letter) - ord("A") + 1
        return number
    return 0


def upgrade() -> None:
    connection = op.get_bind()
    zones = defaultdict(list)
    for row in connection.execute(sa.text(
        "SELECT id, warehouse_ref_id, zone_code FROM warehouse_zone ORDER BY zone_code, id"
    )).mappings():
        zones[row["warehouse_ref_id"]].append(row)

    schema = sa.inspect(connection)
    linked_labels = []
    for table, relation, label in (
        ("putaway_task", "destination_zone_id", "destination_zone"),
        ("storage_location", "zone_id", "zone"),
    ):
        if schema.has_table(table) and {relation, label} <= {column["name"] for column in schema.get_columns(table)}:
            linked_labels.append((table, relation, label))

    for warehouse_zones in zones.values():
        used = {
            row["zone_code"].upper()
            for row in warehouse_zones
            if re.fullmatch(r"ZONE-(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})", row["zone_code"])
        }
        next_sequence = max((_sequence(row["zone_code"].upper()) for row in warehouse_zones), default=0) + 1
        for row in warehouse_zones:
            old = row["zone_code"]
            if old in used and re.fullmatch(r"ZONE-\d+", old):
                continue
            sequence = _sequence(old.upper())
            new = f"ZONE-{sequence:03d}"
            if not sequence or new in used:
                new = f"ZONE-{next_sequence:03d}"
                next_sequence += 1
            used.add(new)
            params = {"id": row["id"], "old": old, "new": new}
            connection.execute(sa.text(
                "UPDATE warehouse_zone SET zone_code = :new, "
                "zone_name = CASE WHEN upper(zone_name) = upper(:old) THEN :new ELSE zone_name END "
                "WHERE id = :id"
            ), params)
            for table, relation, label in linked_labels:
                connection.execute(sa.text(
                    f"UPDATE {table} SET {label} = :new WHERE {relation} = :id AND upper({label}) = upper(:old)"
                ), params)


def downgrade() -> None:
    # Numeric codes remain readable by older versions. Keep the normalized data.
    pass
