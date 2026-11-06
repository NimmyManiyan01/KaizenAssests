"""Read-only operational reporting with server-enforced module and supplier scope."""
from __future__ import annotations

import csv
import io
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response
from sqlalchemy import Date, String, text, and_, case, cast, exists, false, func, or_, select

from app.database.base import Base
from app.database.session import UnitOfWork
from app.security.dependencies import CurrentUser, get_current_user

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])

async def get_report_uow(response: Response):
    response.headers["Cache-Control"] = "no-store"
    async with UnitOfWork() as uow:
        if uow.session.bind.dialect.name == "postgresql":
            await uow.session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            await uow.session.execute(text("SET LOCAL TIME ZONE 'UTC'"))
        yield uow

MODULES = {"gate": "Gate Entry / Exit", "supplier": "Supplier", "grn": "GRN / Receiving",
           "warehouse": "Warehouse", "assembly": "Assembly", "dispatch": "Dispatch"}
BUCKETS = ("PENDING", "IN_PROGRESS", "DONE", "ATTENTION", "CANCELLED", "OTHER")
COMMON_DONE = {"COMPLETED", "CLOSED", "RESOLVED", "STORED", "PUTAWAY_COMPLETED",
               "ASSEMBLY_RECEIVED", "RECEIVED", "DELIVERED", "GATE_EXIT_COMPLETED", "VEHICLE_EXITED", "CHECKED_OUT", "EXITED"}
COMMON_ATTENTION = {"REJECTED", "QC_FAILED", "QUALITY_FAILED", "DISPUTED", "DISPUTE",
                    "ON_HOLD", "HELD", "QC_REJECTED", "PARTIALLY_REJECTED", "REWORK_REQUIRED", "DENIED_ENTRY", "FAILED", "SHORTAGE"}
COMMON_CANCELLED = {"CANCELLED", "CANCELED", "VOID"}
COMMON_PENDING = {"PENDING", "DRAFT", "GRN_DRAFT", "CREATED", "OPEN", "SUBMITTED", "SENT",
                  "SUPPLIER_SENT", "PENDING_RESPONSE", "PENDING_WAREHOUSE_APPROVAL",
                  "PUTAWAY_PENDING", "READY_FOR_PUTAWAY", "AWAITING_DOCK", "PENDING_ALLOCATION",
                  "PENDING_APPROVAL", "AWAITING_PICKUP"}
COMMON_PROGRESS = {"APPROVED", "ACCEPTED", "VERIFIED", "SECURITY_APPROVED", "CHECKED_IN",
                   "ASSIGNED", "RESERVED", "PARTIALLY_RESERVED", "PARTIALLY_COMPLETED",
                   "ALLOCATED", "DOCK_ASSIGNED", "AT_DOCK", "OCCUPIED", "IN_PROGRESS",
                   "PUTAWAY_IN_PROGRESS", "LOCATION_ASSIGNED", "ASSIGNED_TO_WAREHOUSE",
                   "IN_PRODUCTION", "QC_PENDING", "UNDER_INSPECTION", "QUALITY_PASSED", "QUALITY_INSPECTION_REQUIRED", "DOCK_ALLOCATION_PENDING", "PENDING_ALLOCATION",
                   "UNLOADING", "UNLOADED", "RECEIVING", "RECEIVING_COMPLETED", "RELEASED",
                   "EXIT_APPROVED", "GRN_POSTED", "CONFIRMED", "PICKING", "PICKED", "PACKING",
                   "PACKED", "LOADING", "LOADED", "READY", "READY_FOR_PICKUP", "READY_TO_DISPATCH", "DISPATCHED",
                   "IN_TRANSIT", "AT_RECEIVING", "AWAITING_GATE_EXIT", "REPLACEMENT_IN_TRANSIT"}

@dataclass(frozen=True)
class Report:
    key: str
    module: str
    label: str
    table: str
    reference: str
    date_field: str
    fields: str
    done: tuple[str, ...] = ()
    progress: tuple[str, ...] = ()
    pending: tuple[str, ...] = ()
    status_field: str | None = "status"
    fixed_status: str = "RECORDED"

