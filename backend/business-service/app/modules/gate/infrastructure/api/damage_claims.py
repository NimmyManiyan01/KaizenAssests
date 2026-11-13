"""Damage-claim response, replacement receipt, return, and closure workflow."""
from __future__ import annotations
import datetime, uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from app.database.session import UnitOfWork, get_uow
from app.modules.gate.infrastructure.persistence.models import DamagePhotoModel, DamageReportModel, GateEntryModel, ReceivingLineModel, SupplierDamageClaimModel, SupplierReturnModel, ReplacementShipmentModel
from app.common.persistence.models import AsnModel, AsnLineModel, SupplierModel, SupplierUserModel
from app.modules.receiving.infrastructure.persistence.models import GrnModel, GrnLineModel, GrnDamageEvidenceModel
from app.common.persistence.models import MaterialStockModel, NotificationModel
from app.security.dependencies import CurrentUser, get_current_user

router = APIRouter(prefix="/api/damage-claims", tags=["damage-claims"])
RESPONSES = {"ACCEPT", "REJECT", "PARTIALLY_ACCEPT", "REQUEST_MORE_INFORMATION", "REPLACEMENT_OFFERED", "RETURN_ACCEPTED", "DISPUTE", "DISPUTE_RAISED"}
RESOLUTIONS = {"REPLACEMENT", "CREDIT_NOTE", "RETURN"}
now = lambda: datetime.datetime.now(datetime.timezone.utc)

async def supplier_id_for_user(user: CurrentUser, uow: UnitOfWork):
    mapped = (await uow.session.execute(
        select(SupplierUserModel.supplier_id).where(SupplierUserModel.username == user.username)
    )).scalar_one_or_none()
    value = (user.raw_claims or {}).get("supplier_id")
    claimed = None
    if value:
        try:
            claimed = uuid.UUID(str(value))
        except ValueError:
            claimed = (await uow.session.execute(
                select(SupplierModel.id).where(SupplierModel.supplier_code == str(value))
            )).scalar_one_or_none()
    # The legacy local supplier token carries sup-00001 while ASN creation
    # binds that account to the persistent SUP-DEFAULT supplier. Resolve the
    # same identity here for both listing claims and authorizing responses.
    if (
        mapped is None and claimed is None
        and user.username in {"supplier", "supplier_partner"}
        and value in {None, "sup-00001"}
    ):
        from app.config.settings import get_settings

        if get_settings().environment.lower() in {"local", "test", "development"}:
            claimed = (await uow.session.execute(
                select(SupplierModel.id).where(SupplierModel.supplier_code == "SUP-DEFAULT")
            )).scalar_one_or_none()
    if mapped and claimed and mapped != claimed:
        raise HTTPException(403, "Authenticated supplier identity is inconsistent")
    return mapped or claimed

class ResponseBody(BaseModel):
    response: str
    resolution: str | None = None
    remarks: str | None = Field(None, max_length=2000)
    return_required: bool = False
class ShipmentBody(BaseModel):
    vehicle_number: str = Field(..., min_length=1, max_length=32)
    driver_name: str | None = Field(None, max_length=128)
    driver_contact: str | None = Field(None, max_length=32)
    expected_arrival: datetime.datetime | None = None
    replacement_quantity: float | None = Field(None, gt=0)
    transporter: str | None = Field(None, max_length=128)
    challan_number: str | None = Field(None, max_length=128)
    invoice_number: str | None = Field(None, max_length=128)
class GateBody(BaseModel):
    vehicle_number: str = Field(..., min_length=1, max_length=32)
class ReceiptBody(BaseModel):
    received_quantity: float = Field(..., ge=0)
class InspectionBody(BaseModel):
    accepted_quantity: float = Field(..., ge=0)
    damaged_quantity: float = Field(..., ge=0)
class PutawayBody(BaseModel):
    location: str = Field(..., min_length=1, max_length=128)
class ReturnBody(BaseModel):
    vehicle_number: str = Field(..., min_length=1, max_length=32)

def require_role(user: CurrentUser, *roles: str):
    if not any(role in user.roles for role in roles): raise HTTPException(403, "Role is not authorized for this action")
async def claim_context(claim_id: str, uow: UnitOfWork):
    try: cid = uuid.UUID(claim_id)
    except ValueError: raise HTTPException(404, "Damage claim was not found")
    row = (await uow.session.execute(select(SupplierDamageClaimModel, DamageReportModel, ReceivingLineModel)
        .outerjoin(DamageReportModel, DamageReportModel.id == SupplierDamageClaimModel.damage_report_id)
        .outerjoin(ReceivingLineModel, ReceivingLineModel.id == DamageReportModel.receiving_line_id)
        .where(SupplierDamageClaimModel.id == cid))).first()
    if not row: raise HTTPException(404, "Damage claim was not found")
    claim, report, line = row
    # GRN-native claims do not have a legacy damage_report or receiving_line.
    # Resolve their source GRN line so response/replacement/return actions
    # work for both claim formats.
    if line is None and claim.source_grn_line_id:
        line = (await uow.session.execute(
            select(GrnLineModel).where(GrnLineModel.id == claim.source_grn_line_id)
        )).scalar_one_or_none()
    return claim, report, line
async def next_number(uow, model, field, prefix):
    value = (await uow.session.execute(select(func.max(field)))).scalar_one_or_none()
    try: sequence = int(value.split("-",1)[1]) + 1 if value else 1
    except (ValueError, IndexError): sequence = 1
    return f"{prefix}-{sequence:05d}"

