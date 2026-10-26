from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from app.common.persistence.models import AsnModel, MaterialModel, SupplierModel
from app.database.session import UnitOfWork, get_uow
from app.modules.dispatch.infrastructure.persistence.models import VehicleModel
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
            .where(or_(AsnModel.asn_number.ilike(term), AsnModel.vehicle_number.ilike(term), AsnModel.driver_name.ilike(term)))
            .order_by(AsnModel.created_at.desc()).limit(8)
        )).all()
        for asn, supplier_name in asns:
            results.append({
                "id": str(asn.id), "type": "ASN", "title": asn.asn_number,
                "subtitle": " · ".join(filter(None, [supplier_name, asn.vehicle_number, asn.status])),
                "url": "/supplier/asns",
            })

        materials = (await uow.session.execute(
            select(MaterialModel).where(or_(MaterialModel.material_code.ilike(term), MaterialModel.material_name.ilike(term)))
            .order_by(MaterialModel.created_at.desc()).limit(8)
        )).scalars().all()
        for material in materials:
            results.append({
                "id": str(material.id), "type": "Material", "title": material.material_code,
                "subtitle": material.material_name, "url": "/supplier-materials",
            })

        suppliers = (await uow.session.execute(
            select(SupplierModel).where(or_(SupplierModel.supplier_name.ilike(term), SupplierModel.registered_company_name.ilike(term), SupplierModel.supplier_code.ilike(term)))
            .order_by(SupplierModel.created_at.desc()).limit(8)
        )).scalars().all()
        for supplier in suppliers:
            results.append({
                "id": str(supplier.id), "type": "Supplier", "title": supplier.supplier_name,
                "subtitle": supplier.supplier_code or supplier.registered_company_name, "url": "/supplier-dashboard",
            })

        vehicles = (await uow.session.execute(
            select(VehicleModel).where(VehicleModel.vehicle_number.ilike(term)).limit(8)
        )).scalars().all()
        for vehicle in vehicles:
            results.append({
                "id": str(vehicle.id), "type": "Vehicle", "title": vehicle.vehicle_number,
                "subtitle": vehicle.status, "url": "/vehicle-queue",
            })

        gates = (await uow.session.execute(
            select(GateEntryModel).where(or_(GateEntryModel.gate_entry_number.ilike(term), GateEntryModel.vehicle_number.ilike(term), GateEntryModel.driver_name.ilike(term)))
            .order_by(GateEntryModel.created_at.desc()).limit(8)
        )).scalars().all()
        for gate in gates:
            results.append({
                "id": str(gate.id), "type": "Gate Entry", "title": gate.gate_entry_number,
                "subtitle": " · ".join(filter(None, [gate.vehicle_number, gate.driver_name, gate.status])),
                "url": f"/gate-dashboard?search={quote(gate.gate_entry_number)}",
            })


    return {"results": results[:30]}
