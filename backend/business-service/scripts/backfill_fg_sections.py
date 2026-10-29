"""Explicit, single-FG backfill. Dry run unless --apply is supplied.

Supply DATABASE_URL explicitly in the process environment. This script never
loads credentials from .env. Review the FG and supplier IDs before applying.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--fg-id", required=True, type=__import__("uuid").UUID)
parser.add_argument("--supplier-id", required=True)
parser.add_argument("--apply", action="store_true")


async def main(args):
    if not os.environ.get("DATABASE_URL"):
        raise SystemExit("Set DATABASE_URL explicitly; no default database permitted")
    from sqlalchemy import select, func
    from app.database.session import session_scope
    from app.modules.assembly.infrastructure.persistence.models import (
        AssemblyFinishedGoodsModel, AssemblyQualityInspectionModel,
        AssemblyFinishedGoodsAllocationModel, FinishedGoodsSectionModel,
    )
    from app.modules.assembly.infrastructure.sections import generate_sections
    async with session_scope() as db:
        fg = await db.scalar(select(AssemblyFinishedGoodsModel).where(AssemblyFinishedGoodsModel.id == args.fg_id).with_for_update())
        if not fg:
            raise SystemExit("FG not found")
        approved = await db.scalar(select(AssemblyQualityInspectionModel.id).where(
            AssemblyQualityInspectionModel.assembly_order_id == fg.assembly_order_id,
            AssemblyQualityInspectionModel.status == "QC_APPROVED"))
        allocated = await db.scalar(select(func.count()).select_from(AssemblyFinishedGoodsAllocationModel).where(
            AssemblyFinishedGoodsAllocationModel.finished_goods_id == fg.id))
        existing = await db.scalar(select(FinishedGoodsSectionModel.id).where(FinishedGoodsSectionModel.finished_goods_id == fg.id).limit(1))
        used_section = await db.scalar(select(FinishedGoodsSectionModel.id).where(
            FinishedGoodsSectionModel.finished_goods_id == fg.id,
            FinishedGoodsSectionModel.status != "AVAILABLE").limit(1))
        if not approved or allocated or used_section or fg.section_supplier_id:
            raise SystemExit("Refused: requires approved, unallocated FG with no used sections or supplier assignment")
        print(f"FG={fg.id}; existing_batch={fg.batch_number}; supplier={args.supplier_id}; sections=8; apply={args.apply}")
        if args.apply:
            fg.section_supplier_id = args.supplier_id
            await generate_sections(db, fg)
            print("Backfill committed with original Main FG and material QRs preserved")


if __name__ == "__main__":
    asyncio.run(main(parser.parse_args()))