def compute_replacement_asn_number(original_asn_number: str, existing_records: list[str]) -> str:
    """Compute collision-safe replacement reference: {original}-R, or -R2, -R3 if already exists."""
    cleaned = (original_asn_number or "").strip()
    if not cleaned:
        cleaned = "ASN-REPLACEMENT"
    base_ref = f"{cleaned}-R"
    existing_set = {str(n).strip().upper() for n in existing_records if n}
    if base_ref.upper() not in existing_set:
        return base_ref
    counter = 2
    while f"{base_ref.upper()}{counter}" in existing_set or f"{cleaned.upper()}-R{counter}" in existing_set:
        counter += 1
    return f"{cleaned}-R{counter}"

async def get_next_replacement_asn_number(uow: UnitOfWork, original_asn_number: str) -> str:
    """Generate a collision-safe replacement ASN reference by appending -R to the original ASN."""
    cleaned = (original_asn_number or "").strip()
    if not cleaned:
        cleaned = "ASN-REPLACEMENT"
    base_ref = f"{cleaned}-R"
    existing_records = (await uow.session.execute(
        select(AsnModel.asn_number).where(
            func.upper(AsnModel.asn_number).like(f"{base_ref.upper()}%")
        )
    )).scalars().all()
    return compute_replacement_asn_number(original_asn_number, existing_records)

