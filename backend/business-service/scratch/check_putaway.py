import sys
import os
sys.path.insert(0, os.path.abspath('.'))

import asyncio
from sqlalchemy import text
from app.database.session import AsyncSessionFactory

async def main():
    async with AsyncSessionFactory() as session:
        result = await session.execute(text("SELECT task_number, grn_number, item_code, material_name, quantity, status FROM putaway_task ORDER BY created_at DESC LIMIT 5"))
        rows = result.fetchall()
        for r in rows:
            print(r)

if __name__ == "__main__":
    asyncio.run(main())
