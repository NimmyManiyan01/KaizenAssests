"""ASN progression derived exclusively from linked operational records."""
from collections import defaultdict
from decimal import Decimal
from datetime import date, datetime, time, timedelta, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, cast, exists, func, or_, select, String

from app.database.session import UnitOfWork
from app.security.dependencies import CurrentUser, get_current_user
from .router import access, get_report_uow, table

router = APIRouter()
GRN_DONE = {"COMPLETED", "GRN_POSTED", "CONFIRMED", "PUT_AWAY"}
PUTAWAY_DONE = {"COMPLETED", "STORED", "PUTAWAY_COMPLETED"}
EXITS = {"EXITED", "VEHICLE_EXITED", "GATE_EXIT_COMPLETED", "CHECKED_OUT"}
STOPPED = {"CANCELLED", "CANCELED", "VOID"}
DENIED = {"REJECTED", "DENIED_ENTRY"}

def require_journey_role(user):
    roles = {r.strip().upper() for r in user.roles}
    if not roles.intersection({"ADMIN", "SUPER_ADMIN", "SUPERUSER", "SUPPLIER"}):
        raise HTTPException(403, "ASN journey reporting is available to Admin and Supplier")

def rows_by(rows, key):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row[key]].append(row)
    return grouped

def safe_rows(rows, reference, timestamp):
    return [{"id":str(row["id"]), "reference":str(row.get(reference) or row["id"]),
             "status":row.get("status"), "at":row.get(timestamp),
             "fields":{k:v for k,v in row.items() if k!="id"}} for row in rows]

def stage(key,label,state,records,note="",done=0,total=0):
    return {"key":key,"label":label,"state":state,"records":records,"note":note,
            "completed_count":done,"total_count":total,
            "at":next((r["at"] for r in reversed(records) if r.get("at")),None)}

def progress_state(done,total,started=False):
    if total and done==total: return "DONE"
    if done or started: return "IN_PROGRESS"
    return "PENDING"

