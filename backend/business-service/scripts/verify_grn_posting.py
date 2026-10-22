"""Verify GRN completion on a disposable copy; the source database is read-only."""
import asyncio
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app  # Register all ORM models; does not start the server.
from app.modules.receiving.infrastructure.persistence.models import GrnModel
from app.modules.receiving.infrastructure.api.router import complete_grn
from app.modules.storage.infrastructure.persistence.models import PutawayTaskModel

async def verify(database):
    with tempfile.TemporaryDirectory() as folder:
        clone = Path(folder) / "grn-test.db"
        with closing(sqlite3.connect(database.resolve().as_uri()+"?mode=ro", uri=True)) as source, closing(sqlite3.connect(clone)) as destination:
            source.backup(destination)
        engine = create_async_engine("sqlite+aiosqlite:///" + clone.as_posix())
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                grn = (await session.execute(select(GrnModel).order_by(GrnModel.created_at.desc()).limit(1))).scalar_one()
                response = await complete_grn(str(grn.id), request=None, uow=SimpleNamespace(session=session), user=SimpleNamespace(username="regression-test"), _perm=None)
                await session.commit()
                assert response.status == "COMPLETED"
                tasks = (await session.execute(select(PutawayTaskModel).where(PutawayTaskModel.grn_id == grn.id))).scalars().all()
                accepted = sum((line.quality_approved_quantity or line.good_quantity or 0) for line in grn.lines)
                assert sum(task.quantity for task in tasks) <= accepted
                before = len(tasks)
                await complete_grn(str(grn.id), request=None, uow=SimpleNamespace(session=session), user=SimpleNamespace(username="regression-test"), _perm=None)
                await session.commit()
                after = await session.scalar(select(func.count()).select_from(PutawayTaskModel).where(PutawayTaskModel.grn_id == grn.id))
                assert after == before, "Retry duplicated putaway tasks"
                print("PASS: complete endpoint, commit, accepted quantity limit, and retry without duplicate tasks (disposable database copy)")
        finally:
            await engine.dispose()

if __name__ == "__main__":
    asyncio.run(verify(Path(sys.argv[1] if len(sys.argv)>1 else "wms.db")))
