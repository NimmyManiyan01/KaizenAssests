import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, Eye, FileText, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { getUserInfo, requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/supplier/asns/new")({
  beforeLoad: () => requireRole(["SUPPLIER", "ADMIN", "SUPERUSER"]),
  component: NewAsnPage,
});

const inputClass = "mt-1.5 h-10 rounded-xl border-border/80 bg-background text-xs font-semibold";

const normalizeVehicleNumber = (value: string) =>
  value
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .trim();

const isValidVehicleNumber = (value: string) => {
  const normalized = normalizeVehicleNumber(value);
  return /^(?:[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}|BH\d{2}[A-Z]{2}\d{4})$/.test(normalized);
};

const normalizeDriverName = (value: string) => value.trim().replace(/\s+/g, " ");

const isValidDriverName = (value: string) => {
  const normalized = normalizeDriverName(value);
  return normalized.length >= 2 && /[A-Za-z].*[A-Za-z]/.test(normalized) && /^[A-Za-z][A-Za-z' ]*[A-Za-z]$/.test(normalized);
};

const normalizeDriverContact = (value: string) => value.trim();

const isValidDriverContact = (value: string) => {
  const normalized = value.trim();
  return /^[6-9]\d{9}$/.test(normalized) && !/^([6-9])\1{9}$/.test(normalized);
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
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as any;

  const [asnList, setAsnList] = useState<AsnRecord[]>(INITIAL_ASNS);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [isMaterialPopupOpen, setIsMaterialPopupOpen] = useState(false);
  const [customMaterialRowIndex, setCustomMaterialRowIndex] = useState<number | null>(null);
  const [customMaterialName, setCustomMaterialName] = useState("");
  const [manualVehicle, setManualVehicle] = useState(false);
  const [manualDriver, setManualDriver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nextSubmitting, setNextSubmitting] = useState(false);
  const [creatingMaterial, setCreatingMaterial] = useState(false);
  const [selectedAsn, setSelectedAsn] = useState<AsnRecord | null>(null);

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
  const [transportErrors, setTransportErrors] = useState({
    vehicle: "",
    driver: "",
    contact: "",
  });
  const [registeredVehicles, setRegisteredVehicles] = useState<any[]>([]);
  const [registeredDrivers, setRegisteredDrivers] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([
    { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
  ]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});

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
        setSupplierCompanyName(companyName);
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
      .getMaterialComponents("ACTIVE")
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
    try {
      const next = await api.getNextAsnNumber();
      setAsnNumber(next.asnNumber);

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
      // fallback to INITIAL_ASNS
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateModal = async () => {
    // Open the first dialog immediately; loading the next ASN number should
    // never make the user wait before seeing the popup.
    setIsAssignmentOpen(true);
    const next = await api.getNextAsnNumber().catch(() => null);
    if (next?.asnNumber) setAsnNumber(next.asnNumber);
    setExpectedArrivalDate("");
    setSupplierName(supplierCompanyName || currentUser?.full_name || currentUser?.username || "");
    setDestinationWarehouse("");
    setDestinationWarehouseId("");
    setSelectedPo(null);
    setVehicleNumber("");
    setDriverName("");
    setDriverMobile("");
    setTransportErrors({ vehicle: "", driver: "", contact: "" });
    setManualVehicle(false);
    setManualDriver(false);
    setLines([
      { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
    ]);
    setLineErrors({});
  };

  const closeCreateFlow = () => {
    setIsAssignmentOpen(false);
    setIsModalOpen(false);
    void navigate({ to: "/supplier/asns" });
  };

  useEffect(() => {
    if (search?.open === "create") {
      void handleOpenCreateModal();
    }
  }, [search?.open]);

  const continueToAsnForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (nextSubmitting) return;
    setNextSubmitting(true);
    const errors = {
      vehicle: !vehicleNumber.trim()
        ? "Vehicle number is required."
        : !isValidVehicleNumber(vehicleNumber)
          ? "Enter a valid vehicle number, e.g. KA03AB1234."
          : "",
      driver: !driverName.trim()
        ? "Driver name is required."
        : !isValidDriverName(driverName)
          ? /^[A-Za-z ]+$/.test(normalizeDriverName(driverName))
            ? "Enter a valid driver name."
            : "Driver name must contain valid letters."
          : "",
      contact: !driverMobile.trim()
        ? "Driver contact number is required."
        : !isValidDriverContact(driverMobile)
          ? /^\d{10}$/.test(driverMobile.trim()) && /^([6-9])\1{9}$/.test(driverMobile.trim())
            ? "Enter a valid driver mobile number."
            : "Enter a valid 10-digit mobile number."
          : "",
    };
    setTransportErrors(errors);
    if (errors.vehicle || errors.driver || errors.contact) {
      setNextSubmitting(false);
      return;
    }

    setVehicleNumber(normalizeVehicleNumber(vehicleNumber));
    setDriverName(normalizeDriverName(driverName));
    setDriverMobile(normalizeDriverContact(driverMobile));
    setIsAssignmentOpen(false);
    setIsModalOpen(true);
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
    const today = new Date().toISOString().slice(0, 10);
    if (expectedArrivalDate < today) {
      toast.error("Expected arrival date cannot be in the past.");
      return;
    }
    if (
      !isValidVehicleNumber(vehicleNumber) ||
      !isValidDriverName(driverName) ||
      !driverMobile.trim()
    ) {
      if (!isValidVehicleNumber(vehicleNumber)) {
        toast.error("Enter a valid vehicle number, e.g. KA03AB1234.");
        return;
      }
      if (!isValidDriverName(driverName)) {
        toast.error("Enter a valid driver name.");
        return;
      }
      toast.error("Enter a valid 10-digit mobile number.");
      return;
    }
    const normalizedVehicleNumber = normalizeVehicleNumber(vehicleNumber);
    const normalizedDriverName = normalizeDriverName(driverName);
    const quantityErrors: Record<number, string> = {};
    lines.forEach((line, index) => {
      const rawQuantity = String(line.shipped_quantity ?? "").trim();
      const quantity = Number(rawQuantity);
      const uom = String(line.uom || "").toUpperCase();
      const discrete = ["PCS", "EA", "UNIT", "PIECE", "NOS", "SET", "BOX", "PACK"].includes(uom);
      if (!/^\d+(\.\d{1,4})?$/.test(rawQuantity) || !Number.isFinite(quantity) || quantity <= 0) {
        quantityErrors[index] = "Enter a positive quantity with up to 4 decimal places.";
      } else if (discrete && !Number.isInteger(quantity)) {
        quantityErrors[index] = `${uom} quantities must be whole numbers.`;
      }
    });
    setLineErrors(quantityErrors);
    if (Object.keys(quantityErrors).length) {
      toast.error("Correct the shipped quantity errors before submitting.");
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
        vehicle_number: normalizedVehicleNumber,
        driver_name: normalizedDriverName,
        driver_contact: normalizeDriverContact(driverMobile),
        lines: lines.map((l) => ({
          material_id: l.material_id,
          item_code: l.item_code,
          material_name: l.material_name,
          shipped_quantity: Number(l.shipped_quantity) || 0,
          uom: l.uom || "PCS",
        })),
        status: "SUBMITTED",
      };

      const createdAsn = await api.createAsn(payload);

      const newRecord: AsnRecord = {
        // Keep the server identifier so the PDF endpoint can resolve this
        // newly-created ASN immediately. Fall back to the number for older
        // backend responses, which also support number-based lookup.
        id: String(createdAsn?.id || createdAsn?.asn_id || createdAsn?.asn_number || asnNumber),
        asn_number: createdAsn?.asn_number || asnNumber,
        po_number: "",
        supplier_name: supplierName,
        destination_warehouse: destinationWarehouse,
        vehicle_number: normalizedVehicleNumber,
        driver_name: normalizedDriverName,
        driver_contact: driverMobile.trim(),
        expected_arrival_at: expectedArrivalDate,
        status: "SUBMITTED",
        created_at: new Date().toISOString(),
        lines: payload.lines,
      };

      setAsnList((prev) => [newRecord, ...prev]);
      setSubmitting(false);
      setIsModalOpen(false);
      await navigate({ to: "/supplier/asns" });

      toast.success(`ASN ${asnNumber} Created Successfully ✓`, {
        description: `Vehicle ${newRecord.vehicle_number} · Driver ${newRecord.driver_name} (${newRecord.driver_contact})\n\nGate Security can now scan or search ${asnNumber}!`,
      });
    } catch (err: any) {
      setSubmitting(false);
      toast.error("ASN Creation Failed", { description: err?.message || "Could not create ASN." });
    }
  };

  const filteredList = asnList.filter((a) => {
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

  const downloadAsn = async (asn: AsnRecord) => {
    try {
      await api.downloadAsnPdf(asn.id, asn.asn_number);
      toast.success(`ASN ${asn.asn_number} downloaded`);
    } catch (error: any) {
      toast.error(error?.message || "Unable to download ASN");
    }
  };

  const deleteAsn = async (asn: AsnRecord) => {
    if (!window.confirm(`Delete ASN ${asn.asn_number}?`)) return;
    try {
      await api.deleteAsn(asn.id);
      setAsnList((rows) => rows.filter((row) => row.id !== asn.id));
      setSelectedAsn(null);
      toast.success(`ASN ${asn.asn_number} deleted`);
    } catch (error: any) {
      toast.error(error?.message || "Unable to delete ASN");
    }
  };

  return (
    <AppShell>
      <div className="space-y-4 w-full pb-10">
        {/* Search & ASN Table Card */}
        <Card className="rounded-2xl border-border/60 shadow-soft">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold uppercase tracking-wider">
                GENERATED ADVANCE SHIPPING NOTICES
              </CardTitle>
              <CardDescription>
                Search and manage generated ASNs or download official certificates
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

              <Button
                onClick={() => navigate({ to: "/supplier/asns/new", search: { open: "create" } as any })}
                className="rounded-xl font-bold shadow-md bg-sky-600 hover:bg-sky-700 text-white h-9 px-4 text-xs"
              >
                <Plus className="mr-1.5 size-4" /> Create ASN
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
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
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-medium">
                  {filteredList.length ? filteredList.map((asn) => (
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
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-bold uppercase">
                          {String(asn.status || "SUBMITTED").replaceAll("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="outline" title="Edit ASN" aria-label="Edit ASN" className="size-8 rounded-lg" onClick={() => toast.info("ASN editing is not available after submission.")}> <Pencil className="size-3.5" /> </Button>
                          <Button size="icon" variant="outline" title="Download ASN" aria-label="Download ASN" className="size-8 rounded-lg" onClick={() => void downloadAsn(asn)}> <Download className="size-3.5" /> </Button>
                          <Button size="icon" variant="outline" title="Delete ASN" aria-label="Delete ASN" className="size-8 rounded-lg text-red-600" onClick={() => void deleteAsn(asn)}> <Trash2 className="size-3.5" /> </Button>
                          <Button size="sm" variant="outline" className="rounded-xl border-sky-500/40 text-sky-600 hover:bg-sky-50" onClick={() => setSelectedAsn(asn)}><Eye className="mr-1.5 size-3.5" />View</Button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        <p className="font-bold text-foreground">No ASNs created yet</p>
                        <p className="mt-1">Create your first ASN to start an inbound shipment.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={Boolean(selectedAsn)} onOpenChange={(open) => !open && setSelectedAsn(null)}>
          <DialogContent className="max-w-lg rounded-2xl p-6">
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
                  <span className="text-muted-foreground">Expected Arrival</span>
                  <p className="font-semibold">
                    {selectedAsn.delivery_date ||
                      selectedAsn.expected_arrival_date ||
                      selectedAsn.expected_arrival_at?.split("T")[0] ||
                      "—"}
                  </p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isAssignmentOpen} onOpenChange={(open) => !open ? closeCreateFlow() : setIsAssignmentOpen(true)}>
          <DialogContent className="max-w-xl rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-primary">
                Assign vehicle and driver
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={continueToAsnForm} className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Enter the vehicle and driver details for this shipment.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="assignment-vehicle">Vehicle Number *</Label>
                  <Input
                    id="assignment-vehicle"
                    placeholder="Enter vehicle number"
                    value={vehicleNumber}
                    onChange={(e) => {
                      setVehicleNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ""));
                      setTransportErrors((current) => ({ ...current, vehicle: "" }));
                    }}
                    className={inputClass}
                  />
                  {transportErrors.vehicle && (
                    <p className="mt-1 text-xs font-medium text-destructive">{transportErrors.vehicle}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="assignment-driver">Driver Name *</Label>
                  <Input
                    id="assignment-driver"
                    placeholder="Enter driver name"
                    value={driverName}
                    onChange={(e) => {
                      setDriverName(e.target.value.replace(/[^A-Za-z' ]/g, ""));
                      setTransportErrors((current) => ({ ...current, driver: "" }));
                    }}
                    className={inputClass}
                  />
                  {transportErrors.driver && (
                    <p className="mt-1 text-xs font-medium text-destructive">{transportErrors.driver}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="assignment-contact">Driver Contact *</Label>
                  <Input
                    id="assignment-contact"
                    type="tel"
                    maxLength={10}
                    placeholder="Enter mobile number"
                    value={driverMobile}
                    onChange={(e) => {
                      setDriverMobile(e.target.value.replace(/[^0-9]/g, "").slice(0, 10));
                      setTransportErrors((current) => ({ ...current, contact: "" }));
                    }}
                    className={inputClass}
                  />
                  {transportErrors.contact && (
                    <p className="mt-1 text-xs font-medium text-destructive">{transportErrors.contact}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeCreateFlow}>
                  Cancel
                </Button>
                <Button type="submit" disabled={nextSubmitting}>
                  {nextSubmitting ? "Checking…" : "Next"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={isMaterialPopupOpen} onOpenChange={setIsMaterialPopupOpen}>
          <DialogContent className="max-w-sm rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-primary">
                Add custom material
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleAddNewCustomMaterial();
              }}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="custom-material-name">Material name *</Label>
                <Input
                  id="custom-material-name"
                  autoFocus
                  required
                  placeholder="Enter material name"
                  value={customMaterialName}
                  onChange={(event) => setCustomMaterialName(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCustomMaterialName("");
                    setIsMaterialPopupOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={creatingMaterial || !customMaterialName.trim()}>
                  {creatingMaterial ? "Saving…" : "Add Material"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* CREATE ASN POPUP MODAL DIALOG */}
        <Dialog open={isModalOpen} onOpenChange={(open) => !open ? closeCreateFlow() : setIsModalOpen(true)}>
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
                      value={supplierName}
                      readOnly
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
                      min={new Date().toISOString().slice(0, 10)}
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
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="e.g. 9845012345"
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
                        <th className="p-2.5">Material</th>
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
                                if (e.target.value === "__add_custom_material__") {
                                  setCustomMaterialRowIndex(idx);
                                  setIsMaterialPopupOpen(true);
                                  return;
                                }
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
                              <option hidden value="__add_custom_material__">
                                ＋ Add custom material
                              </option>
                            </select>
                          </td>
                          <td className="p-2">
                            <Input
                              required
                              type="number"
                              placeholder="Enter quantity"
                              value={line.shipped_quantity}
                              onChange={(e) => {
                                setLineErrors((prev) => ({ ...prev, [idx]: "" }));
                                setLines((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? { ...item, shipped_quantity: e.target.value }
                                      : item,
                                  ),
                                )
                              }}
                              min="0.0001"
                              step="0.0001"
                              className="h-8 text-xs font-bold text-right"
                            />
                            {lineErrors[idx] && (
                              <p className="mt-1 text-[10px] text-destructive">{lineErrors[idx]}</p>
                            )}
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
              <div className="flex gap-2 justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl font-bold"
                  onClick={closeCreateFlow}
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
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
