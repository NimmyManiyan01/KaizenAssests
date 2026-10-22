from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, or_, select

from app.common.persistence.models import AsnModel, SupplierModel
from app.database.session import UnitOfWork, get_uow
from app.modules.gate.infrastructure.persistence.models import GateEntryModel


router = APIRouter(prefix="/api/v1/procurement", tags=["global-search"])


@router.get("/global-search")
async def global_search(
    q: str = Query(..., min_length=2),
    uow: UnitOfWork = Depends(get_uow),
):
    term = f"%{q.strip()}%"
    results: list[dict] = []

    async with uow:
        asns = (await uow.session.execute(
            select(AsnModel, SupplierModel.supplier_name)
            .outerjoin(SupplierModel, SupplierModel.id == AsnModel.supplier_id)
            .where(AsnModel.asn_number.ilike(term))
            .order_by(AsnModel.created_at.desc()).limit(8)
        )).all()
        for asn, supplier_name in asns:
            results.append({
                "id": str(asn.id), "type": "ASN", "title": asn.asn_number,
                "subtitle": " · ".join(filter(None, [supplier_name, asn.vehicle_number, asn.status])),
                "url": f"/supplier/asns/new?search={quote(asn.asn_number)}",
            })

        gates = (await uow.session.execute(
            select(GateEntryModel).where(or_(GateEntryModel.gate_entry_number.ilike(term), GateEntryModel.vehicle_number.ilike(term), cast(GateEntryModel.created_at, String).ilike(term)))
            .order_by(GateEntryModel.created_at.desc()).limit(8)
        )).scalars().all()
        for gate in gates:
            results.append({
                "id": str(gate.id), "type": "Gate Entry", "title": gate.gate_entry_number,
                "subtitle": " · ".join(filter(None, [gate.vehicle_number, gate.driver_name, gate.status])),
                "url": f"/gate-dashboard?search={quote(gate.gate_entry_number)}",
            })


    return {"results": results[:30]}