@router.get("")
async def list_claims(user: CurrentUser = Depends(get_current_user), uow: UnitOfWork = Depends(get_uow)):
    require_role(user, "SUPPLIER", "PROCUREMENT", "WAREHOUSE", "GATE_SECURITY", "ADMIN")
    query = select(SupplierDamageClaimModel, DamageReportModel, ReceivingLineModel, GateEntryModel, AsnModel, GrnModel, GrnLineModel)
    if "SUPPLIER" in user.roles:
        supplier_id = await supplier_id_for_user(user, uow)
        if supplier_id is None: return []
        query = query.where(SupplierDamageClaimModel.supplier_id == supplier_id)
    rows = (await uow.session.execute(query
        .outerjoin(DamageReportModel, DamageReportModel.id == SupplierDamageClaimModel.damage_report_id)
        .outerjoin(ReceivingLineModel, ReceivingLineModel.id == DamageReportModel.receiving_line_id)
        .outerjoin(GateEntryModel, GateEntryModel.id == DamageReportModel.gate_entry_id)
        .outerjoin(AsnModel, AsnModel.id == GateEntryModel.asn_id)
        .outerjoin(GrnModel, GrnModel.id == SupplierDamageClaimModel.source_grn_id)
        .outerjoin(GrnLineModel, GrnLineModel.id == SupplierDamageClaimModel.source_grn_line_id)
        .order_by(SupplierDamageClaimModel.created_at.desc()))).all()
    result=[]
    # Backfill claims for completed GRNs created before automatic publication
    # was enabled. This is idempotent because damage_report_id is unique.
    if not rows and "SUPPLIER" in user.roles:
        supplier_id = await supplier_id_for_user(user, uow)
        if supplier_id is not None:
            reports = (await uow.session.execute(
                select(DamageReportModel, GateEntryModel, AsnModel)
                .join(GateEntryModel, GateEntryModel.id == DamageReportModel.gate_entry_id)
                .join(AsnModel, AsnModel.id == GateEntryModel.asn_id)
                .where(AsnModel.supplier_id == supplier_id, DamageReportModel.damaged_quantity > 0)
            )).all()
            last_claim = (await uow.session.execute(select(func.max(SupplierDamageClaimModel.claim_number)))).scalar_one_or_none()
            try: sequence = int(last_claim.split("-", 1)[1]) + 1 if last_claim else 1
            except (ValueError, IndexError): sequence = 1
            for report, _gate, _asn in reports:
                if report.grn_number:
                    uow.session.add(SupplierDamageClaimModel(
                        claim_number=f"DC-{sequence:05d}", damage_report_id=report.id,
                        supplier_id=supplier_id, status="SUPPLIER_SENT", created_by="SYSTEM",
                        created_at=now(), sent_at=now(),
                    ))
                    sequence += 1
            if reports:
                await uow.session.flush()
                rows = (await uow.session.execute(query
                    .outerjoin(DamageReportModel, DamageReportModel.id == SupplierDamageClaimModel.damage_report_id)
                    .outerjoin(ReceivingLineModel, ReceivingLineModel.id == DamageReportModel.receiving_line_id)
                    .outerjoin(GateEntryModel, GateEntryModel.id == DamageReportModel.gate_entry_id)
                    .outerjoin(AsnModel, AsnModel.id == GateEntryModel.asn_id)
                    .outerjoin(GrnModel, GrnModel.id == SupplierDamageClaimModel.source_grn_id)
                    .outerjoin(GrnLineModel, GrnLineModel.id == SupplierDamageClaimModel.source_grn_line_id)
                    .where(SupplierDamageClaimModel.supplier_id == supplier_id)
                    .order_by(SupplierDamageClaimModel.created_at.desc()))).all()

    # Backfill claims for GRNs completed through the receiving workflow before
    # GRN-native publication was added. This also handles a supplier having
    # one existing claim while another damaged GRN line is still unclaimed.
    if "SUPPLIER" in user.roles:
        supplier_id = await supplier_id_for_user(user, uow)
        if supplier_id is not None:
            grn_lines = (await uow.session.execute(
                select(GrnModel, GrnLineModel, AsnModel)
                .join(GrnLineModel, GrnLineModel.grn_id == GrnModel.id)
                .join(AsnModel, AsnModel.id == GrnModel.asn_id)
                .where(
                    AsnModel.supplier_id == supplier_id,
                    GrnModel.status.in_(("COMPLETED", "POSTED")),
                    (GrnLineModel.damaged_quantity > 0) | (GrnLineModel.rejected_quantity > 0),
                )
            )).all()
            last_claim = (await uow.session.execute(
                select(func.max(SupplierDamageClaimModel.claim_number))
            )).scalar_one_or_none()
            try:
                sequence = int(last_claim.rsplit("-", 1)[1]) + 1 if last_claim else 1
            except (ValueError, IndexError):
                sequence = 1
            created_any = False
            for grn, source_line, _asn in grn_lines:
                existing = (await uow.session.execute(
                    select(SupplierDamageClaimModel.id).where(
                        SupplierDamageClaimModel.source_grn_line_id == source_line.id
                    )
                )).scalar_one_or_none()
                if existing:
                    continue
                claim_number = f"DC-{sequence:05d}"
                sequence += 1
                created_at = grn.posted_at or grn.created_at
                uow.session.add(SupplierDamageClaimModel(
                    claim_number=claim_number,
                    source_grn_id=grn.id,
                    source_grn_line_id=source_line.id,
                    supplier_id=supplier_id,
                    status="SUPPLIER_SENT",
                    created_by="SYSTEM",
                    created_at=created_at,
                    sent_at=created_at,
                ))
                created_any = True
            if created_any:
                await uow.session.flush()
                rows = (await uow.session.execute(query
                    .outerjoin(DamageReportModel, DamageReportModel.id == SupplierDamageClaimModel.damage_report_id)
                    .outerjoin(ReceivingLineModel, ReceivingLineModel.id == DamageReportModel.receiving_line_id)
                    .outerjoin(GateEntryModel, GateEntryModel.id == DamageReportModel.gate_entry_id)
                    .outerjoin(AsnModel, AsnModel.id == GateEntryModel.asn_id)
                    .outerjoin(GrnModel, GrnModel.id == SupplierDamageClaimModel.source_grn_id)
                    .outerjoin(GrnLineModel, GrnLineModel.id == SupplierDamageClaimModel.source_grn_line_id)
                    .where(SupplierDamageClaimModel.supplier_id == supplier_id)
                    .order_by(SupplierDamageClaimModel.created_at.desc()))).all()
    if not rows:
        return []
    for claim, report, line, gate_entry, asn, source_grn, source_line in rows:
        if source_line is not None:
            if source_grn is not None:
                gate_entry = await uow.session.get(GateEntryModel, source_grn.gate_entry_id) if source_grn.gate_entry_id else None
                asn_id = source_grn.asn_id or (gate_entry.asn_id if gate_entry else None)
                asn = await uow.session.get(AsnModel, asn_id) if asn_id else None
            evidence = (await uow.session.execute(select(GrnDamageEvidenceModel).where(GrnDamageEvidenceModel.grn_line_id == source_line.id))).scalars().all()
            shipment = (await uow.session.execute(select(ReplacementShipmentModel).where(ReplacementShipmentModel.claim_id == claim.id))).scalar_one_or_none()
            returned = (await uow.session.execute(select(SupplierReturnModel).where(SupplierReturnModel.claim_id == claim.id))).scalar_one_or_none()

            orig_asn_num = (source_grn.asn_number if source_grn else None) or (asn.asn_number if asn else None)
            display_status = claim.status
            if claim.status == "CLOSED":
                display_status = "RESOLVED"
            elif claim.status == "REPLACEMENT_COMPLETED":
                display_status = "REPLACEMENT_COMPLETED"
            elif claim.status in {"REPLACEMENT_IN_TRANSIT", "REPLACEMENT_IN_PROGRESS"}:
                display_status = claim.status
            elif shipment:
                if shipment.status in {"INVENTORY_POSTED", "PUTAWAY_COMPLETED"}:
                    display_status = "REPLACEMENT_COMPLETED"
                elif shipment.status in {"IN_TRANSIT", "AT_RECEIVING", "AWAITING_INSPECTION", "INSPECTION_PASSED"}:
                    display_status = "REPLACEMENT_IN_TRANSIT"
                else:
                    display_status = shipment.status
            elif not claim.supplier_response:
                display_status = "PENDING_RESPONSE"
            else:
                display_status = "ACCEPTED" if claim.supplier_response in {"ACCEPT", "PARTIALLY_ACCEPT", "REPLACEMENT_OFFERED"} else claim.supplier_response

            workflow_state = (
                "COMPLETED" if (claim.status == "REPLACEMENT_COMPLETED" or (shipment and shipment.status in {"INVENTORY_POSTED", "PUTAWAY_COMPLETED"}))
                else ("IN_PROGRESS" if (shipment or claim.status in {"REPLACEMENT_IN_TRANSIT", "REPLACEMENT_IN_PROGRESS"})
                else "PENDING")
            )

            result.append({"id": str(claim.id), "claim_number": claim.claim_number, "status": display_status,
              "claim_status": claim.status, "workflow_state": workflow_state,
              "claim_source": "GRN",
              "response": claim.supplier_response, "resolution": claim.resolution, "responded_at": claim.responded_at.isoformat() if claim.responded_at else None, "supplier_remarks": claim.supplier_remarks,
              "return_required": claim.return_required, "po_number": source_grn.po_number if source_grn else None,
              "grn_number": source_grn.grn_number if source_grn else None, "grn_id": str(source_grn.id) if source_grn else None,
              "material": source_line.material_name or source_line.item_code, "item_code": source_line.item_code,
              "batch_number": None, "received_quantity": float(source_line.received_quantity or 0),
              "accepted_quantity": float(source_line.accepted_quantity or 0), "damaged_quantity": float(source_line.damaged_quantity or 0),
              "rejected_quantity": float(source_line.rejected_quantity or 0), "uom": source_line.uom,
              "asn_number": orig_asn_num,
              "original_asn_number": orig_asn_num,
              "replacement_asn_number": shipment.shipment_number if shipment else (f"{orig_asn_num}-R" if orig_asn_num else None),
              "asn_id": str(asn.id) if asn else (str(source_grn.asn_id) if source_grn and source_grn.asn_id else None),
              "original_asn_id": str(asn.id) if asn else (str(source_grn.asn_id) if source_grn and source_grn.asn_id else None),
              "vehicle_number": (source_grn.vehicle_number if source_grn else None) or (gate_entry.vehicle_number if gate_entry else None) or (asn.vehicle_number if asn else None),
              "gate_entry_number": (source_grn.gate_entry_number if source_grn else None) or (gate_entry.gate_entry_number if gate_entry else None),
              "inbound_exited_at": gate_entry.exited_at.isoformat() if gate_entry and gate_entry.exited_at else None,
              "driver_name": (source_grn.driver_name if source_grn else None) or (gate_entry.driver_name if gate_entry else None) or (asn.driver_name if asn else None),
              "driver_contact": asn.driver_contact if asn else None,
              "asn_status": asn.status if asn else None,
              "asn_shipment_date": asn.shipment_date.isoformat() if asn and asn.shipment_date else None,
              "damage_reason": next((e.reason for e in evidence if e.reason), None), "remarks": next((e.remarks for e in evidence if e.remarks), None),
              "photos": [{"filename": e.file_name, "content_type": "image/*", "file_path": e.file_path} for e in evidence],
              "replacement_asn": None if not shipment else {"id": str(shipment.id), "asn_id": str(shipment.asn_id) if shipment.asn_id else None, "asn_number": shipment.shipment_number, "status": shipment.status, "claim_id": str(claim.id), "supplier_id": str(claim.supplier_id), "expected_quantity": float(shipment.expected_quantity), "original_asn_number": orig_asn_num},
              "shipment": None if not shipment else {"id":str(shipment.id),"shipment_number":shipment.shipment_number,"asn_id":str(shipment.asn_id) if shipment.asn_id else None,"asn_number":shipment.shipment_number,"status":shipment.status,"vehicle_number":shipment.vehicle_number,"gate_entry_number":shipment.gate_entry_number,"replacement_grn_number":shipment.replacement_grn_number,"expected_quantity":float(shipment.expected_quantity),"received_quantity":float(shipment.received_quantity) if shipment.received_quantity is not None else None,"accepted_quantity":float(shipment.accepted_quantity) if shipment.accepted_quantity is not None else None,"damaged_quantity":float(shipment.damaged_quantity) if shipment.damaged_quantity is not None else None,"putaway_location":shipment.putaway_location},
              "return": None if not returned else {"id":str(returned.id),"return_number":returned.return_number,"status":returned.status,"vehicle_number":returned.vehicle_number}})
            continue
        grn_id = (await uow.session.execute(
            select(GrnModel.id).where(GrnModel.grn_number == report.grn_number).limit(1)
        )).scalar_one_or_none() if report.grn_number else None
        photos = (await uow.session.execute(select(DamagePhotoModel).where(DamagePhotoModel.damage_report_id == report.id))).scalars().all()
        shipment=(await uow.session.execute(select(ReplacementShipmentModel).where(ReplacementShipmentModel.claim_id==claim.id))).scalar_one_or_none()
        returned=(await uow.session.execute(select(SupplierReturnModel).where(SupplierReturnModel.claim_id==claim.id))).scalar_one_or_none()
        orig_asn_num = asn.asn_number if asn else None
        display_status = claim.status
        if claim.status == "CLOSED": display_status = "RESOLVED"
        elif claim.status == "REPLACEMENT_COMPLETED": display_status = "REPLACEMENT_COMPLETED"
        elif claim.status in {"REPLACEMENT_IN_TRANSIT", "REPLACEMENT_IN_PROGRESS"}: display_status = claim.status
        elif shipment:
            if shipment.status in {"INVENTORY_POSTED", "PUTAWAY_COMPLETED"}: display_status = "REPLACEMENT_COMPLETED"
            elif shipment.status in {"IN_TRANSIT", "AT_RECEIVING", "AWAITING_INSPECTION", "INSPECTION_PASSED"}: display_status = "REPLACEMENT_IN_TRANSIT"
            else: display_status = shipment.status
        elif not claim.supplier_response: display_status = "PENDING_RESPONSE"
        else: display_status = "ACCEPTED" if claim.supplier_response in {"ACCEPT", "PARTIALLY_ACCEPT", "REPLACEMENT_OFFERED"} else claim.supplier_response
        workflow_state = (
            "COMPLETED" if (claim.status == "REPLACEMENT_COMPLETED" or (shipment and shipment.status in {"INVENTORY_POSTED", "PUTAWAY_COMPLETED"}))
            else ("IN_PROGRESS" if (shipment or claim.status in {"REPLACEMENT_IN_TRANSIT", "REPLACEMENT_IN_PROGRESS"})
            else "PENDING")
        )
        result.append({"id":str(claim.id),"claim_number":claim.claim_number,"status":display_status,"claim_status":claim.status,"workflow_state":workflow_state,"response":claim.supplier_response,"resolution":claim.resolution,
          "claim_source": "LEGACY_DAMAGE_REPORT",
          "responded_at":claim.responded_at.isoformat() if claim.responded_at else None,"supplier_remarks":claim.supplier_remarks,"return_required":claim.return_required,"po_number":report.po_number,"grn_number":report.grn_number,
          "grn_id": str(grn_id) if grn_id else None,
          "material":report.material_name or report.material_code,"item_code":report.material_code,"batch_number":None,
          "received_quantity":float(report.received_quantity),"accepted_quantity":float(line.good_quantity or 0),
          "damaged_quantity":float(report.damaged_quantity),"rejected_quantity":float(line.rejected_quantity or 0),"uom":line.uom,
          "asn_number": orig_asn_num, "original_asn_number": orig_asn_num,
          "replacement_asn_number": shipment.shipment_number if shipment else (f"{orig_asn_num}-R" if orig_asn_num else None),
          "asn_id": str(asn.id) if asn else None, "original_asn_id": str(asn.id) if asn else None,
          "vehicle_number": asn.vehicle_number if asn else gate_entry.vehicle_number,
          "driver_name": asn.driver_name if asn else gate_entry.driver_name, "driver_contact": asn.driver_contact if asn else None,
          "damage_reason": report.damage_reason, "remarks": report.remarks,
          "photos": [{"filename": p.filename, "content_type": p.content_type, "image_base64": __import__("base64").b64encode(p.image_data).decode("ascii")} for p in photos],
          "replacement_asn": None if not shipment else {"id": str(shipment.id), "asn_id": str(shipment.asn_id) if shipment.asn_id else None, "asn_number": shipment.shipment_number, "status": shipment.status, "claim_id": str(claim.id), "supplier_id": str(claim.supplier_id), "expected_quantity": float(shipment.expected_quantity), "original_asn_number": orig_asn_num},
          "shipment": None if not shipment else {"id":str(shipment.id),"shipment_number":shipment.shipment_number,"asn_id":str(shipment.asn_id) if shipment.asn_id else None,"asn_number":shipment.shipment_number,"status":shipment.status,"vehicle_number":shipment.vehicle_number,
            "gate_entry_number":shipment.gate_entry_number,"replacement_grn_number":shipment.replacement_grn_number,"expected_quantity":float(shipment.expected_quantity),
            "received_quantity":float(shipment.received_quantity) if shipment.received_quantity is not None else None,"accepted_quantity":float(shipment.accepted_quantity) if shipment.accepted_quantity is not None else None,
            "damaged_quantity":float(shipment.damaged_quantity) if shipment.damaged_quantity is not None else None,"putaway_location":shipment.putaway_location},
          "return":None if not returned else {"id":str(returned.id),"return_number":returned.return_number,"status":returned.status,"vehicle_number":returned.vehicle_number}})
    return result

