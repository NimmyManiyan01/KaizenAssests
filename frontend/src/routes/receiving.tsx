import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Database,
  DoorOpen,
  FileCheck2,
  FileText,
  Filter,
  Loader2,
  PackageCheck,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Truck,
  UserCheck,
  UserRound,
  Warehouse,
  X,
} from "lucide-react";

export const Route = createFileRoute("/receiving")({ component: ReceivingControlCenter });

type ReceivingStatus =
  | "PENDING_RECEIVING"
  | "AT_DOCK"
  | "UNLOADING"
  | "UNLOADING_COMPLETED"
  | "QC_PENDING"
  | "QC_IN_PROGRESS"
  | "QC_COMPLETED"
  | "GRN_DRAFT"
  | "GRN_REVIEW"
  | "GRN_POSTED"
  | "READY_FOR_PUTAWAY"
  | "QC_HOLD";

const statusLabels: Record<ReceivingStatus, string> = {
  PENDING_RECEIVING: "Gate Entry",
  AT_DOCK: "At Dock",
  UNLOADING: "Unloading",
  UNLOADING_COMPLETED: "Unloaded",
  QC_PENDING: "QC Pending",
  QC_IN_PROGRESS: "QC In Progress",
  QC_COMPLETED: "QC Completed",
  GRN_DRAFT: "GRN Draft",
  GRN_REVIEW: "GRN Pending",
  GRN_POSTED: "GRN Posted",
  READY_FOR_PUTAWAY: "Ready for Putaway",
  QC_HOLD: "QC Hold",
};

interface InboundRecord {
  id: string;
  gatePassNo: string;
  vehicleNo: string;
  supplierName: string;
  supplierCode: string;
  poNo: string;
  asnNo: string;
  dockNo: string;
  warehouseName: string;
  zoneName: string;
  status: ReceivingStatus;
  entryTime: string;
  securityOfficer: string;
  assignedOperator: string;
  assignedInspector: string;
  expectedQty: number;
  receivedQty: number;
  damagedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: string;
  ewayNo: string;
  ewayValidUntil: string;
  lrNo: string;
  lrDate: string;
  transporterName: string;
  driverName: string;
  rawArrival?: any;
}

