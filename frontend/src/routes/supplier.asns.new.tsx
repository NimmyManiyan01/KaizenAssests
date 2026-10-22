import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import type { DateRange } from "react-day-picker";

export const Route = createFileRoute("/supplier/asns/new")({
  beforeLoad: () => {},
  component: NewAsnPage,
});

const inputClass = "mt-1.5 h-10 rounded-xl border-border/80 bg-background text-xs font-semibold";
const todayDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};
const dateToFilterValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const displayFilterDate = (value: string) => {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

interface AsnRecord {
  id: string;
  asn_number: string;
  po_number: string;
  supplier_name: string;
  destination_warehouse: string;
  vehicle_number: string;
  driver_name: string;
  driver_contact: string;
  delivery_date?: string;
  expected_arrival_date?: string;
  expected_arrival_at?: string;
  status: string;
  created_at: string;
  lines: any[];
}

const INITIAL_ASNS: AsnRecord[] = [];

function NewAsnPage() {
  const search = useSearch({ strict: false }) as any;

  const [asnList, setAsnList] = useState<AsnRecord[]>(INITIAL_ASNS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [arrivalFrom, setArrivalFrom] = useState("");
  const [arrivalTo, setArrivalTo] = useState("");
  const [arrivalRangeOpen, setArrivalRangeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [assignmentTouched, setAssignmentTouched] = useState({
    vehicle: false,
    driver: false,
    contact: false,
  });
  const [asnSubmitted, setAsnSubmitted] = useState(false);
  const [isMaterialPopupOpen, setIsMaterialPopupOpen] = useState(false);
  const [customMaterialRowIndex, setCustomMaterialRowIndex] = useState<number | null>(null);
  const [customMaterialName, setCustomMaterialName] = useState("");
  const [manualVehicle, setManualVehicle] = useState(false);
  const [manualDriver, setManualDriver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creatingMaterial, setCreatingMaterial] = useState(false);
  const [selectedAsn, setSelectedAsn] = useState<AsnRecord | null>(null);
  const [asnPendingDelete, setAsnPendingDelete] = useState<AsnRecord | null>(null);
  const [editingAsnNumber, setEditingAsnNumber] = useState<string | null>(null);

  useEffect(() => {
    if (typeof search?.search === "string") setSearchQuery(search.search);
  }, [search?.search]);

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

  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [materialCatalog, setMaterialCatalog] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedPo, setSelectedPo] = useState<any>(null);
  const currentUser = getUserInfo();

  useEffect(() => {
    loadAsnData();
    void (
      currentUser?.supplierId
        ? api.getSupplier(currentUser.supplierId)
        : api.getSuppliers({ search: currentUser?.username })
    )
      .then((result: any) => {
        const supplierRows = Array.isArray(result)
          ? result
          : result?.items || result?.suppliers || [];
        const supplier = supplierRows.length
          ? supplierRows.find(
              (item: any) =>
                String(item.id) === String(currentUser?.supplierId) ||
                String(item.username || item.supplier_name || "").toLowerCase() ===
                  String(currentUser?.username || "").toLowerCase(),
            ) || supplierRows[0]
          : result;
        const companyName =
          supplier?.registered_company_name ||
          supplier?.company_name ||
          supplier?.supplier_name ||
          "";
        const displaySupplierName = /seeded supplier/i.test(companyName) ? "MTU" : companyName;
        setSupplierCompanyName(displaySupplierName);
        if (displaySupplierName) setSupplierName(displaySupplierName);
      })
      .catch(() => undefined);
    void Promise.all([api.getStores({ status: "ALL" }).catch(() => [])]).then(([stores]) => {
      setWarehouses(
        (stores || []).filter(
          (store: any) => String(store.status || "ACTIVE").toUpperCase() === "ACTIVE",
        ),
      );
    });
    void api
      .getMaterials({ status: "ACTIVE" })
      .then((materials) =>
        setMaterialCatalog(
          (materials || []).map((material: any) => ({
            ...material,
            id: material.id || material.material_id,
            code: material.code || material.material_code,
            name: material.name || material.material_name,
            uom: material.uom || material.base_uom || material.unit_of_measure,
          })),
        ),
      )
      .catch(() => setMaterialCatalog([]));
    void Promise.all([api.getVehicles().catch(() => []), api.getDrivers().catch(() => [])]).then(
      ([vehicles, drivers]) => {
        setRegisteredVehicles(
          (vehicles || []).filter(
            (v: any) =>
              v.is_active !== false &&
              String(v.status || "AVAILABLE").toUpperCase() === "AVAILABLE",
          ),
        );
        setRegisteredDrivers(
          (drivers || []).filter(
            (d: any) =>
              d.is_active !== false && String(d.status || "ACTIVE").toUpperCase() === "ACTIVE",
          ),
        );
      },
    );
  }, []);

  const loadAsnData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const next = await api.getNextAsnNumber();
      setAsnNumber(next.asnNumber);

      // Use the same role-scoped endpoint as the Supplier Dashboard. The
      // backend applies supplier visibility from the authenticated session;
      // passing a possibly stale client supplier id can incorrectly return an
      // empty list while the dashboard still shows the records.
      const remoteAsns = await api.getAsns();
      if (Array.isArray(remoteAsns) && remoteAsns.length > 0) {
        const mapped = remoteAsns.map((a: any) => ({
          id: a.id || a.asn_number,
          asn_number: a.asn_number || "",
          po_number: a.po_number || "",
          supplier_name: a.supplier_name || "Bharat Electronics Components Pvt. Ltd.",
          destination_warehouse: a.warehouse_name || "Raw Material Warehouse",
          vehicle_number: a.vehicle_number || "KA 01 AB 4582",
          driver_name: a.driver_name || "Suresh Gowda",
          driver_contact: a.driver_contact || "+91 98450 12345",
          // Preserve the persisted value returned by the API across reloads/sessions.
          expected_arrival_at: a.expected_arrival_at || undefined,
          status: a.status || "SUBMITTED",
          created_at: a.created_at || new Date().toISOString(),
          lines: a.lines || [
            { material_name: "Stainless Steel Sheet 304", quantity: 500, uom: "KG" },
          ],
        }));
        setAsnList(mapped);
      }
    } catch {
      setAsnList([]);
      setLoadError("Unable to load ASN records.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateModal = async () => {
    setEditingAsnNumber(null);
    // Open the first dialog immediately; loading the next ASN number should
    // never make the user wait before seeing the popup.
    setIsAssignmentOpen(true);
    const next = await api.getNextAsnNumber().catch(() => null);
    if (next?.asnNumber) setAsnNumber(next.asnNumber);
    setExpectedArrivalDate(todayDate());
    setSupplierName(supplierCompanyName || currentUser?.full_name || currentUser?.username || "");
    setDestinationWarehouse("");
    setDestinationWarehouseId("");
    setSelectedPo(null);
    setVehicleNumber("");
    setDriverName("");
    setDriverMobile("");
    setAssignmentTouched({ vehicle: false, driver: false, contact: false });
    setAssignmentSubmitting(false);
    setManualVehicle(false);
    setManualDriver(false);
    setLines([
      { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
    ]);
  };

  useEffect(() => {
    if (search?.open === "create") {
      void handleOpenCreateModal();
    }
  }, [search?.open]);

  const continueToAsnForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (assignmentSubmitting) return;
    const normalizedVehicle = vehicleNumber.toUpperCase().replace(/\s+/g, "").trim();
    const vehiclePattern = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/;
    const driverPattern = /^[A-Za-z .'-]{2,80}$/;
    const contactPattern = /^[6-9]\d{9}$/;
    setAssignmentTouched({ vehicle: true, driver: true, contact: true });
    if (!normalizedVehicle || !driverName.trim() || !driverMobile.trim()) {
      toast.error("Vehicle number, driver name and driver contact are required");
      document
        .getElementById(
          !normalizedVehicle
            ? "assignment-vehicle"
            : !driverName.trim()
              ? "assignment-driver"
              : "assignment-contact",
        )
        ?.focus();
      return;
    }
    if (!vehiclePattern.test(normalizedVehicle)) {
      toast.error("Enter a valid vehicle number.");
      document.getElementById("assignment-vehicle")?.focus();
      return;
    }
    if (!driverPattern.test(driverName.trim())) {
      toast.error("Enter a valid driver name.");
      document.getElementById("assignment-driver")?.focus();
      return;
    }
    if (!contactPattern.test(driverMobile.replace(/[\s-]/g, ""))) {
      toast.error("Enter a valid 10-digit mobile number.");
      document.getElementById("assignment-contact")?.focus();
      return;
    }
    setVehicleNumber(normalizedVehicle);
    setAssignmentSubmitting(true);
    window.setTimeout(() => {
      setIsAssignmentOpen(false);
      setIsModalOpen(true);
      setAssignmentSubmitting(false);
    }, 200);
  };

  const handleAddNewCustomMaterial = async () => {
    const compName = customMaterialName.trim();
    if (!compName || creatingMaterial) return;
    setCreatingMaterial(true);
    try {
      const created = await api.createMaterialComponent(compName.trim(), "PCS");
      const refreshedMaterials = await api.getMaterials({ status: "ACTIVE" });
      const normalizedMaterials = (refreshedMaterials || []).map((material: any) => ({
        ...material,
        id: material.id || material.material_id,
        code: material.code || material.material_code,
        name: material.name || material.material_name,
        uom: material.uom || material.base_uom || material.unit_of_measure,
      }));
      const createdId = String(created.id || created.material_id || "");
      const selectedMaterial =
        normalizedMaterials.find((material: any) => String(material.id) === createdId) ||
        normalizedMaterials.find(
          (material: any) =>
            String(material.code) === String(created.code || created.material_code),
        );
      if (!selectedMaterial?.id || !selectedMaterial.uom) {
        throw new Error(
          "Material was created, but its canonical Material Master record or UOM could not be loaded.",
        );
      }
      setMaterialCatalog(normalizedMaterials);
      const createdMaterial = {
        material_id: selectedMaterial.id,
        item_code: selectedMaterial.code,
        material_name: selectedMaterial.name,
        shipped_quantity: "1",
        uom: selectedMaterial.uom,
      };
      setLines((prev) => {
        const targetIndex =
          customMaterialRowIndex ?? prev.findIndex((line) => !line.material_id && !line.item_code);
        if (targetIndex < 0) return [...prev, createdMaterial];
        return prev.map((line, index) =>
          index === targetIndex ? { ...line, ...createdMaterial } : line,
        );
      });
      toast.success(`Component '${selectedMaterial.name}' saved to Database ✓`, {
        description: `Code: ${selectedMaterial.code} · UOM: ${selectedMaterial.uom}`,
      });
      setCustomMaterialName("");
      setIsMaterialPopupOpen(false);
    } catch (error) {
      toast.error("Failed to save material to database", {
        description: error instanceof Error ? error.message : "The material was not saved.",
      });
    } finally {
      setCreatingMaterial(false);
    }
  };

  const selectPurchaseOrder = async (id: string) => {
    if (!id) {
      setSelectedPo(null);
      setLines([]);
      return;
    }
    const po = await api.getPurchaseOrder(id);
    setSelectedPo(po);
    const poLines = po?.lines || po?.items || po?.materials || po?.purchase_order_lines || [];
    setLines(
      poLines.map((line: any) => ({
        item_code: line.item_code || line.material_code || line.code || "",
        material_name: line.material_name || line.material?.name || line.name || "",
        shipped_quantity: "",
        remaining_quantity: Number(
          line.remaining_quantity ??
            line.remaining ??
            line.balance_quantity ??
            line.ordered_quantity ??
            line.quantity ??
            0,
        ),
        uom: line.uom || line.unit_of_measure || "PCS",
      })),
    );
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lines.length || lines.some((line) => !line.item_code || !line.material_name)) {
      toast.error("Select a material before submitting the ASN");
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
    if (lines.some((line) => Number(line.shipped_quantity) <= 0)) {
      toast.error("Shipped quantity must be greater than zero");
      return;
    }
    if (lines.some((line) => !String(line.uom || "").trim())) {
      toast.error("UOM is required for every material line");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        asn_number: asnNumber,
        po_number: undefined,
        supplier_name: supplierName,
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
          uom: l.uom || "PCS",
        })),
        status: "SUBMITTED",
      };

      const createdAsn = editingAsnNumber
        ? await api.updateAsn(editingAsnNumber, payload)
        : await api.createAsn(payload);

      const newRecord: AsnRecord = {
        // Keep the server identifier so the PDF endpoint can resolve this
        // newly-created ASN immediately. Fall back to the number for older
        // backend responses, which also support number-based lookup.
        id: String(createdAsn?.id || createdAsn?.asn_id || createdAsn?.asn_number || asnNumber),
        asn_number: createdAsn?.asn_number || asnNumber,
        po_number: "",
        supplier_name: supplierName,
        destination_warehouse: destinationWarehouse,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        expected_arrival_at: expectedArrivalDate,
        status: "SUBMITTED",
        created_at: new Date().toISOString(),
        lines: payload.lines,
      };

      setAsnList((prev) =>
        editingAsnNumber
          ? prev.map((row) =>
              row.asn_number === editingAsnNumber ? { ...row, ...newRecord, id: row.id } : row,
            )
          : [newRecord, ...prev],
      );
      setSubmitting(false);
      setAsnSubmitted(true);
      setIsModalOpen(false);
      setIsAssignmentOpen(false);

      toast.success(
        `ASN ${asnNumber} ${editingAsnNumber ? "updated and resubmitted" : "submitted successfully"}`,
      );
      setEditingAsnNumber(null);
    } catch (err: any) {
      setSubmitting(false);
      toast.error("ASN Creation Failed", { description: err?.message || "Could not create ASN." });
    }
  };

  const downloadSelectedAsn = async () => {
    if (!selectedAsn) return;
    try {
      await api.downloadAsnPdf(selectedAsn.asn_number);
      toast.success("ASN PDF downloaded");
    } catch (error: any) {
      toast.error(error?.message || "Unable to download ASN");
    }
  };

  const cancelSelectedAsn = async () => {
    if (!selectedAsn) return;
    try {
      const updated = await api.cancelAsn(selectedAsn.asn_number);
      setAsnList((rows) =>
        rows.map((row) =>
          row.asn_number === selectedAsn.asn_number
            ? { ...row, ...updated, status: "CANCELLED" }
            : row,
        ),
      );
      setSelectedAsn((current) =>
        current ? { ...current, ...updated, status: "CANCELLED" } : current,
      );
      toast.success(`ASN ${selectedAsn.asn_number} cancelled`);
    } catch (error: any) {
      toast.error(error?.message || "Unable to cancel ASN");
    }
  };

  const canModifyAsn = (asn: AsnRecord) => {
    if (String(asn.status).toUpperCase() === "CANCELLED") return false;
    const createdAt = new Date(asn.created_at).getTime();
    return Number.isFinite(createdAt) && Date.now() - createdAt <= 60 * 60 * 1000;
  };

  const deleteAsnRecord = (asn: AsnRecord) => {
    if (canModifyAsn(asn)) setAsnPendingDelete(asn);
  };

  const confirmDeleteAsn = async () => {
    const asn = asnPendingDelete;
    if (!asn) return;
    setAsnPendingDelete(null);
    try {
      await api.deleteAsn(asn.asn_number);
      setAsnList((rows) => rows.filter((row) => row.asn_number !== asn.asn_number));
      setSelectedAsn((current) => (current?.asn_number === asn.asn_number ? null : current));
      toast.success(`ASN ${asn.asn_number} deleted`);
    } catch (error: any) {
      toast.error(error?.message || "Unable to delete ASN");
    }
  };

  const editAsnRecord = (asn: AsnRecord) => {
    if (!canModifyAsn(asn)) {
      toast.error("Edit window expired", {
        description: "ASN edits are allowed only within 1 hour of submission.",
      });
      return;
    }
    setSelectedAsn(null);
    setEditingAsnNumber(asn.asn_number);
    setAsnNumber(asn.asn_number);
    setSupplierName(asn.supplier_name || "");
    setDestinationWarehouse(asn.destination_warehouse || "");
    setExpectedArrivalDate(
      asn.delivery_date ||
        asn.expected_arrival_date ||
        asn.expected_arrival_at?.split("T")[0] ||
        "",
    );
    setVehicleNumber(asn.vehicle_number || "");
    setDriverName(asn.driver_name || "");
    setDriverMobile(asn.driver_contact || "");
    setLines(
      asn.lines?.length
        ? asn.lines
        : [{ material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" }],
    );
    setIsAssignmentOpen(true);
  };

  const filteredList = asnList.filter((a) => {
    const arrival =
      a.delivery_date || a.expected_arrival_date || a.expected_arrival_at?.split("T")[0] || "";
    if (statusFilter !== "ALL" && String(a.status || "").toUpperCase() !== statusFilter)
      return false;
    if (arrivalFrom && arrival < arrivalFrom) return false;
    if (arrivalTo && arrival > arrivalTo) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.asn_number.toLowerCase().includes(q) ||
      a.supplier_name.toLowerCase().includes(q) ||
      a.vehicle_number.toLowerCase().includes(q) ||
      a.driver_name.toLowerCase().includes(q) ||
      a.po_number.toLowerCase().includes(q)
    );
  });
  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("ALL");
    setArrivalFrom("");
    setArrivalTo("");
    setArrivalRangeOpen(false);
  };
  const arrivalRange: DateRange | undefined =
    arrivalFrom || arrivalTo
      ? {
          from: arrivalFrom ? new Date(`${arrivalFrom}T00:00:00`) : undefined,
          to: arrivalTo ? new Date(`${arrivalTo}T00:00:00`) : undefined,
        }
      : undefined;
  const arrivalRangeLabel =
    arrivalFrom && arrivalTo
      ? `${displayFilterDate(arrivalFrom)} – ${displayFilterDate(arrivalTo)}`
      : arrivalFrom
        ? `${displayFilterDate(arrivalFrom)} – End date`
        : arrivalTo
          ? `Start date – ${displayFilterDate(arrivalTo)}`
          : "Filter date";

  return (
    <AppShell
      title="Advance Shipment Notices"
      subtitle="Create, track and download shipment notices"
    >
      <div className="space-y-4 w-full pb-10">
        {/* Search & ASN Table Card */}
        <Card className="rounded-2xl border-border/60 shadow-soft">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold uppercase tracking-wider">
                ASN Records
              </CardTitle>
              <CardDescription>Manage generated shipment notices</CardDescription>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search ASN, Vehicle, Driver..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 w-full rounded-xl border bg-background pl-9 pr-3 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <Popover open={arrivalRangeOpen} onOpenChange={setArrivalRangeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-w-0 justify-start rounded-xl px-2 text-left text-xs font-normal"
                  >
                    <CalendarIcon className="mr-2 size-4" />
                    {arrivalRangeLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto p-0">
                  <Calendar
                    mode="range"
                    selected={arrivalRange}
                    onSelect={(range: DateRange | undefined) => {
                      setArrivalFrom(range?.from ? dateToFilterValue(range.from) : "");
                      setArrivalTo(range?.to ? dateToFilterValue(range.to) : "");
                      if (range?.from && range?.to) setArrivalRangeOpen(false);
                    }}
                    numberOfMonths={1}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl text-xs"
                onClick={clearFilters}
              >
                Clear Filters
              </Button>

              <Button
                onClick={handleOpenCreateModal}
                className="rounded-xl font-bold shadow-md bg-sky-600 hover:bg-sky-700 text-white h-9 px-4 text-xs"
              >
                <Plus className="mr-1.5 size-4" /> Create ASN
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loadError && (
              <div className="m-4 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <span>{loadError}</span>
                <Button size="sm" variant="outline" onClick={() => void loadAsnData()}>
                  <RefreshCw className="mr-2 size-4" /> Retry
                </Button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 font-bold uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">ASN Number</th>
                    <th className="px-4 py-3">Supplier Name</th>
                    <th className="px-4 py-3">Vehicle Number</th>
                    <th className="px-4 py-3">Driver Name & Mobile</th>
                    <th className="px-4 py-3">Expected Arrival Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Materials</th>
                    <th className="w-44 px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-medium">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                        <Loader2 className="mx-auto size-5 animate-spin" /> Loading ASN records…
                      </td>
                    </tr>
                  ) : !filteredList.length ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                        {asnList.length
                          ? "No ASNs match the selected filters."
                          : "No ASN records found."}
                      </td>
                    </tr>
                  ) : (
                    filteredList.map((asn) => (
                      <tr key={asn.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-primary">
                          {asn.asn_number}
                        </td>
                        <td className="px-4 py-3 font-bold text-foreground">{asn.supplier_name}</td>
                        <td className="px-4 py-3 font-mono font-bold text-sky-600">
                          {asn.vehicle_number}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-bold">{asn.driver_name}</span>{" "}
                          <span className="text-muted-foreground font-mono">
                            ({asn.driver_contact})
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-emerald-600">
                          {asn.delivery_date ||
                            asn.expected_arrival_date ||
                            asn.expected_arrival_at?.split("T")[0] ||
                            "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold text-blue-700">
                            {String(asn.status || "SUBMITTED").replaceAll("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {asn.lines?.length || 0} items ·{" "}
                          {asn.lines?.reduce(
                            (sum: number, line: any) =>
                              sum + Number(line.shipped_quantity ?? line.quantity ?? 0),
                            0,
                          ) || 0}{" "}
                          units
                        </td>
                        <td className="w-20 px-4 py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8 rounded-lg"
                                aria-label={`Actions for ${asn.asn_number}`}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem
                                disabled={!canModifyAsn(asn)}
                                onSelect={() => editAsnRecord(asn)}
                              >
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-rose-600 focus:text-rose-700"
                                disabled={!canModifyAsn(asn)}
                                onSelect={() => deleteAsnRecord(asn)}
                              >
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setSelectedAsn(asn)}>
                                <Eye /> View
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={Boolean(selectedAsn)} onOpenChange={(open) => !open && setSelectedAsn(null)}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-primary">ASN Details</DialogTitle>
            </DialogHeader>
            {selectedAsn && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
                <div>
                  <span className="text-muted-foreground">ASN Number</span>
                  <p className="font-mono font-bold">{selectedAsn.asn_number}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Supplier</span>
                  <p className="font-semibold">{selectedAsn.supplier_name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Vehicle</span>
                  <p className="font-mono font-semibold">{selectedAsn.vehicle_number}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Driver</span>
                  <p className="font-semibold">{selectedAsn.driver_name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Driver Contact</span>
                  <p className="font-mono">{selectedAsn.driver_contact}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="font-semibold">
                    {String(selectedAsn.status || "SUBMITTED").replaceAll("_", " ")}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Expected Arrival</span>
                  <p className="font-semibold">
                    {selectedAsn.delivery_date ||
                      selectedAsn.expected_arrival_date ||
                      selectedAsn.expected_arrival_at?.split("T")[0] ||
                      "—"}
                  </p>
                </div>
                <div className="col-span-2 border-t pt-3">
                  <span className="text-muted-foreground">Shipped Materials</span>
                  {selectedAsn.lines?.length ? (
                    <div className="mt-2 divide-y">
                      {selectedAsn.lines.map((line: any, index: number) => (
                        <div
                          key={`${line.item_code || line.material_name}-${index}`}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <span className="font-semibold">
                            {line.material_name || line.item_code || "—"}{" "}
                            <span className="font-mono text-muted-foreground">
                              ({line.item_code || "—"})
                            </span>
                          </span>
                          <span className="font-bold">
                            {line.shipped_quantity ?? line.quantity ?? 0} {line.uom || ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-muted-foreground">No shipment materials recorded.</p>
                  )}
                </div>
                <div className="col-span-2 flex justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void downloadSelectedAsn()}
                  >
                    <Download className="mr-2 size-4" /> Download
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={Boolean(asnPendingDelete)}
          onOpenChange={(open) => !open && setAsnPendingDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete ASN?</AlertDialogTitle>
              <AlertDialogDescription>
                Delete ASN {asnPendingDelete?.asn_number}? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => void confirmDeleteAsn()}
              >
                Delete ASN
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog
          open={isAssignmentOpen}
          onOpenChange={(open) => {
            if (!assignmentSubmitting) setIsAssignmentOpen(open);
          }}
        >
          <DialogContent className="w-[calc(100%-2rem)] max-w-xl rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-primary">
                Assign vehicle and driver
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={continueToAsnForm} className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Enter transport details. The complete ASN form will open after you continue.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="assignment-vehicle">Vehicle Number *</Label>
                  <Input
                    id="assignment-vehicle"
                    required
                    placeholder="Enter vehicle number"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                    onBlur={() => {
                      setVehicleNumber((value) => value.trim());
                      setAssignmentTouched((value) => ({ ...value, vehicle: true }));
                    }}
                    onFocus={() => setAssignmentTouched((value) => ({ ...value, vehicle: true }))}
                    aria-invalid={
                      assignmentTouched.vehicle &&
                      !/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/.test(
                        vehicleNumber.replace(/\s+/g, "").trim(),
                      )
                    }
                    aria-describedby="assignment-vehicle-error"
                    pattern="[A-Za-z]{2}[0-9]{1,2}[A-Za-z]{1,3}[0-9]{4}"
                    maxLength={13}
                    className={inputClass}
                  />
                  {assignmentTouched.vehicle && !vehicleNumber.trim() && (
                    <p id="assignment-vehicle-error" className="mt-1 text-xs text-rose-600">
                      Vehicle number is required.
                    </p>
                  )}
                  {assignmentTouched.vehicle &&
                    vehicleNumber.trim() &&
                    !/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/.test(
                      vehicleNumber.replace(/\s+/g, "").trim(),
                    ) && (
                      <p id="assignment-vehicle-error" className="mt-1 text-xs text-rose-600">
                        Enter a valid vehicle number.
                      </p>
                    )}
                </div>
                <div>
                  <Label htmlFor="assignment-driver">Driver Name *</Label>
                  <Input
                    id="assignment-driver"
                    required
                    placeholder="Enter driver name"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    onBlur={() => {
                      setDriverName((value) => value.trim().replace(/\s+/g, " "));
                      setAssignmentTouched((value) => ({ ...value, driver: true }));
                    }}
                    onFocus={() => setAssignmentTouched((value) => ({ ...value, driver: true }))}
                    aria-invalid={
                      assignmentTouched.driver && !/^[A-Za-z .'-]{2,80}$/.test(driverName.trim())
                    }
                    aria-describedby="assignment-driver-error"
                    pattern="[A-Za-z .'-]{2,80}"
                    maxLength={80}
                    className={inputClass}
                  />
                  {assignmentTouched.driver && !driverName.trim() && (
                    <p id="assignment-driver-error" className="mt-1 text-xs text-rose-600">
                      Driver name is required.
                    </p>
                  )}
                  {assignmentTouched.driver &&
                    driverName.trim() &&
                    !/^[A-Za-z .'-]{2,80}$/.test(driverName.trim()) && (
                      <p id="assignment-driver-error" className="mt-1 text-xs text-rose-600">
                        Enter a valid driver name.
                      </p>
                    )}
                </div>
                <div>
                  <Label htmlFor="assignment-contact">Driver Contact *</Label>
                  <Input
                    id="assignment-contact"
                    required
                    type="tel"
                    value={driverMobile}
                    onChange={(e) =>
                      setDriverMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    onBlur={() => setAssignmentTouched((value) => ({ ...value, contact: true }))}
                    onFocus={() => setAssignmentTouched((value) => ({ ...value, contact: true }))}
                    aria-invalid={assignmentTouched.contact && !/^[6-9]\d{9}$/.test(driverMobile)}
                    aria-describedby="assignment-contact-error"
                    inputMode="tel"
                    pattern="[6-9][0-9]{9}"
                    maxLength={10}
                    className={inputClass}
                  />
                  {assignmentTouched.contact && !driverMobile && (
                    <p id="assignment-contact-error" className="mt-1 text-xs text-rose-600">
                      Driver contact is required.
                    </p>
                  )}
                  {assignmentTouched.contact &&
                    driverMobile &&
                    !/^[6-9]\d{9}$/.test(driverMobile) && (
                      <p id="assignment-contact-error" className="mt-1 text-xs text-rose-600">
                        Enter a valid 10-digit mobile number.
                      </p>
                    )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={assignmentSubmitting}
                  onClick={() => setIsAssignmentOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    assignmentSubmitting ||
                    !/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/.test(
                      vehicleNumber.replace(/\s+/g, "").trim(),
                    ) ||
                    !/^[A-Za-z .'-]{2,80}$/.test(driverName.trim()) ||
                    !/^[6-9]\d{9}$/.test(driverMobile)
                  }
                >
                  {assignmentSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Continue to ASN Details
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* CREATE ASN POPUP MODAL DIALOG */}
        <Dialog
          open={isModalOpen}
          onOpenChange={(open) => {
            setIsModalOpen(open);
            if (!open && !asnSubmitted) setIsAssignmentOpen(true);
            if (!open) setAsnSubmitted(false);
          }}
        >
          <DialogContent className="max-w-2xl rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="font-black text-lg text-primary uppercase border-b pb-2">
                CREATE ADVANCE SHIPPING NOTICE (ASN)
              </DialogTitle>
            </DialogHeader>

            <form noValidate onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              {/* AUTOMATIC / MANDATORY DETAILS */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                  1. SHIPMENT & WAREHOUSE DETAILS
                </h3>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      ASN Number
                    </Label>
                    <div className="mt-1 flex h-10 items-center rounded-xl border bg-muted/60 px-3 font-mono font-bold text-primary">
                      {asnNumber}
                    </div>
                  </div>

                  <div>
                    <Label
                      htmlFor="supplier-name"
                      className="text-[10px] font-bold uppercase text-muted-foreground"
                    >
                      Supplier Name
                    </Label>
                    <Input
                      id="supplier-name"
                      required
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      className={`${inputClass} bg-muted`}
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor="expected-arrival-date"
                      className="text-[10px] font-bold uppercase text-muted-foreground"
                    >
                      Expected Arrival Date *
                    </Label>
                    <Input
                      id="expected-arrival-date"
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
              <div
                aria-hidden="true"
                className="hidden rounded-xl border bg-muted/30 p-4 space-y-3"
              >
                <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                  2. VEHICLE & DRIVER DETAILS
                </h3>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label
                      htmlFor="modal-vehicle-number"
                      className="text-[10px] font-bold uppercase text-muted-foreground"
                    >
                      Vehicle Number *
                    </Label>
                    <select
                      id="modal-vehicle-number"
                      required
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value)}
                      className={`${inputClass} w-full px-3`}
                    >
                      <option value="">Select registered vehicle</option>
                      {registeredVehicles.map((v) => (
                        <option key={v.id} value={v.vehicle_number}>
                          {v.vehicle_number} · {v.vehicle_type || "Vehicle"} ·{" "}
                          {v.capacity_tons ?? v.capacity ?? "—"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label
                      htmlFor="modal-driver-name"
                      className="text-[10px] font-bold uppercase text-muted-foreground"
                    >
                      Driver Name *
                    </Label>
                    <select
                      id="modal-driver-name"
                      required
                      value={driverName}
                      onChange={(e) => {
                        const d = registeredDrivers.find(
                          (row) => (row.driver_name || row.name) === e.target.value,
                        );
                        setDriverName(e.target.value);
                        setDriverMobile(d?.phone || d?.mobile_number || d?.phone_number || "");
                      }}
                      className={`${inputClass} w-full px-3`}
                    >
                      <option value="">Select registered driver</option>
                      {registeredDrivers.map((d) => (
                        <option key={d.id} value={d.driver_name || d.name}>
                          {d.driver_name || d.name} · {d.license_number || "License pending"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label
                      htmlFor="modal-driver-mobile"
                      className="text-[10px] font-bold uppercase text-muted-foreground"
                    >
                      Driver Mobile Number *
                    </Label>
                    <Input
                      id="modal-driver-mobile"
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
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() =>
                        setLines((rows) => [
                          ...rows,
                          {
                            material_id: "",
                            item_code: "",
                            material_name: "",
                            shipped_quantity: "",
                            uom: "",
                          },
                        ])
                      }
                    >
                      + Add Row
                    </Button>
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
                              value={line.item_id || line.material_id || ""}
                              onChange={(e) => {
                                const material = materialCatalog.find(
                                  (item) => String(item.id) === e.target.value,
                                );
                                if (
                                  material &&
                                  lines.some(
                                    (item, i) =>
                                      i !== idx && String(item.material_id) === String(material.id),
                                  )
                                ) {
                                  toast.error("This material is already selected in the ASN.");
                                  return;
                                }
                                setLines((current) =>
                                  current.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          material_id: material?.id || "",
                                          item_code: material?.code || "",
                                          material_name: material?.name || "",
                                          uom: material?.uom || "",
                                        }
                                      : item,
                                  ),
                                );
                              }}
                              className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-semibold"
                            >
                              <option value="">Select material</option>
                              {materialCatalog.map((material) => (
                                <option key={material.id} value={material.id}>
                                  {material.name} ({material.code})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <Input
                              required
                              type="number"
                              min="1"
                              step="any"
                              placeholder="Enter quantity"
                              value={line.shipped_quantity}
                              onKeyDown={(e) => {
                                if (["-", "+", "e", "E"].includes(e.key)) e.preventDefault();
                              }}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          shipped_quantity: e.target.value.replace(/[^0-9.]/g, ""),
                                        }
                                      : item,
                                  ),
                                )
                              }
                              className="h-8 text-xs font-bold text-right"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              readOnly
                              value={line.uom}
                              className="h-8 bg-muted text-xs font-semibold"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={lines.length === 1}
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
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-xl font-bold sm:mr-auto"
                  onClick={() => {
                    setAsnSubmitted(false);
                    setIsModalOpen(false);
                    setIsAssignmentOpen(true);
                  }}
                >
                  <ArrowLeft className="mr-2 size-4" /> Back
                </Button>
                <div className="flex justify-end gap-2">
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
                    disabled={submitting}
                    className="rounded-xl font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-md"
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 size-4" />
                    )}
                    Submit ASN
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