async def ensure_supplier_owns_claim(user: CurrentUser, claim: SupplierDamageClaimModel, uow: UnitOfWork):
    if "SUPPLIER" not in user.roles: return
    supplier_id = await supplier_id_for_user(user, uow)
    if supplier_id is None or claim.supplier_id != supplier_id:
        raise HTTPException(403, "Claim belongs to another supplier")

@router.post("/{claim_id}/respond")
async def respond(claim_id:str, body:ResponseBody, user:CurrentUser=Depends(get_current_user), uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"SUPPLIER","ADMIN"); claim,report,line=await claim_context(claim_id,uow)
    await ensure_supplier_owns_claim(user, claim, uow)
    response=body.response.upper(); resolution=body.resolution.upper() if body.resolution else None
    if response not in RESPONSES: raise HTTPException(422,"Invalid supplier response")
    if response in {"ACCEPT","PARTIALLY_ACCEPT","REPLACEMENT_OFFERED","RETURN_ACCEPTED"} and resolution not in RESOLUTIONS: raise HTTPException(422,"Select a resolution for an accepted claim")
    claim.supplier_response=response; claim.resolution=resolution; claim.supplier_remarks=body.remarks; claim.return_required=body.return_required; claim.responded_at=now()
    claim.status = "ACCEPTED" if response in {"ACCEPT","PARTIALLY_ACCEPT","REPLACEMENT_OFFERED","RETURN_ACCEPTED"} else ("DISPUTED" if response in {"DISPUTE", "DISPUTE_RAISED"} else response)
    uow.session.add(NotificationModel(user_role="PROCUREMENT",title=f"Claim {claim.claim_number} response",message=f"Supplier responded {response.replace('_',' ')}"+(f" — {resolution.replace('_',' ')}" if resolution else ""),link="/procurement/quality-issues"))
    await uow.session.flush(); return {"claim_number":claim.claim_number,"status":claim.status,"response":response,"resolution":resolution}