function mapArrivalToRecord(arrival: any): InboundRecord {
  let status: ReceivingStatus = "PENDING_RECEIVING";
  const rawStatus = (arrival.status || "").toUpperCase();
  if (["AT_DOCK", "DOCK_ASSIGNED", "OCCUPIED", "MOVING_TO_DOCK"].includes(rawStatus)) {
    status = "AT_DOCK";
  } else if (["UNLOADING", "UNLOADING_IN_PROGRESS"].includes(rawStatus)) {
    status = "UNLOADING";
  } else if (["UNLOADED", "UNLOADING_COMPLETED"].includes(rawStatus)) {
    status = "UNLOADING_COMPLETED";
  } else if (["QC_PENDING", "QUALITY_INSPECTION_REQUIRED"].includes(rawStatus)) {
    status = "QC_PENDING";
  } else if (["QC_IN_PROGRESS"].includes(rawStatus)) {
    status = "QC_IN_PROGRESS";
  } else if (["QC_HOLD", "QUALITY_FAILED"].includes(rawStatus)) {
    status = "QC_HOLD";
  } else if (["QC_COMPLETED", "QUALITY_PASSED"].includes(rawStatus)) {
    status = "QC_COMPLETED";
  } else if (["GRN_DRAFT"].includes(rawStatus)) {
    status = "GRN_DRAFT";
  } else if (["GRN_REVIEW", "GRN_PENDING"].includes(rawStatus)) {
    status = "GRN_REVIEW";
  } else if (["GRN_POSTED", "RECEIVING_COMPLETED", "COMPLETED"].includes(rawStatus)) {
    status = "GRN_POSTED";
  } else if (["READY_FOR_PUTAWAY"].includes(rawStatus)) {
    status = "READY_FOR_PUTAWAY";
  } else {
    status = "PENDING_RECEIVING";
  }

  const materials = Array.isArray(arrival.expected_materials) ? arrival.expected_materials : [];
  const expectedQty = materials.reduce(
    (acc: number, m: any) => acc + Number(m.po_quantity || m.quantity || 0),
    0,
  );
  const receivedQty = materials.reduce(
    (acc: number, m: any) => acc + Number(m.received_quantity || 0),
    0,
  );
  const damagedQty = materials.reduce(
    (acc: number, m: any) => acc + Number(m.damaged_quantity || 0),
    0,
  );
  const acceptedQty = materials.reduce(
    (acc: number, m: any) => acc + Number(m.good_quantity || 0),
    0,
  );
  const rejectedQty = materials.reduce(
    (acc: number, m: any) => acc + Number(m.rejected_quantity || 0),
    0,
  );

  const formatTime = (ts?: string) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return Number.isNaN(d.getTime())
      ? ts
      : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  };

  return {
    id: String(arrival.id || arrival.gate_pass_number || arrival.gate_entry_no || Math.random()),
    gatePassNo: arrival.gate_pass_number || arrival.gate_entry_no || "—",
    vehicleNo: arrival.vehicle_number || "—",
    supplierName: arrival.supplier_name || arrival.vendor || "—",
    supplierCode: arrival.supplier_code || "—",
    poNo: arrival.po_number || "—",
    asnNo: arrival.asn_number || "—",
    dockNo: arrival.dock_number || arrival.assigned_dock_id || "Unassigned",
    warehouseName: arrival.assigned_warehouse_name || arrival.warehouse_name || "Raw Material Warehouse",
    zoneName: arrival.zone || "Inbound Receiving Bay",
    status,
    entryTime: formatTime(arrival.facility_entry_at || arrival.entry_time),
    securityOfficer: arrival.security_officer_name || arrival.security_officer || "Security Officer",
    assignedOperator: arrival.unloading_started_by || arrival.assigned_by || "Warehouse Operator",
    assignedInspector: arrival.quality_inspected_by || "Quality Inspector",
    expectedQty,
    receivedQty,
    damagedQty,
    acceptedQty,
    rejectedQty,
    invoiceNo: arrival.invoice_number || "—",
    invoiceDate: arrival.invoice_date || "—",
    invoiceAmount: arrival.invoice_amount || "—",
    ewayNo: arrival.eway_bill_number || "—",
    ewayValidUntil: arrival.eway_bill_valid_until || "—",
    lrNo: arrival.lr_number || "—",
    lrDate: arrival.lr_date || "—",
    transporterName: arrival.transporter_name || arrival.shipment?.transporter || "—",
    driverName: arrival.driver_name
      ? `${arrival.driver_name}${arrival.driver_phone ? ` (${arrival.driver_phone})` : ""}`
      : "—",
    rawArrival: arrival,
  };
}