REPORTS = [
 Report("gate_entries","gate","Inbound gate entries","gate_entry","gate_entry_number","created_at",
        "gate_entry_number vehicle_number driver_name status asn_id facility_entry_at exited_at exited_by assigned_dock_id created_at updated_at"),
 Report("gate_pickups","gate","FG pickup entry / exit","finished_goods_pickup_gate_visit","gate_pass_number","created_at",
        "gate_pass_number supplier_name vehicle_number driver_name request_id assembly_unit_code status arrived_at entered_at exited_at security_officer documents_verified created_at"),
 Report("asns","supplier","Advance shipment notices","asn","asn_number","created_at",
        "asn_number supplier_id vehicle_number driver_name transporter warehouse_id status shipment_type shipment_date expected_arrival_at invoice_number challan_number number_of_packages package_type created_at",
        done=("RECEIVED","RECEIVING_COMPLETED","GRN_COMPLETED","CLOSED")),
 Report("claims","supplier","Damage claims","supplier_damage_claim","claim_number","created_at",
        "claim_number supplier_id source_grn_id source_grn_line_id status supplier_response resolution return_required supplier_remarks sent_at responded_at closed_at created_at"),
 Report("returns","supplier","Supplier returns","supplier_return","return_number","created_at",
        "return_number claim_id quantity vehicle_number status created_by gate_exit_by gate_exit_at created_at"),
 Report("replacement_shipments","supplier","Replacement shipments","replacement_shipment","shipment_number","expected_arrival",
        "shipment_number claim_id asn_id vehicle_number status expected_quantity received_quantity accepted_quantity damaged_quantity replacement_grn_number gate_entry_number expected_arrival received_at inventory_posted_at",
        done=("INVENTORY_POSTED",)),
 Report("fg_requests","supplier","Finished-goods requests","finished_goods_request","request_number","created_at",
        "request_number supplier_id supplier_name assembly_unit_code finished_goods_code finished_goods_name quantity uom status work_order_number completed_quantity vehicle_number driver_name expected_pickup_date created_at"),
 Report("receipts","grn","Goods receipt notes","grn","grn_number","created_at",
        "grn_number asn_number gate_entry_number supplier_name supplier_company_name vehicle_number driver_name warehouse_id dock_number receipt_type receipt_date received_by status posted_by posted_at created_at",
        done=("GRN_POSTED","PUT_AWAY","CONFIRMED")),
 Report("quarantine","grn","Quarantine and disposition","quarantine_record","quarantine_number","created_at",
        "quarantine_number grn_number asn_number item_code material_name damaged_quantity uom batch_number supplier_name warehouse_id reason status disposition reviewed_by reviewed_at created_at",
        done=("RELEASED","RETURNED","DISPOSED"), progress=("UNDER_REVIEW",)),
 Report("putaways","warehouse","Putaway batches","putaway_task","task_number","created_at",
        "task_number grn_number item_code material_name batch_number quantity uom warehouse_id destination_bin_code destination_rack assigned_to status started_at completed_at completed_by created_at"),
 Report("stock","warehouse","Stock by batch and location","inventory_location_balance","material_code","updated_at",
        "material_code material_name batch_number warehouse_id storage_location_id quantity available_quantity uom last_grn_number updated_at",
        status_field=None, fixed_status="ON_HAND"),
 Report("requisitions","warehouse","Assembly requisitions","assembly_requisition","requisition_number","created_at",
        "requisition_number warehouse_id department requested_by priority required_date status assigned_warehouse_code assigned_by assigned_at created_at"),
 Report("material_requests","warehouse","Material requests","material_request","request_number","created_at",
        "request_number assembly_unit_code warehouse_id department requested_by priority required_date status remarks created_at updated_at"),
 Report("picks","warehouse","Picking orders","pick_task","task_number","created_at",
        "task_number request_number warehouse_id department status destination assigned_to assigned_at started_at completed_at completed_by created_at"),
 Report("pickup_batches","warehouse","Warehouse pickup batches","pickup_task","task_number","created_at",
        "task_number requisition_number warehouse_code department material_code material_name requested_quantity picked_quantity uom status picked_zone_code picked_batch_number completed_by completed_at created_at"),
 Report("issues","warehouse","Material issue transactions","inventory_issue_transaction","issue_number","issued_at",
        "issue_number requisition_number material_code material_name batch_number quantity uom warehouse_code zone_code recipient_department stock_before stock_after issued_by issued_at",
        status_field=None, fixed_status="ISSUED"),
 Report("docks","warehouse","Dock allocations","dock_allocation_requests","existing_gate_pass_id","created_at",
        "existing_gate_pass_id vendor_reference vehicle_number material_description quantity status assigned_dock_id assigned_warehouse_code assigned_by assigned_at arrived_at released_at created_at",
        done=("RELEASED",)),
 Report("orders","assembly","Production orders","assembly_order","order_number","created_at",
        "order_number assembly_unit_code product_code product_name bom_number planned_quantity completed_quantity rejected_quantity uom priority required_date assigned_line assigned_operator status material_received_at started_at completed_at created_at"),
 Report("inspections","assembly","Quality inspections","assembly_quality_inspection","id","inspected_at",
        "assembly_order_id produced_quantity passed_quantity failed_quantity rework_quantity held_quantity status inspected_by authorized_person_confirmed notes inspected_at",
        done=("QC_APPROVED","PASSED"), progress=("PARTIALLY_APPROVED",)),
 Report("finished_goods","assembly","Finished-goods records","assembly_finished_goods","section_main_id","posted_at",
        "section_main_id assembly_order_id product_code product_name batch_number serial_number quantity uom status location_code posted_at",
        done=("DISPATCHED",), progress=("QC_APPROVED","AVAILABLE")),
 Report("rework","assembly","Rework orders","assembly_rework_order","rework_number","created_at",
        "rework_number assembly_order_id reason_for_failure failed_quantity assigned_team assigned_worker status final_result started_at completed_at created_at"),
 Report("scrap","assembly","Scrap records","assembly_scrap","material_code","recorded_at",
        "assembly_order_id material_code quantity uom reason employee_team approval_required status recorded_at approved_by approved_at",
        done=("APPROVED",)),
 Report("dispatches","dispatch","Dispatch orders","dispatch_order","dispatch_number","created_at",
        "dispatch_number order_number assembly_unit_code customer_name warehouse_id dispatch_type status destination scheduled_date expected_delivery_date priority transporter transport_mode gate_exit_completed_at gate_exit_security_officer created_at updated_at",
        progress=("READY_FOR_DISPATCH","OUT_FOR_DELIVERY")),
]
REGISTRY = {r.key: r for r in REPORTS}
# Child tables are only read after their authorized parent has been selected.
CHILDREN = {
 "asns": ("asn_line", "asn_id", "item_code material_name shipped_quantity uom"),
 "receipts": ("grn_line", "grn_id", "item_code material_name uom received_quantity accepted_quantity quality_approved_quantity damaged_quantity rejected_quantity held_quantity balance_quantity quality_result"),
 "dispatches": ("dispatch_item", "dispatch_order_id", "material_code material_name uom quantity_ordered quantity_available quantity_picked quantity_packed quantity_loaded quantity_pending batch bin status"),
 "requisitions": ("assembly_requisition_item", "requisition_id", "material_code material_name requested_quantity reserved_quantity uom"),
 "finished_goods": ("finished_goods_section", "finished_goods_id", "section_number sub_id status loaded_at dispatched_at loaded_by dispatched_by"),
}
SUPPLIER_WAREHOUSE = {"putaways", "stock", "issues"}