def build_journey(asn, supplier_name, gates, allocations, assignments, grns, putaways, lines, dock_names):
    """Keep parallel exit/warehouse stages independent; never infer a release from a free dock."""
    cancelled = str(asn.get("status") or "").upper() in STOPPED
    stages = [stage("asn","ASN created","CANCELLED" if cancelled else "DONE",
                    safe_rows([asn],"asn_number","created_at"),"Saved ASN record.",1,1)]
    gate_records=safe_rows(gates,"gate_entry_number","created_at")
    denied=bool(gates) and all(str(g.get("status") or "").upper() in DENIED|STOPPED for g in gates)
    stages.append(stage("gate","Gate entry","ATTENTION" if denied else ("DONE" if gates else "PENDING"),
                        gate_records,"Actual gate passes linked to this ASN.",len(gates),len(gates)))

    # The allocation request and receiving assignment describe the same event.
    # Merge their evidence by gate-pass ID/number so it is never counted twice.
    gate_by_id={g["id"]:g for g in gates}
    assignment_by_pass={}
    for a in assignments:
        gate=gate_by_id.get(a["gate_entry_id"])
        key=gate["gate_entry_number"] if gate else str(a["gate_entry_id"])
        assignment_by_pass[key]=a
    pass_alias={str(g["id"]):g["gate_entry_number"] for g in gates}
    events=[]
    seen=set()
    for allocation in allocations:
        key=pass_alias.get(allocation["existing_gate_pass_id"],allocation["existing_gate_pass_id"])
        if str(allocation.get("status") or "").upper() in STOPPED: continue
        assignment=assignment_by_pass.get(key)
        if not allocation.get("assigned_dock_id") and not assignment:
            continue
        seen.add(key)
        released_at=allocation.get("released_at") or (assignment.get("dock_released_at") if assignment else None)
        released=bool(released_at) or str(allocation.get("status") or "").upper()=="RELEASED"
        dock=dock_names.get(allocation.get("assigned_dock_id"),{})
        events.append({"id":str(allocation["id"]),"reference":dock.get("dock_code") or (assignment.get("dock_number") if assignment else None) or "Dock assignment",
                       "status":allocation.get("status"),"at":allocation.get("assigned_at") or (assignment.get("assigned_at") if assignment else None),
                       "released":released,"released_at":released_at,
                       "fields":{"gate_pass":key,"dock_code":dock.get("dock_code") or (assignment.get("dock_number") if assignment else None),
                                 "dock_name":dock.get("dock_name"),"allocation_status":allocation.get("status"),
                                 "assigned_by":allocation.get("assigned_by") or (assignment.get("assigned_by") if assignment else None),
                                 "assigned_at":allocation.get("assigned_at"),"released_at":released_at}})
    for key,assignment in assignment_by_pass.items():
        if key in seen: continue
        events.append({"id":str(assignment["id"]),"reference":assignment["dock_number"],"status":"RELEASED" if assignment.get("dock_released_at") else "ASSIGNED",
                       "at":assignment.get("assigned_at"),"released":bool(assignment.get("dock_released_at")),
                       "released_at":assignment.get("dock_released_at"),
                       "fields":{"gate_pass":key,"dock_code":assignment["dock_number"],"assigned_by":assignment.get("assigned_by"),
                                 "assigned_at":assignment.get("assigned_at"),"released_at":assignment.get("dock_released_at")}})
    stages.append(stage("dock","Dock allocation","DONE" if events else ("IN_PROGRESS" if allocations else "PENDING"),
                        events or safe_rows(allocations,"existing_gate_pass_id","created_at"),
                        "Saved allocation and receiving-assignment evidence, merged per gate pass.",len(events),len(events)))

    active_grns=[g for g in grns if str(g.get("status") or "").upper() not in STOPPED]
    completed_grns=sum(str(g.get("status") or "").upper() in GRN_DONE for g in active_grns)
    grn_rows=safe_rows(grns,"grn_number","posted_at")
    for r,g in zip(grn_rows,grns):
        r["at"]=g.get("posted_at") or g.get("created_at")
    stages.append(stage("grn","GRN / receiving",progress_state(completed_grns,len(active_grns),bool(active_grns)),
                        grn_rows,"Drafts remain in progress. Only saved completed/posted receipts complete this stage.",
                        completed_grns,len(active_grns)))
    released=sum(bool(e["released"]) for e in events)
    release_records=[{**e,"at":e.get("released_at"),"status":"RELEASED" if e["released"] else "NOT_RELEASED"} for e in events]
    stages.append(stage("release","Dock release",progress_state(released,len(events),bool(completed_grns)),
                        release_records,"Release uses this shipment's recorded release event, not the dock's current availability.",released,len(events)))

    active_tasks=[p for p in putaways if str(p.get("status") or "").upper() not in STOPPED]
    stored=sum(str(p.get("status") or "").upper() in PUTAWAY_DONE for p in active_tasks)
    approved=sum((Decimal(str(line["quality_approved_quantity"] if line.get("quality_approved_quantity") is not None else line.get("good_quantity") or 0)) for line in lines),Decimal("0"))
    no_storage=bool(active_grns) and completed_grns==len(active_grns) and bool(lines) and approved==0 and not active_tasks
    stages.append(stage("putaway","Warehouse putaway","NOT_REQUIRED" if no_storage else progress_state(stored,len(active_tasks),bool(active_tasks)),
                        safe_rows(active_tasks,"task_number","completed_at"),
                        "No approved stock requires putaway." if no_storage else "Batch progress; all linked active batches must be stored to complete.",
                        stored,len(active_tasks)))
    active_gates=[g for g in gates if str(g.get("status") or "").upper() not in DENIED|STOPPED]
    exited=sum(bool(g.get("exited_at")) or str(g.get("status") or "").upper() in EXITS for g in active_gates)
    stages.append(stage("exit","Vehicle gate exit",progress_state(exited,len(active_gates),bool(released)),
                        safe_rows(active_gates,"gate_entry_number","exited_at"),
                        "Exit and putaway can proceed independently after receiving.",exited,len(active_gates)))

    warnings=[]
    saved=str(asn.get("status") or "").upper()
    if events and saved in {"AWAITING_DOCK","PENDING_ALLOCATION","PENDING_DOCK_ALLOCATION"}:
        warnings.append("The saved ASN status is behind its linked dock/receiving records. The journey uses those records; the saved ASN is not modified.")
    if active_grns and not events:
        warnings.append("Receipts exist but no linked dock-allocation evidence was found.")
    if released and completed_grns < len(active_grns):
        warnings.append("A dock release is recorded while a linked GRN remains incomplete.")
    if cancelled: current="ASN cancelled"
    elif denied: current="Gate entry requires attention"
    elif not gates: current="Awaiting gate entry"
    elif not events: current="Awaiting dock allocation"
    elif not active_grns or completed_grns<len(active_grns): current="GRN / receiving pending" if not active_grns else "GRN / receiving in progress"
    elif released<len(events): current="Awaiting dock release"
    else:
        pending=[]
        if not no_storage and (not active_tasks or stored<len(active_tasks)): pending.append("Putaway in progress" if active_tasks else "Awaiting putaway")
        if exited<len(active_gates): pending.append("Awaiting vehicle exit")
        current="; ".join(pending) if pending else "Inbound journey complete"
    quantities=defaultdict(lambda:{"received":Decimal("0"),"approved":Decimal("0"),"damaged":Decimal("0"),"rejected":Decimal("0")})
    for line in lines:
        unit=line.get("uom") or "UNSPECIFIED"
        for target,source in [("received","received_quantity"),("approved","quality_approved_quantity"),("damaged","damaged_quantity"),("rejected","rejected_quantity")]:
            quantities[unit][target]+=Decimal(str(line.get(source) or 0))
    return {"id":str(asn["id"]),"asn_number":asn["asn_number"],"supplier_name":supplier_name,
            "vehicle_number":asn.get("vehicle_number"),"source_status":asn.get("status"),
            "current_stage":current,"created_at":asn.get("created_at"),"stages":stages,"warnings":warnings,
            "quantities":[{"uom":uom,**values} for uom,values in quantities.items()]}