@router.post("/{claim_id}/replacement-shipments",status_code=201)
async def ship_replacement(claim_id:str, body:ShipmentBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"SUPPLIER","ADMIN"); claim,report,line=await claim_context(claim_id,uow)
    await ensure_supplier_owns_claim(user, claim, uow)
    if not claim.resolution:
        claim.resolution = "REPLACEMENT"
        if not claim.supplier_response:
            claim.supplier_response = "ACCEPT"
        if not claim.responded_at:
            claim.responded_at = now()
    elif claim.resolution not in {"REPLACEMENT","RETURN_REPLACEMENT"}:
        raise HTTPException(409,"Claim resolution does not include replacement")
    existing=(await uow.session.execute(select(ReplacementShipmentModel).where(ReplacementShipmentModel.claim_id==claim.id))).scalar_one_or_none()
    if existing:
        return {"id":str(existing.id),"shipment_number":existing.shipment_number,"asn_id":str(existing.asn_id) if existing.asn_id else None,"asn_number":existing.shipment_number,"status":existing.status}

    # Fetch ONLY eligible damaged material from damage claim
    item_code = report.material_code if report is not None else (line.item_code if line is not None else "ITEM")
    material_name = (
        report.material_name or report.material_code
        if report is not None
        else (line.material_name or line.item_code if line is not None else item_code)
    )
    material_id = getattr(line, "material_id", None) if line is not None else None
    max_eligible_qty = float(
        report.damaged_quantity
        if report is not None
        else (line.damaged_quantity or 0) + (line.rejected_quantity or 0)
    )
    if max_eligible_qty <= 0:
        raise HTTPException(409, "Claim has no damaged or rejected quantity available for replacement")
    uom = (line.uom if line is not None else "PCS") or "PCS"

    if body.replacement_quantity is not None:
        req_qty = float(body.replacement_quantity)
        if req_qty <= 0:
            raise HTTPException(422, "Replacement quantity must be greater than zero")
        if req_qty > max_eligible_qty:
            raise HTTPException(422, f"Replacement quantity ({req_qty}) cannot exceed eligible damaged quantity ({max_eligible_qty})")
        replacement_quantity = Decimal(str(req_qty))
    else:
        replacement_quantity = Decimal(str(max_eligible_qty))

    # Retrieve original ASN and append suffix -R
    original_asn = None
    original_asn_number = None
    source_grn = None
    if claim.source_grn_id:
        source_grn = await uow.session.get(GrnModel, claim.source_grn_id)
        if source_grn:
            if source_grn.asn_id:
                original_asn = await uow.session.get(AsnModel, source_grn.asn_id)
            if not original_asn and source_grn.gate_entry_id:
                gate = await uow.session.get(GateEntryModel, source_grn.gate_entry_id)
                if gate and gate.asn_id:
                    original_asn = await uow.session.get(AsnModel, gate.asn_id)
            original_asn_number = (original_asn.asn_number if original_asn else None) or source_grn.asn_number
    elif claim.damage_report_id and report:
        if report.gate_entry_id:
            gate = await uow.session.get(GateEntryModel, report.gate_entry_id)
            if gate and gate.asn_id:
                original_asn = await uow.session.get(AsnModel, gate.asn_id)
                original_asn_number = original_asn.asn_number
    if not original_asn_number:
        original_asn_number = f"ASN-{claim.claim_number}"

    replacement_asn_number = await get_next_replacement_asn_number(uow, original_asn_number)

    supplier = await uow.session.get(SupplierModel, claim.supplier_id)
    supplier_name = supplier.supplier_name if supplier else "Supplier"

    replacement_asn = AsnModel(
        asn_number=replacement_asn_number,
        supplier_id=claim.supplier_id,
        po_id=str(source_grn.po_id) if source_grn and source_grn.po_id else (str(original_asn.po_id) if original_asn and original_asn.po_id else None),
        po_number=source_grn.po_number if source_grn and source_grn.po_number else (original_asn.po_number if original_asn else None),
        status="SUBMITTED",
        warehouse_id=source_grn.warehouse_id if source_grn and source_grn.warehouse_id else (original_asn.warehouse_id if original_asn else "WH_PUNE-01"),
        vehicle_number=body.vehicle_number.upper(),
        driver_name=body.driver_name or (original_asn.driver_name if original_asn else "Replacement Driver"),
        driver_contact=body.driver_contact or (original_asn.driver_contact if original_asn else None),
        expected_arrival_at=body.expected_arrival or (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)),
        shipment_date=now().date(),
        shipment_type="REPLACEMENT",
        claim_id=claim.id,
        transporter=body.transporter,
        challan_number=body.challan_number,
        invoice_number=body.invoice_number,
        logistics=[{
            "type": "replacement_claim",
            "claim_id": str(claim.id),
            "claim_number": claim.claim_number,
            "original_asn_id": str(original_asn.id) if original_asn else None,
            "original_asn_number": original_asn_number,
            "original_grn_id": str(claim.source_grn_id) if claim.source_grn_id else None,
            "original_grn_number": source_grn.grn_number if source_grn else None,
            "material_code": item_code,
            "material_name": material_name,
            "damaged_quantity": max_eligible_qty,
            "replacement_quantity": float(replacement_quantity),
            "uom": uom,
        }, {
            "type": "asn_details",
            "supplier_name": supplier_name,
            "destination_warehouse": "Main Warehouse",
        }],
    )
    replacement_asn.lines.append(AsnLineModel(
        material_id=material_id,
        item_code=item_code,
        material_name=material_name,
        shipped_quantity=replacement_quantity,
        uom=uom,
    ))
    uow.session.add(replacement_asn)
    await uow.session.flush()

    shipment=ReplacementShipmentModel(shipment_number=replacement_asn_number,claim_id=claim.id,asn_id=replacement_asn.id,expected_quantity=replacement_quantity,vehicle_number=body.vehicle_number.upper(),expected_arrival=body.expected_arrival,status="IN_TRANSIT")
    uow.session.add(shipment)
    claim.status="REPLACEMENT_IN_TRANSIT"
    uow.session.add(NotificationModel(user_role="GATE_SECURITY",title=f"Replacement {replacement_asn_number} expected",message=f"Vehicle {shipment.vehicle_number} carrying replacement {replacement_quantity} {uom} for claim {claim.claim_number} (Original ASN: {original_asn_number}).",link="/replacement-gate-entry"))
    uow.session.add(NotificationModel(user_role="WAREHOUSE",title=f"Replacement {replacement_asn_number} dispatched",message=f"Supplier dispatched replacement {replacement_asn_number} for claim {claim.claim_number}.",link="/damage-claims"))
    await uow.session.flush()
    return {"id":str(shipment.id),"shipment_number":replacement_asn_number,"asn_id":str(replacement_asn.id),"asn_number":replacement_asn_number,"original_asn_number":original_asn_number,"shipment_type":"REPLACEMENT","claim_id":str(claim.id),"status":shipment.status}