function ReceivingControlCenter() {
  const [records, setRecords] = useState<InboundRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<InboundRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [activeTab, setActiveTab] = useState("overview");

  // Operators & Inspectors
  const [assignedOp, setAssignedOp] = useState("Lead Warehouse Operator");
  const [assignedQc, setAssignedQc] = useState("Incoming Quality Inspector");

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const arrivals = await api.getInboundArrivals(true);
      const mapped = Array.isArray(arrivals) ? arrivals.map(mapArrivalToRecord) : [];
      setRecords(mapped);
      setSelectedRecord((prev) => {
        if (!prev) return mapped[0] ?? null;
        const found = mapped.find((r) => r.id === prev.id);
        return found ?? mapped[0] ?? null;
      });
    } catch (error) {
      if (!quiet) {
        toast.error("Unable to load receiving monitor data", {
          description: error instanceof Error ? error.message : "Please check backend connection.",
        });
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const interval = window.setInterval(() => void loadData(true), 10_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const handleAssignOperator = (opName: string) => {
    setAssignedOp(opName);
    if (selectedRecord) {
      setSelectedRecord({ ...selectedRecord, assignedOperator: opName });
      toast.success(`Operator Notification Sent: ${opName}`, {
        description: `New Receiving Assignment: Vehicle ${selectedRecord.vehicleNo} at Dock ${selectedRecord.dockNo}`,
      });
    }
  };

  const handleAssignInspector = (qcName: string) => {
    setAssignedQc(qcName);
    if (selectedRecord) {
      setSelectedRecord({ ...selectedRecord, assignedInspector: qcName });
      toast.success(`Quality Inspector Notification Sent: ${qcName}`, {
        description: `Material Ready for Inspection: Gate Pass ${selectedRecord.gatePassNo} at Dock ${selectedRecord.dockNo}`,
      });
    }
  };

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {
      PENDING_RECEIVING: 0,
      AT_DOCK: 0,
      UNLOADING: 0,
      QC_PENDING: 0,
      QC_HOLD: 0,
      GRN_REVIEW: 0,
      READY_FOR_PUTAWAY: 0,
    };
    for (const r of records) {
      if (counts[r.status] !== undefined) {
        counts[r.status]++;
      }
    }
    return counts;
  }, [records]);

  const filteredRecords = records.filter((r) => {
    if (stageFilter !== "ALL" && r.status !== stageFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.gatePassNo.toLowerCase().includes(q) ||
      r.vehicleNo.toLowerCase().includes(q) ||
      r.supplierName.toLowerCase().includes(q) ||
      r.poNo.toLowerCase().includes(q) ||
      r.dockNo.toLowerCase().includes(q)
    );
  });

  const timelineEvents = useMemo(() => {
    if (!selectedRecord) return [];
    const raw = selectedRecord.rawArrival || {};
    const events: { time: string; actor: string; event: string }[] = [];

    const fmt = (iso?: string) => {
      if (!iso) return "";
      const d = new Date(iso);
      return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    };

    if (raw.facility_entry_at || (selectedRecord.entryTime && selectedRecord.entryTime !== "—")) {
      events.push({
        time: fmt(raw.facility_entry_at) || selectedRecord.entryTime,
        actor: selectedRecord.securityOfficer || "Gate Security",
        event: `Gate Entry Completed (${selectedRecord.gatePassNo})`,
      });
    }

    if (raw.assigned_at || (selectedRecord.dockNo && selectedRecord.dockNo !== "Unassigned")) {
      events.push({
        time: fmt(raw.assigned_at) || "Dock Phase",
        actor: raw.assigned_by || "Warehouse Operations",
        event: `Dock ${selectedRecord.dockNo} Assigned`,
      });
    }

    if (
      raw.dock_arrival_at ||
      ["AT_DOCK", "UNLOADING", "UNLOADING_COMPLETED", "QC_PENDING", "QC_IN_PROGRESS", "QC_COMPLETED", "GRN_DRAFT", "GRN_REVIEW", "GRN_POSTED", "READY_FOR_PUTAWAY"].includes(selectedRecord.status)
    ) {
      events.push({
        time: fmt(raw.dock_arrival_at) || "Dock Phase",
        actor: raw.dock_checked_in_by || selectedRecord.assignedOperator || "Dock Operator",
        event: `Vehicle Arrived at Dock ${selectedRecord.dockNo}`,
      });
    }

    if (
      raw.unloading_started_at ||
      ["UNLOADING", "UNLOADING_COMPLETED", "QC_PENDING", "QC_IN_PROGRESS", "QC_COMPLETED", "GRN_DRAFT", "GRN_REVIEW", "GRN_POSTED", "READY_FOR_PUTAWAY"].includes(selectedRecord.status)
    ) {
      events.push({
        time: fmt(raw.unloading_started_at) || "Receiving",
        actor: raw.unloading_started_by || selectedRecord.assignedOperator || "Warehouse Operator",
        event: selectedRecord.receivedQty > 0
          ? `Unloading In Progress (${selectedRecord.receivedQty} Qty Recorded)`
          : "Unloading In Progress",
      });
    }

    if (
      raw.receiving_completed_at ||
      ["UNLOADING_COMPLETED", "QC_PENDING", "QC_IN_PROGRESS", "QC_COMPLETED", "GRN_DRAFT", "GRN_REVIEW", "GRN_POSTED", "READY_FOR_PUTAWAY"].includes(selectedRecord.status)
    ) {
      events.push({
        time: fmt(raw.receiving_completed_at) || "Receiving",
        actor: raw.receiving_completed_by || selectedRecord.assignedOperator || "Warehouse Operator",
        event: `Unloading Completed (${selectedRecord.receivedQty || selectedRecord.expectedQty} Qty Received)`,
      });
    }

    if (
      raw.quality_inspected_at ||
      ["QC_PENDING", "QC_IN_PROGRESS", "QC_COMPLETED", "QC_HOLD", "GRN_DRAFT", "GRN_REVIEW", "GRN_POSTED", "READY_FOR_PUTAWAY"].includes(selectedRecord.status)
    ) {
      events.push({
        time: fmt(raw.quality_inspected_at) || "QC Inspection",
        actor: raw.quality_inspected_by || selectedRecord.assignedInspector || "QC Inspector",
        event:
          selectedRecord.status === "QC_HOLD"
            ? `QC Hold: Quality Issues Flagged (${selectedRecord.rejectedQty || 0} Rejected)`
            : selectedRecord.acceptedQty > 0
            ? `QC Inspection Completed (${selectedRecord.acceptedQty} Accepted / ${selectedRecord.rejectedQty || 0} Rejected)`
            : "QC Inspection In Progress",
      });
    }

    if (
      raw.prepared_grn_id ||
      ["GRN_DRAFT", "GRN_REVIEW", "GRN_POSTED", "READY_FOR_PUTAWAY"].includes(selectedRecord.status)
    ) {
      events.push({
        time: "GRN Stage",
        actor: "Warehouse Operator",
        event:
          selectedRecord.status === "GRN_POSTED" || selectedRecord.status === "READY_FOR_PUTAWAY"
            ? `GRN Posted (${raw.prepared_grn_id || "GRN Completed"})`
            : "GRN Review / Preparation In Progress",
      });
    }

    if (selectedRecord.status === "READY_FOR_PUTAWAY") {
      events.push({
        time: "Putaway Ready",
        actor: "Warehouse System",
        event: "Material Handling Unit QR Labels Generated & Ready for Bin Putaway",
      });
    }

    return events;
  }, [selectedRecord]);

  return (
    <AppShell
      title="Warehouse Manager Receiving Monitor"
      subtitle="Section 41–45: Real-time receiving monitor, timestamped timeline, role notifications & traceability matrix"
    >
      <div className="space-y-6">
        {/* Section 41 - Real-Time Receiving Stage Monitor */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-black uppercase tracking-widest text-primary">
              RECEIVING STAGE MONITOR (SECTION 41)
            </h2>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadData()}
                disabled={loading}
                className="h-7 text-xs font-bold gap-1 rounded-lg"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                Refresh
              </Button>
              {stageFilter !== "ALL" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStageFilter("ALL")}
                  className="h-7 text-xs text-primary font-bold"
                >
                  Clear Filter (Showing All)
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {[
              {
                label: "GATE ENTRY",
                count: stageCounts.PENDING_RECEIVING || 0,
                filter: "PENDING_RECEIVING",
                color: "text-slate-700 bg-slate-500/10 border-slate-500/30",
              },
              {
                label: "AT DOCK",
                count: stageCounts.AT_DOCK || 0,
                filter: "AT_DOCK",
                color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
              },
              {
                label: "UNLOADING",
                count: stageCounts.UNLOADING || 0,
                filter: "UNLOADING",
                color: "text-sky-600 bg-sky-500/10 border-sky-500/30",
              },
              {
                label: "QC PENDING",
                count: stageCounts.QC_PENDING || 0,
                filter: "QC_PENDING",
                color: "text-amber-600 bg-amber-500/10 border-amber-500/30",
              },
              {
                label: "QC HOLD",
                count: stageCounts.QC_HOLD || 0,
                filter: "QC_HOLD",
                color: "text-red-600 bg-red-500/10 border-red-500/30",
              },
              {
                label: "GRN PENDING",
                count: stageCounts.GRN_REVIEW || 0,
                filter: "GRN_REVIEW",
                color: "text-purple-600 bg-purple-500/10 border-purple-500/30",
              },
              {
                label: "READY FOR PUTAWAY",
                count: stageCounts.READY_FOR_PUTAWAY || 0,
                filter: "READY_FOR_PUTAWAY",
                color: "text-emerald-700 bg-emerald-500/20 border-emerald-500/50",
              },
            ].map((st) => (
              <Card
                key={st.label}
                className={cn(
                  "rounded-2xl p-3.5 border transition-all cursor-pointer hover:scale-[1.02]",
                  st.color,
                  stageFilter === st.filter && "ring-2 ring-primary",
                )}
                onClick={() => setStageFilter(st.filter)}
              >
                <p className="text-2xl font-black">{st.count}</p>
                <p className="text-[10px] font-black uppercase tracking-wider mt-1">{st.label}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* Inbound Vehicles List */}
        <Card className="rounded-2xl border-border/60 shadow-sm overflow-hidden bg-card">
          <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/20 pb-4">
            <div>
              <CardTitle className="text-base font-black flex items-center gap-2">
                <Truck className="size-4 text-primary" /> Active Inbound Receiving Queue
              </CardTitle>
              <CardDescription>
                Live inbound vehicles, assigned docks, and stage progression
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-72 sm:w-80 md:w-96">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search Gate Pass, Vehicle, PO..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 w-full rounded-xl border bg-background pl-9 pr-3 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 font-bold uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Gate Pass</th>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">PO</th>
                    <th className="px-4 py-3">Dock</th>
                    <th className="px-4 py-3">Receiving Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto size-5 animate-spin mb-2 text-primary" />
                        Loading inbound shipments...
                      </td>
                    </tr>
                  ) : filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No inbound receiving records found.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((r) => (
                      <tr
                        key={r.id}
                        className={cn(
                          "hover:bg-muted/30 transition-colors cursor-pointer",
                          selectedRecord?.id === r.id && "bg-primary/5",
                        )}
                        onClick={() => setSelectedRecord(r)}
                      >
                        <td className="px-4 py-3 font-mono font-bold text-primary">{r.gatePassNo}</td>
                        <td className="px-4 py-3 font-bold">{r.vehicleNo}</td>
                        <td className="px-4 py-3 font-medium">{r.supplierName}</td>
                        <td className="px-4 py-3 font-semibold">{r.poNo}</td>
                        <td className="px-4 py-3 font-bold text-emerald-600 dark:text-emerald-400">
                          {r.dockNo}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className="rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30">
                            {statusLabels[r.status] || r.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs font-bold text-primary"
                          >
                            Open Record <ArrowRight className="ml-1 size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Detail Page */}
        {selectedRecord ? (
          <Card className="rounded-2xl border-primary/30 p-6 shadow-xl bg-card">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black">Inbound Receipt Record</h2>
                  <Badge
                    variant="outline"
                    className="font-mono text-xs font-bold border-primary/30 text-primary"
                  >
                    {selectedRecord.gatePassNo}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Vehicle:{" "}
                  <span className="font-bold text-foreground">{selectedRecord.vehicleNo}</span> ·
                  Supplier:{" "}
                  <span className="font-bold text-foreground">{selectedRecord.supplierName}</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground text-right">
                    Dock Assignment
                  </p>
                  <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 text-right">
                    {selectedRecord.dockNo}
                  </p>
                </div>
                <Badge className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-3 py-1 font-bold">
                  {statusLabels[selectedRecord.status] || selectedRecord.status}
                </Badge>
              </div>
            </div>

            {/* Tabs */}
            <Tabs
              defaultValue="overview"
              value={activeTab}
              onValueChange={setActiveTab}
              className="mt-4"
            >
              <TabsList className="bg-muted/50 p-1 rounded-xl flex-wrap">
                <TabsTrigger value="overview" className="rounded-lg text-xs font-bold">
                  OVERVIEW
                </TabsTrigger>
                <TabsTrigger value="timeline" className="rounded-lg text-xs font-bold">
                  TIMELINE (SEC 42)
                </TabsTrigger>
                <TabsTrigger value="matrix" className="rounded-lg text-xs font-bold">
                  PERMISSIONS (SEC 44)
                </TabsTrigger>
                <TabsTrigger value="data" className="rounded-lg text-xs font-bold font-mono">
                  TRACEABILITY (SEC 45)
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">
                      Gate Information
                    </h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">Gate Pass:</span>{" "}
                        <span className="font-bold font-mono">{selectedRecord.gatePassNo}</span>
                      </p>
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">Warehouse:</span>{" "}
                        <span className="font-bold">{selectedRecord.warehouseName}</span>
                      </p>
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">Entry Time:</span>{" "}
                        <span className="font-bold">{selectedRecord.entryTime}</span>
                      </p>
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">Security Officer:</span>{" "}
                        <span className="font-bold">{selectedRecord.securityOfficer}</span>
                      </p>
                    </div>
                  </Card>

                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">
                      Procurement Details
                    </h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">PO Number:</span>{" "}
                        <span className="font-bold font-mono text-primary">
                          {selectedRecord.poNo}
                        </span>
                      </p>
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">ASN Number:</span>{" "}
                        <span className="font-bold font-mono">{selectedRecord.asnNo}</span>
                      </p>
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">Expected Qty:</span>{" "}
                        <span className="font-bold">{selectedRecord.expectedQty} PCS</span>
                      </p>
                    </div>
                  </Card>

                  {/* Assignments */}
                  <Card className="rounded-xl p-4 bg-primary/5 border-primary/30">
                    <h3 className="text-xs font-black uppercase text-primary mb-2 flex items-center gap-1.5">
                      <UserCheck className="size-4" /> Receiving Assignments
                    </h3>
                    <div className="space-y-3 text-xs">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                          Assigned Warehouse Operator
                        </p>
                        <select
                          value={assignedOp}
                          onChange={(e) => handleAssignOperator(e.target.value)}
                          className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-bold"
                        >
                          <option value="Lead Warehouse Operator">
                            Lead Warehouse Operator
                          </option>
                          <option value="Dock Receiving Operator">
                            Dock Receiving Operator
                          </option>
                          <option value="Floor Operations Associate">
                            Floor Operations Associate
                          </option>
                        </select>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                          Assigned Quality Inspector
                        </p>
                        <select
                          value={assignedQc}
                          onChange={(e) => handleAssignInspector(e.target.value)}
                          className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-bold"
                        >
                          <option value="Incoming Quality Inspector">
                            Incoming Quality Inspector
                          </option>
                          <option value="Receiving Quality Analyst">
                            Receiving Quality Analyst
                          </option>
                          <option value="Lead QC Officer">
                            Lead QC Officer
                          </option>
                        </select>
                      </div>
                    </div>
                  </Card>
                </div>
              </TabsContent>

              {/* Section 42 - Timeline Tab */}
              <TabsContent value="timeline" className="mt-4">
                <Card className="rounded-xl p-5 bg-card border-border/60">
                  <h3 className="text-xs font-black uppercase text-primary mb-4">
                    RECEIVING TIMELINE (SECTION 42)
                  </h3>
                  {timelineEvents.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      No timestamped events recorded for this shipment yet.
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      {timelineEvents.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 border-b pb-2">
                          <div className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary text-[10px] font-black">
                            {idx + 1}
                          </div>
                          <span className="font-mono text-xs font-bold text-sky-600 w-24">
                            {item.time}
                          </span>
                          <div className="flex-1">
                            <p className="font-bold text-foreground">{item.event}</p>
                            <p className="text-[10px] text-muted-foreground">{item.actor}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </TabsContent>

              {/* Section 44 - Permissions Matrix Tab */}
              <TabsContent value="matrix" className="mt-4">
                <Card className="rounded-xl p-5 bg-card border-border/60">
                  <h3 className="text-xs font-black uppercase text-primary mb-3">
                    PERMISSION MATRIX (SECTION 44)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border">
                      <thead className="bg-muted font-bold uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="p-2.5">Function</th>
                          <th className="p-2.5 text-center">Warehouse Manager</th>
                          <th className="p-2.5 text-center">Operator</th>
                          <th className="p-2.5 text-center">QC</th>
                          <th className="p-2.5 text-center">Warehouse Operator</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y font-semibold">
                        <tr>
                          <td className="p-2.5">View Gate Pass / PO / ASN</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                        </tr>
                        <tr>
                          <td className="p-2.5">Assign Operator / QC Inspector</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-muted-foreground">—</td>
                        </tr>
                        <tr>
                          <td className="p-2.5">Confirm Dock Arrival</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-muted-foreground">—</td>
                        </tr>
                        <tr>
                          <td className="p-2.5">Start Unloading & Count Material</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-muted-foreground">—</td>
                        </tr>
                        <tr>
                          <td className="p-2.5">Perform QC & Accept/Reject</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-muted-foreground">—</td>
                        </tr>
                        <tr>
                          <td className="p-2.5">Create GRN Draft & Post GRN</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                        </tr>
                        <tr>
                          <td className="p-2.5">Generate Material / HU QR</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-amber-600">Limited</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                        </tr>
                        <tr>
                          <td className="p-2.5">Approve Exceptions (Over-receipt)</td>
                          <td className="text-center text-emerald-600 font-black">✓</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-muted-foreground">—</td>
                          <td className="text-center text-sky-600">Configurable</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              </TabsContent>

              {/* Section 45 - Traceability Tab */}
              <TabsContent value="data" className="mt-4">
                <Card className="rounded-xl p-5 bg-card border-border/60">
                  <h3 className="text-xs font-black uppercase text-primary mb-3">
                    CORE DATA RELATIONSHIP & TRACEABILITY (SECTION 45)
                  </h3>
                  <div className="bg-muted/30 p-4 rounded-xl border border-primary/20 text-center font-mono text-xs space-y-1 font-bold">
                    <p className="text-primary">PurchaseOrder ➔ PurchaseOrderItem</p>
                    <p>↓</p>
                    <p>ASN ➔ ASNItem</p>
                    <p>↓</p>
                    <p>GateEntry ➔ GatePass</p>
                    <p>↓</p>
                    <p>DockReceiving ➔ ReceivingItem</p>
                    <p>↓</p>
                    <p className="text-amber-600">QualityInspection</p>
                    <p>↓</p>
                    <p className="text-emerald-600 font-black">GRN ➔ GRNItem</p>
                    <p>↓</p>
                    <p>MaterialLot ➔ HandlingUnit ➔ QR / Barcode</p>
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </Card>
        ) : (
          !loading && (
            <Card className="rounded-2xl border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/10">
              No shipment selected. Select an inbound shipment from the queue above to inspect receiving details.
            </Card>
          )
        )}
      </div>
    </AppShell>
  );
}
