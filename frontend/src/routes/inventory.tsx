import { PutawayBatchTable, type PutawayView } from "@/components/wms/putaway-batch-table";
import { canAssignPutaway, canScanPutaway, assignedPutawayLocations, unassignedPutawayQuantity, isAssignableRack } from "@/lib/putaway-task-selection";
import { Label } from "@/components/ui/label";
import { RackOccupancyCards } from "@/components/wms/rack-occupancy-cards";
import { InformationTooltip } from "@/components/ui/information-tooltip";
import { inventoryHelp } from "@/lib/information-help";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Boxes,
  Search,
  Loader2,
  AlertTriangle,
  Building2,
  RefreshCw,
  CheckCircle2,
  PackageCheck,
  ClipboardList,
  QrCode,
  ListOrdered,
  Plus,
  Eye,
  Scan,
  Camera,
  Layers,
  Tag,
  Download,
  Printer,
} from "lucide-react";
import { AssemblyRequisitionsPanel } from "@/components/wms/assembly-requisitions-panel";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { isValidIdentifier } from "@/lib/input-validation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import QRCode from "qrcode";
import jsQR from "jsqr";
import warehouseHero from "@/assets/login-warehouse.png";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Warehouse Module · KaizenAssests" },
      {
        name: "description",
        content:
          "Authoritative, simple end-to-end Warehouse & Inventory operations control system.",
      },
    ],
  }),
  component: SimpleWarehouseModule,
});

type TabType = "dashboard" | "putaway" | "inventory" | "requests" | "picking" | "locations";