def table(name):
    return Base.metadata.tables[name]

def classify(report: Report, value: str) -> str:
    status = str(value or "UNKNOWN").upper()
    if status in report.done: return "DONE"
    if status in report.progress: return "IN_PROGRESS"
    if status in report.pending: return "PENDING"
    if status in COMMON_CANCELLED: return "CANCELLED"
    if status in COMMON_ATTENTION: return "ATTENTION"
    if status in COMMON_DONE or status in {"ISSUED","RECORDED"}: return "DONE"
    if status in COMMON_PENDING: return "PENDING"
    if status in COMMON_PROGRESS or status == "ON_HAND": return "IN_PROGRESS"
    return "OTHER"

def status_expression(report):
    t = table(report.table)
    if report.status_field:
        return func.upper(func.coalesce(t.c[report.status_field], "UNKNOWN"))
    from sqlalchemy import literal
    return literal(report.fixed_status)

def bucket_expression(report):
    states = COMMON_DONE | COMMON_ATTENTION | COMMON_CANCELLED | COMMON_PENDING | COMMON_PROGRESS | set(report.done) | set(report.progress) | set(report.pending) | {"ISSUED","RECORDED","ON_HAND"}
    status = status_expression(report)
    return case(*[(status.in_([s for s in states if classify(report,s)==b]), b) for b in BUCKETS[:-1]], else_="OTHER")

