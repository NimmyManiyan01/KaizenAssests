"""Remove only material-master rows created by the repository seed scripts."""
import asyncio
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from sqlalchemy import text
from app.database.session import session_scope

STANDARD_CODES = ("MAT-WIRE-001", "MAT-STEEL-001", "MAT-IRON-001")


async def main() -> None:
    async with session_scope() as session:
        rows = (await session.execute(text(
            """SELECT id, material_code FROM material
               WHERE created_by = 'SYSTEM_ASN_MATERIAL_SEED'
                  OR material_code IN (:wire, :steel, :iron)"""
        ), {"wire": STANDARD_CODES[0], "steel": STANDARD_CODES[1], "iron": STANDARD_CODES[2]})).all()
        ids = [str(row[0]) for row in rows]
        codes = [row[1] for row in rows]
        print(f"Seeded materials identified: {len(rows)} ({', '.join(codes) or 'none'})")
        if not ids:
            return

        await session.execute(text("DELETE FROM supplier_material_link WHERE material_id = ANY(:ids)"), {"ids": ids})
        await session.execute(text("DELETE FROM material_stock WHERE material_id = ANY(:ids) OR material_code = ANY(:codes)"), {"ids": ids, "codes": codes})
        await session.execute(text("DELETE FROM material_variant WHERE material_id = ANY(:ids)"), {"ids": ids})
        await session.execute(text("DELETE FROM material WHERE id = ANY(:ids)"), {"ids": ids})
        await session.commit()
        remaining = (await session.execute(text(
            "SELECT count(*) FROM material WHERE created_by = 'SYSTEM_ASN_MATERIAL_SEED' OR material_code IN (:wire, :steel, :iron)"
        ), {"wire": STANDARD_CODES[0], "steel": STANDARD_CODES[1], "iron": STANDARD_CODES[2]})).scalar_one()
        print(f"Seeded materials remaining: {remaining}")


if __name__ == "__main__":
    asyncio.run(main())
