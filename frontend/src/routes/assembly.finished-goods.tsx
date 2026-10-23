import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyFinishedGoodItem,
  type AssemblyFinishedGoodDetail,
} from "@/lib/api-client";
import QRCode from "qrcode";
import {
  Copy,
  Download,
  LayoutDashboard,
  Eye,
  PackageCheck,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assembly/finished-goods")({
  beforeLoad: () =>
    requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER", "STORE_MANAGER", "QUALITY"]),
  head: () => ({ meta: [{ title: "Finished Goods · KaizenAssests" }] }),
  component: AssemblyFinishedGoodsPage,
});

function AssemblyFinishedGoodsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AssemblyFinishedGoodItem[]>([]);
  const [detailsFg, setDetailsFg] = useState<AssemblyFinishedGoodItem | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  // Print Label Modal State
  const [selectedFg, setSelectedFg] = useState<AssemblyFinishedGoodDetail | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [labelLoading, setLabelLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const fetchItems = useCallback(async (isManual = false, background = false) => {
    if (isManual) setRefreshing(true);
    else if (!background) setLoading(true);
    try {
      const res = await api.getAssemblyFinishedGoods({
        group_by: "product",
      } as any);
      setItems(res || []);
    } catch (err: any) {
      if (!background)
        toast.error("Failed to load Finished Goods: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
    const sync = () => {
      if (document.visibilityState !== "hidden") void fetchItems(false, true);
    };
    const timer = window.setInterval(sync, 15000);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
  }, [fetchItems]);

  const handleOpenPrintModal = async (item: AssemblyFinishedGoodItem) => {
    try {
      setLabelLoading(true);
      const detail = await api.getAssemblyFinishedGoodsDetail(item.id);
      setSelectedFg(detail);

      const qrText =
        detail.qr_code || `FG|${detail.product_code}|${detail.order_number}|QTY:${detail.quantity}`;
      const url = await QRCode.toDataURL(qrText, {
        width: 256,
        margin: 1,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      });
      setQrDataUrl(url);
    } catch (err: any) {
      toast.error("Failed to generate label QR: " + (err.message || "Unknown error"));
    } finally {
      setLabelLoading(false);
    }
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const printContents = printRef.current.innerHTML;
    const printWindow = window.open("", "_blank", "width=600,height=600");
    if (!printWindow) {
      toast.error("Please allow popups to print the label");
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Finished Good Label - ${selectedFg?.serial_number || "FG"}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 16px; background: #fff; color: #000; }
            .label-box { border: 2px solid #000; padding: 16px; width: 380px; margin: 0 auto; box-sizing: border-box; }
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
            .header h2 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
            .header p { margin: 2px 0 0 0; font-size: 10px; color: #555; }
            .qr-center { text-align: center; margin: 12px 0; }
            .qr-center img { width: 140px; height: 140px; }
            .field-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; }
            .field-label { font-weight: bold; }
            .field-val { font-family: monospace; font-weight: bold; }
            .stamp { text-align: center; border: 1px dashed #16a34a; color: #16a34a; padding: 4px; font-size: 11px; font-weight: bold; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="label-box">
            ${printContents}
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadLabel = () => {
    if (!qrDataUrl || !selectedFg) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `${selectedFg.batch_number || selectedFg.serial_number || "finished-good"}-qr.png`;
    link.click();
  };

  // Filtered list
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase().trim();
    return items.filter(
      (fg: any) =>
        fg.order_number?.toLowerCase().includes(q) ||
        fg.product_name?.toLowerCase().includes(q) ||
        fg.product_code?.toLowerCase().includes(q) ||
        fg.serial_number?.toLowerCase().includes(q) ||
        fg.batch_number?.toLowerCase().includes(q) ||
        fg.location_code?.toLowerCase().includes(q) ||
        fg.batches?.some((batch: any) =>
          [batch.batch_number, batch.order_number, batch.serial_number, batch.location_code].some(
            (value) => value?.toLowerCase().includes(q),
          ),
        ),
    );
  }, [items, search]);

  const detailBatches = useMemo(() => {
    const timestamp = (batch: AssemblyFinishedGoodItem) => {
      const value = Date.parse(batch.posted_at || "");
      return Number.isFinite(value) ? value : Infinity;
    };
    return detailsFg
      ? [...((detailsFg as any).batches || [detailsFg])].sort(
          (a, b) => timestamp(a) - timestamp(b) || a.id.localeCompare(b.id),
        )
      : [];
  }, [detailsFg]);

  return (
    <AppShell
      title="Finished Goods Records"
      subtitle="Assembly FG storage tracking, customer dispatch readiness, and QR label generation"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/assembly-dashboard" as any })}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80 font-medium"
          >
            <LayoutDashboard className="size-3.5 text-primary" />
            Dashboard
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/assembly/quality" as any })}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80 font-medium"
          >
            <ShieldCheck className="size-3.5 text-purple-500" />
            Quality Checks
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchItems(true)}
            disabled={refreshing}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-primary")} />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="min-w-0 space-y-6">
        {/* Main Work Center Table Card */}
        <div className="min-w-0 rounded-2xl border border-border/70 bg-card p-5 shadow-soft space-y-4">
          {/* Header & Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/60">
            <p className="text-xs text-muted-foreground">
              Showing <strong className="text-foreground">{filteredItems.length}</strong> of{" "}
              {items.length} products
            </p>

            {/* Search input */}
            <div className="relative w-full sm:w-80 sm:shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                aria-label="Search finished goods"
                placeholder="Search batch, product or order..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-xl border border-border bg-card pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
              {search && (
                <button
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Table Content */}
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="size-6 animate-spin text-primary mx-auto opacity-70" />
              <p className="text-xs text-muted-foreground">Loading Finished Goods inventory...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-14 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-muted mx-auto mb-3 text-muted-foreground">
                <PackageCheck className="size-6 opacity-60" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {search
                  ? "No finished goods match your search"
                  : "No Finished Goods in storage yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {search
                  ? "Try searching by another product name or order number."
                  : "Completed orders certified by Quality Inspection are automatically deposited into this vault."}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  className="rounded-xl text-xs gap-1.5 font-semibold"
                  onClick={() => navigate({ to: "/assembly/quality" as any })}
                >
                  <ShieldCheck className="size-3.5" />
                  View Quality Checks
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full min-w-[800px] text-left text-xs">
                <thead className="bg-muted/50">
                  <tr className="border-b border-border/70 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="py-3 px-4">
                      Product
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Produced
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Available
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Reserved
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Dispatched
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Status
                    <InformationTooltip help="finishedGoods" /></th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredItems.map((fg) => (
                    <tr key={fg.id} className="group hover:bg-muted/40 transition-colors">
                      {/* Product */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-foreground text-xs">
                          {fg.product_name}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          {fg.product_code}
                        </div>
                      </td>

                      {[
                        (fg as any).produced_quantity ?? fg.quantity,
                        (fg as any).available_quantity ?? fg.quantity,
                        (fg as any).reserved_quantity ?? 0,
                        (fg as any).dispatched_quantity ?? 0,
                      ].map((quantity, index) => (
                        <td
                          key={index}
                          className="py-3.5 px-4 text-right whitespace-nowrap tabular-nums font-semibold"
                        >
                          {quantity.toLocaleString()}{" "}
                          <span className="text-muted-foreground font-normal">{fg.uom}</span>
                        </td>
                      ))}

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            ((fg as any).available_quantity ?? 0) > 0
                              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                          )}
                        >
                          {((fg as any).available_quantity ?? 0) > 0 ? "AVAILABLE" : "OUT OF STOCK"}
                        </span>
                      </td>

                      {/* Label Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-xl px-3 text-xs gap-1.5"
                            onClick={() => {
                              setExpandedBatches([]);
                              setDetailsFg(fg);
                            }}
                          >
                            <Eye className="size-3.5" /> View Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        <Dialog open={!!detailsFg} onOpenChange={(open) => !open && setDetailsFg(null)}>
          <DialogContent className="flex w-[calc(100vw-2rem)] max-w-4xl max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0">
            <DialogHeader className="shrink-0 border-b border-border/60 p-5 pr-10">
              <DialogTitle>Finished Goods Details</DialogTitle>
              <DialogDescription className="text-xs">
                {detailsFg?.product_name} ({detailsFg?.product_code})
              </DialogDescription>
              <dl className="grid grid-cols-3 gap-3 pt-3 text-left text-xs">
                {[
                  ["Produced", (detailsFg as any)?.produced_quantity ?? detailsFg?.quantity],
                  ["Available", (detailsFg as any)?.available_quantity],
                  ["Reserved", (detailsFg as any)?.reserved_quantity],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-muted/40 p-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-semibold text-foreground">
                      {value == null ? "Unavailable" : Number(value).toLocaleString()}{" "}
                      {detailsFg?.uom}
                    </dd>
                  </div>
                ))}
              </dl>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
              <p className="py-3 text-xs text-muted-foreground">
                FIFO: oldest stock received first, matching dispatch allocation. Zero available
                stock cannot be newly allocated.
              </p>
              <table className="w-full min-w-[650px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-muted text-[11px] uppercase text-muted-foreground">
                  <tr>
                    {["Batch ID", "Manufacturing Date", "Available Qty", "Reserved Qty", "Status", "QR Label"].map(
                      (label) => (
                        <th key={label} className="border-b px-3 py-3 last:text-right">
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {detailBatches.map((batch) => {
                    const expanded = expandedBatches.includes(batch.id);
                    const available = Number(batch.available_quantity ?? batch.quantity);
                    const reserved = Number(batch.reserved_quantity ?? 0);
                    return (
                      <Fragment key={batch.id}>
                        <tr className="align-top">
                          <td className="px-3 py-3">
                            <p className="font-mono font-semibold">
                              {batch.batch_number || batch.serial_number || batch.order_number}
                            </p>
                            <button
                              type="button"
                              className="mt-2 text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2"
                              aria-expanded={expanded}
                              aria-controls={`batch-details-${batch.id}`}
                              onClick={() =>
                                setExpandedBatches((rows) =>
                                  expanded
                                    ? rows.filter((id) => id !== batch.id)
                                    : [...rows, batch.id],
                                )
                              }
                            >
                              {expanded ? "Hide details" : "Batch details"}
                            </button>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {batch.manufacturing_date
                              ? new Date(batch.manufacturing_date).toLocaleDateString()
                              : "Unavailable"}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap tabular-nums font-semibold">
                            {available.toLocaleString()} {batch.uom}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap tabular-nums font-semibold text-blue-700">
                            {reserved.toLocaleString()} {batch.uom}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={cn(
                                "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                reserved > 0
                                  ? "border-blue-200 bg-blue-50 text-blue-700"
                                  : available > 0
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                                  : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300",
                              )}
                            >
                              {reserved > 0 ? (available > 0 ? "Partially Reserved" : "Reserved for Dispatch") : available > 0 ? "Available" : "Out of stock"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-xl text-xs gap-1.5"
                              onClick={() => {
                                setDetailsFg(null);
                                void handleOpenPrintModal(batch);
                              }}
                            >
                              <QrCode className="size-3.5" />
                              View/Print QR
                            </Button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr id={`batch-details-${batch.id}`} className="bg-muted/20">
                            <td colSpan={6} className="p-4">
                              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                                {[
                                  ["Order Number", batch.order_number],
                                  ["QC Inspector", batch.inspected_by || "Unavailable"],
                                  [
                                    "QC Status",
                                    (batch.qc_status || batch.status).replaceAll("_", " "),
                                  ],
                                  [
                                    "Inspection Date",
                                    batch.inspected_at
                                      ? new Date(batch.inspected_at).toLocaleString()
                                      : "Unavailable",
                                  ],
                                  ["Floor Location", batch.location_code || "Unavailable"],
                                  [
                                    "Stock Recorded",
                                    batch.posted_at
                                      ? new Date(batch.posted_at).toLocaleString()
                                      : "Unavailable",
                                  ],
                                  [
                                    "Produced",
                                    `${batch.produced_quantity ?? batch.quantity} ${batch.uom}`,
                                  ],
                                  ["Reserved", `${batch.reserved_quantity ?? 0} ${batch.uom}`],
                                  ["Dispatched", `${batch.dispatched_quantity ?? 0} ${batch.uom}`],
                                ].map(([label, value]) => (
                                  <div key={label} className="min-w-0 space-y-1">
                                    <dt className="text-muted-foreground">{label}</dt>
                                    <dd className="break-words font-medium">{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DialogFooter className="shrink-0 border-t border-border/60 px-5 py-3">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setDetailsFg(null)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* PRINT QR LABEL MODAL */}
        {/* ========================================================================= */}
        <Dialog open={!!selectedFg} onOpenChange={(open) => !open && setSelectedFg(null)}>
          <DialogContent className="max-w-md p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3">
              <DialogTitle className="flex items-center gap-2 text-foreground text-lg font-bold">
                <Tag className="size-5 text-primary" />
                Finished Goods QR Identification Label
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Print the FG batch QR identification label for Assembly storage and customer
                dispatch.
              </DialogDescription>
            </DialogHeader>

            {labelLoading ? (
              <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                <RefreshCw className="size-6 animate-spin text-primary mx-auto" />
                <p>Generating barcode & QR matrix...</p>
              </div>
            ) : selectedFg ? (
              <div className="space-y-4 pt-2">
                {/* Visual Label Preview */}
                <div
                  ref={printRef}
                  className="rounded-2xl border-2 border-dashed border-border bg-card p-5 text-card-foreground shadow-2xs space-y-3"
                >
                  <div className="border-b-2 border-border pb-2 text-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                      KaizenAssests Assembly Execution
                    </span>
                    <h3 className="text-sm font-black text-foreground uppercase tracking-wide mt-0.5">
                      Finished Good Batch Label
                    </h3>
                  </div>

                  {qrDataUrl && (
                    <div className="flex justify-center py-1">
                      <img
                        src={qrDataUrl}
                        alt="QR Matrix"
                        className="size-32 rounded-lg border border-border/80 shadow-2xs"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Product:</span>
                      <span className="font-bold text-foreground text-right">
                        {selectedFg.product_name}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Item SKU:</span>
                      <span className="font-mono font-bold text-foreground">
                        {selectedFg.product_code}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Work Order:</span>
                      <span className="font-mono font-bold text-foreground">
                        {selectedFg.order_number}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Quantity:</span>
                      <span className="font-bold text-foreground font-mono">
                        {selectedFg.quantity} {selectedFg.uom}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">FG Batch / QR Identity:</span>
                      <span className="font-mono font-bold text-foreground">
                        {selectedFg.batch_number || selectedFg.serial_number || "Not recorded"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Staging Rack:</span>
                      <span className="font-mono text-foreground">{selectedFg.location_code}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Certified:</span>
                      <span className="text-foreground">
                        {selectedFg.posted_at
                          ? new Date(selectedFg.posted_at).toLocaleDateString()
                          : "Today"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-center text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    ✓ QC CERTIFIED - READY FOR CUSTOMER DISPATCH
                  </div>
                </div>
              </div>
            ) : null}

            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadLabel}
                disabled={!qrDataUrl}
                className="rounded-xl gap-2 font-semibold"
              >
                <Download className="size-3.5" />
                Download QR
              </Button>
              <Button
                size="sm"
                onClick={handlePrint}
                className="rounded-xl gap-2 font-semibold shadow-soft"
              >
                <Printer className="size-3.5" />
                Print Physical Label
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