async def access(user, session):
    roles = {r.upper().replace(" ", "_") for r in user.roles}
    if roles & {"ADMIN","SUPER_ADMIN","SUPERUSER"}:
        return set(MODULES), None, None, None
    modules = set()
    supplier_id = None
    warehouse = None
    if "SUPPLIER" in roles:
        from app.modules.gate.infrastructure.api.damage_claims import supplier_id_for_user
        class Scope:
            pass
        scope = Scope()
        scope.session = session
        supplier_id = await supplier_id_for_user(user, scope)
        # Fail closed: an unmapped supplier sees no records, never all suppliers.
        supplier_id = supplier_id or uuid.UUID(int=0)
        return {"supplier","warehouse"}, supplier_id, None, None
    if roles & {"GATE_SECURITY","GATE_OPERATOR"}: modules.add("gate")
    if roles & {"GRN","GRN_MANAGER","RECEIVING","OPERATIONS","OPERATIONS_MANAGER"}: modules.add("grn")
    if roles & {"WAREHOUSE","WAREHOUSE_MANAGER","WAREHOUSE_OPERATOR"}: modules.add("warehouse")
    if roles & {"ASSEMBLY","ASSEMBLY_MANAGER"}: modules.add("assembly")
    if roles & {"DISPATCH","DISPATCH_MANAGER","DISPATCH_OFFICER","DISPATCH_OPERATOR"}: modules.add("dispatch")
    if roles & {"QUALITY","QC"}: modules |= {"grn","assembly"}
    if roles & {"PROCUREMENT","PROCUREMENT_OFFICER","MANAGER"}: modules |= {"supplier","grn"}
    assembly_unit = (
        str(user.raw_claims.get("assembly_unit_code") or "").strip().upper()
        if roles & {"ASSEMBLY", "ASSEMBLY_MANAGER"}
        else None
    )
    if "WAREHOUSE_OPERATOR" in roles and not roles & {"WAREHOUSE","WAREHOUSE_MANAGER"}:
        account = table("user_account")
        warehouse = await session.scalar(select(account.c.warehouse_ref_id).where(account.c.username==user.username, account.c.status=="ACTIVE"))
        warehouse = warehouse or uuid.UUID(int=0)
    if not modules: raise HTTPException(403, "No reporting access is assigned to this role")
    return modules, supplier_id, warehouse, assembly_unit

def eligible(report, modules, supplier_id):
    return report.module in modules and (supplier_id is None or report.module != "warehouse" or report.key in SUPPLIER_WAREHOUSE)