async def load_journeys(session,asns):
    if not asns: return []
    ids=[a["id"] for a in asns]
    async def fetch(name,fields,*conditions):
        t=table(name)
        return [dict(r) for r in (await session.execute(select(*[t.c[f] for f in fields.split()]).where(*conditions))).mappings()]
    g=table("gate_entry")
    gates=await fetch("gate_entry","id asn_id gate_entry_number vehicle_number driver_name status assigned_dock_id created_at facility_entry_at exited_at exited_by",g.c.asn_id.in_(ids))
    gate_ids=[g["id"] for g in gates]
    gate_passes=[g["gate_entry_number"] for g in gates]
    d=table("dock_allocation_requests")
    allocations=await fetch("dock_allocation_requests","id existing_gate_pass_id assigned_dock_id status assigned_by assigned_at released_at created_at arrived_at completed_at",
                            d.c.existing_gate_pass_id.in_(gate_passes+[str(i) for i in gate_ids]))
    a=table("dock_assignment")
    assignments=await fetch("dock_assignment","id gate_entry_id asn_id dock_number assigned_by assigned_at dock_released_at dock_released_by",
                            or_(a.c.asn_id.in_(ids),a.c.gate_entry_id.in_(gate_ids)))
    r=table("grn")
    grns=await fetch("grn","id asn_id asn_number gate_entry_id gate_entry_number grn_number vehicle_number status created_at posted_at received_by dock_number",
                     or_(r.c.asn_id.in_(ids),and_(r.c.asn_id.is_(None),r.c.gate_entry_id.in_(gate_ids))))
    grn_ids=[r["id"] for r in grns]
    p=table("putaway_task")
    putaways=await fetch("putaway_task","id grn_id task_number grn_number item_code material_name batch_number quantity uom status destination_bin_code created_at completed_at",p.c.grn_id.in_(grn_ids))
    l=table("grn_line")
    lines=await fetch("grn_line","id grn_id item_code material_name uom received_quantity quality_approved_quantity good_quantity damaged_quantity rejected_quantity",l.c.grn_id.in_(grn_ids))
    dm=table("dock_masters")
    docks=await fetch("dock_masters","id dock_code dock_name",dm.c.id.in_([d["assigned_dock_id"] for d in allocations if d.get("assigned_dock_id")]))
    sup=table("supplier")
    suppliers=await fetch("supplier","id supplier_name",sup.c.id.in_([a["supplier_id"] for a in asns]))
    names={s["id"]:s["supplier_name"] for s in suppliers}
    dock_names={d["id"]:d for d in docks}
    result=[]
    for asn in asns:
        own_gates=[g for g in gates if g["asn_id"]==asn["id"]]
        own_gate_ids={g["id"] for g in own_gates}
        own_passes={g["gate_entry_number"] for g in own_gates}|{str(i) for i in own_gate_ids}
        own_grns=[g for g in grns if g["asn_id"]==asn["id"] or (g["asn_id"] is None and g["gate_entry_id"] in own_gate_ids)]
        own_grn_ids={g["id"] for g in own_grns}
        result.append(build_journey(asn,names.get(asn["supplier_id"]),own_gates,
            [d for d in allocations if d["existing_gate_pass_id"] in own_passes],
            [d for d in assignments if d["gate_entry_id"] in own_gate_ids or d["asn_id"]==asn["id"]],
            own_grns,[p for p in putaways if p["grn_id"] in own_grn_ids],
            [l for l in lines if l["grn_id"] in own_grn_ids],dock_names))
    return result

