import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";

export const Route = createFileRoute("/supplier-dashboard")({
  component: SupplierDashboard,
});

const inputClass = "mt-1.5 h-10 rounded-xl border-border/80 bg-background text-xs font-semibold";
const todayDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const statuses: Record<string, string> = {
  SUBMITTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  APPROVED: "bg-sky-50 text-sky-700 border-sky-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
};

function validateTransportDetails(vehicle: string, driver: string, contact: string): string | null {
  const normalizedVehicle = vehicle.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/.test(normalizedVehicle)) {
    return "Enter a valid vehicle number, for example KA42EH6940.";
  }
  if (!/^[A-Za-z][A-Za-z .'-]{1,49}$/.test(driver.trim())) {
    return "Enter a valid driver name using letters only.";
  }
  if (!/^\d{10}$/.test(contact.trim())) {
    return "Driver contact must contain exactly 10 digits.";
  }
  return null;
}

function SupplierDashboard() {
  const [asns, setAsns] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [trendDays, setTrendDays] = useState<7 | 30 | 90>(7);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Modal Form Inputs
  const [asnNumber, setAsnNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierCompanyName, setSupplierCompanyName] = useState("");
  const [destinationWarehouse, setDestinationWarehouse] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverMobile, setDriverMobile] = useState("");
  const [registeredVehicles, setRegisteredVehicles] = useState<any[]>([]);
  const [registeredDrivers, setRegisteredDrivers] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([
    { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
  ]);

  const [materialCatalog, setMaterialCatalog] = useState<any[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedPo, setSelectedPo] = useState<any>(null);
  const currentUser = getUserInfo();

  useEffect(() => {
    loadAsns();
    void (currentUser?.supplierId ? api.getSupplier(currentUser.supplierId) : api.getSuppliers({ search: currentUser?.username })).then((result: any) => { const rows = Array.isArray(result) ? result : result?.items || result?.suppliers || []; const supplier = rows.length ? rows.find((item: any) => String(item.id) === String(currentUser?.supplierId) || String(item.username || item.supplier_name || "").toLowerCase() === String(currentUser?.username || "").toLowerCase()) || rows[0] : result; const companyName = supplier?.registered_company_name || supplier?.company_name || supplier?.supplier_name || ""; setSupplierCompanyName(companyName); if (companyName) setSupplierName(companyName); }).catch(() => undefined);
    setMaterialsLoading(true);
    void api.getMaterialComponents().then((materials) => { setMaterialCatalog((materials || []).map((material: any) => ({ ...material, id: material.id || material.material_id, code: material.code || material.material_code, name: material.name || material.material_name, uom: material.uom || material.base_uom || material.unit_of_measure })).filter((material: any) => material.id && material.code && material.name && material.uom)); setMaterialsError(""); }).catch(() => { setMaterialCatalog([]); setMaterialsError("Unable to load Material Master records."); }).finally(() => setMaterialsLoading(false));
    void Promise.all([api.getVehicles().catch(() => []), api.getDrivers().catch(() => [])]).then(([vehicles, drivers]) => { setRegisteredVehicles((vehicles || []).filter((v: any) => v.is_active !== false && String(v.status || "AVAILABLE").toUpperCase() === "AVAILABLE")); setRegisteredDrivers((drivers || []).filter((d: any) => d.is_active !== false && String(d.status || "ACTIVE").toUpperCase() === "ACTIVE")); });
    void Promise.all([api.getPurchaseOrders({ supplierId: currentUser?.supplierId }).catch(() => []), api.getStores({ status: "ALL" }).catch(() => [])])
      .then(([pos, stores]) => { setPurchaseOrders(pos || []); setWarehouses((stores || []).filter((store: any) => String(store.status || "ACTIVE").toUpperCase() === "ACTIVE")); });
  }, []);

  const handleAddNewCustomMaterial = async () => {
    const compName = prompt("Enter New Material Component Name (to save in Database):");
    if (!compName || !compName.trim()) return;

    try {
      const created = await api.createMaterialComponent(compName.trim(), "PCS");
      setMaterialCatalog((prev) => [created, ...prev]);
      toast.success(`Component '${created.name}' saved to Database ✓`, {
        description: `Code: ${created.code} · Available in dropdown`,
      });
      setLines((prev) => [
        ...prev,
        { item_code: created.code, material_name: created.name, shipped_quantity: "1", uom: created.uom || "PCS" },
      ]);
    } catch {
      toast.error("Failed to save material to database");
    }
  };

  const loadAsns = async () => {
    try {
      const data = await api.getAsns();
      setAsns((data || []).map((asn: any) => ({
        ...asn,
        expected_arrival_date: asn.expected_arrival_date || asn.delivery_date || asn.expected_arrival_at?.split("T")[0] || "",
        supplier_name: asn.supplier_name || asn.supplierName || asn.supplier_company_name || asn.supplier?.supplier_name || "",
        destination_warehouse: asn.destination_warehouse || asn.destinationWarehouse || asn.warehouse_name || asn.delivery_warehouse_name || "",
      })));
    } catch {
      setAsns([]);
    }
  };

  const handleOpenCreateModal = async () => {
    try {
      const next = await api.getNextAsnNumber();
    setAsnNumber(next.asnNumber);
    } catch {
      setAsnNumber("");
    }
    setExpectedArrivalDate(todayDate());
    setSupplierName(supplierCompanyName || currentUser?.full_name || currentUser?.username || "");
    setDestinationWarehouse("");
    setDestinationWarehouseId("");
    setSelectedPo(null);
    setVehicleNumber("");
    setDriverName("");
    setDriverMobile("");
    setLines([{ material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" }]);
    setIsModalOpen(true);
  };

  const selectPurchaseOrder = async (id: string) => {
    if (!id) { setSelectedPo(null); setLines([]); return; }
    const po = await api.getPurchaseOrder(id);
    setSelectedPo(po);
    const poLines = po?.lines || po?.items || po?.materials || po?.purchase_order_lines || [];
    setLines(poLines.map((line: any) => ({ item_code: line.item_code || line.material_code || line.code || "", material_name: line.material_name || line.material?.name || line.name || "", shipped_quantity: "", remaining_quantity: Number(line.remaining_quantity ?? line.remaining ?? line.balance_quantity ?? line.ordered_quantity ?? line.quantity ?? 0), uom: line.uom || line.unit_of_measure || "PCS" })));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const transportError = validateTransportDetails(vehicleNumber, driverName, driverMobile);
    if (transportError) {
      toast.error(transportError);
      return;
    }
    if (!destinationWarehouse || !lines.length || lines.some((line) => !line.item_code || !line.material_name || Number(line.shipped_quantity) <= 0)) {
      toast.error("Select a warehouse and material; shipped quantities must be greater than zero");
      return;
    }
    if (!expectedArrivalDate) {
      toast.error("Expected Arrival Date is mandatory *");
      return;
    }
    if (expectedArrivalDate < todayDate()) {
      toast.error("Expected Arrival Date cannot be before today.");
      return;
    }
    if (!vehicleNumber.trim() || !driverName.trim() || !driverMobile.trim()) {
      toast.error("Please fill in Vehicle Number, Driver Name, and Mobile Number *");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        asn_number: asnNumber,
        po_number: undefined,
        supplier_name: supplierName,
        supplier_id: currentUser?.supplierId,
        destination_warehouse: destinationWarehouse,
        destination_warehouse_id: destinationWarehouseId,
        expected_arrival_at: expectedArrivalDate,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        lines: lines.map((l) => ({
          material_id: l.material_id,
          item_code: l.item_code,
          material_name: l.material_name,
          shipped_quantity: Number(l.shipped_quantity) || 0,
          uom: l.uom,
        })),
        status: "SUBMITTED",
      };

      await api.createAsn(payload);

      const newRecord = {
        id: `asn-${Date.now()}`,
        asn_number: asnNumber,
        po_number: "",
        supplier_name: supplierName,
        supplier_company_name: supplierName,
        destination_warehouse: destinationWarehouse,
        destination_warehouse_id: destinationWarehouseId,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        expected_arrival_date: expectedArrivalDate,
        expected_arrival_at: expectedArrivalDate,
        created_at: new Date().toISOString(),
        status: "SUBMITTED",
        lines: payload.lines,
      };

      setAsns((prev) => [newRecord, ...prev]);
      setSubmitting(false);
      setIsModalOpen(false);

      toast.success(`ASN ${asnNumber} Created Successfully ✓`, {
        description: `Vehicle ${newRecord.vehicle_number} · Driver ${newRecord.driver_name} (${newRecord.driver_contact})\n\nGate Security can now scan or search ${asnNumber}!`,
      });
    } catch (err: any) {
      setSubmitting(false);
      toast.error("ASN Creation Failed", { description: err?.message || "Could not create ASN." });
    }
  };

  const rows = useMemo(() => {
    return asns
      .filter((a) =>
        `${a.asn_number || ""} ${a.vehicle_number || ""} ${a.driver_name || ""} ${a.driver_contact || ""} ${a.status || ""} ${a.expected_arrival_at || ""} ${a.expected_arrival_date || ""} ${a.delivery_date || ""}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
      .sort(
        (a, b) =>
          new Date(b.created_at || b.submitted_at || 0).getTime() -
          new Date(a.created_at || a.submitted_at || 0).getTime()
      );
  }, [asns, query]);

  const submitted = asns.filter(
    (a) => String(a.status || "SUBMITTED").toUpperCase() === "SUBMITTED"
  ).length;
  const vehicles = new Set(asns.map((a) => a.vehicle_number).filter(Boolean)).size;

  const metrics = [
    { title: "Total ASNs", value: asns.length, icon: FileText, tone: "bg-sky-50 text-sky-600" },
    { title: "Submitted", value: submitted, icon: Truck, tone: "bg-emerald-50 text-emerald-600" },
    { title: "Vehicles", value: vehicles, icon: Truck, tone: "bg-purple-50 text-purple-600" },
  ];

  const showDetails = (asn: any) => {
    setSelected(asn);
  };

  const trend = useMemo(() => {
    const toLocalDateKey = (value: unknown) => {
      if (!value) return "";
      const text = String(value);
      const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      if (isoDate) return isoDate;
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return "";
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    };
    const days = Array.from({ length: trendDays }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (trendDays - 1 - i));
      return d;
    });
    return days.map((day) => ({
      key: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      label: day.toLocaleDateString(undefined, { month: "short", day: "2-digit" }),
      count: asns.filter((a) => {
        return toLocalDateKey(a.submitted_at || a.created_at || a.shipment_date) === `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      }).length,
    }));
  }, [asns, trendDays]);

  return (
    <AppShell>
      <div className="space-y-4">
        {/* Top Banner Card with Top-Right Create ASN CTA */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-sky-50 p-4 shadow-xs">
          <div>
            <p className="text-xs font-semibold text-slate-500">Welcome back,</p>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Supplier <span className="text-sky-600">Dashboard</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage your advance shipping notices (ASNs) and track deliveries in real-time.
            </p>
          </div>

          <Link
            to="/supplier/asns/new"
            search={{ open: "create" }}
            className="inline-flex h-10 shrink-0 items-center rounded-xl bg-sky-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-sky-700"
          >
            <Truck className="mr-2 size-4" />
            Create ASN
          </Link>

        </div>

        {/* High-Density Metric Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map(({ title, value, icon: Icon, tone }) => (
            <div
              key={title}
              className="flex min-h-28 items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {title}
                </p>
                <p className="text-2xl font-black text-slate-900 mt-0.5">{value}</p>
              </div>

              <div
                className={`flex size-10 items-center justify-center rounded-xl border border-slate-200/60 ${tone}`}
              >
                <Icon className="size-5" />
              </div>
            </div>
          ))}
        </div>

        {/* ASN History Table Section */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">
                ASN HISTORY
              </h2>
              <p className="text-xs text-slate-500">View and track all your submitted ASNs</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 size-3.5 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ASN, vehicle, status..."
                  className="h-8 pl-8 text-xs font-semibold rounded-xl"
                />
              </div>

            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase font-bold text-slate-500">
                <tr>
                  <th className="px-3.5 py-2.5">ASN Number</th>
                  <th className="px-3.5 py-2.5">Vehicle Number</th>
                  <th className="px-3.5 py-2.5">Expected Arrival Date</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5">Submitted Date</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {rows.map((asn) => {
                  const key = String(asn.id || asn.asn_number);
                  const status = String(asn.status || "SUBMITTED").toUpperCase();
                  return (
                    <tr key={key} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-3.5 py-2.5 font-bold font-mono text-sky-600 cursor-pointer" onClick={() => showDetails(asn)}>
                        {asn.asn_number || "—"}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono font-bold text-slate-900">
                        {asn.vehicle_number || "—"}
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-500">
                        {asn.expected_arrival_at
                          ? new Date(asn.expected_arrival_at).toLocaleDateString()
                          : asn.expected_arrival_date || asn.delivery_date || "—"}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase border ${
                            statuses[status] || "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          ● {status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-500">
                        {asn.created_at
                          ? new Date(asn.created_at).toLocaleDateString()
                          : asn.delivery_date || asn.expected_arrival_date || asn.expected_arrival_at?.split("T")[0] || "—"}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs font-bold text-sky-600"
                            onClick={() => showDetails(asn)}
                          >
                            <Eye className="mr-1 size-3.5" /> View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!rows.length && (
              <p className="p-6 text-center text-xs text-slate-400">No ASN records found.</p>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>Showing {rows.length} entries</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-7 rounded-lg">
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button size="icon" className="size-7 rounded-lg bg-sky-600 text-xs font-bold">
                1
              </Button>
              <Button variant="outline" size="icon" className="size-7 rounded-lg">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>

          {false && selected && (
            <div className="mt-3 rounded-xl bg-sky-50 p-3.5 border border-sky-200 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-bold text-sky-900">{selected.asn_number}</p>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700 font-bold text-sm"
                  onClick={() => setSelected(null)}
                >
                  ✕
                </button>
              </div>
              <p className="mt-1 text-slate-600">
                Vehicle: <span className="font-mono font-bold text-slate-900">{selected.vehicle_number || "—"}</span> · Driver:{" "}
                <span className="font-bold text-slate-900">{selected.driver_name || "—"}</span> ({selected.driver_contact || "+91 98450 12345"})
              </p>
            </div>
          )}
        </section>

        {/* Bottom: ASN Submission Trend */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900">
              ASN SUBMISSION TREND
            </h2>
            <label className="inline-flex items-center rounded-lg border bg-background px-2 text-xs font-bold">
              <select aria-label="ASN submission trend range" className="h-7 bg-transparent outline-none" value={trendDays} onChange={(event) => setTrendDays(Number(event.target.value) as 7 | 30 | 90)}>
                <option value={7}>Last 7 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={90}>Last 90 Days</option>
              </select>
              <ChevronDown className="ml-1.5 size-3" />
            </label>
          </div>

          <div className="mt-4 flex h-36 items-end gap-2 rounded-lg border-b border-l border-slate-200 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_34px,rgba(148,163,184,0.18)_35px)] px-2 pb-1 pt-3">
            {trend.map(({ key, label, count }) => {
              const max = Math.max(...trend.map((item) => item.count), 1);
              return (
                <div key={key} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] font-bold text-slate-500">{count}</span>
                  <div
                    className="h-auto min-w-4 w-full max-w-8 rounded-t bg-blue-600 shadow-sm transition-all hover:bg-blue-700"
                    title={`${label}: ${count}`}
                    style={{ height: `${count ? Math.max((count / max) * 100, 8) : 3}px` }}
                  />
                  <span className="text-[9px] font-bold text-slate-400">{label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-w-lg rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="font-black text-lg text-primary">
                ASN Details · {selected?.asn_number || "—"}
              </DialogTitle>
            </DialogHeader>
            {selected && (
              <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 text-xs sm:grid-cols-2">
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">ASN Number</p><p className="mt-1 font-mono font-black text-sky-600">{selected.asn_number || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Supplier Name</p><p className="mt-1 font-bold text-slate-900">{selected.supplier_name || selected.supplier_company_name || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Vehicle Number</p><p className="mt-1 font-mono font-bold text-slate-900">{selected.vehicle_number || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Driver Name & Mobile</p><p className="mt-1 font-bold text-slate-900">{selected.driver_name || "—"} · {selected.driver_contact || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Expected Arrival Date</p><p className="mt-1 font-bold text-slate-900">{selected.expected_arrival_date || selected.expected_arrival_at?.split("T")[0] || selected.delivery_date || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Status</p><p className="mt-1 font-black text-slate-900">{String(selected.status || "SUBMITTED").replaceAll("_", " ")}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3 sm:col-span-2"><p className="font-bold uppercase text-muted-foreground">Shipped Materials</p>{selected.lines?.length ? <div className="mt-2 divide-y">{selected.lines.map((line: any, index: number) => <div key={`${line.item_code || line.material_name}-${index}`} className="flex justify-between gap-3 py-2"><span className="font-semibold">{line.material_name || line.item_code} <span className="font-mono text-muted-foreground">({line.item_code || "—"})</span></span><span className="font-bold">{line.shipped_quantity ?? line.quantity ?? 0} {line.uom || ""}</span></div>)}</div> : <p className="mt-1 text-muted-foreground">No shipment materials recorded.</p>}</div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* TRANSPORT ASSIGNMENT POPUP — matches the Create ASN flow */}
        <Dialog open={isAssignmentOpen} onOpenChange={setIsAssignmentOpen}>
          <DialogContent className="max-w-xl rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-primary">Assign vehicle and driver</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 text-xs">
              <p className="text-sm leading-6 text-muted-foreground">Enter the transport details first. The complete ASN form will open after you click Next.</p>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="dashboard-assignment-vehicle">Vehicle Number *</Label>
                  <Input id="dashboard-assignment-vehicle" required placeholder="e.g. KA42EH6940" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())} maxLength={13} pattern="[A-Za-z]{2}[0-9]{1,2}[A-Za-z]{1,3}[0-9]{4}" className={inputClass} />
                </div>
                <div>
                  <Label htmlFor="dashboard-assignment-driver">Driver Name *</Label>
                  <Input id="dashboard-assignment-driver" required placeholder="Enter driver name" value={driverName} onChange={(e) => setDriverName(e.target.value)} maxLength={50} className={inputClass} />
                </div>
                <div>
                  <Label htmlFor="dashboard-assignment-mobile">Driver Contact *</Label>
                  <Input id="dashboard-assignment-mobile" required type="tel" inputMode="numeric" placeholder="10-digit mobile number" value={driverMobile} onChange={(e) => setDriverMobile(e.target.value.replace(/\D/g, "").slice(0, 10))} maxLength={10} pattern="[0-9]{10}" className={inputClass} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => setIsAssignmentOpen(false)}>Cancel</Button>
                <Button type="button" className="rounded-xl px-6" onClick={() => { const validationError = validateTransportDetails(vehicleNumber, driverName, driverMobile); if (validationError) { toast.error(validationError); return; } setVehicleNumber(vehicleNumber.replace(/\s+/g, "").toUpperCase()); setIsAssignmentOpen(false); setIsModalOpen(true); }}>Next</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* CREATE ASN POPUP MODAL DIALOG */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-4xl rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="font-black text-lg text-primary uppercase border-b pb-2">
                CREATE ADVANCE SHIPPING NOTICE (ASN)
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              {/* SHIPMENT & WAREHOUSE DETAILS */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                  1. SHIPMENT & WAREHOUSE DETAILS
                </h3>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">ASN Number</Label>
                    <div className="mt-1 flex h-10 items-center rounded-xl border bg-muted/60 px-3 font-mono font-bold text-primary">
                      {asnNumber}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="dashboard-supplier-name" className="text-[10px] font-bold uppercase text-muted-foreground">Supplier Name</Label>
                    <Input
                      id="dashboard-supplier-name"
                      required
                      placeholder="e.g. Bharat Electronics Components Pvt. Ltd."
                      value={supplierName}
                      readOnly
                      className={inputClass}
                    />
                  </div>

                  <div className="hidden">
                    <Label htmlFor="dashboard-destination-warehouse" className="text-[10px] font-bold uppercase text-muted-foreground">Destination Warehouse</Label>
                    <select id="dashboard-destination-warehouse" value={destinationWarehouseId} onChange={(e) => { const w = warehouses.find((item) => String(item.id) === e.target.value); setDestinationWarehouseId(e.target.value); setDestinationWarehouse(w?.store_name || w?.name || w?.store_code || ""); }} className={`${inputClass} w-full px-3`}><option value="">Select warehouse</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.store_name || w.name} ({w.store_code})</option>)}</select>{!warehouses.length && <p className="mt-1 text-[10px] font-semibold text-amber-600">No active warehouses exist in the Warehouse Master.</p>}
                  </div>


                  <div>
                    <Label htmlFor="dashboard-expected-arrival-date" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Expected Arrival Date *
                    </Label>
                    <Input
                      id="dashboard-expected-arrival-date"
                      type="date"
                      required
                      min={todayDate()}
                      value={expectedArrivalDate}
                      onChange={(e) => setExpectedArrivalDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                </div>
              </div>

              {/* VEHICLE & DRIVER DETAILS */}
              <div className="hidden rounded-xl border bg-muted/30 p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                  2. VEHICLE & DRIVER DETAILS
                </h3>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="dash-vehicle-number" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Vehicle Number *
                    </Label>
                    <select id="dash-vehicle-number" required value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} className={`${inputClass} w-full px-3`}><option value="">Select registered vehicle</option>{registeredVehicles.map((v) => <option key={v.id} value={v.vehicle_number}>{v.vehicle_number} · {v.vehicle_type || "Vehicle"} · {v.capacity_tons ?? v.capacity ?? "—"}</option>)}</select>
                  </div>

                  <div>
                    <Label htmlFor="dash-driver-name" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Driver Name *
                    </Label>
                    <select id="dash-driver-name" required value={driverName} onChange={(e) => { const d = registeredDrivers.find((row) => (row.driver_name || row.name) === e.target.value); setDriverName(e.target.value); setDriverMobile(d?.phone || d?.mobile_number || d?.phone_number || ""); }} className={`${inputClass} w-full px-3`}><option value="">Select registered driver</option>{registeredDrivers.map((d) => <option key={d.id} value={d.driver_name || d.name}>{d.driver_name || d.name} · {d.license_number || "License pending"}</option>)}</select>
                  </div>

                  <div>
                    <Label htmlFor="dash-driver-mobile" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Driver Mobile Number *
                    </Label>
                    <Input
                      id="dash-driver-mobile"
                      required
                      type="tel"
                      placeholder="e.g. +91 98450 12345"
                      value={driverMobile}
                      onChange={(e) => setDriverMobile(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* MATERIAL LINE ITEMS TABLE */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                    2. SHIPPED MATERIALS & QUANTITIES
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-2"><Input placeholder="Search material name or code" value={materialSearch} onChange={(e) => setMaterialSearch(e.target.value)} className="h-8 w-56 text-[11px]" /><Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setLines((rows) => [...rows, { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" }])}>+ Add Row</Button></div>{materialsLoading && <span className="text-[11px] text-muted-foreground">Loading materials…</span>}{materialsError && <span className="text-[11px] text-red-600">{materialsError}</span>}{!materialsLoading && !materialsError && materialCatalog.length === 0 && <span className="text-[11px] text-amber-600">No active materials found.</span>}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border bg-background">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/40 border-b font-bold uppercase text-muted-foreground">
                      <tr>
                        <th className="p-2.5">Material Name Component (Select from DB Dropdown)</th>
                        <th className="p-2.5 text-right">Shipped Qty</th>
                        <th className="p-2.5">UOM</th>
                        <th className="p-2.5 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="p-2">
                            <select
                              required
                              value={line.material_name}
                              onChange={(e) => {
                                const val = e.target.value;
                                const matched = materialCatalog.find((m) => m.name === val || m.material_name === val);
                                setLines((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          material_name: val,
                                          item_code: matched?.code || matched?.material_code || item.item_code,
                                          uom: matched?.uom || matched?.base_uom || item.uom || "PCS",
                                        }
                                      : item
                                  )
                                );
                              }}
                              className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-semibold"
                            >
                              <option value="">-- Select Material Component from Database --</option>
                              {materialCatalog.map((mat, mIdx) => (
                                <option key={mat.code || mat.material_code || mIdx} value={mat.name || mat.material_name}>
                                  {mat.name || mat.material_name} ({mat.category || "Component"})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <Input
                              required
                              type="number"
                              placeholder="Enter quantity"
                              value={line.shipped_quantity}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((item, i) => (i === idx ? { ...item, shipped_quantity: e.target.value } : item))
                                )
                              }
                              className="h-8 text-xs font-bold text-right"
                            />
                          </td>
                          <td className="p-2">
                            <Input readOnly value={line.uom} className="h-8 bg-muted text-xs font-semibold" />
                          </td>
                          <td className="p-2 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled
                              onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                              className="h-7 size-7 text-red-500 hover:bg-red-50"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SUBMIT ACTIONS */}
              <div className="flex gap-2 justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl font-bold"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || !lines.length || lines.some((line) => !line.material_id || !line.uom || Number(line.shipped_quantity) <= 0)}
                  className="rounded-xl font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-md"
                >
                  {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}
                  Submit ASN
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