def scope_condition(report, supplier_id, warehouse, assembly_unit):
    t = table(report.table)
    conditions = []
    if supplier_id is not None:
        a, g, p = table("asn"), table("grn"), table("putaway_task")
        owned_asns = select(a.c.id).where(a.c.supplier_id == supplier_id)
        owned_grns = select(g.c.id).where(g.c.asn_id.in_(owned_asns))
        if report.key in {"asns","claims","fg_requests"}:
            conditions.append(t.c.supplier_id == (str(supplier_id) if report.key == "fg_requests" else supplier_id))
        elif report.key in {"returns","replacement_shipments"}:
            claim = table("supplier_damage_claim")
            conditions.append(t.c.claim_id.in_(select(claim.c.id).where(claim.c.supplier_id==supplier_id)))
        elif report.key == "putaways":
            conditions.append(t.c.grn_id.in_(owned_grns))
        elif report.key in {"stock","issues"}:
            # Match receipt provenance at batch/material level; never scope by a shared material alone.
            batch_col = t.c.batch_number
            material_col = t.c.material_code
            conditions.append(exists(select(p.c.id).where(p.c.grn_id.in_(owned_grns), p.c.batch_number==batch_col, p.c.item_code==material_col)))
            # Suppress ambiguous shared batches instead of disclosing their combined balance.
            other = p.alias("other_supplier_putaway")
            conditions.append(~exists(select(other.c.id).where(
                other.c.batch_number==batch_col, other.c.item_code==material_col,
                or_(other.c.grn_id.not_in(owned_grns), other.c.grn_id.is_(None)))))

        else: conditions.append(false())
    if warehouse is not None:
        wh = table("warehouse_configuration")
        code = select(wh.c.warehouse_code).where(wh.c.id==warehouse).scalar_subquery()
        if report.key == "putaways":
            conditions.append(or_(t.c.destination_warehouse_ref_id==warehouse, and_(t.c.destination_warehouse_ref_id.is_(None),t.c.warehouse_id==code)))
        elif "warehouse_ref_id" in t.c:
            conditions.append(t.c.warehouse_ref_id==warehouse)
        elif "warehouse_id" in t.c:
            conditions.append(t.c.warehouse_id==code)
        elif "warehouse_code" in t.c:
            conditions.append(t.c.warehouse_code==code)
        elif "assigned_warehouse_ref_id" in t.c:
            conditions.append(t.c.assigned_warehouse_ref_id==warehouse)
        else: conditions.append(false())
    if assembly_unit is not None:
        if not assembly_unit:
            conditions.append(false())
        elif report.key in {"orders", "dispatches", "gate_pickups", "fg_requests", "material_requests"}:
            conditions.append(t.c.assembly_unit_code == assembly_unit)
        elif report.key in {"inspections", "finished_goods", "rework", "scrap"}:
            order = table("assembly_order")
            conditions.append(t.c.assembly_order_id.in_(select(order.c.id).where(order.c.assembly_unit_code == assembly_unit)))
        else:
            conditions.append(false())
    return conditions

def filters(report, supplier_id, warehouse, assembly_unit, start, end, search="", status="", bucket=""):
    t = table(report.table)
    conditions = scope_condition(report,supplier_id,warehouse,assembly_unit)
    if end == date.max: raise HTTPException(422,"End date must be earlier than 9999-12-31")
    if start and end and start > end: raise HTTPException(422,"Start date must be on or before end date")
    date_column = t.c[report.date_field]
    tz = timezone.utc if getattr(date_column.type, "timezone", False) else None
    if start: conditions.append(date_column >= datetime.combine(start,time.min,tzinfo=tz))
    if end: conditions.append(date_column < datetime.combine(end+timedelta(days=1),time.min,tzinfo=tz))
    if search.strip():
        value = search.strip().replace("\\","\\\\").replace("%","\\%").replace("_","\\_")
        conditions.append(or_(*[cast(t.c[f],String).ilike("%"+value+"%",escape="\\") for f in report.fields.split()]))
    if status: conditions.append(status_expression(report)==status.upper())
    if bucket:
        if bucket not in BUCKETS: raise HTTPException(422,"Invalid lifecycle group")
        conditions.append(bucket_expression(report)==bucket)
    return conditions

def definition(r):
    return {"key":r.key,"module":r.module,"label":r.label,"date_field":r.date_field,
            "columns":list(dict.fromkeys(["id"]+r.fields.split())),"reference":r.reference,
            "unit":"batch records" if r.key=="putaways" else "records",
            "date_basis":"Stock last updated" if r.key=="stock" else r.date_field.replace("_"," ").title()}

async def selected(key,user,session):
    report = REGISTRY.get(key)
    if report is None: raise HTTPException(404,"Report not found")
    modules,supplier,warehouse,assembly_unit = await access(user,session)
    if not eligible(report,modules,supplier): raise HTTPException(403,"Report is outside your reporting scope")
    return report,supplier,warehouse,assembly_unit