async def get_shipment(shipment_id,uow):
    try: sid=uuid.UUID(shipment_id)
    except ValueError: raise HTTPException(404,"Replacement shipment was not found")
    shipment=await uow.session.get(ReplacementShipmentModel,sid)
    if not shipment: raise HTTPException(404,"Replacement shipment was not found")
    return shipment

@router.post("/replacement-shipments/{shipment_id}/gate-entry")
async def gate_entry(shipment_id:str,body:GateBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"GATE_SECURITY","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if body.vehicle_number.upper()!=shipment.vehicle_number: raise HTTPException(409,"Vehicle does not match replacement shipment")
    if shipment.asn_id:
        existing_gate = (await uow.session.execute(select(GateEntryModel).where(GateEntryModel.asn_id == shipment.asn_id))).scalar_one_or_none()
        if existing_gate:
            shipment.gate_entry_number = existing_gate.gate_entry_number
            shipment.gate_recorded_by = user.username
            shipment.gate_recorded_at = now()
            shipment.status = "AT_RECEIVING"
            await uow.session.flush()
            return {"gate_entry_number": existing_gate.gate_entry_number, "asn_id": str(shipment.asn_id), "status": shipment.status}
        asn = await uow.session.get(AsnModel, shipment.asn_id)
        if asn is None: raise HTTPException(409, "Replacement ASN is missing")
        gate = GateEntryModel(
            gate_entry_number=await next_number(uow, GateEntryModel, GateEntryModel.gate_entry_number, "GE"),
            po_id=None,
            asn_id=asn.id,
            po_number=asn.po_number or "REPLACEMENT",
            vehicle_number=shipment.vehicle_number,
            driver_name=asn.driver_name or "Supplier replacement driver",
            driver_phone=asn.driver_contact,
            po_document_path="replacement-claim",
            status="ARRIVED",
            verification_type="REPLACEMENT_ASN",
            security_officer_id=user.username,
            ocr_supplier_name=str(asn.supplier_id),
        )
        uow.session.add(gate)
        await uow.session.flush()
        shipment.gate_entry_number = gate.gate_entry_number
    if not shipment.asn_id:
        shipment.gate_entry_number=await next_number(uow,ReplacementShipmentModel,ReplacementShipmentModel.gate_entry_number,"RGE")
    shipment.gate_recorded_by=user.username; shipment.gate_recorded_at=now(); shipment.status="AT_RECEIVING"; await uow.session.flush()
    return {"gate_entry_number":shipment.gate_entry_number,"status":shipment.status}

@router.post("/replacement-shipments/{shipment_id}/receive")
async def receive(shipment_id:str,body:ReceiptBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if shipment.status!="AT_RECEIVING": raise HTTPException(409,"Replacement must complete gate entry first")
    shipment.replacement_grn_number=await next_number(uow,ReplacementShipmentModel,ReplacementShipmentModel.replacement_grn_number,"RGRN")
    shipment.received_quantity=body.received_quantity; shipment.received_by=user.username; shipment.received_at=now(); shipment.status="AWAITING_INSPECTION"; await uow.session.flush()
    return {"replacement_grn":shipment.replacement_grn_number,"received":body.received_quantity,"expected":float(shipment.expected_quantity),"status":shipment.status}

@router.post("/replacement-shipments/{shipment_id}/inspect")
async def inspect(shipment_id:str,body:InspectionBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if shipment.received_quantity is None or abs(body.accepted_quantity+body.damaged_quantity-float(shipment.received_quantity))>.0001: raise HTTPException(422,"Accepted plus damaged must equal received")
    shipment.accepted_quantity=body.accepted_quantity; shipment.damaged_quantity=body.damaged_quantity; shipment.inspected_by=user.username; shipment.inspected_at=now(); shipment.status="INSPECTION_PASSED" if body.damaged_quantity==0 else "INSPECTION_FAILED"; await uow.session.flush()
    return {"status":shipment.status,"accepted":body.accepted_quantity,"damaged":body.damaged_quantity}

@router.post("/replacement-shipments/{shipment_id}/putaway")
async def putaway(shipment_id:str,body:PutawayBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if shipment.status!="INSPECTION_PASSED": raise HTTPException(409,"Replacement inspection must pass before putaway")
    shipment.putaway_location=body.location; shipment.putaway_by=user.username; shipment.putaway_at=now(); shipment.status="PUTAWAY_COMPLETED"; await uow.session.flush(); return {"status":shipment.status,"location":body.location}

@router.post("/replacement-shipments/{shipment_id}/post-inventory")
async def post_inventory(shipment_id:str,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","ADMIN"); shipment=await get_shipment(shipment_id,uow)
    if shipment.status!="PUTAWAY_COMPLETED" or shipment.inventory_posted_at: raise HTTPException(409,"Complete putaway before posting inventory")
    claim,report,line=await claim_context(str(shipment.claim_id),uow); qty=shipment.accepted_quantity or 0
    mat_code = report.material_code if report is not None else (line.item_code if line is not None else "ITEM")
    mat_name = (report.material_name or report.material_code) if report is not None else (line.material_name or line.item_code if line is not None else mat_code)
    uom_val = (line.uom if line is not None else "PCS") or "PCS"
    stock=(await uow.session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code==mat_code).with_for_update())).scalar_one_or_none()
    if stock is None: stock=MaterialStockModel(material_code=mat_code,material_name=mat_name,category="REPLACEMENT",on_hand=0,allocated=0,available=0,uom=uom_val,warehouse_id="WH_PUNE-01",reorder_point=0); uow.session.add(stock)
    stock.on_hand=(stock.on_hand or 0)+qty; stock.available=(stock.available or 0)+qty; stock.updated_at=datetime.datetime.now(); shipment.inventory_posted_at=now(); shipment.status="INVENTORY_POSTED"; claim.status="REPLACEMENT_COMPLETED"; await uow.session.flush()
    return {"status":shipment.status,"inventory_added":float(qty),"available_inventory":float(stock.available)}

@router.post("/{claim_id}/returns",status_code=201)
async def create_return(claim_id:str,body:ReturnBody,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"WAREHOUSE","PROCUREMENT","ADMIN"); claim,report,line=await claim_context(claim_id,uow)
    if not claim.return_required: raise HTTPException(409,"Supplier did not request return of damaged goods")
    existing=(await uow.session.execute(select(SupplierReturnModel).where(SupplierReturnModel.claim_id==claim.id))).scalar_one_or_none()
    if existing:return {"id":str(existing.id),"return_number":existing.return_number,"status":existing.status}
    return_quantity = report.damaged_quantity if report is not None else (line.damaged_quantity or 0) + (line.rejected_quantity or 0)
    if return_quantity <= 0: raise HTTPException(409,"Claim has no damaged or rejected quantity available for return")
    number=await next_number(uow,SupplierReturnModel,SupplierReturnModel.return_number,"SR"); record=SupplierReturnModel(return_number=number,claim_id=claim.id,quantity=return_quantity,status="AWAITING_GATE_EXIT",vehicle_number=body.vehicle_number.upper(),created_by=user.username,created_at=now());uow.session.add(record);await uow.session.flush();return {"id":str(record.id),"return_number":number,"status":record.status}

@router.post("/returns/{return_id}/gate-exit")
async def return_exit(return_id:str,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"GATE_SECURITY","ADMIN")
    try: record=await uow.session.get(SupplierReturnModel,uuid.UUID(return_id))
    except ValueError: record=None
    if not record: raise HTTPException(404,"Supplier return was not found")
    claim,report,line=await claim_context(str(record.claim_id),uow)
    record.status="RETURNED_TO_SUPPLIER";record.gate_exit_by=user.username;record.gate_exit_at=now()
    line.disposition_status="RETURNED_TO_SUPPLIER"
    await uow.session.flush();return {"return_number":record.return_number,"status":record.status}

@router.post("/{claim_id}/close")
async def close_claim(claim_id:str,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_uow)):
    require_role(user,"PROCUREMENT","ADMIN");claim,report,line=await claim_context(claim_id,uow)
    if claim.resolution in {"REPLACEMENT","RETURN_REPLACEMENT"}:
        shipment=(await uow.session.execute(select(ReplacementShipmentModel).where(ReplacementShipmentModel.claim_id==claim.id))).scalar_one_or_none()
        if not shipment or shipment.status!="INVENTORY_POSTED": raise HTTPException(409,"Replacement obligation is not complete")
    if claim.return_required:
        returned=(await uow.session.execute(select(SupplierReturnModel).where(SupplierReturnModel.claim_id==claim.id))).scalar_one_or_none()
        if not returned or returned.status!="RETURNED_TO_SUPPLIER": raise HTTPException(409,"Damaged goods return is not complete")
    claim.status="CLOSED";claim.closed_by=user.username;claim.closed_at=now()
    if report is not None: report.status="CLOSED"
    await uow.session.flush();return {"claim_number":claim.claim_number,"status":"CLOSED"}


@router.get("/return-reasons")
async def list_return_reasons():
    """Unified return and damage claim rejection reasons (CHG-MOD-002)."""
    from app.modules.returns.domain.return_reason import ReturnReason
    return [{"code": r.value, "label": r.name.replace("_", " ").title()} for r in ReturnReason]