@router.get("/journeys")
async def journeys(start:date|None=None,end:date|None=None,search:str=Query("",max_length=200),
                   asn_id:uuid.UUID|None=None,limit:int=Query(10,ge=1,le=50),offset:int=Query(0,ge=0),
                   user:CurrentUser=Depends(get_current_user),uow:UnitOfWork=Depends(get_report_uow)):
    require_journey_role(user)
    _,supplier_id,_=await access(user,uow.session)
    t=table("asn")
    where=[]
    if supplier_id is not None: where.append(t.c.supplier_id==supplier_id)
    if asn_id: where.append(t.c.id==asn_id)
    if end==date.max or start and end and start>end: raise HTTPException(422,"Choose a valid date range")
    if start: where.append(t.c.created_at>=datetime.combine(start,time.min))
    if end: where.append(t.c.created_at<datetime.combine(end+timedelta(days=1),time.min))
    if search.strip():
        q=search.strip().replace("\\","\\\\").replace("%","\\%").replace("_","\\_")
        pattern="%"+q+"%"
        g,r,s=table("gate_entry"),table("grn"),table("supplier")
        where.append(or_(*[t.c[f].ilike(pattern,escape="\\") for f in ["asn_number","vehicle_number","driver_name"]],
            exists(select(g.c.id).where(g.c.asn_id==t.c.id,g.c.gate_entry_number.ilike(pattern,escape="\\"))),
            exists(select(r.c.id).where(r.c.asn_id==t.c.id,r.c.grn_number.ilike(pattern,escape="\\"))),
            exists(select(s.c.id).where(s.c.id==t.c.supplier_id,s.c.supplier_name.ilike(pattern,escape="\\")))))
    total=await uow.session.scalar(select(func.count()).select_from(t).where(*where))
    columns="id asn_number supplier_id vehicle_number driver_name status created_at shipment_date expected_arrival_at".split()
    asns=[dict(r) for r in (await uow.session.execute(select(*[t.c[c] for c in columns]).where(*where).order_by(t.c.created_at.desc(),t.c.id).limit(limit).offset(offset))).mappings()]
    rows=await load_journeys(uow.session,asns)
    return {"total":total,"rows":rows,"generated_at":datetime.now(timezone.utc),
            "can_open_workspaces":supplier_id is None,
            "source":"Live ASN, gate, dock, receipt and putaway records. No sample or seeded journey data."}