@router.get("/catalog")
async def catalog(user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_report_uow)):
    modules,supplier,warehouse,assembly_unit = await access(user,uow.session)
    roles = {r.strip().upper() for r in user.roles}
    return {"journey_access":bool(roles & {"ADMIN","SUPER_ADMIN","SUPERUSER","SUPPLIER"}),
            "modules":[{"key":k,"label":v} for k,v in MODULES.items() if k in modules],
            "reports":[definition(r) for r in REPORTS if eligible(r,modules,supplier)],
            "scope":"Your supplier's receipts and receipt-linked warehouse activity" if supplier is not None else ("Your assigned warehouse" if warehouse else (f"Assembly unit {assembly_unit}" if assembly_unit else "Your authorized modules")),
            "buckets":list(BUCKETS)}

@router.get("/summary")
async def summary(module:str="",start:date|None=None,end:date|None=None,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_report_uow)):
    modules,supplier,warehouse,assembly_unit = await access(user,uow.session)
    if module and module not in modules: raise HTTPException(403,"Module is outside your reporting scope")
    results = []
    daily = {}
    for r in REPORTS:
        if not eligible(r,modules,supplier) or module and r.module!=module: continue
        t = table(r.table)
        where = filters(r,supplier,warehouse,assembly_unit,start,end)
        status_expr = status_expression(r)
        statuses = (await uow.session.execute(select(status_expr.label("status"),func.count().label("count")).select_from(t).where(*where).group_by(status_expr))).mappings().all()
        counts = dict.fromkeys(BUCKETS,0)
        for row in statuses: counts[classify(r,row["status"])] += row["count"]
        trend = (await uow.session.execute(select(cast(t.c[r.date_field], Date).label("day"),func.count()).where(*where).group_by("day"))).all()
        for day,count in trend:
            if day: daily[str(day)] = daily.get(str(day),0)+count
        aged_open = 0
        if r.key != "stock":
            cutoff = datetime.now(timezone.utc) - timedelta(days=7)
            if not getattr(t.c[r.date_field].type, "timezone", False):
                cutoff = cutoff.replace(tzinfo=None)
            aged_open = await uow.session.scalar(select(func.count()).select_from(t).where(
                *where, bucket_expression(r).in_(["PENDING","IN_PROGRESS"]), t.c[r.date_field] < cutoff))
        results.append({**definition(r),"total":sum(counts.values()),"counts":counts,
                        "open_over_7_days":aged_open,"statuses":[dict(row) for row in statuses]})
    totals = {b:sum(r["counts"][b] for r in results) for b in BUCKETS}
    return {"generated_at":datetime.now(timezone.utc),"reports":results,"counts":totals,
            "total":sum(totals.values()),"trend":[{"date":d,"count":daily[d]} for d in sorted(daily)],
            "note":"Activity records across distinct workflows; a receipt and its batches count separately. Status is current; dates filter each report's stated date field. Stock is a current snapshot, not historical stock."}

def csv_cell(value):
    if isinstance(value,(dict,list)): value=__import__("json").dumps(jsonable_encoder(value),ensure_ascii=False)
    if value is None: return ""
    if isinstance(value, (int, float, Decimal)): return value
    s = str(value)
    return "'"+s if s.lstrip().startswith(("=","+","-","@")) else s

async def query_records(report,supplier,warehouse,assembly_unit,session,start,end,search,status,bucket,limit,offset):
    t = table(report.table)
    where = filters(report,supplier,warehouse,assembly_unit,start,end,search,status,bucket)
    total = await session.scalar(select(func.count()).select_from(t).where(*where))
    columns = list(dict.fromkeys(["id"]+report.fields.split()))
    rows = (await session.execute(select(*[t.c[c] for c in columns]).where(*where).order_by(t.c[report.date_field].desc().nullslast(),t.c.id).limit(limit).offset(offset))).mappings().all()
    return total,[{**dict(row),"lifecycle":classify(report,row.get(report.status_field) if report.status_field else report.fixed_status)} for row in rows]