function SimpleWarehouseModule() {
  const navigate = useNavigate();
  const searchParams: any = useSearch({ from: "/inventory" });
  const tabOptions: TabType[] = ["dashboard", "putaway", "inventory", "requests", "picking", "locations"];
  const activeTab: TabType = tabOptions.includes(searchParams?.tab)
    ? (searchParams.tab === "requests" ? "picking" : searchParams.tab)
    : "dashboard";
  const pageHeader: Record<TabType, { eyebrow: string; title: string; description: string; icon: typeof Boxes }> = {
    dashboard: {
      eyebrow: "Warehouse Operations",
      title: "Warehouse Dashboard",
      description: "Monitor inventory, putaway, material requests, and picking activity.",
      icon: Boxes,
    },
    putaway: {
      eyebrow: "Inbound Operations",
      title: "Putaway Tasks",
      description: "Move received materials into their assigned warehouse bins.",
      icon: PackageCheck,
    },
    inventory: {
      eyebrow: "Stock Control",
      title: "Inventory",
      description: "Review on-hand quantities, availability, and material locations.",
      icon: Boxes,
    },
    requests: {
      eyebrow: "Warehouse Requests",
      title: "Material Requests",
      description: "Review and fulfill material requests from production and stores.",
      icon: ClipboardList,
    },
    picking: {
      eyebrow: "Outbound Operations",
      title: "Assembly Requisitions & Picking",
      description: "Review assembly requisitions, reserve stock, and confirm material picks for issue.",
      icon: ListOrdered,
    },
    locations: {
      eyebrow: "Warehouse Layout",
      title: "Zones & Racks",
      description: "Manage storage zones, rack capacities, and occupancy.",
      icon: Building2,
    },
  };
  const PageHeaderIcon = pageHeader[activeTab].icon;

  // Data States (All coming strictly from backend)
  const [loading, setLoading] = useState<boolean>(true);
  const [putawayTasks, setPutawayTasks] = useState<any[]>([]);
  const [inventorySummary, setInventorySummary] = useState<any[]>([]);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [pickupTasks, setPickupTasks] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [bins, setBins] = useState<any[]>([]);
  const [docks, setDocks] = useState<any[]>([]);
  const [dockRequests, setDockRequests] = useState<any[]>([]);
  const [dockChoices, setDockChoices] = useState<Record<string, string>>({});
  const [dockStoreChoices, setDockStoreChoices] = useState<Record<string, string>>({});

  // Search & Filter States
  const [invSearch, setInvSearch] = useState("");
  const [invWarehouseFilter, setInvWarehouseFilter] = useState("ALL");
  const [invStatusFilter, setInvStatusFilter] = useState("ALL");

  // Selected Detail Modals
  const [selectedInventory, setSelectedInventory] = useState<any>(null);
  const [selectedPutawayGroup, setSelectedPutawayGroup] = useState<any>(null);
  const [putawayView, setPutawayView] = useState<PutawayView>("details");
  const openPutawayGroup = (group: any, view: PutawayView = "details") => { setPutawayView(view); setSelectedPutawayGroup(group); };
  const [assignPutawayTask, setAssignPutawayTask] = useState<any>(null);
  const [scanPutawayTask, setScanPutawayTask] = useState<any>(null);
  const [putawayScan, setPutawayScan] = useState({ materialQr: "", binQr: "", quantity: "" });
  const [putawayQrImages, setPutawayQrImages] = useState({ material: "", bin: "" });
  const [qrPreview, setQrPreview] = useState<{ title: string; image: string } | null>(null);
  const [putawayScanValid, setPutawayScanValid] = useState(false);
  const [materialQrVerified, setMaterialQrVerified] = useState(false);
  const [binQrVerified, setBinQrVerified] = useState(false);
  const [qrScanError, setQrScanError] = useState("");
  const [cameraField, setCameraField] = useState<"material" | "bin" | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [pickupToConfirm, setPickupToConfirm] = useState<any>(null);
  const [pickupFifoAlert, setPickupFifoAlert] = useState("");
  const [pickupConfirmation, setPickupConfirmation] = useState({
    material_scan: "",
    zone_scan: "",
    quantity: "",
  });
  const [pickupQrImages, setPickupQrImages] = useState({ material: "", rack: "" });
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [assignStoreId, setAssignStoreId] = useState("");
  const [assignZoneId, setAssignZoneId] = useState("");
  const [assignQuantity, setAssignQuantity] = useState("");

  // Location Creation Modals
  const [createLocationType, setCreateLocationType] = useState<
    "zone" | "bin" | null
  >(null);
  const [editingZone, setEditingZone] = useState<any | null>(null);
  const [newZoneForm, setNewZoneForm] = useState({ zone_code: "", zone_name: "" });
  const [firstWarehouse, setFirstWarehouse] = useState({ name: "", location: "" });
  const [newBinForm, setNewBinForm] = useState({ zone_id: "" });
  const [newBinRows, setNewBinRows] = useState<[{ rack: string; position: string; capacity: string; bin_code: string }]>([{ rack: "", position: "", capacity: "", bin_code: "" }]);
  const [viewBinQrModal, setViewBinQrModal] = useState<any>(null);
  const [binQrImage, setBinQrImage] = useState<string | null>(null);

  // Submitting States
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!cameraField) return;
    let cancelled = false;
    setCameraError("");
    void navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          void cameraVideoRef.current.play();
        }
      })
      .catch(() =>
        setCameraError(
          "Camera permission was denied or is unavailable. Enter the QR value manually.",
        ),
      );
    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, [cameraField]);

  useEffect(() => {
    if (!cameraField) return;
    const timer = window.setInterval(() => {
      const video = cameraVideoRef.current;
      const canvas = cameraCanvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(image.data, image.width, image.height);
      if (result?.data) {
        setPutawayScan((current) => ({
          ...current,
          [cameraField === "material" ? "materialQr" : "binQr"]: result.data,
        }));
        setCameraField(null);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [cameraField]);

  useEffect(() => {
    const value = viewBinQrModal?.qr_identifier;
    if (!value) {
      setBinQrImage(null);
      return;
    }
    let active = true;
    void QRCode.toDataURL(value)
      .then((dataUrl) => {
        if (active) setBinQrImage(dataUrl);
      })
      .catch(() => {
        if (active) setBinQrImage(null);
      });
    return () => {
      active = false;
    };
  }, [viewBinQrModal]);

  // Load Real Operational Data (No Hardcoded Fallbacks)
  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [
        putawaysRes,
        inventoryRes,
        storesRes,
        materialCatalogRes,
        assemblyRequestsRes,
        assemblyPickingTasksRes,
      ] = await Promise.all([
        api.getPutawayTasks(),
        api.getWarehouseInventorySummary(),
        api.getStores(),
        api.getMaterialComponents(),
        api.getAssemblyMaterialRequests(),
        api.getAssemblyPickingTasks(),
      ]);

      let normalizedPutawayTasks = (Array.isArray(putawaysRes) ? putawaysRes : []).filter(
        (task: any, index: number, tasks: any[]) => {
          const grn = String(task.grn_id || task.grn_number || "").toUpperCase();
          const item = String(task.item_code || task.material_code || "").toUpperCase();
          const batch = String(task.batch_number || task.batchNumber || "")
            .trim()
            .toUpperCase();
          if (!batch) return true;
          return (
            tasks.findIndex(
              (candidate: any) =>
                String(candidate.grn_id || candidate.grn_number || "").toUpperCase() === grn &&
                String(candidate.item_code || candidate.material_code || "").toUpperCase() ===
                  item &&
                String(candidate.batch_number || candidate.batchNumber || "")
                  .trim()
                  .toUpperCase() === batch,
            ) === index
          );
        },
      );
      // Reconcile legacy task rows against the saved GRN batches. This keeps
      // old duplicate posting attempts out of the queue without deleting
      // historical records.
      const grnKeys = Array.from(
        new Set(
          normalizedPutawayTasks.map((task: any) => task.grn_id).filter((value: any) => value),
        ),
      );
      const canonicalByGrnMaterial = new Map<string, Set<string>>();
      await Promise.all(
        grnKeys.map(async (grnKey) => {
          try {
            const detail = await api.getGrnDetail(String(grnKey));
            for (const line of Array.isArray(detail?.lines) ? detail.lines : []) {
              const approved = Number(line.quality_approved_quantity ?? line.good_quantity ?? 0);
              let remaining = approved;
              const allowed = new Set<string>();
              for (const batch of [...(Array.isArray(line.batches) ? line.batches : [])].sort(
                (a: any, b: any) =>
                  String(a.created_at || "").localeCompare(String(b.created_at || "")),
              )) {
                const batchNumber = String(batch.batch_number || "")
                  .trim()
                  .toUpperCase();
                const quantity = Number(batch.batch_quantity || 0);
                if (!batchNumber || allowed.has(batchNumber) || remaining <= 0 || quantity <= 0)
                  continue;
                allowed.add(batchNumber);
                remaining -= Math.min(quantity, remaining);
              }
              if (allowed.size > 0) {
                canonicalByGrnMaterial.set(
                  `${grnKey}:${String(line.item_code || "").toUpperCase()}`,
                  allowed,
                );
              }
            }
          } catch {
            // The task endpoint remains the source if a legacy GRN cannot be read.
          }
        }),
      );
      normalizedPutawayTasks = normalizedPutawayTasks.filter((task: any) => {
        const batch = String(task.batch_number || task.batchNumber || "")
          .trim()
          .toUpperCase();
        if (!batch || !task.grn_id) return true;
        const allowed = canonicalByGrnMaterial.get(
          `${task.grn_id}:${String(task.item_code || task.material_code || "").toUpperCase()}`,
        );
        return !allowed || allowed.has(batch);
      });
      setPutawayTasks(normalizedPutawayTasks);
      const assemblyRequests = (
        Array.isArray(assemblyRequestsRes) ? assemblyRequestsRes : []
      ).flatMap((req: any) =>
        (Array.isArray(req.items) ? req.items : []).map((item: any) => ({
          ...req,
          id: req.id,
          request_number: req.request_number,
          material_code: item.material_code,
          material_name: item.material_name,
          material_qr: item.material_qr,
          quantity: item.quantity,
          required_quantity: item.quantity,
          uom: item.uom,
          available: item.available_quantity,
          available_quantity: item.available_quantity,
        })),
      );
      setMaterialRequests(assemblyRequests);
      const stockRows = Array.isArray(inventoryRes) ? inventoryRes : [];
      const stockCodes = new Set(
        stockRows.map((row: any) => String(row.material_code || row.code || "").toUpperCase()),
      );
      const catalogRows = (Array.isArray(materialCatalogRes) ? materialCatalogRes : [])
        .filter((material: any) => material.code && material.name)
        .filter((material: any) => !stockCodes.has(String(material.code).toUpperCase()))
        .map((material: any) => ({
          material_code: material.code,
          material_name: material.name,
          batch_number: "-",
          available_quantity: 0,
          on_hand_quantity: 0,
          total_quantity: 0,
          uom: material.uom || "PCS",
          location: "-",
          is_catalog_item: true,
        }));
      const rowsToRefresh = [...stockRows, ...catalogRows];
      const refreshedStockRows = await Promise.all(
        rowsToRefresh.map(async (row: any) => {
          const code = row.material_code || row.code;
          if (!code) return row;
          try {
            const detail = await api.getMaterialInventoryDetail(String(code));
            const summary = detail?.summary || {};
            const firstLocation = Array.isArray(detail?.locations) ? detail.locations[0] : null;
            const movementBatches = (Array.isArray(detail?.movements) ? detail.movements : [])
              .filter((movement: any) => movement.movement_type === "PUTAWAY" && movement.batch_lot)
              .map((movement: any) => ({
                batch_number: movement.batch_lot,
                quantity: movement.quantity,
                uom: movement.uom || summary.uom,
              }));
            return {
              ...row,
              available: summary.available_stock ?? row.available,
              available_quantity: summary.available_stock ?? row.available_quantity,
              total_quantity: summary.total_stock ?? row.total_quantity,
              on_hand_quantity: summary.total_stock ?? row.on_hand_quantity,
              batch_details: movementBatches.length ? movementBatches : row.batch_details,
              batch_number:
                movementBatches.map((b: any) => b.batch_number).join(", ") || row.batch_number,
              location: firstLocation?.bin_code || firstLocation?.location_code || row.location,
              location_code: firstLocation?.location_code || row.location_code,
              bin_code: firstLocation?.bin_code || row.bin_code,
              uom: summary.uom || row.uom,
            };
          } catch {
            return row;
          }
        }),
      );
      setInventorySummary(refreshedStockRows);
      const assemblyPickingTasks = (
        Array.isArray(assemblyPickingTasksRes) ? assemblyPickingTasksRes : []
      ).flatMap((task: any) =>
        (Array.isArray(task.items) ? task.items : []).map((item: any) => ({
          id: `${task.id}:${item.material_code}`,
          task_number: task.task_number,
          assembly_order_number: task.request_number,
          material_code: item.material_code,
          material_name: item.material_name,
          material_qr: item.material_qr,
          quantity:
            item.picked_quantity ??
            item.issued_quantity ??
            item.required_quantity ??
            item.requested_quantity,
          requested_quantity: item.requested_quantity ?? item.required_quantity,
          picked_quantity: item.picked_quantity ?? item.issued_quantity ?? 0,
          batch_number:
            item.batch_number || item.batch_lot_number || task.confirmation?.batch_number,
          uom: item.uom,
          pick_location: item.pick_location || task.pick_location || task.destination,
          confirmation: task.confirmation,
          status: task.status,
          assembly_pick_task_id: task.id,
        })),
      );
      setPickupTasks(assemblyPickingTasks);
      setStores(Array.isArray(storesRes) ? storesRes : []);

      const locationZones = await api.getLocationZones();
      const zoneRows = Array.isArray(locationZones) ? locationZones : [];
      const zoneBins = await Promise.all(zoneRows.map((zone: any) => api.getZoneBins(zone.id)));
      setZones(zoneRows);
      setBins(zoneBins.flatMap((rows: any[]) => rows || []));
      const [dockRows, pendingDockRows] = await Promise.all([
        api.getDocks(),
        api.getPendingAllocations(),
      ]);
      setDocks(Array.isArray(dockRows) ? dockRows : []);
      setDockRequests(Array.isArray(pendingDockRows) ? pendingDockRows : []);
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch warehouse data");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(true), 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleTabChange = (tab: TabType) => {
    navigate({ to: "/inventory", search: { tab } });
  };

  // Flattened Bins List for Single Location Selector (Strictly from DB)
  const allFlattenedBins = useMemo(() => {
    const list: Array<{
      id: string;
      label: string;
      bin_code: string;
      store_id: string;
      zone_id: string;
      rack: string;
      rack_capacity?: any;
      position?: string;
      qr_identifier?: string;
      status?: string;
    }> = [];
    if (bins && bins.length > 0) {
      bins.forEach((b) => {
        list.push({
          id: b.id,
          label: `${b.zone_code || b.zone_name || "—"} / ${b.rack || "—"} / ${b.bin_code}`,
          bin_code: b.bin_code,
          store_id: b.store_id,
          zone_id: b.zone_id,
          rack: b.rack,
          rack_capacity: b.rack_capacity,
          position: b.position || b.shelf,
          qr_identifier: b.qr_identifier,
          status: b.status,
        });
      });
    }
    return list;
  }, [bins]);

  // Action: Assign Storage Location to Putaway Task
  const handleConfirmAssignPutaway = async () => {
    if (!assignPutawayTask) return;
    const quantity = Number(assignQuantity);
    if (
      !assignStoreId ||
      !assignZoneId ||
      !selectedLocationId ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > unassignedPutawayQuantity(assignPutawayTask)
    ) {
      toast.error("Select an active rack and enter a valid assignment quantity.");
      return;
    }
    setIsSubmitting(true);
    try {
      const selectedBinObj = allFlattenedBins.find(
        (b) => b.id === selectedLocationId || b.bin_code === selectedLocationId,
      );
      await api.assignPutawayLocation(
        assignPutawayTask.id,
        selectedBinObj?.id,
        selectedBinObj?.store_id,
        selectedBinObj?.zone_id,
        selectedBinObj?.id,
        quantity,
      );
      toast.success(
        `Assigned ${assignPutawayTask.material_name || "Material"} to ${selectedBinObj?.label || selectedLocationId}`,
      );
      setAssignPutawayTask(null);
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to assign location");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAssignPutaway = (task: any) => {
    if (!canAssignPutaway(task)) return;
    setSelectedPutawayGroup(null);
    setAssignPutawayTask(task);
    setAssignStoreId(task.destination_store_id || task.assigned_store_id || "");
    setAssignZoneId(task.destination_zone_id || "");
    setSelectedLocationId(task.destination_bin_id || "");
    setAssignQuantity(String(unassignedPutawayQuantity(task)));
  };

  const openPutawayScan = (task: any) => {
    setSelectedPutawayGroup(null);
    setScanPutawayTask(task);
    setPutawayScan({ materialQr: "", binQr: "", quantity: String(task.quantity ?? "") });
    setPutawayScanValid(false);
    setMaterialQrVerified(false);
    setBinQrVerified(false);
    setQrScanError("");
  };

  const pickupMaterialQrValue =
    pickupToConfirm?.material_qr ||
    pickupToConfirm?.confirmation?.material_qr ||
    (pickupToConfirm?.batch_number ? `QR-BATCH-${pickupToConfirm.batch_number}` : "") ||
    pickupToConfirm?.material_code ||
    "";
  const pickupRackQrValue =
    pickupToConfirm?.pick_location ||
    pickupToConfirm?.confirmation?.rack_qr ||
    pickupToConfirm?.rack_qr ||
    "";

  const decodeQrUpload = (file: File, field: "material" | "bin") => {
    if (!/image\/(png|jpeg|jpg)/i.test(file.type)) {
      setQrScanError("Upload a PNG, JPG, or JPEG QR image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return setQrScanError("Could not read the uploaded image.");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(pixels.data, pixels.width, pixels.height);
        if (!decoded?.data) {
          setQrScanError(
            `No readable ${field === "material" ? "Material" : "BIN"} QR found in the image.`,
          );
          return;
        }
        setQrScanError("");
        setPutawayScan((current) => ({
          ...current,
          [field === "material" ? "materialQr" : "binQr"]: decoded.data,
        }));
      };
      image.onerror = () => setQrScanError("Could not load the uploaded image.");
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const decodePickupQrUpload = (file: File, field: "material" | "rack") => {
    if (!/image\/(png|jpeg|jpg)/i.test(file.type)) {
      toast.error("Upload a PNG, JPG, or JPEG QR image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return toast.error("Could not read the uploaded QR image.");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(pixels.data, pixels.width, pixels.height);
        if (!decoded?.data)
          return toast.error(`No readable ${field === "material" ? "material" : "rack"} QR found.`);
        setPickupConfirmation((current) => ({
          ...current,
          [field === "material" ? "material_scan" : "zone_scan"]: decoded.data,
        }));
      };
      image.onerror = () => toast.error("Could not load the uploaded QR image.");
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const downloadQrValue = async (value: string, title: string) => {
    if (!value.trim()) {
      toast.error(`No ${title.toLowerCase()} value is available to generate a QR.`);
      return;
    }
    try {
      const image = await QRCode.toDataURL(value.trim(), { width: 320, margin: 2 });
      const link = document.createElement("a");
      link.href = image;
      link.download = `${title.replaceAll(" ", "-").toLowerCase()}.png`;
      link.click();
    } catch {
      toast.error(`Unable to generate the ${title.toLowerCase()} QR.`);
    }
  };

  const printBinQr = () => {
    if (!viewBinQrModal || !binQrImage) return;
    const printWindow = window.open("", "_blank", "width=700,height=700");
    if (!printWindow) {
      toast.error("Allow pop-ups to print the bin QR label.");
      return;
    }
    const doc = printWindow.document;
    doc.title = `Bin QR - ${viewBinQrModal.bin_code}`;
    const style = doc.createElement("style");
    style.textContent = "@page { margin: 15mm; } body { font: 16px Arial, sans-serif; color: #000; text-align: center; } img { width: 240px; height: 240px; } h1 { font-size: 24px; } p { margin: 8px 0; }";
    doc.head.appendChild(style);
    const heading = doc.createElement("h1");
    heading.textContent = viewBinQrModal.bin_code;
    doc.body.appendChild(heading);
    const image = doc.createElement("img");
    image.alt = `QR code for ${viewBinQrModal.bin_code}`;
    image.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
    image.onerror = () => {
      printWindow.close();
      toast.error("Unable to load the bin QR for printing.");
    };
    doc.body.appendChild(image);
    const zone = zones.find((item) => String(item.id) === String(viewBinQrModal.zone_id));
    for (const text of [
      viewBinQrModal.qr_identifier,
      `Zone: ${zone?.zone_name || zone?.zone_code || "—"}`,
      `Rack: ${viewBinQrModal.rack || "—"} | Shelf: ${viewBinQrModal.position || "—"}`,
      `Status: ${viewBinQrModal.status || "UNKNOWN"}`,
    ]) {
      const line = doc.createElement("p");
      line.textContent = text;
      doc.body.appendChild(line);
    }
    image.src = binQrImage;
  };

  useEffect(() => {
    let active = true;
    const quantity = Number(putawayScan.quantity);
    setPutawayScanValid(false);
    setMaterialQrVerified(false);
    setBinQrVerified(false);
    if (
      !scanPutawayTask ||
      !putawayScan.materialQr.trim() ||
      !(putawayScan.binQr || "").trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > Number(scanPutawayTask.quantity || 0)
    )
      return;
    void Promise.allSettled([
      api.resolveGrnQr(putawayScan.materialQr.trim()),
      api.resolveBinQr((putawayScan.binQr || "").trim(), scanPutawayTask.destination_store_id),
    ])
      .then(([materialResult, rackResult]) => {
        if (materialResult.status === "rejected") {
          throw new Error(materialResult.reason?.message || "Material QR could not be resolved.");
        }
        if (rackResult.status === "rejected") {
          throw new Error(rackResult.reason?.message || "BIN QR could not be resolved.");
        }
        const material = materialResult.value;
        const rack = rackResult.value;
        const materialMatches =
          String(material.material_code || "").toUpperCase() ===
            String(scanPutawayTask.item_code || "").toUpperCase() &&
          (!material.putaway_task_id || material.putaway_task_id === scanPutawayTask.id) &&
          (!scanPutawayTask.batch_number ||
            String(material.batch_lot_number || "").toUpperCase() ===
              String(scanPutawayTask.batch_number).toUpperCase());
        const rackMatches =
          (!scanPutawayTask.destination_bin_id ||
            rack.bin_id === scanPutawayTask.destination_bin_id) &&
          String(rack.bin_code || "").toUpperCase() ===
            String(
              scanPutawayTask.destination_bin_code ||
                scanPutawayTask.destination_bin ||
                rack.bin_code,
            ).toUpperCase();
        if (active) {
          setMaterialQrVerified(materialMatches);
          setBinQrVerified(rackMatches);
          setPutawayScanValid(materialMatches && rackMatches);
          if (!materialMatches && !rackMatches)
            setQrScanError("Material QR batch and BIN QR do not match this putaway task.");
          else if (!materialMatches)
            setQrScanError(
              `Material QR does not match batch ${scanPutawayTask.batch_number || "the assigned batch"}.`,
            );
          else if (!rackMatches)
            setQrScanError(
              `BIN QR does not match assigned bin ${scanPutawayTask.destination_bin_code || scanPutawayTask.destination_bin || "the assigned bin"}.`,
            );
        }
      })
      .catch((error: any) => {
        if (active) {
          setMaterialQrVerified(false);
          setBinQrVerified(false);
          setPutawayScanValid(false);
          setQrScanError(error?.message || "QR validation failed.");
        }
      });
    return () => {
      active = false;
    };
  }, [scanPutawayTask, putawayScan.materialQr, putawayScan.binQr, putawayScan.quantity]);

  useEffect(() => {
    if (!scanPutawayTask) {
      setPutawayQrImages({ material: "", bin: "" });
      return;
    }
    let active = true;
    const assignedBin = allFlattenedBins.find(
      (bin) =>
        bin.id === scanPutawayTask.destination_bin_id ||
        bin.bin_code === scanPutawayTask.destination_bin_code,
    );
    const previewMaterialQr =
      putawayScan.materialQr.trim() ||
      scanPutawayTask.material_qr ||
      (scanPutawayTask.batch_number ? `QR-BATCH-${scanPutawayTask.batch_number}` : "") ||
      scanPutawayTask.barcode_value ||
      "";
    const previewRackQr =
      (putawayScan.binQr || "").trim() ||
      assignedBin?.qr_identifier ||
      scanPutawayTask.destination_bin_code ||
      scanPutawayTask.destination_bin ||
      "";
    void Promise.all([
      previewMaterialQr
        ? QRCode.toDataURL(previewMaterialQr, { width: 180, margin: 1 })
        : Promise.resolve(""),
      previewRackQr
        ? QRCode.toDataURL(previewRackQr, { width: 180, margin: 1 })
        : Promise.resolve(""),
    ])
      .then(([material, rack]) => {
        if (active) setPutawayQrImages({ material, bin: rack });
      })
      .catch(() => {
        if (active) setPutawayQrImages({ material: "", bin: "" });
      });
    return () => {
      active = false;
    };
  }, [scanPutawayTask, putawayScan.materialQr, putawayScan.binQr, allFlattenedBins]);

  const handleConfirmPutaway = async () => {
    if (!scanPutawayTask) return;
    const quantity = Number(putawayScan.quantity);
    if (
      !putawayScan.materialQr.trim() ||
      !(putawayScan.binQr || "").trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      toast.error("Scan the material QR and BIN QR, then enter a valid quantity.");
      return;
    }
    setIsSubmitting(true);
    try {
      const resolved = await api.resolveGrnQr(putawayScan.materialQr.trim());
      if (resolved.putaway_task_id && resolved.putaway_task_id !== scanPutawayTask.id) {
        throw new Error("The scanned material does not match this putaway task.");
      }
      if (
        String(resolved.material_code || "").toUpperCase() !==
        String(scanPutawayTask.item_code || "").toUpperCase()
      ) {
        throw new Error("The scanned material does not match this putaway task.");
      }
      const rack = await api.resolveBinQr(
        (putawayScan.binQr || "").trim(),
        scanPutawayTask.destination_store_id,
      );
      if (
        scanPutawayTask.destination_bin_id &&
        rack.bin_id !== scanPutawayTask.destination_bin_id
      ) {
        throw new Error(
          `Wrong BIN. Scan ${scanPutawayTask.destination_bin_code || scanPutawayTask.destination_bin}.`,
        );
      }
      await api.executePutaway({
        task_id: scanPutawayTask.id,
        grn_qr_code: putawayScan.materialQr.trim(),
        bin_qr_code: (putawayScan.binQr || "").trim(),
        quantity,
      });
      toast.success("Putaway confirmed and inventory updated.");
      setScanPutawayTask(null);
      await fetchData(true);
    } catch (err: any) {
      toast.error(err.message || "Putaway confirmation failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Approve Material Request
  const handleApproveMaterialRequest = async (req: any) => {
    const reqQty = Number(req.quantity ?? req.required_quantity ?? 0);
    const availQty = Number(req.available_quantity ?? req.available ?? 0);

    if (availQty < reqQty) {
      toast.error(
        `Insufficient stock. Requested: ${reqQty} ${req.uom || ""}, available: ${availQty} ${req.uom || ""}, shortage: ${reqQty - availQty} ${req.uom || ""}.`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await api.approveAssemblyMaterialRequest(req.id || req.request_number);
      toast.success(
        `Approved Material Request ${req.request_number || req.id}. Stock verified; picking can now begin.`,
      );
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to approve request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePartialApproveMaterialRequest = async (req: any) => {
    const requestItems = Array.isArray(req.items) ? req.items : [req];
    const approvedItems = requestItems
      .map((item: any) => ({
        material_code: item.material_code,
        approved_quantity: Math.min(
          Number(item.required_quantity ?? item.quantity ?? 0),
          Number(item.available_quantity ?? item.available ?? 0),
        ),
      }))
      .filter((item: any) => item.approved_quantity > 0);
    if (!approvedItems.length) {
      toast.error("No available stock can be approved for this request.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.approveAssemblyMaterialRequest(req.id || req.request_number, {
        approved_items: approvedItems,
        remarks: "Partially approved against current available stock.",
      });
      toast.success(`Partially approved ${req.request_number || req.id}.`);
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to partially approve request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectMaterialRequest = async (req: any) => {
    const reason = window.prompt("Reason for rejecting this material request:");
    if (!reason?.trim()) return;
    setIsSubmitting(true);
    try {
      await api.rejectAssemblyMaterialRequest(req.id || req.request_number, reason.trim());
      toast.success(`Rejected Material Request ${req.request_number || req.id}.`);
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to reject request");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Complete Pickup Task
  const handleCompletePickup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pickupToConfirm) return;
    setIsSubmitting(true);
    try {
      if (pickupToConfirm.assembly_pick_task_id) {
        await api.completeAssemblyPickingTask(pickupToConfirm.assembly_pick_task_id, {
          material_scan: pickupConfirmation.material_scan.trim(),
          zone_scan: pickupConfirmation.zone_scan.trim(),
          quantity: Number(pickupConfirmation.quantity),
        });
      } else {
        await api.completePickupTask(pickupToConfirm.id, {
          material_scan: pickupConfirmation.material_scan.trim(),
          zone_scan: pickupConfirmation.zone_scan.trim(),
          quantity: Number(pickupConfirmation.quantity),
        });
      }
      toast.success("Pick confirmed and inventory updated.");
      setPickupToConfirm(null);
      setPickupConfirmation({ material_scan: "", zone_scan: "", quantity: "" });
      void fetchData();
    } catch (err: any) {
      if (String(err.message || "").toUpperCase().includes("FIFO:")) {
        setPickupFifoAlert(String(err.message).replace(/^.*FIFO:\s*/is, ""));
      }
      toast.error(err.message || "Failed to complete pickup task");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Location codes are scoped to zones; the legacy warehouse parent stays internal.
  const openCreateZone = async () => {
    try {
      const nextZone = await api.getNextLocationZoneCode();
      setEditingZone(null);
      setNewZoneForm({ zone_code: nextZone.suggested_zone_code, zone_name: "" });
      setCreateLocationType("zone");
    } catch (err: any) {
      toast.error(err.message || "Unable to generate the next zone code.");
    }
  };

  const openCreateBin = async (zone: any) => {
    if (!zone || String(zone.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
      toast.error("Bins can only be added to an active zone.");
      return;
    }
    try {
      const nextCode = await api.getNextBinCode(zone.id);
      setNewBinForm({ zone_id: zone.id });
      setNewBinRows([{ rack: nextCode.suggested_rack_code, position: "", capacity: "", bin_code: nextCode.suggested_bin_code }]);
    } catch (err: any) {
      toast.error(err.message || "Unable to prepare the next bin code.");
      return;
    }
    setCreateLocationType("bin");
  };

  // Action: Create Location Sub-Form (Zone, Bin)
  const handleCreateLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (createLocationType === "zone") {
        const zoneName = newZoneForm.zone_code;
        if (!newZoneForm.zone_code) {
          toast.error("A zone code could not be generated. Close and reopen this form.");
          return;
        }
<<<<<<< HEAD
        const nextCode = await api.getNextStoreCode();
        const createdStore = await api.createStore({
          store_name: storeName,
          store_code: nextCode.suggested_store_code,
          store_type: newStoreForm.store_type,
          status: "ACTIVE",
          warehouse_id: newStoreForm.warehouse_id || "Main Warehouse",
        });
        toast.success(`Warehouse created: ${createdStore.store_name} (${createdStore.store_code})`);
        setNewStoreForm({
          store_code: "",
          store_name: "",
          description: "",
          store_type: "RAW_MATERIAL",
          status: "ACTIVE",
          warehouse_id: "",
        });
      } else if (createLocationType === "zone") {
        const targetStoreId = newZoneForm.store_id;
        if (!targetStoreId) {
          toast.error("Select a warehouse before creating a zone.");
          return;
=======
        const generatedZoneCode = newZoneForm.zone_code;
        if (editingZone) {
          await api.updateZone(String(editingZone.id), { zone_name: zoneName });
          toast.success(`Zone ${generatedZoneCode} updated.`);
        } else {
          if (!stores.length && (!firstWarehouse.name.trim() || !firstWarehouse.location.trim())) {
            toast.error("Enter the warehouse name and location / plant for the first zone.");
            return;
          }
          const createdZone = await api.createLocationZone({
            zone_name: zoneName,
            zone_code: generatedZoneCode,
            ...(!stores.length ? {
              warehouse_name: firstWarehouse.name.trim(), warehouse_id: firstWarehouse.location.trim(),
            } : {}),
          });
          toast.success(
            `Zone created: ${createdZone?.zone_name || newZoneForm.zone_name} (${createdZone?.zone_code || generatedZoneCode || "auto-generated"})`,
          );
>>>>>>> origin/Srujan_M_S
        }
        setNewZoneForm({ zone_code: "", zone_name: "" });
        setEditingZone(null);
      } else if (createLocationType === "bin") {
        const row = newBinRows[0];
        if (
          !newBinForm.zone_id ||
          !row.rack.trim() ||
          !Number.isSafeInteger(Number(row.capacity)) || Number(row.capacity) <= 0 ||
          !row.bin_code.trim()
        ) {
          toast.error("Enter a rack code and a positive whole Maximum Capacity (PCS).");
          return;
        }
        if (
<<<<<<< HEAD
          !isValidIdentifier(row.rack) ||
          !isValidIdentifier(row.position) ||
          !isValidIdentifier(row.bin_code)
        ) {
          toast.error(
            "Rack, position, and bin codes may contain only letters, numbers, underscores, and hyphens.",
          );
=======
          row.rack.trim().length > 64 ||
          row.bin_code.trim().length > 64 ||
          !isValidIdentifier(row.rack) ||
          !isValidIdentifier(row.bin_code)
        ) {
          toast.error("Rack, position, and bin codes must be 1–64 characters using letters, numbers, underscores, or hyphens.");
          return;
        }
        if (row.position.trim() && (row.position.trim().length > 64 || !isValidIdentifier(row.position))) {
          toast.error("Shelf / Position must use up to 64 letters, numbers, underscores, or hyphens.");
>>>>>>> origin/Srujan_M_S
          return;
        }
        const existingBins = await api.getZoneBins(newBinForm.zone_id);
        const normalizedBinCode = row.bin_code.trim().toUpperCase();
        const normalizedRack = row.rack.trim().toUpperCase();
        const normalizedPosition = row.position.trim().toUpperCase() || undefined;
        if ((existingBins || []).some((b: any) => String(b.bin_code).toUpperCase() === normalizedBinCode)) {
          toast.error(`Bin code '${row.bin_code}' already exists in this zone.`);
          return;
        }
        if (
          (existingBins || []).some(
            (b: any) =>
              String(b.rack || "").toUpperCase() === normalizedRack,
          )
        ) {
          toast.error("This rack already exists in the zone. Use Add Material.");
          return;
        }
        const zone = zones.find((z) => z.id === newBinForm.zone_id);
        if (!zone) {
          toast.error("The selected zone no longer exists. Refresh and try again.");
          return;
        }
        await api.createBin(newBinForm.zone_id, {
          bin_code: normalizedBinCode,
          bin_name: normalizedBinCode,
          rack: normalizedRack,
          position: normalizedPosition,
          capacity: Number(row.capacity),
          qr_identifier: `QR-${normalizedBinCode}`,
        });
        toast.success(`Rack ${normalizedRack} created with capacity ${row.capacity} PCS.`);
      }
      setCreateLocationType(null);
      await fetchData(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to create location entity");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered Inventory List
  const filteredInventory = useMemo(() => {
    return inventorySummary.filter((item) => {
      const matchesSearch =
        !invSearch ||
        (item.material_name || item.material || "")
          .toLowerCase()
          .includes(invSearch.toLowerCase()) ||
        (item.material_code || "").toLowerCase().includes(invSearch.toLowerCase()) ||
        (item.batch_number || item.batch || "").toLowerCase().includes(invSearch.toLowerCase());

      const matchesWarehouse =
        invWarehouseFilter === "ALL" ||
        (item.warehouse_id || item.store_name || "").includes(invWarehouseFilter);

      const matchesStatus = invStatusFilter === "ALL" || item.status === invStatusFilter;

      return matchesSearch && matchesWarehouse && matchesStatus;
    });
  }, [inventorySummary, invSearch, invWarehouseFilter, invStatusFilter]);

  const getInventoryDisplayQuantity = (item: any) => {
    const batches = Array.isArray(item.batch_details) ? item.batch_details : [];
    const batchTotal = batches.reduce(
      (sum: number, batch: any) => sum + Number(batch.quantity || 0),
      0,
    );
    const summaryQuantity =
      item.available_to_pick_quantity ??
      item.available ??
      item.available_quantity ??
      item.total_quantity;
    return Number(summaryQuantity || 0) === 0 && batchTotal > 0
      ? batchTotal
      : (summaryQuantity ?? "—");
  };

  const getInventoryDisplayLocation = (item: any) =>
    item.location_code ||
    item.bin_code ||
    item.location ||
    item.batch_details?.[0]?.location ||
    "—";

  // Dashboard Aggregates (Real backend numbers)
  const pendingPutawayCount = putawayTasks.filter(
    (t) => t.status === "PENDING" || t.status === "CREATED",
  ).length;
  const pendingRequestsCount = materialRequests.filter(
    (r) => ["PENDING", "SUBMITTED", "PENDING_WAREHOUSE_APPROVAL"].includes(String(r.status || "").toUpperCase()),
  ).length;
  const pendingPickingCount = pickupTasks.filter(
    (p) => p.status === "PENDING" || p.status === "IN_PROGRESS",
  ).length;
  const inventoryByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of inventorySummary) {
      const category = String(item.category || item.material_category || item.material_group || "Other").trim() || "Other";
      const quantity = Number(item.available ?? item.available_quantity ?? item.on_hand_quantity ?? item.total_quantity ?? 0);
      if (quantity > 0) totals.set(category, (totals.get(category) || 0) + 1);
    }
    const sorted = Array.from(totals, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
    if (sorted.length <= 6) return sorted;
    const visible = sorted.slice(0, 5);
    visible.push({ name: "Other categories", value: sorted.slice(5).reduce((sum, item) => sum + item.value, 0) });
    return visible;
  }, [inventorySummary]);
  const openWorkByType = [
    { name: "Putaway", tasks: pendingPutawayCount, fill: "#d97706" },
    { name: "Requests", tasks: pendingRequestsCount, fill: "#2563eb" },
    { name: "Picking", tasks: pendingPickingCount, fill: "#7c3aed" },
  ];
  const totalOpenTasks = openWorkByType.reduce((total, queue) => total + queue.tasks, 0);
  const busiestQueue = [...openWorkByType].sort((a, b) => b.tasks - a.tasks)[0];
  const groupedPutawayTasks = useMemo(() => {
    const groups = new Map<string, any>();
    for (const task of putawayTasks) {
      const key =
        task.grn_number ||
        task.grnNumber ||
        task.order_number ||
        task.asn_number ||
        task.asnNumber ||
        task.id;
      const group = groups.get(key) || {
        key,
        grn_number: task.grn_number || task.grnNumber,
        asn_number: task.asn_number || task.asnNumber,
        tasks: [],
        batches: new Set<string>(),
        materials: new Set<string>(),
        quantity: 0,
        uom: task.uom || "",
        status: task.status,
      };
      group.tasks.push(task);
      if (task.batch_number || task.batchNumber)
        group.batches.add(task.batch_number || task.batchNumber);
      if (task.material_name || task.item_code)
        group.materials.add(task.material_name || task.item_code);
      group.quantity += Number(
        task.stored_quantity ?? task.quantity ?? task.received_quantity ?? 0,
      );
      if (task.status !== "COMPLETED" && task.status !== "STORED") group.status = task.status;
      groups.set(key, group);
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      batch_count: group.batches.size,
      material_count: group.materials.size,
      material_names: Array.from(group.materials),
      batch_details: group.tasks.map((task: any) => ({
        batch_number: task.batch_number || task.batchNumber || "-",
        quantity: task.stored_quantity ?? task.quantity ?? task.received_quantity ?? 0,
        uom: task.uom || "PCS",
      })),
      status: group.tasks.every((task: any) =>
        ["COMPLETED", "PUTAWAY_COMPLETED", "STORED"].includes(
          String(task.status || "").toUpperCase(),
        ),
      )
        ? "COMPLETED"
        : group.tasks.some(
              (task: any) => String(task.status || "").toUpperCase() === "PARTIALLY_COMPLETED",
            )
          ? "PARTIALLY_COMPLETED"
          : group.tasks.every(
                (task: any) =>
                  task.destination_bin_id || task.destination_bin_code || task.destination_bin,
              )
            ? "ASSIGNED"
            : "PENDING",
    }));
  }, [putawayTasks]);
  const visiblePutawayBatches = (selectedPutawayGroup?.tasks || []).filter((task: any) =>
    putawayView === "assign" ? canAssignPutaway(task) : putawayView === "scan" ? canScanPutaway(task) : true);
  const visiblePutawayMaterials = new Set(visiblePutawayBatches.map((task: any) => task.item_code || task.material_name)).size;
  const visiblePutawayQuantity = visiblePutawayBatches.reduce((total: number, task: any) =>
    total + (putawayView === "assign" ? unassignedPutawayQuantity(task) : Number(task.quantity || 0)), 0);
  const totalAvailableStock = inventorySummary.reduce(
    (acc, i) => acc + Number(i.available || i.available_quantity || 0),
    0,
  );
  const handleAllocateDockFromLocations = async (requestId: string) => {
    const dockId = dockChoices[requestId];
    const storeId = dockStoreChoices[requestId];
    if (!dockId || !storeId) {
      toast.error("Select an available dock and warehouse for this gate entry.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.allocateDock(requestId, dockId, { assignedStoreId: storeId });
      toast.success("Dock allocated. Gate Entry has been notified.");
      await fetchData(true);
    } catch (error: any) {
      toast.error(error.message || "Unable to allocate dock");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReleaseDockFromLocations = async (dock: any) => {
    const allocationId = dock.current_allocation?.id;
    if (!allocationId) {
      toast.error("No active allocation is linked to this dock.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.releaseDock(allocationId);
      toast.success("Dock released. Gate Entry has been notified that it is empty.");
      await fetchData(true);
    } catch (error: any) {
      toast.error(error.message || "Unable to release dock");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell activeItem="/inventory">
      <div className="space-y-5 rounded-2xl bg-gradient-to-br from-slate-50 via-blue-50/50 to-teal-50/40 p-3 pb-8 sm:p-5">
        {/* Header Title Bar */}
        <div className="relative isolate flex min-h-[164px] flex-col justify-center gap-4 overflow-hidden rounded-2xl border border-[#0b315c] bg-[#0b315c] px-6 py-5 shadow-sm md:flex-row md:items-center md:justify-between md:px-8">
          <div aria-hidden="true" className="absolute inset-0 -z-20 bg-cover bg-[center_43%]" style={{ backgroundImage: `url(${warehouseHero})` }} />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#071d3df2_0%,#0b315ce8_38%,#0b315ca8_68%,#0b315c32_100%)]" />
          <div className="relative max-w-3xl text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-200">
              Warehouse Control <span className="px-1 text-blue-300/70">/</span> {pageHeader[activeTab].eyebrow}
            </p>
            <h1 className="mt-2 flex items-center gap-2.5 text-[25px] font-semibold tracking-tight md:text-[28px]">
              <PageHeaderIcon className="h-6 w-6 text-[#71b5ff]" />
              <span className="inline-flex items-center">{pageHeader[activeTab].title}<InformationTooltip help={inventoryHelp[activeTab]} placement="title" className="text-blue-100 hover:text-white" /></span>
            </h1>
            <p className="mt-1.5 text-sm text-blue-50/85">
              {pageHeader[activeTab].description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => void fetchData()}
              title={`Refresh ${pageHeader[activeTab].title}`}
              aria-label={`Refresh ${pageHeader[activeTab].title}`}
              className="border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* 7 Simple Warehouse Navbar Sub-Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => handleTabChange(v as TabType)}
          className="w-full"
        >
          {false && (
            <TabsList className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl flex flex-wrap gap-1 w-full justify-start border border-slate-200 dark:border-slate-800">
              <TabsTrigger value="dashboard" className="gap-2 px-4 py-2 text-xs font-semibold">
                <Boxes className="h-4 w-4" />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="putaway" className="gap-2 px-4 py-2 text-xs font-semibold">
                <PackageCheck className="h-4 w-4" />
                Putaway
                {pendingPutawayCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold px-1.5 py-0.2"
                  >
                    {pendingPutawayCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="inventory" className="gap-2 px-4 py-2 text-xs font-semibold">
                <Boxes className="h-4 w-4" />
                Inventory
              </TabsTrigger>
              <TabsTrigger value="requests" className="gap-2 px-4 py-2 text-xs font-semibold">
                <ClipboardList className="h-4 w-4" />
                Material Requests
                {pendingRequestsCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 bg-blue-500/15 text-blue-700 dark:text-blue-400 font-bold px-1.5 py-0.2"
                  >
                    {pendingRequestsCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="picking" className="gap-2 px-4 py-2 text-xs font-semibold">
                <ListOrdered className="h-4 w-4" />
                Picking
                {pendingPickingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 font-bold px-1.5 py-0.2"
                  >
                    {pendingPickingCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="locations" className="gap-2 px-4 py-2 text-xs font-semibold">
                <Building2 className="h-4 w-4" />
                Locations
              </TabsTrigger>
            </TabsList>
          )}

          {/* ========================================================================= */}
          {/* 1. DASHBOARD TAB */}
          {/* ========================================================================= */}
          <TabsContent value="dashboard" className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="rounded-xl border-emerald-200 border-t-4 border-t-emerald-600 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/30">
                <div className="flex items-center justify-between"><div className="flex items-center"><span className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Available stock</span><InformationTooltip help="availableStockKpi" /></div><CheckCircle2 className="size-5 text-emerald-600" /></div>
                <div className="mt-3 text-3xl font-bold leading-none tabular-nums text-slate-900 dark:text-slate-100">{totalAvailableStock.toLocaleString()}</div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Units ready for picking or issue</p>
              </Card>
              <Card className="rounded-xl border-amber-200 border-t-4 border-t-amber-500 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30">
                <div className="flex items-center justify-between"><div className="flex items-center"><span className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">Putaway to do</span><InformationTooltip help="putawayKpi" /></div><PackageCheck className="size-5 text-amber-600" /></div>
                <div className="mt-3 text-3xl font-bold leading-none tabular-nums text-slate-900 dark:text-slate-100">{pendingPutawayCount}</div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Open putaway tasks</p>
              </Card>
              <Card className="rounded-xl border-blue-200 border-t-4 border-t-blue-600 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/30">
                <div className="flex items-center justify-between"><div className="flex items-center"><span className="text-xs font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-200">Requests to review</span><InformationTooltip help="requestsReviewKpi" /></div><ClipboardList className="size-5 text-blue-600" /></div>
                <div className="mt-3 text-3xl font-bold leading-none tabular-nums text-slate-900 dark:text-slate-100">{pendingRequestsCount}</div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Waiting for warehouse review</p>
              </Card>
              <Card className="rounded-xl border-violet-200 border-t-4 border-t-violet-600 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm dark:border-violet-900/60 dark:bg-violet-950/30">
                <div className="flex items-center justify-between"><div className="flex items-center"><span className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">Picks to complete</span><InformationTooltip help="picksCompleteKpi" /></div><ListOrdered className="size-5 text-violet-600" /></div>
                <div className="mt-3 text-3xl font-bold leading-none tabular-nums text-slate-900 dark:text-slate-100">{pendingPickingCount}</div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Open picking tasks</p>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="rounded-xl border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50/60 p-5 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/20">
                <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900 dark:text-slate-100">Warehouse locations</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Your zones and storage bins</p></div><Building2 className="size-5 text-sky-700" /></div>
                <div className="flex gap-3">
                  <div className="min-w-28 flex-1 rounded-lg border border-blue-200 bg-blue-100/70 p-3"><p className="text-xs font-semibold uppercase text-blue-800">Zones</p><p className="mt-1 text-2xl font-bold text-blue-950">{zones.length}</p></div>
                  <div className="min-w-28 flex-1 rounded-lg border border-teal-200 bg-teal-100/70 p-3"><p className="text-xs font-semibold uppercase text-teal-800">Bins</p><p className="mt-1 text-2xl font-bold text-teal-950">{bins.length}</p></div>
                </div>
                <Button size="sm" variant="outline" className="mt-4 border-sky-300 bg-white hover:bg-sky-100" onClick={() => handleTabChange("locations")}>View zones and bins</Button>
              </Card>

              <Card className="rounded-xl border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50/60 p-5 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20">
                <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900 dark:text-slate-100">What needs attention</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Open work, grouped by task</p></div><ClipboardList className="size-5 text-indigo-600" /></div>
                <div className="space-y-2">
                  {[
                    { label: "Putaway tasks", count: pendingPutawayCount, tab: "putaway" as TabType, tone: "border-amber-200 bg-amber-50 text-amber-900" },
                    { label: "Material requests", count: pendingRequestsCount, tab: "requests" as TabType, tone: "border-blue-200 bg-blue-50 text-blue-900" },
                    { label: "Picking tasks", count: pendingPickingCount, tab: "picking" as TabType, tone: "border-violet-200 bg-violet-50 text-violet-900" },
                  ].map((item) => (
                    <button key={item.tab} type="button" onClick={() => handleTabChange(item.tab)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition hover:brightness-[0.98] ${item.tone}`}>
                      <span>{item.label}</span><span className="rounded-full bg-white/80 px-2.5 py-0.5 font-bold tabular-nums">{item.count}</span>
                    </button>
                  ))}
                </div>
              </Card>
            </div>

            <section aria-labelledby="warehouse-analytics-title" className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="warehouse-analytics-title" className="text-lg font-bold text-slate-900">Warehouse analytics</h2>
                  <p className="text-sm text-slate-600">A quick view of available stock and work waiting in your queues.</p>
                </div>
                <p className="text-xs font-medium text-slate-500">Based on the latest loaded records</p>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card className="border-cyan-200 bg-gradient-to-br from-cyan-50/80 via-white to-sky-50/60 p-5 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/20">
                  <div className="mb-2">
                    <h3 className="font-bold text-slate-900 dark:text-slate-100">Stock records by category</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Counts inventory records with available stock in each material category.</p>
                  </div>
                  {inventoryByCategory.length ? (
                    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(150px,0.8fr)]">
                      <div className="h-[250px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={inventoryByCategory} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                              {inventoryByCategory.map((entry, index) => (
                                <Cell key={entry.name} fill={["#0284c7", "#0d9488", "#4f46e5", "#d97706", "#db2777", "#64748b"][index % 6]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => [Number(value).toLocaleString(), "Stock records"]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2">
                        {inventoryByCategory.map((entry, index) => (
                          <div key={entry.name} className="flex items-center justify-between gap-3 rounded-lg border border-white/80 bg-white/75 px-3 py-2 text-sm shadow-sm">
                            <span className="flex min-w-0 items-center gap-2 text-slate-700"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: ["#0284c7", "#0d9488", "#4f46e5", "#d97706", "#db2777", "#64748b"][index % 6] }} /><span className="truncate">{entry.name}</span></span>
                            <span className="shrink-0 font-semibold tabular-nums text-slate-900">{entry.value.toLocaleString()} records</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid h-[250px] place-items-center rounded-xl border border-dashed border-cyan-200 bg-white/60 text-center text-sm text-slate-500">No available stock to chart yet.</div>
                  )}
                </Card>

                <Card className="border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-indigo-50/60 p-5 shadow-sm dark:border-violet-900/60 dark:bg-violet-950/20">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div><h3 className="font-bold text-slate-900 dark:text-slate-100">Open work by queue</h3><p className="text-sm text-slate-600 dark:text-slate-400">Compare tasks waiting for warehouse action.</p></div>
                    <span className="rounded-full border border-violet-200 bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">{totalOpenTasks} open items</span>
                  </div>
                  <div className="h-[250px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={openWorkByType} margin={{ top: 12, right: 12, left: -18, bottom: 4 }}>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#475569", fontSize: 12 }} />
                        <YAxis allowDecimals={false} width={38} tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 11 }} />
                        <Tooltip cursor={{ fill: "#eef2ff" }} formatter={(value) => [value, "Open tasks"]} />
                        <Bar dataKey="tasks" name="Open tasks" radius={[6, 6, 0, 0]} maxBarSize={58}>
                          {openWorkByType.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-1 rounded-lg border border-violet-100 bg-white/70 px-3 py-2 text-xs text-slate-600">
                    {totalOpenTasks === 0 ? "All warehouse queues are clear." : `${busiestQueue.name} has the most open work (${busiestQueue.tasks}). Select its queue in the sidebar to review tasks.`}
                  </p>
                </Card>
              </div>
            </section>
          </TabsContent>
          <TabsContent value="putaway" className="space-y-6 mt-6">
            <Card className="overflow-x-auto border-amber-200 bg-gradient-to-br from-amber-50/80 via-white to-orange-50/50 p-5 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 uppercase tracking-wider">
                Putaway Work Queue (Assign Storage Locations & Confirm)
              </h3>
              <table className="w-full min-w-[1440px] table-fixed text-left text-xs">
                <colgroup><col /><col className="w-[26%]" /><col /><col /><col className="w-[18%]" /><col /><col className="w-[360px]" /></colgroup>
                <thead>
                  <tr className="border-b border-sky-200 bg-sky-100/70 text-sky-950 uppercase dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
                    <th className="py-2.5 px-3">GRN / Task No</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Batch</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Remaining Qty</th>
                    <th className="py-2.5 px-3">Assigned Rack</th>
                    <th className="py-2.5 px-3">Status<InformationTooltip help="workflowStatus" /></th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {putawayTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        No putaway tasks pending. Post a GRN to generate putaway work.
                      </td>
                    </tr>
                  ) : (
                    groupedPutawayTasks.map((t, index) => (
                      <tr
                        key={t.id || t.key || `${t.grn_number || "putaway"}-${index}`}
                        className="hover:bg-slate-50 dark:hover:bg-slate-900/50"
                      >
                        <td className="py-3 px-3 font-semibold text-indigo-600">
                          {t.grn_number || t.key}
                        </td>
                        <td className="py-3 px-3 font-medium">
                          <button
                            type="button"
                            className="text-left hover:text-indigo-600"
                            onClick={() => openPutawayGroup(t)}
                          >
                            {t.material_names?.join(", ") || "-"}
                            {t.material_count > 1 && (
                              <span className="ml-1 text-slate-400">({t.material_count})</span>
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-500">
                          {t.batch_count ? (
                            <button
                              type="button"
                              className="underline hover:text-indigo-600"
                              onClick={() => openPutawayGroup(t)}
                            >
                              {t.batch_count} batch{t.batch_count === 1 ? "" : "es"}
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="py-3 px-3 font-bold">
                          {t.quantity ?? "—"} {t.uom || ""}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1">
                            {Array.from(new Set<string>(t.tasks.flatMap(assignedPutawayLocations))).map(code => <Badge key={code} variant="outline" className="bg-emerald-50 font-mono text-[10px] text-emerald-700">{code}</Badge>)}
                            {!t.tasks.some((task: any) => assignedPutawayLocations(task).length) && <span className="italic text-slate-400">Unassigned</span>}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              t.status === "COMPLETED" || t.status === "STORED"
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-amber-500/15 text-amber-700",
                            )}
                          >
                            {t.status || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="ml-auto grid w-[328px] grid-cols-3 items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => t.tasks.length === 1 ? openAssignPutaway(t.tasks[0]) : openPutawayGroup(t, "assign")}
                            disabled={!t.tasks.some(canAssignPutaway)}
                            className="h-8 w-full min-w-0 whitespace-nowrap px-2 text-xs border-indigo-200 text-indigo-700"
                          >
                            Assign Rack
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => t.tasks.length === 1 ? openPutawayScan(t.tasks[0]) : openPutawayGroup(t, "scan")}
                            disabled={!t.tasks.some(canScanPutaway)}
                            className="h-8 w-full min-w-0 whitespace-nowrap px-2 text-xs border-emerald-200 text-emerald-700"
                          >
                            <Scan className="mr-1 h-3 w-3" /> Scan QR
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openPutawayGroup(t)}
                            className="h-8 w-full min-w-0 whitespace-nowrap px-2 text-xs"
                          >
                            View Details
                          </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 3. INVENTORY TAB */}
          {/* ========================================================================= */}
          <TabsContent value="inventory" className="space-y-6 mt-6">
            <Card className="space-y-4 border-sky-200 bg-gradient-to-br from-sky-50/80 via-white to-cyan-50/50 p-5 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/20">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search material, code, batch..."
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    className="pl-9 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Select value={invWarehouseFilter} onValueChange={setInvWarehouseFilter}>
                    <SelectTrigger className="w-40 text-xs">
                      <SelectValue placeholder="Warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Warehouses</SelectItem>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.store_code || s.store_name}>
                          {s.store_code || s.store_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-sky-200 bg-sky-100/70 text-sky-950 uppercase dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
                      <th className="py-2.5 px-3">Material Code</th>
                      <th className="py-2.5 px-3">Material Name</th>
                      <th className="py-2.5 px-3">Batch</th>
                      <th className="py-2.5 px-3">Available<InformationTooltip help="inventory" /></th>
                      <th className="py-2.5 px-3">Location</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-6 text-slate-500">
                          No inventory stock records found.
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                          <td className="py-3 px-3 font-mono font-semibold text-indigo-600">
                            {item.material_code || "-"}
                          </td>
                          <td className="py-3 px-3 font-medium text-slate-900 dark:text-slate-100">
                            {item.material_name || item.material}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-500">
                            {item.batch_number ||
                              item.batch ||
                              item.batch_details?.map((b: any) => b.batch_number).join(", ") ||
                              "-"}
                          </td>
                          <td className="py-3 px-3 font-bold text-emerald-600">
                            Available: {getInventoryDisplayQuantity(item)} {item.uom || ""}
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {getInventoryDisplayLocation(item)}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedInventory(item);
                                void api
                                  .getMaterialInventoryDetail(String(item.material_code || ""))
                                  .then((detail: any) => {
                                    const firstLocation = Array.isArray(detail?.locations)
                                      ? detail.locations[0]
                                      : null;
                                    const putawayMovements = (
                                      Array.isArray(detail?.movements) ? detail.movements : []
                                    ).filter(
                                      (movement: any) => movement.movement_type === "PUTAWAY",
                                    );
                                    const movementBatches = putawayMovements
                                      .filter((movement: any) => movement.batch_lot)
                                      .map((movement: any) => ({
                                        batch_number: movement.batch_lot,
                                        quantity: movement.quantity,
                                        uom: movement.uom || detail?.summary?.uom,
                                      }));
                                    const refreshedRow = {
                                      batch_details: movementBatches,
                                      batch_number: movementBatches
                                        .map((b: any) => b.batch_number)
                                        .join(", "),
                                      available: detail?.summary?.available_stock,
                                      available_quantity: detail?.summary?.available_stock,
                                      total_quantity: detail?.summary?.total_stock,
                                      on_hand_quantity: detail?.summary?.total_stock,
                                      location_code: firstLocation?.location_code,
                                      bin_code:
                                        firstLocation?.bin_code || putawayMovements[0]?.to_location,
                                      location:
                                        firstLocation?.bin_code ||
                                        firstLocation?.location_code ||
                                        putawayMovements[0]?.to_location,
                                      uom: detail?.summary?.uom,
                                    };
                                    setInventorySummary((rows: any[]) =>
                                      rows.map((row: any) =>
                                        String(row.material_code || "").toUpperCase() ===
                                        String(item.material_code || "").toUpperCase()
                                          ? { ...row, ...refreshedRow }
                                          : row,
                                      ),
                                    );
                                    setSelectedInventory((current: any) =>
                                      current
                                        ? {
                                            ...current,
                                            inventory_history: detail?.inventory_history,
                                            batch_details: movementBatches.length
                                              ? movementBatches
                                              : detail?.batches || [],
                                            detail_movements: detail?.movements,
                                            warehouse:
                                              firstLocation?.store_name || detail?.warehouse,
                                            zone_code: firstLocation?.zone_code,
                                            bin_code:
                                              firstLocation?.bin_code ||
                                              putawayMovements[0]?.to_location,
                                            location:
                                              firstLocation?.location_code ||
                                              putawayMovements[0]?.to_location,
                                            total_quantity:
                                              detail?.summary?.total_stock ??
                                              current.total_quantity,
                                            available:
                                              detail?.summary?.available_stock ?? current.available,
                                            uom:
                                              detail?.summary?.uom ||
                                              firstLocation?.uom ||
                                              current.uom,
                                          }
                                        : current,
                                    );
                                  })
                                  .catch(() => undefined);
                              }}
                              className="h-7 text-xs text-indigo-600"
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> View Details
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 4. MATERIAL REQUESTS TAB */}
          {/* ========================================================================= */}
          <TabsContent value="requests" className="space-y-6 mt-6">
            <Card className="overflow-x-auto border-blue-200 bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/50 p-5 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 uppercase tracking-wider">
                Assembly Material Requisitions (Warehouse Approval & Reservation)
              <InformationTooltip help="reserved" /></h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-sky-200 bg-sky-100/70 text-sky-950 uppercase dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
                    <th className="py-2.5 px-3">Request No</th>
                    <th className="py-2.5 px-3">Assembly Order</th>
                    <th className="py-2.5 px-3">Material Required</th>
                    <th className="py-2.5 px-3">Required Qty</th>
                    <th className="py-2.5 px-3">Available Stock</th>
                    <th className="py-2.5 px-3">Status<InformationTooltip help="workflowStatus" /></th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {materialRequests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        No material requisitions pending.
                      </td>
                    </tr>
                  ) : (
                    materialRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="py-3 px-3 font-semibold text-indigo-600">
                          {req.request_number || req.id}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {req.assembly_order || req.assembly_order_number || "-"}
                        </td>
                        <td className="py-3 px-3 font-medium">
                          {req.material_name || req.material_code}
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100">
                          {req.quantity ?? req.required_quantity ?? "—"} {req.uom || ""}
                        </td>
                        <td className="py-3 px-3 font-bold text-emerald-600">
                          {req.available ?? req.available_quantity ?? "—"} {req.uom || ""}
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              req.status === "APPROVED"
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-blue-500/15 text-blue-700",
                            )}
                          >
                            {req.status || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {(req.status === "PENDING" ||
                            req.status === "SUBMITTED" ||
                            req.status === "PENDING_WAREHOUSE_APPROVAL") && (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                onClick={() => handleApproveMaterialRequest(req)}
                                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handlePartialApproveMaterialRequest(req)}
                                className="h-7 text-xs"
                              >
                                Partial
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRejectMaterialRequest(req)}
                                className="h-7 text-xs text-red-600"
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 5. PICKING TAB */}
          {/* ========================================================================= */}
          <TabsContent value="picking" className="space-y-6 mt-6">
            <AssemblyRequisitionsPanel onUpdated={() => fetchData(true)} />
            <Card className="overflow-x-auto border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-indigo-50/50 p-5 shadow-sm dark:border-violet-900/60 dark:bg-violet-950/20">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 uppercase tracking-wider">
                Warehouse Picking Queue (Operator Pick Tasks)
              <InformationTooltip help="pickRemaining" /></h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-violet-200 bg-violet-100/70 text-violet-950 uppercase dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-100">
                    <th className="py-2.5 px-3">Task No</th>
                    <th className="py-2.5 px-3">Assembly Order</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Pick Location</th>
                    <th className="py-2.5 px-3">Quantity</th>
                    <th className="py-2.5 px-3">Status<InformationTooltip help="workflowStatus" /></th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pickupTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        No pick tasks in queue. Approve a Material Request to generate pick tasks.
                      </td>
                    </tr>
                  ) : (
                    pickupTasks.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="py-3 px-3 font-semibold text-indigo-600">
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() => { setPickupFifoAlert(""); setPickupToConfirm(p); }}
                          >
                            {p.task_number || p.id}
                          </button>
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {p.assembly_order_number || p.assembly_order || "-"}
                        </td>
                        <td className="py-3 px-3 font-medium">
                          {p.material_name || p.material_code}
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant="outline" className="bg-slate-50 font-mono text-[10px]">
                            {p.pick_location || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 font-bold">
                          {p.quantity ?? "—"} {p.uom || ""}
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              p.status === "COMPLETED"
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-indigo-500/15 text-indigo-700",
                            )}
                          >
                            {p.status || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {p.status !== "COMPLETED" && (
                            <Button
                              size="sm"
                              onClick={() => { setPickupFifoAlert(""); setPickupToConfirm(p); }}
                              className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                            >
                              Confirm Pick
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 7. LOCATIONS TAB */}
          {/* ========================================================================= */}
          <TabsContent value="locations" className="space-y-6 mt-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-indigo-600" /> Zones & Racks
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Zone → Rack → Shelf/Position → Bin
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={openCreateZone}
                  className="gap-1 text-xs"
                >
                  <Plus className="h-3.5 w-3.5 text-indigo-600" /> Add Zone
                </Button>
              </div>
            </div>

            {false && (
              <Card className="p-5 space-y-4">
                <div>
                  <h3 className="text-base font-bold">Dock allocation for Gate Entry</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Allocate an available dock to an approved gate entry. Gate Security is notified
                    on allocation and release.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate({ to: "/dock-management" })}
                >
                  Manage docks
                </Button>
                {dockRequests.length > 0 && (
                  <div className="space-y-2">
                    {dockRequests.map((request) => (
                      <div
                        key={request.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                      >
                        <div className="min-w-48 flex-1 text-xs">
                          <strong>{request.vehicle_number}</strong> ·{" "}
                          {request.existing_gate_pass_id}
                        </div>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-xs"
                          value={dockChoices[request.id] || ""}
                          onChange={(event) =>
                            setDockChoices((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select available dock</option>
                          {docks
                            .filter((dock) => dock.status === "AVAILABLE")
                            .map((dock) => (
                              <option key={dock.id} value={dock.id}>
                                {dock.dock_code} · {dock.dock_name}
                              </option>
                            ))}
                        </select>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-xs"
                          value={dockStoreChoices[request.id] || ""}
                          onChange={(event) =>
                            setDockStoreChoices((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select warehouse</option>
                          {stores
                            .filter((store) => (store.status || "").toUpperCase() === "ACTIVE")
                            .map((store) => (
                              <option key={store.id} value={store.id}>
                                {store.store_name} · {store.store_code}
                              </option>
                            ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={isSubmitting || !stores.length}
                          onClick={() => void handleAllocateDockFromLocations(request.id)}
                        >
                          Allocate dock
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  {docks
                    .filter((dock) => ["OCCUPIED", "RESERVED"].includes(dock.status))
                    .map((dock) => (
                      <div
                        key={dock.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-xs"
                      >
                        <span>
                          <strong>{dock.dock_code}</strong>
                          {dock.current_allocation?.vehicle_number
                            ? ` · ${dock.current_allocation.vehicle_number}`
                            : ""}{" "}
                          · {dock.status}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSubmitting || !dock.current_allocation?.id}
                          onClick={() => void handleReleaseDockFromLocations(dock)}
                        >
                          Release dock
                        </Button>
                      </div>
                    ))}
                  {!dockRequests.length &&
                    !docks.some((dock) => ["OCCUPIED", "RESERVED"].includes(dock.status)) && (
                      <p className="text-xs text-muted-foreground">
                        No pending gate entries or active dock allocations.
                      </p>
                    )}
                </div>
              </Card>
            )}

            {zones.length === 0 ? (
              <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/50 p-8 text-center text-sm text-slate-600 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20">
                No zones configured yet. Use Add Zone to create the first zone.
              </Card>
            ) : (
              <div className="space-y-4">
                {zones.map((zone) => {
                  const zoneBins = allFlattenedBins.filter((bin) => bin.zone_id === zone.id);
                  const rackCount = new Set(zoneBins.map(bin => bin.rack_capacity?.id || bin.rack || bin.id)).size;
                  return (
                    <Card key={zone.id} className="overflow-hidden border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-sky-50/40 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-5 py-4">
                        <div>
                          <h3 className="font-bold text-slate-900">
                            {zone.zone_code}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                      {rackCount} {rackCount === 1 ? "rack" : "racks"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {zone.status || "ACTIVE"}
                          </Badge>
                          <Button
                            size="sm"
                            disabled={isSubmitting || String(zone.status || "ACTIVE").toUpperCase() !== "ACTIVE"}
                            onClick={() => void openCreateBin(zone)}
                            className="h-8 gap-1 bg-indigo-600 text-xs text-white hover:bg-indigo-700"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add Rack
                          </Button>
                        </div>
                      </div>
                      {zoneBins.length === 0 ? (
                        <p className="px-5 py-6 text-center text-sm text-slate-500">
                          No racks in this zone. Use Add Rack to add a storage location.
                        </p>
                      ) : (
                        <RackOccupancyCards bins={zoneBins} allBins={allFlattenedBins}
                          onAddMaterial={() => handleTabChange("putaway")}
                          zone={{ zone_code: zone.zone_code, zone_name: zone.zone_name }} onUpdated={() => fetchData(true)} />
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      <Dialog
        open={Boolean(pickupToConfirm)}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setPickupToConfirm(null);
            setPickupFifoAlert("");
            setPickupConfirmation({ material_scan: "", zone_scan: "", quantity: "" });
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pickupToConfirm?.status === "COMPLETED"
                ? "Picking Task Details"
                : "Confirm physical pick"}
            </DialogTitle>
            <DialogDescription>
              {pickupToConfirm?.status === "COMPLETED"
                ? "Read-only audit summary for the completed warehouse picking operation."
                : "Enter the scanned material and storage location codes and the quantity actually picked. Stock updates only after the server validates them."}
            </DialogDescription>
          </DialogHeader>
          {pickupToConfirm && (
            <form onSubmit={handleCompletePickup} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Task {pickupToConfirm.task_number || pickupToConfirm.id} ·{" "}
                {pickupToConfirm.material_name || pickupToConfirm.material_code}
              </p>
              {pickupFifoAlert && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p><strong>Older stock must be cleared first.</strong> {pickupFifoAlert}</p></div>}
              {pickupToConfirm.status === "COMPLETED" && (
                <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs">
                  <p>
                    <strong>Material:</strong>{" "}
                    {pickupToConfirm.material_name || pickupToConfirm.material_code} (
                    {pickupToConfirm.material_code})
                  </p>
                  <p>
                    <strong>Batch:</strong> {pickupToConfirm.batch_number || "Not recorded"}
                  </p>
                  <p>
                    <strong>Material QR:</strong>{" "}
                    {pickupToConfirm.confirmation?.material_qr || "Not recorded"}
                  </p>
                  <p>
                    <strong>Rack QR:</strong>{" "}
                    {pickupToConfirm.confirmation?.rack_qr ||
                      pickupToConfirm.pick_location ||
                      "Not recorded"}
                  </p>
                  <p>
                    <strong>Picked quantity:</strong>{" "}
                    {pickupToConfirm.picked_quantity ?? pickupToConfirm.quantity ?? 0}{" "}
                    {pickupToConfirm.uom || ""}
                  </p>
                  <p>
                    <strong>Confirmed by:</strong>{" "}
                    {pickupToConfirm.confirmation?.confirmed_by || "Not recorded"}
                  </p>
                  <p>
                    <strong>Completed:</strong>{" "}
                    {pickupToConfirm.confirmation?.confirmed_at
                      ? new Date(pickupToConfirm.confirmation.confirmed_at).toLocaleString()
                      : "Not recorded"}
                  </p>
                </div>
              )}
              {pickupToConfirm.status !== "COMPLETED" && (
                <>
                  <div className="space-y-2">
                    <span className="inline-flex items-center"><label className="text-xs font-semibold" htmlFor="pickup-material-scan">
                      Material code / QR scan
                    </label><InformationTooltip help="qr" /></span>
                    <Input
                      id="pickup-material-scan"
                      required
                      value={pickupConfirmation.material_scan}
                      onChange={(event) => {
                        setPickupFifoAlert("");
                        setPickupConfirmation((current) => ({
                          ...current,
                          material_scan: event.target.value,
                        }));
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="cursor-pointer font-semibold text-primary underline">
                        Upload QR
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg"
                          className="hidden"
                          onChange={(event) =>
                            event.target.files?.[0] &&
                            decodePickupQrUpload(event.target.files[0], "material")
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs"
                        onClick={() => void downloadQrValue(pickupMaterialQrValue, "Material QR")}
                      >
                        Download QR
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <span className="inline-flex items-center"><label className="text-xs font-semibold" htmlFor="pickup-zone-scan">
                      BIN / location code / QR scan
                    </label><InformationTooltip help="qr" /></span>
                    <Input
                      id="pickup-zone-scan"
                      required
                      value={pickupConfirmation.zone_scan}
                      onChange={(event) =>
                        setPickupConfirmation((current) => ({
                          ...current,
                          zone_scan: event.target.value,
                        }))
                      }
                    />
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="cursor-pointer font-semibold text-primary underline">
                        Upload QR
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg"
                          className="hidden"
                          onChange={(event) =>
                            event.target.files?.[0] &&
                            decodePickupQrUpload(event.target.files[0], "rack")
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs"
                        onClick={() => void downloadQrValue(pickupRackQrValue, "BIN QR")}
                      >
                        Download QR
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <span className="inline-flex items-center"><label className="text-xs font-semibold" htmlFor="pickup-quantity">
                      Quantity picked {pickupToConfirm.uom ? `(${pickupToConfirm.uom})` : ""}
                    </label><InformationTooltip help="pickRemaining" /></span>
                    <Input
                      id="pickup-quantity"
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      required
                      value={pickupConfirmation.quantity}
                      onChange={(event) =>
                        setPickupConfirmation((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                    />
                    {pickupToConfirm.requested_quantity != null && (
                      <p className="text-xs text-muted-foreground">
                        Requested: {pickupToConfirm.requested_quantity} {pickupToConfirm.uom || ""}{" "}
                        · Remaining:{" "}
                        {Math.max(
                          0,
                          Number(pickupToConfirm.requested_quantity) -
                            Number(
                              pickupToConfirm.picked_quantity ||
                                (pickupToConfirm.status === "COMPLETED"
                                  ? pickupToConfirm.requested_quantity
                                  : 0),
                            ),
                        )}{" "}
                        {pickupToConfirm.uom || ""}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Source rack: {pickupToConfirm.pick_location || "Not assigned"}
                    </p>
                    {pickupToConfirm.batch_number && (
                      <p className="text-xs text-muted-foreground">
                        Material batch: {pickupToConfirm.batch_number}
                      </p>
                    )}
                    {pickupToConfirm.confirmation?.confirmed && (
                      <p className="text-xs text-emerald-700">
                        Confirmed by{" "}
                        {pickupToConfirm.confirmation.confirmed_by || "Warehouse Operator"} on{" "}
                        {new Date(pickupToConfirm.confirmation.confirmed_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                </>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPickupToConfirm(null)}>
                  {pickupToConfirm.status === "COMPLETED" ? "Close" : "Cancel"}
                </Button>
                {pickupToConfirm.status !== "COMPLETED" && (
                  <Button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      !pickupConfirmation.material_scan.trim() ||
                      !pickupConfirmation.zone_scan.trim() ||
                      Number(pickupConfirmation.quantity) <= 0
                    }
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm pick"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 1. Assign Storage Location Modal */}
      <Dialog open={!!assignPutawayTask} onOpenChange={() => setAssignPutawayTask(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Storage Location</DialogTitle>
            <DialogDescription>
              Select destination rack for Putaway Task {assignPutawayTask?.grn_number}
            </DialogDescription>
          </DialogHeader>

          {assignPutawayTask && (
            <div className="space-y-4 text-xs py-2">
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {assignPutawayTask.material_name || "-"}
                </div>
                <div className="text-slate-500">
                  Quantity: {assignPutawayTask.quantity ?? "—"} {assignPutawayTask.uom || ""} |
                  Batch: {assignPutawayTask.batch_number || "—"}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Select
                  value={assignStoreId}
                  onValueChange={(value) => {
                    setAssignStoreId(value);
                    setAssignZoneId("");
                    setSelectedLocationId("");
                  }}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores
                      .filter((s) => !s.status || String(s.status).toUpperCase() === "ACTIVE")
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.store_code} - {s.store_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select
                  value={assignZoneId}
                  onValueChange={(value) => {
                    setAssignZoneId(value);
                    setSelectedLocationId("");
                  }}
                  disabled={!assignStoreId}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones
                      .filter(
                        (z) =>
                          z.store_id === assignStoreId &&
                          (!z.status || String(z.status).toUpperCase() === "ACTIVE"),
                      )
                      .map((z) => (
                        <SelectItem key={z.id} value={z.id}>
                          {z.zone_code || z.zone_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedLocationId}
                  onValueChange={setSelectedLocationId}
                  disabled={!assignZoneId}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select active rack" />
                  </SelectTrigger>
                  <SelectContent>
                    {allFlattenedBins
                      .filter(
                        (loc) =>
                          loc.store_id === assignStoreId &&
                          loc.zone_id === assignZoneId &&
                          isAssignableRack(loc.status),
                      )
                      .map((loc) => (
                        <SelectItem key={loc.id} value={loc.id} disabled={typeof loc.rack_capacity?.available_capacity === "number" && loc.rack_capacity.available_capacity <= 0}>
                          {loc.rack || loc.bin_code} ({loc.bin_code}){typeof loc.rack_capacity?.available_capacity === "number" ? ` / ${loc.rack_capacity.available_capacity} PCS available` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="font-semibold">
                  Assign Quantity ({assignPutawayTask.uom || "PCS"})
                </label>
                <Input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  max={unassignedPutawayQuantity(assignPutawayTask)}
                  value={assignQuantity}
                  onChange={(event) => setAssignQuantity(event.target.value)}
                />
                <p className="text-xs text-slate-500">
                  Unassigned in selected batch: {unassignedPutawayQuantity(assignPutawayTask)} {assignPutawayTask.uom || "PCS"}{" "}
                  · Remaining:{" "}
                  {Math.max(
                    0,
                    unassignedPutawayQuantity(assignPutawayTask) - Number(assignQuantity || 0),
                  )}{" "}
                  {assignPutawayTask.uom || "PCS"}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignPutawayTask(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAssignPutaway}
              disabled={
                isSubmitting ||
                !assignStoreId ||
                !assignZoneId ||
                !selectedLocationId ||
                !Number.isFinite(Number(assignQuantity)) ||
                Number(assignQuantity) <= 0 ||
                Number(assignQuantity) > (assignPutawayTask ? unassignedPutawayQuantity(assignPutawayTask) : 0)
              }
              className="bg-indigo-600 text-white"
            >
              ASSIGN RACK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 1b. Scan and confirm physical BIN putaway */}
      <Dialog open={!!scanPutawayTask} onOpenChange={() => setScanPutawayTask(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Scan Material & BIN</DialogTitle>
            <DialogDescription>
              Scan the existing material QR first, then scan the assigned BIN QR.
            </DialogDescription>
          </DialogHeader>
          {scanPutawayTask && (
            <div className="space-y-4 text-xs">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                <div className="font-semibold">
                  {scanPutawayTask.material_name || scanPutawayTask.item_code}
                </div>
                <div className="text-slate-500">
                  GRN: {scanPutawayTask.grn_number || "-"} · Batch:{" "}
                  {scanPutawayTask.batch_number || "-"}
                </div>
                <div className="mt-1 font-semibold">
                  Pending: {scanPutawayTask.quantity} {scanPutawayTask.uom || ""}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="inline-flex items-center"><label className="font-semibold">Material QR</label><InformationTooltip help="qr" /></span>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    value={putawayScan.materialQr}
                    placeholder="Scan material QR"
                    onChange={(e) => {
                      setMaterialQrVerified(false);
                      setPutawayScan((s) => ({ ...s, materialQr: e.target.value }));
                    }}
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCameraField("material")}
                  >
                    <Camera className="mr-1 h-4 w-4" />
                    Scan with Camera
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer text-xs text-primary underline">
                    Upload QR Image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="hidden"
                      onChange={(e) =>
                        e.target.files?.[0] && decodeQrUpload(e.target.files[0], "material")
                      }
                    />
                  </label>
                  {materialQrVerified && (
                    <span className="font-semibold text-emerald-600">✓ Verified</span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="font-semibold">BIN QR</label>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    value={putawayScan.binQr}
                    placeholder="Scan BIN QR"
                    onChange={(e) => {
                      setBinQrVerified(false);
                      setPutawayScan((s) => ({ ...s, binQr: e.target.value }));
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCameraField("bin")}
                  >
                    <Camera className="mr-1 h-4 w-4" />
                    Scan with Camera
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer text-xs text-primary underline">
                    Upload QR Image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="hidden"
                      onChange={(e) =>
                        e.target.files?.[0] && decodeQrUpload(e.target.files[0], "bin")
                      }
                    />
                  </label>
                  {binQrVerified && (
                    <span className="font-semibold text-emerald-600">✓ Verified</span>
                  )}
                </div>
                {qrScanError && <p className="text-xs text-rose-600">{qrScanError}</p>}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  disabled={!putawayQrImages.bin}
                  onClick={() =>
                    putawayQrImages.bin &&
                    setQrPreview({ title: "BIN QR", image: putawayQrImages.bin })
                  }
                >
                  View QR
                </Button>
              </div>
              <div className="space-y-1.5">
                <label className="font-semibold">
                  Stored quantity {scanPutawayTask.uom ? `(${scanPutawayTask.uom})` : ""}
                </label>
                <Input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  max={scanPutawayTask.quantity}
                  value={putawayScan.quantity}
                  onChange={(e) => setPutawayScan((s) => ({ ...s, quantity: e.target.value }))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScanPutawayTask(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmPutaway}
              disabled={isSubmitting || !putawayScanValid}
              className="bg-emerald-600 text-white"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Putaway"}
            </Button><InformationTooltip help="putaway" />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cameraField} onOpenChange={(open) => !open && setCameraField(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan {cameraField === "material" ? "Material" : "BIN"} QR</DialogTitle>
            <DialogDescription>
              Allow camera access and hold the QR label inside the frame.
            </DialogDescription>
          </DialogHeader>
          <video ref={cameraVideoRef} className="w-full rounded-xl bg-black" playsInline muted />
          <canvas ref={cameraCanvasRef} className="hidden" />
          {cameraError && <p className="text-sm text-rose-600">{cameraError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCameraField(null)}>
              Use Manual Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrPreview} onOpenChange={(open) => !open && setQrPreview(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-xs">
          <DialogHeader>
            <DialogTitle>{qrPreview?.title}</DialogTitle>
          </DialogHeader>
          {qrPreview?.image && (
            <>
              <img
                src={qrPreview.image}
                alt={qrPreview.title}
                className="mx-auto h-56 w-56 rounded-lg border bg-white p-3"
              />
              <a
                href={qrPreview.image}
                download={`${qrPreview.title.replaceAll(" ", "-").toLowerCase()}.png`}
                className="mx-auto block text-center text-sm font-semibold text-primary underline"
              >
                Download QR Image
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedPutawayGroup} onOpenChange={() => setSelectedPutawayGroup(null)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{putawayView === "assign" ? "Assign Rack / Select Batch" : putawayView === "scan" ? "Scan QR / Select Assigned Batch" : "Putaway Details"}</DialogTitle>
            <DialogDescription>{selectedPutawayGroup?.grn_number || "GRN"}</DialogDescription>
          </DialogHeader>
          {selectedPutawayGroup && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-4">
                <div>
                  <span className="text-xs text-muted-foreground">GRN Number</span>
                  <p className="font-mono font-bold">{selectedPutawayGroup.grn_number || ""}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Materials</span>
                  <p className="font-bold">{visiblePutawayMaterials}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Batches</span>
                  <p className="font-bold">{visiblePutawayBatches.length}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{putawayView === "assign" ? "Quantity to Assign" : "Remaining to Put Away"}</span>
                  <p className="font-bold">
                    {visiblePutawayQuantity} {selectedPutawayGroup.uom}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{putawayView === "assign" ? "Only batches with unassigned quantities are shown. Select a batch to assign its remaining quantity to a rack." : putawayView === "scan" ? "Only assigned, unfinished batches are shown. Select a batch to scan its material and rack QR and confirm putaway." : "Review all material batches, remaining quantities, assigned locations, and completion statuses."}</p>
              <PutawayBatchTable mode={putawayView} tasks={selectedPutawayGroup.tasks} onAssign={openAssignPutaway} onScan={openPutawayScan} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 2. Inventory Detail Modal */}
      <Dialog open={!!selectedInventory} onOpenChange={() => setSelectedInventory(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedInventory?.material_name ||
                selectedInventory?.material ||
                "Material Details"}
            </DialogTitle>
          </DialogHeader>

          {selectedInventory && (
            <div className="space-y-4 text-xs py-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500">Material Code:</span>
                  <div className="font-mono font-semibold">
                    {selectedInventory.material_code || "-"}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Batch:</span>
                  <div className="font-mono font-semibold">
                    {selectedInventory.batch_details?.length
                      ? selectedInventory.batch_details.map((b: any) => b.batch_number).join(", ")
                      : selectedInventory.batch_number || selectedInventory.batch || "-"}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                  Storage Location
                </div>
                <div className="font-semibold">
                  {selectedInventory.warehouse || selectedInventory.warehouse_id || "-"} →{" "}
                  {selectedInventory.zone_code || selectedInventory.zone_name || "-"} →{" "}
                  {selectedInventory.bin_code || selectedInventory.location || "-"}
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-2">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                  Batch-wise Stock
                </div>
                {(selectedInventory.batch_details || []).length > 0 ? (
                  selectedInventory.batch_details.map((batch: any) => (
                    <div
                      key={batch.batch_number}
                      className="flex justify-between border-b last:border-0 pb-1 last:pb-0"
                    >
                      <span className="font-mono">{batch.batch_number}</span>
                      <span className="font-semibold">
                        {batch.quantity} {batch.uom || selectedInventory.uom || ""}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500">No batch movement details available.</div>
                )}
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-2">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                  Stock
                </div>
                <div className="flex justify-between font-medium">
                  <span>Total Physical Stock:</span>
                  <span className="font-bold">
                    {selectedInventory.total_quantity ?? selectedInventory.on_hand_quantity ?? "—"}{" "}
                    {selectedInventory.uom || ""}
                  </span>
                </div>
                <div className="flex justify-between font-medium text-emerald-600">
                  <span>Available Stock:</span>
                  <span className="font-bold">
                    {selectedInventory.available ?? selectedInventory.available_quantity ?? "—"}{" "}
                    {selectedInventory.uom || ""}
                  </span>
                </div>
              </div>

              {selectedInventory.inventory_history && (
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                  <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                    Inventory History
                  </div>
                  <div>
                    Original GRN:{" "}
                    <span className="font-semibold">
                      {selectedInventory.inventory_history.original_grn || "-"}
                    </span>
                  </div>
                  <div>
                    Batch:{" "}
                    <span className="font-mono font-semibold">
                      {selectedInventory.inventory_history.batch_number || "-"}
                    </span>
                  </div>
                  <div>
                    Previous Rack Location:{" "}
                    <span className="font-semibold">
                      {selectedInventory.inventory_history.original_rack || "-"}
                    </span>
                  </div>
                  <div>
                    Received Quantity:{" "}
                    <span className="font-semibold">
                      {selectedInventory.inventory_history.received_quantity}{" "}
                      {selectedInventory.uom || ""}
                    </span>
                  </div>
                  <div>
                    Issued to Assembly:{" "}
                    <span className="font-semibold">
                      {selectedInventory.inventory_history.issued_quantity}{" "}
                      {selectedInventory.uom || ""}
                    </span>
                  </div>
                  <div>
                    Remaining Quantity:{" "}
                    <span className="font-semibold">
                      {selectedInventory.inventory_history.remaining_quantity}{" "}
                      {selectedInventory.uom || ""}
                    </span>
                  </div>
                  <div>
                    Picking Task:{" "}
                    <span className="font-mono font-semibold">
                      {selectedInventory.inventory_history.picking_task || "-"}
                    </span>
                  </div>
                </div>
              )}

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                  Location
                </div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {selectedInventory.bin_code || selectedInventory.location || "-"}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 3. Bin QR & Placed Material Inspector Modal */}
      <Dialog open={!!viewBinQrModal} onOpenChange={() => setViewBinQrModal(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-600">
              <QrCode className="h-5 w-5" /> Storage Location & Placed Material Inspector
            </DialogTitle>
            <DialogDescription>
              Scanned location details and real-time physical stock placed in this location.
            </DialogDescription>
          </DialogHeader>

          {viewBinQrModal &&
            (() => {
              const bCode = viewBinQrModal.bin_code;
              const locationZone = zones.find(
                (zone) => String(zone.id) === String(viewBinQrModal.zone_id),
              );
              const placedItems = inventorySummary.filter((item) => {
                const itemLoc = (item.bin_code || item.location || "").toLowerCase();
                return itemLoc.includes(bCode.toLowerCase());
              });

              const qrCodeVal = viewBinQrModal.qr_identifier;

              return (
                <div className="space-y-4 text-xs py-2">
                  <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="p-3 bg-white rounded-lg border-2 border-indigo-600 shadow-inner flex flex-col items-center">
                      {binQrImage ? (
                        <img
                          src={binQrImage}
                          alt={`QR code for ${viewBinQrModal.bin_code}`}
                          className="h-32 w-32"
                        />
                      ) : (
                        <p className="h-32 w-32 flex items-center justify-center text-center text-[10px] text-muted-foreground">
                          QR code unavailable for this bin
                        </p>
                      )}
                    </div>
                    <div className="space-y-1 flex-1 text-center sm:text-left">
                      <div className="text-[11px] font-bold text-indigo-600 font-mono">
                        {qrCodeVal}
                      </div>
                      <h4 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                        {viewBinQrModal.bin_code}
                      </h4>
                      <p className="text-slate-500 font-medium">
                        Zone:{" "}
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {locationZone?.zone_name || locationZone?.zone_code || "—"}
                        </span>
                      </p>
                      <p className="text-slate-500 font-medium">
                        Rack:{" "}
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {viewBinQrModal.rack || "—"}
                        </span>{" "}
                        | Shelf:{" "}
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {viewBinQrModal.position || "—"}
                        </span>
                      </p>
                      <Badge className="bg-emerald-500/15 text-emerald-700 text-[10px] font-bold uppercase mt-1">
                        STATUS: {viewBinQrModal.status || "UNKNOWN"}
                      </Badge>
                      <div className="flex flex-wrap justify-center gap-2 pt-3 sm:justify-start">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!binQrImage}
                          onClick={() => void downloadQrValue(qrCodeVal || "", `Bin QR ${bCode}`)}
                        >
                          <Download className="mr-2 h-4 w-4" /> Download QR
                        </Button>
                        <Button size="sm" disabled={!binQrImage} onClick={printBinQr}>
                          <Printer className="mr-2 h-4 w-4" /> Print QR
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Boxes className="h-4 w-4 text-indigo-600" /> Placed Materials in Location (
                        {placedItems.length})
                      </h4>
                      {placedItems.length > 0 ? (
                        <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                          {placedItems.reduce(
                            (acc, i) => acc + Number(i.available ?? i.total_quantity ?? 0),
                            0,
                          )}{" "}
                          {placedItems[0]?.uom || ""} STORED
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-500 text-[10px]">
                          LOCATION IS EMPTY
                        </Badge>
                      )}
                    </div>

                    <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase text-[10px]">
                          <tr>
                            <th className="py-2 px-3">Material</th>
                            <th className="py-2 px-3">Batch</th>
                            <th className="py-2 px-3">Quantity</th>
                            <th className="py-2 px-3">Source GRN</th>
                            <th className="py-2 px-3">Status<InformationTooltip help="workflowStatus" /></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                          {placedItems.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center py-6 text-slate-400">
                                No materials currently placed in this location. Ready for Putaway.
                              </td>
                            </tr>
                          ) : (
                            placedItems.map((item, idx) => (
                              <tr
                                key={idx}
                                className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                              >
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-slate-900 dark:text-slate-100">
                                    {item.material_name || item.material}
                                  </div>
                                  <div className="font-mono text-[10px] text-slate-400">
                                    {item.material_code || "-"}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-indigo-600">
                                  {item.batch_number || item.batch || "-"}
                                </td>
                                <td className="py-2.5 px-3 font-bold text-emerald-600">
                                  {item.available ?? item.total_quantity ?? 0} {item.uom || ""}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-500">
                                  {item.grn_number || "-"}
                                </td>
                                <td className="py-2.5 px-3">
                                  <Badge className="text-[9px] font-bold uppercase">
                                    {item.status || "UNKNOWN"}
                                  </Badge>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>

      {/* 4. Create Location Entity Modal (Add Zone, Add Bin) */}
      <Dialog
        open={!!createLocationType}
        onOpenChange={(open) => {
          if (!open) {
            setCreateLocationType(null);
            setEditingZone(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-indigo-600" />
              {createLocationType === "zone" && (editingZone ? "Edit Storage Zone" : "Add New Storage Zone")}
              {createLocationType === "bin" && "Add Rack (Capacity & Auto QR)"}
            </DialogTitle>
            <DialogDescription>
              {createLocationType === "zone" && (editingZone ? "Update the zone name. The generated zone code remains unchanged." : "Define a storage zone.")}
              {createLocationType === "bin" &&
                "Set the maximum capacity. Rack code, bin code, and QR code are generated automatically."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateLocationSubmit} className="space-y-4 text-xs py-2">
            {createLocationType === "zone" && (
              <>
                {!editingZone && !stores.length && (
                  <div className="space-y-3 rounded-lg border p-3">
                    <p className="text-muted-foreground">Set up the warehouse with your first zone.</p>
                    <div className="space-y-1">
                      <label htmlFor="first-warehouse-name" className="font-semibold">Warehouse name</label>
                      <Input id="first-warehouse-name" required maxLength={128}
                        value={firstWarehouse.name} onChange={(event) => setFirstWarehouse({ ...firstWarehouse, name: event.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="first-warehouse-location" className="font-semibold">Location / plant</label>
                      <Input id="first-warehouse-location" required maxLength={64}
                        value={firstWarehouse.location} onChange={(event) => setFirstWarehouse({ ...firstWarehouse, location: event.target.value })} />
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Zone Code</label>
                  <Input
                    value={newZoneForm.zone_code}
                    readOnly
                    className="bg-slate-50 font-mono"
                  />
                </div>
              </>
            )}

            {createLocationType === "bin" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Zone</label>
                  <div className="rounded-md border bg-slate-50 px-3 py-2 text-slate-700">
                    {zones.find((zone) => zone.id === newBinForm.zone_id)?.zone_code} - {zones.find((zone) => zone.id === newBinForm.zone_id)?.zone_name}
                  </div>
                </div>
                <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-rack-code" className="block text-sm leading-5">Rack Code (auto-generated)</Label>
                    <Input id="new-rack-code" className="h-11 w-full bg-slate-50 font-mono" readOnly value={newBinRows[0].rack} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-rack-capacity" className="block text-sm leading-5">Maximum Capacity (PCS) *</Label>
                    <Input id="new-rack-capacity" className="h-11 w-full" type="number" min={1} max={2147483647} step={1} required placeholder="80" value={newBinRows[0].capacity} onChange={e => setNewBinRows([{ ...newBinRows[0], capacity: e.target.value }])} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-rack-bin-code" className="block text-sm leading-5">Bin Code (auto-generated)</Label>
                    <Input id="new-rack-bin-code" className="h-11 w-full" readOnly value={newBinRows[0].bin_code} />
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateLocationType(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-indigo-600 text-white">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                ) : createLocationType === "bin" ? (
                  "Create Rack"
                ) : (
                  editingZone ? "Save Changes" : `Create ${createLocationType?.toUpperCase()}`
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