async def quantity_totals(report,supplier,warehouse,assembly_unit,session,start,end,search,status,bucket):
    t = table(report.table)
    parent = select(t.c.id).where(*filters(report,supplier,warehouse,assembly_unit,start,end,search,status,bucket))
    source = t
    condition = t.c.id.in_(parent)
    fields = [f for f in ("quantity","available_quantity","requested_quantity","picked_quantity","planned_quantity","completed_quantity","rejected_quantity","damaged_quantity","actual_consumed") if f in t.c]
    if report.key in {"asns","receipts","dispatches","requisitions"}:
        child_name,fk,_ = CHILDREN[report.key]
        source=table(child_name)
        condition=source.c[fk].in_(parent)
        fields=[f for f in ("shipped_quantity","received_quantity","quality_approved_quantity","damaged_quantity","rejected_quantity","held_quantity","requested_quantity","quantity_ordered","quantity_picked","quantity_packed","quantity_loaded","quantity_pending") if f in source.c]
    if "uom" not in source.c or not fields: return []
    unit=func.coalesce(source.c.uom,"UNSPECIFIED")
    query=select(unit.label("uom"),*[func.coalesce(func.sum(source.c[f]),0).label(f) for f in fields]).where(condition).group_by(unit)
    return [dict(row) for row in (await session.execute(query)).mappings()]

@router.get("/records")
async def records(report:str,start:date|None=None,end:date|None=None,search:str=Query("",max_length=200),status:str="",bucket:str="",
                  limit:int=Query(25,ge=1,le=100),offset:int=Query(0,ge=0),user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_report_uow)):
    r,supplier,warehouse,assembly_unit = await selected(report,user,uow.session)
    total,rows = await query_records(r,supplier,warehouse,assembly_unit,uow.session,start,end,search,status,bucket,limit,offset)
    totals = await quantity_totals(r,supplier,warehouse,assembly_unit,uow.session,start,end,search,status,bucket)
    return {"total":total,"rows":rows,"quantity_totals":totals,"definition":definition(r),"limit":limit,"offset":offset}

@router.get("/export")
async def export(report:str,start:date|None=None,end:date|None=None,search:str=Query("",max_length=200),status:str="",bucket:str="",
                 user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_report_uow)):
    r,supplier,warehouse,assembly_unit = await selected(report,user,uow.session)
    total,rows = await query_records(r,supplier,warehouse,assembly_unit,uow.session,start,end,search,status,bucket,10001,0)
    if total>10000: raise HTTPException(422,"Export exceeds 10,000 records. Narrow the date or status filters.")
    output=io.StringIO()
    writer=csv.writer(output)
    columns=definition(r)["columns"]+["lifecycle"]
    writer.writerow(columns)
    writer.writerows([csv_cell(row.get(c)) for c in columns] for row in rows)
    return Response("\ufeff"+output.getvalue(),media_type="text/csv",headers={"Cache-Control":"no-store","Content-Disposition":f'attachment; filename="{r.key}-{date.today().isoformat()}.csv"'})

@router.get("/detail")
async def detail(report:str,id:uuid.UUID,user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_report_uow)):
    r,supplier,warehouse,assembly_unit = await selected(report,user,uow.session)
    t=table(r.table)
    columns=definition(r)["columns"]
    row=(await uow.session.execute(select(*[t.c[c] for c in columns]).where(t.c.id==id,*scope_condition(r,supplier,warehouse,assembly_unit)))).mappings().first()
    if row is None: raise HTTPException(404,"Report record not found")
    children=[]
    if r.key in CHILDREN:
        name,fk,fields=CHILDREN[r.key]
        child=table(name)
        children=[dict(x) for x in (await uow.session.execute(select(*[child.c[f] for f in fields.split()]).where(child.c[fk]==id))).mappings()]
    if r.key in {"orders","picks"}:
        # JSON item lists are operational line data, not a second record count.
        items=await uow.session.scalar(select(t.c["items"]).where(t.c.id==id))
        allowed={"material_code","material_name","requested_quantity","required_quantity","picked_quantity","issued_quantity","received_quantity","quantity","uom","status","batch_number"}
        children=[{k:v for k,v in item.items() if k in allowed} for item in (items or []) if isinstance(item,dict)]
    return {"record":dict(row),"lines":children}


# Import after shared reporting helpers are defined.
from .journeys import router as journey_router
router.include_router(journey_router)
