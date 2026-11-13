import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Eye, History, Loader2, RefreshCw, ShieldAlert, Truck } from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, resolveMediaUrl } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import {
  isValidAsnDriverMobileNumber,
  isValidAsnDriverName,
  isValidAsnVehicleNumber,
  isValidVehicleNumber,
  normalizeAsnVehicleNumber,
  sanitizeAsnDriverName,
  sanitizeMobileNumber,
} from "@/lib/input-validation";

export const Route = createFileRoute("/damage-claims")({ component: Page });
const actionButtonClass = "h-10 rounded-lg";

const todayDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

function Page() {
  const navigate = useNavigate();
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [forms, setForms] = useState<Record<string, any>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "pending" | "in_progress" | "completed">("all");

  // Replacement modal state
  const [replacementClaim, setReplacementClaim] = useState<any | null>(null);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [repForm, setRepForm] = useState({
    vehicleNumber: "",
    driverName: "",
    driverMobile: "",
    deliveryDate: todayDate(),
    replacementQuantity: "",
    transporter: "",
    challanNumber: "",
    invoiceNumber: "",
  });
  const [repTouched, setRepTouched] = useState({
    vehicleNumber: false,
    driverName: false,
    driverMobile: false,
    replacementQuantity: false,
  });
  const [repSubmitting, setRepSubmitting] = useState(false);

  const roles: string[] = getUserInfo()?.roles || [];
  const has = (role: string) => roles.includes(role) || roles.includes("ADMIN");

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await api.getDamageClaims();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load damage claims";
      setError(message);
      toast.error("Unable to load damage claims", { description: message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<any>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (e) {
      toast.error("Workflow action failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(undefined);
    }
  };

  const patch = (id: string, data: any) =>
    setForms((all) => ({ ...all, [id]: { ...all[id], ...data } }));

  const openReplacementModal = useCallback((c: any) => {
    setReplacementClaim(c);
    const initialQty = String(c.damaged_quantity || 1);
    setRepForm({
      vehicleNumber: "",
      driverName: "",
      driverMobile: "",
      deliveryDate: todayDate(),
      replacementQuantity: initialQty,
      transporter: "",
      challanNumber: "",
      invoiceNumber: "",
    });
    setRepTouched({
      vehicleNumber: false,
      driverName: false,
      driverMobile: false,
      replacementQuantity: false,
    });
    api.getDrivers().then((d) => setDrivers(Array.isArray(d) ? d : [])).catch(() => setDrivers([]));
  }, []);

  const isRepVehicleValid = isValidAsnVehicleNumber(repForm.vehicleNumber);
  const isRepDriverNameValid = isValidAsnDriverName(repForm.driverName);
  const isRepDriverMobileValid = isValidAsnDriverMobileNumber(repForm.driverMobile);
  const repMaxEligible = replacementClaim ? Number(replacementClaim.damaged_quantity || 0) : 0;
  const repQtyNum = Number(repForm.replacementQuantity);
  const isRepQtyValid = repQtyNum > 0 && (repMaxEligible <= 0 || repQtyNum <= repMaxEligible);

  const submitReplacementShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replacementClaim) return;
    setRepTouched({
      vehicleNumber: true,
      driverName: true,
      driverMobile: true,
      replacementQuantity: true,
    });
    if (!isRepVehicleValid || !isRepDriverNameValid || !isRepDriverMobileValid || !isRepQtyValid) {
      toast.error("Please correct the form errors before submitting.");
      return;
    }
    setRepSubmitting(true);
    try {
      const payload = {
        vehicle_number: normalizeAsnVehicleNumber(repForm.vehicleNumber),
        driver_name: repForm.driverName.trim().replace(/ +/g, " "),
        driver_contact: repForm.driverMobile.trim(),
        expected_arrival: repForm.deliveryDate ? `${repForm.deliveryDate}T10:00:00Z` : undefined,
        replacement_quantity: repQtyNum,
        transporter: repForm.transporter.trim() || undefined,
        challan_number: repForm.challanNumber.trim() || undefined,
        invoice_number: repForm.invoiceNumber.trim() || undefined,
      };
      const res = await api.createReplacementShipment(replacementClaim.id, payload);
      const repRef = res.asn_number || res.shipment_number || `${replacementClaim.asn_number || "ASN"}-R`;
      toast.success(`Replacement ASN ${repRef} submitted successfully`);
      setReplacementClaim(null);
      await load();
    } catch (err: any) {
      toast.error("Failed to create replacement shipment", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRepSubmitting(false);
    }
  };

  const isClaimCompleted = (c: any) =>
    c.status === "REPLACEMENT_COMPLETED" ||
    c.status === "RESOLVED" ||
    c.status === "CLOSED" ||
    c.shipment?.status === "INVENTORY_POSTED" ||
    c.workflow_state === "COMPLETED";

  const isClaimInProgress = (c: any) =>
    !isClaimCompleted(c) && (
      Boolean(c.shipment) ||
      c.status === "REPLACEMENT_IN_TRANSIT" ||
      c.status === "REPLACEMENT_IN_PROGRESS" ||
      c.workflow_state === "IN_PROGRESS"
    );

  const isClaimPending = (c: any) =>
    !isClaimCompleted(c) && !isClaimInProgress(c);

  const pendingClaims = claims.filter(isClaimPending);
  const inProgressClaims = claims.filter(isClaimInProgress);
  const completedClaims = claims.filter(isClaimCompleted);
  const historyClaims = claims.filter((claim) => Boolean(claim.shipment) || isClaimCompleted(claim));

  const visibleClaims = showHistory
    ? (activeTab === "completed"
        ? completedClaims
        : activeTab === "in_progress"
          ? inProgressClaims
          : historyClaims)
    : (activeTab === "pending"
        ? pendingClaims
        : activeTab === "in_progress"
          ? inProgressClaims
          : activeTab === "completed"
            ? completedClaims
            : (has("SUPPLIER") ? claims : claims));

  return (
    <AppShell
      title={
        <span className="supplier-page-title inline-flex items-center gap-3">
          <span className="supplier-page-title-icon inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
            <ShieldAlert className="size-5" aria-hidden="true" />
          </span>
          Damage Claims
        </span>
      }
      subtitle={roles.includes("SUPPLIER") ? "Review damaged or rejected goods, inbound shipment details, and replacement history." : "Review damaged or rejected goods and track claim and replacement history."}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="default" className="h-10 gap-2 rounded-lg bg-primary px-4 text-primary-foreground hover:bg-primary/90" onClick={() => setShowHistory(value => !value)}>
            <History className="size-4" />{showHistory ? "Back to claims" : `History (${historyClaims.length})`}
          </Button>
          <Button data-refresh-control="true" size="icon" aria-label="Refresh damage claims" title="Refresh damage claims"
            type="button"
            variant="outline"
            className="h-10 w-10 rounded-lg"
            onClick={() => void load()}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      }
    >
      {loading ? (
        <div
          className="supplier-module-page grid h-48 place-items-center rounded-xl border border-border bg-card text-sm text-muted-foreground"
          role="status"
        >
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading damage claims…
          </span>
        </div>
      ) : error ? (
        <Card className="supplier-module-page rounded-xl border-border bg-card p-6 text-center shadow-sm sm:p-8">
          <p className="font-medium text-destructive">Damage claims could not be loaded.</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button type="button" className="mt-4 h-10 rounded-lg" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      ) : visibleClaims.length === 0 && activeTab === "all" && !showHistory && claims.length === 0 ? (
        <Card className="supplier-module-page rounded-xl border-border bg-card p-6 text-center shadow-sm sm:p-10">
          <h3 className="text-base font-semibold">No pending damage claims</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Claims remain here until you send a replacement.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Workflow Status Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <Button
                type="button"
                size="sm"
                variant={activeTab === "all" ? "default" : "outline"}
                className={`h-8 rounded-lg text-xs font-semibold ${activeTab === "all" ? "bg-primary text-primary-foreground" : ""}`}
                onClick={() => setActiveTab("all")}
              >
                All ({claims.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "pending" ? "default" : "outline"}
                className={`h-8 rounded-lg text-xs font-semibold ${activeTab === "pending" ? "bg-primary text-primary-foreground" : ""}`}
                onClick={() => setActiveTab("pending")}
              >
                Pending ({pendingClaims.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "in_progress" ? "default" : "outline"}
                className={`h-8 rounded-lg text-xs font-semibold ${activeTab === "in_progress" ? "bg-primary text-primary-foreground" : ""}`}
                onClick={() => setActiveTab("in_progress")}
              >
                In Progress ({inProgressClaims.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "completed" ? "default" : "outline"}
                className={`h-8 rounded-lg text-xs font-semibold ${activeTab === "completed" ? "bg-primary text-primary-foreground" : ""}`}
                onClick={() => setActiveTab("completed")}
              >
                Completed ({completedClaims.length})
              </Button>
            </div>
            {showHistory && (
              <span className="text-xs font-medium text-muted-foreground">
                Showing historical records
              </span>
            )}
          </div>

          {visibleClaims.length === 0 ? (
            <Card className="rounded-xl border-border bg-card p-6 text-center shadow-sm sm:p-10">
              <h3 className="text-base font-semibold">
                {activeTab === "pending"
                  ? "No claims pending replacement"
                  : activeTab === "in_progress"
                    ? "No replacement shipments currently in progress"
                    : activeTab === "completed"
                      ? "No completed replacement records yet"
                      : "No damage claims match this filter"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {activeTab === "pending"
                  ? "All received damage claims have replacements arranged."
                  : activeTab === "in_progress"
                    ? "Replacements appear here once dispatched until received at warehouse."
                    : "Completed replacements with inventory added appear here."}
              </p>
            </Card>
          ) : (
            visibleClaims.map((c) => {
              const f = forms[c.id] || {};
              const s = c.shipment;
              const completed = isClaimCompleted(c);
              const inProgress = isClaimInProgress(c);
              const details = (
                <Card key={c.id} className="damage-claim-card supplier-module-page rounded-xl border-border bg-card p-3 shadow-sm sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-mono text-base font-semibold text-foreground">
                        {c.claim_number || "Claim —"}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">{c.material || "Material not specified"}</p>
                    </div>
                    <StatusBadge status={completed ? "REPLACEMENT_COMPLETED" : (inProgress ? (s?.status || c.status || "REPLACEMENT_IN_TRANSIT") : c.status)} />
                  </div>
                  <dl className="claim-quantity-summary">
                    <div><dt>Damaged quantity</dt><dd className="text-destructive font-semibold">{c.damaged_quantity ?? "Not recorded"} {c.uom || ""}</dd></div>
                    <div><dt>Rejected quantity</dt><dd>{c.rejected_quantity ?? "Not recorded"} {c.uom || ""}</dd></div>
                  </dl>
                  <div className="claim-information-layout">
                    <section className="claim-shipment-section">
                      <h4 className="mb-3 text-sm font-semibold">Original inbound shipment</h4>
                      <div className="claim-shipment-details grid gap-4 text-sm sm:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground">Original GRN</span>
                          <p className="font-medium">{c.grn_number || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Original ASN</span>
                          <p className="font-mono font-semibold text-foreground">{c.asn_number || c.original_asn_number || "Not recorded"}</p>
                          {c.asn_status && <p className="text-xs text-muted-foreground">{c.asn_status.replaceAll("_", " ")}{c.asn_shipment_date ? ` | Shipped ${new Date(c.asn_shipment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}</p>}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Inbound vehicle</span>
                          <p className="font-mono font-medium">{c.vehicle_number || "Not recorded"}</p>
                          {c.inbound_exited_at && <p className="text-xs text-muted-foreground">Gate exit recorded {new Date(c.inbound_exited_at).toLocaleString()}</p>}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Inbound gate pass</span>
                          <p className="font-medium">{c.gate_entry_number || "Not recorded"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Inbound driver</span>
                          <p className="font-medium">{c.driver_name || "Not recorded"}{c.driver_contact ? ` | ${c.driver_contact}` : ""}</p>
                        </div>
                        {!roles.includes("SUPPLIER") && (
                          <>
                            <div>
                              <span className="text-muted-foreground">Response</span>
                              <p className="font-medium">
                                {c.response?.replaceAll("_", " ") || "No response yet"}
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Resolution</span>
                              <p className="font-medium">{c.resolution?.replaceAll("_", " ") || "—"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Quarantine</span>
                              <p className="font-medium text-warning-foreground">Original goods retained</p>
                            </div>
                          </>
                        )}
                      </div>
                    </section>
                    {(c.damage_reason || c.remarks || c.photos?.length) && (
                      <div className="claim-evidence rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-sm font-semibold text-foreground">Damage evidence</p>
                        {c.damage_reason && (
                          <p className="mt-2 text-sm">
                            <span className="font-semibold">Reason:</span> {c.damage_reason}
                          </p>
                        )}
                        {c.remarks && (
                          <p className="mt-1 text-sm">
                            <span className="font-semibold">Remarks:</span> {c.remarks}
                          </p>
                        )}
                        {c.photos?.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-3">
                            {c.photos.map((photo: any, index: number) => (
                              <button
                                type="button"
                                key={`${photo.file_path}-${index}`}
                                aria-label={`View damage evidence ${index + 1} for ${c.claim_number || "claim"}`}
                                onClick={() => setPreviewPhoto(resolveMediaUrl(photo.file_path))}
                                className="overflow-hidden rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:border-primary"
                              >
                                <img
                                  src={resolveMediaUrl(photo.file_path)}
                                  alt={`Damage evidence ${index + 1}`}
                                  className="h-20 w-28 object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {!roles.includes("SUPPLIER") && showHistory && c.response && (
                    <div className="mt-3 rounded-lg bg-muted/30 p-3 text-sm">
                      {c.responded_at && <p><span className="text-muted-foreground">Responded: </span>{new Date(c.responded_at).toLocaleString()}</p>}
                      <p><span className="text-muted-foreground">Supplier remarks: </span>{c.supplier_remarks || "No remarks"}</p>
                      <p className="mt-1"><span className="text-muted-foreground">Return required: </span>{c.return_required ? "Yes" : "No"}</p>
                    </div>
                  )}

                  {/* Supplier Replacement Initiation Button */}
                  {has("SUPPLIER") && !s && !completed && (
                    <div className="claim-replacement-footer mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Arrange a replacement delivery</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Reuses original ASN {c.asn_number ? `(${c.asn_number}-R)` : ""} with driver & shipment details for damaged items only.
                        </p>
                      </div>
                      <Button
                        type="button"
                        className={actionButtonClass}
                        disabled={busy === c.id}
                        onClick={() => openReplacementModal(c)}
                      >
                        {busy === c.id && <Loader2 className="size-4 animate-spin" />}
                        Replacement <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}

                  {/* Replacement Shipment Details and Progression Card */}
                  {s && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <strong className="font-mono text-sm">{s.shipment_number || `${c.asn_number || "ASN"}-R`}</strong>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 font-semibold">
                            Replacement Reference
                          </span>
                        </div>
                        <StatusBadge status={completed ? "REPLACEMENT_COMPLETED" : s.status} />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <div>
                          <span className="text-muted-foreground">Original ASN:</span>
                          <p className="font-mono font-medium">{c.asn_number || c.original_asn_number || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Replacement Qty:</span>
                          <p className="font-semibold text-primary">{s.expected_quantity ?? c.damaged_quantity} {c.uom || "PCS"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Vehicle:</span>
                          <p className="font-mono font-medium">{s.vehicle_number || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Gate Pass:</span>
                          <p className="font-medium">{s.gate_entry_number || "Pending Gate"}</p>
                        </div>
                      </div>

                      {completed ? (
                        <div className="mt-3 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-800 border border-emerald-200 font-medium">
                          ✓ Replacement completed. {s.accepted_quantity ?? s.expected_quantity ?? c.damaged_quantity} {c.uom || "PCS"} verified, accepted, and posted into warehouse inventory.
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Replacement shipment in progress · Status: {s.status.replaceAll("_", " ")}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {has("GATE_SECURITY") && s.status === "IN_TRANSIT" && (
                          <Button
                            type="button"
                            className={actionButtonClass}
                            disabled={busy === s.id}
                            onClick={() =>
                              void run(
                                s.id,
                                () => api.replacementGateEntry(s.id, s.vehicle_number),
                                "Replacement gate entry recorded",
                              )
                            }
                          >
                            {busy === s.id && <Loader2 className="size-4 animate-spin" />}
                            Record Gate Entry
                          </Button>
                        )}
                        {has("WAREHOUSE") && s.status === "AT_RECEIVING" && (
                          <Button
                            type="button"
                            className={actionButtonClass}
                            disabled={busy === s.id}
                            onClick={() =>
                              void run(
                                s.id,
                                () => api.receiveReplacement(s.id, s.expected_quantity),
                                "Replacement GRN created",
                              )
                            }
                          >
                            {busy === s.id && <Loader2 className="size-4 animate-spin" />}
                            Receive {s.expected_quantity ?? "—"} & Create RGRN
                          </Button>
                        )}
                        {has("WAREHOUSE") && s.status === "AWAITING_INSPECTION" && (
                          <Button
                            type="button"
                            className={actionButtonClass}
                            disabled={busy === s.id}
                            onClick={() =>
                              void run(
                                s.id,
                                () => api.inspectReplacement(s.id, s.received_quantity, 0),
                                "Replacement inspection passed",
                              )
                            }
                          >
                            {busy === s.id && <Loader2 className="size-4 animate-spin" />}
                            Accept All {s.received_quantity ?? "—"}
                          </Button>
                        )}
                        {has("WAREHOUSE") && s.status === "INSPECTION_PASSED" && (
                          <>
                            <Input
                              aria-label="Storage location"
                              className="h-10 rounded-lg sm:max-w-52"
                              placeholder="Storage location"
                              value={f.location || ""}
                              onChange={(e) => patch(c.id, { location: e.target.value })}
                            />
                            <Button
                              type="button"
                              className={actionButtonClass}
                              disabled={busy === s.id}
                              onClick={() =>
                                void run(
                                  s.id,
                                  () => api.putawayReplacement(s.id, f.location),
                                  "Replacement put away",
                                )
                              }
                            >
                              {busy === s.id && <Loader2 className="size-4 animate-spin" />}
                              Complete Putaway
                            </Button>
                          </>
                        )}
                        {has("WAREHOUSE") && s.status === "PUTAWAY_COMPLETED" && (
                          <Button
                            type="button"
                            className={actionButtonClass}
                            disabled={busy === s.id}
                            onClick={() =>
                              void run(
                                s.id,
                                () => api.postReplacementInventory(s.id),
                                "Replacement added to available inventory",
                              )
                            }
                          >
                            {busy === s.id && <Loader2 className="size-4 animate-spin" />}
                            Post to Inventory
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {c.return_required && has("WAREHOUSE") && !c.return && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      {c.vehicle_number && (
                        <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
                          <span>Inbound vehicle: <strong>{c.vehicle_number}</strong>. {c.inbound_exited_at ? "Its inbound gate exit is already recorded; confirm availability before reusing it." : "Confirm the vehicle is still on site before using it for the return."}</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => patch(c.id, { returnVehicle: c.vehicle_number, validation: "" })}>Use inbound vehicle</Button>
                        </div>
                      )}
                      <Input
                        aria-label="Return vehicle number"
                        className="h-10 rounded-lg"
                        placeholder="Return vehicle number"
                        value={f.returnVehicle || ""}
                        onChange={(e) =>
                          patch(c.id, { returnVehicle: e.target.value.replace(/[^A-Za-z0-9 ]/g, "") })
                        }
                      />
                      <Button
                        type="button"
                        className={actionButtonClass}
                        variant="destructive"
                        disabled={busy === c.id}
                        onClick={() => {
                          if (!isValidVehicleNumber(f.returnVehicle || "")) {
                            patch(c.id, { validation: "Enter a valid return vehicle number." });
                            return;
                          }
                          void run(
                            c.id,
                            () => api.createSupplierReturn(c.id, f.returnVehicle.trim()),
                            "Supplier return created",
                          );
                        }}
                      >
                        {busy === c.id && <Loader2 className="size-4 animate-spin" />}
                        Create Supplier Return
                      </Button>
                    </div>
                  )}
                  {c.return && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
                      <span className="text-sm font-medium">
                        {c.return.return_number} · {c.return.status.replaceAll("_", " ")}
                      </span>
                      {has("GATE_SECURITY") && c.return.status === "AWAITING_GATE_EXIT" && (
                        <Button
                          type="button"
                          className={actionButtonClass}
                          disabled={busy === c.return.id}
                          onClick={() =>
                            void run(
                              c.return.id,
                              () => api.completeSupplierReturn(c.return.id),
                              "Damaged goods returned to supplier",
                            )
                          }
                        >
                          {busy === c.return.id && <Loader2 className="size-4 animate-spin" />}
                          Complete Gate Exit
                        </Button>
                      )}
                    </div>
                  )}
                  {has("PROCUREMENT") && c.status !== "CLOSED" && (
                    <Button
                      type="button"
                      className={`mt-4 ${actionButtonClass}`}
                      variant="outline"
                      disabled={busy === c.id}
                      onClick={() =>
                        void run(c.id, () => api.closeDamageClaim(c.id), "Damage claim closed")
                      }
                    >
                      {busy === c.id && <Loader2 className="size-4 animate-spin" />}
                      Close Claim
                    </Button>
                  )}
                </Card>
              );
              return showHistory ? (
                <div key={c.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <h3 className="font-mono font-semibold">{c.claim_number}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{c.material || "Material"} · {c.grn_number || ""}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusBadge status={completed ? "REPLACEMENT_COMPLETED" : (s?.status || c.status)} />
                      <Button variant="outline" size="sm" onClick={() => setHistoryDetailId(c.id)}><Eye className="size-4" />View details</Button>
                    </div>
                  </Card>
                  <Dialog open={historyDetailId === c.id} onOpenChange={open => !open && setHistoryDetailId(null)}>
                    <DialogContent className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto">
                      <DialogHeader className="pr-6 text-left"><DialogTitle>Claim details · {c.claim_number}</DialogTitle></DialogHeader>
                      {details}
                    </DialogContent>
                  </Dialog>
                </div>
              ) : details;
            })
          )}
        </div>
      )}

      {/* Replacement Initiation Modal */}
      <Dialog open={Boolean(replacementClaim)} onOpenChange={(open) => !open && !repSubmitting && setReplacementClaim(null)}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-2xl max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border-border bg-card p-0 text-foreground">
          <DialogHeader className="border-b border-border bg-muted/40 px-5 py-4 text-left">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <Truck className="size-5 text-primary" />
              Initiate Replacement Delivery Notice
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Create a replacement ASN for approved damaged materials linked to the original inbound shipment.
            </p>
          </DialogHeader>

          {replacementClaim && (
            <form onSubmit={submitReplacementShipment} className="space-y-4 p-5 text-sm">
              {/* Step 1 & 2: Identify Original ASN & Replacement Reference */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 sm:grid-cols-3">
                <div>
                  <span className="text-xs text-muted-foreground">Original ASN</span>
                  <p className="font-mono font-bold text-foreground">
                    {replacementClaim.asn_number || replacementClaim.original_asn_number || "Not recorded"}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Replacement Reference</span>
                  <p className="font-mono font-bold text-primary">
                    {replacementClaim.asn_number ? `${replacementClaim.asn_number}-R` : (replacementClaim.original_asn_number ? `${replacementClaim.original_asn_number}-R` : "ASN-REPLACEMENT-R")}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Damage Claim</span>
                  <p className="font-mono font-bold text-foreground">{replacementClaim.claim_number}</p>
                </div>
                {replacementClaim.grn_number && (
                  <div>
                    <span className="text-xs text-muted-foreground">Original GRN</span>
                    <p className="font-medium text-foreground">{replacementClaim.grn_number}</p>
                  </div>
                )}
                {replacementClaim.po_number && (
                  <div>
                    <span className="text-xs text-muted-foreground">Purchase Order</span>
                    <p className="font-medium text-foreground">{replacementClaim.po_number}</p>
                  </div>
                )}
              </div>

              {/* Step 3: Fetch ONLY Damaged & Approved Materials */}
              <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Replacement Material (Damaged Items Only)
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    Eligible Damaged Qty: <strong className="text-destructive font-semibold">{replacementClaim.damaged_quantity} {replacementClaim.uom || "PCS"}</strong>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div>
                    <p className="font-semibold text-foreground">{replacementClaim.material}</p>
                    <p className="font-mono text-xs text-muted-foreground">{replacementClaim.item_code}</p>
                  </div>
                  <div className="w-full sm:w-44">
                    <Label htmlFor="rep-quantity" className="text-xs">Replacement Qty ({replacementClaim.uom || "PCS"}) *</Label>
                    <Input
                      id="rep-quantity"
                      type="number"
                      min="0.001"
                      max={replacementClaim.damaged_quantity}
                      step="any"
                      value={repForm.replacementQuantity}
                      onChange={(e) => setRepForm((f) => ({ ...f, replacementQuantity: e.target.value }))}
                      onBlur={() => setRepTouched((t) => ({ ...t, replacementQuantity: true }))}
                      className="mt-1 h-9 rounded-lg"
                    />
                    {repTouched.replacementQuantity && !isRepQtyValid && (
                      <p className="mt-1 text-[11px] text-destructive">
                        Quantity must be &gt; 0 and &le; {replacementClaim.damaged_quantity}.
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground italic">
                  * Note: Only materials identified as damaged and approved for replacement are included. Accepted goods from the original shipment are excluded.
                </p>
              </div>

              {/* Step 1 & 4: Transport & Driver Details Form with standard validations */}
              <div className="space-y-3 pt-1">
                <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                  Transport & Driver Assignment
                </h4>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="rep-vehicle" className="text-xs">Vehicle Number *</Label>
                    <Input
                      id="rep-vehicle"
                      placeholder="e.g. MH12AB1234"
                      value={repForm.vehicleNumber}
                      onChange={(e) => setRepForm((f) => ({ ...f, vehicleNumber: e.target.value.toUpperCase() }))}
                      onBlur={() => setRepTouched((t) => ({ ...t, vehicleNumber: true }))}
                      className="mt-1 h-9 font-mono rounded-lg"
                    />
                    {repTouched.vehicleNumber && !isRepVehicleValid && (
                      <p className="mt-1 text-[11px] text-destructive">
                        Enter a valid vehicle registration number (e.g. MH12AB1234).
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="rep-delivery-date" className="text-xs">Expected Delivery Date *</Label>
                    <Input
                      id="rep-delivery-date"
                      type="date"
                      min={todayDate()}
                      value={repForm.deliveryDate}
                      onChange={(e) => setRepForm((f) => ({ ...f, deliveryDate: e.target.value }))}
                      className="mt-1 h-9 rounded-lg"
                    />
                  </div>
                </div>

                {drivers.length > 0 && (
                  <div>
                    <Label htmlFor="rep-driver-select" className="text-xs">Registered Driver (Optional)</Label>
                    <select
                      id="rep-driver-select"
                      className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs"
                      onChange={(e) => {
                        const sel = drivers.find((d) => (d.driver_name || d.name) === e.target.value);
                        if (sel) {
                          setRepForm((f) => ({
                            ...f,
                            driverName: sel.driver_name || sel.name || "",
                            driverMobile: sel.driver_contact || sel.mobile || sel.phone || "",
                          }));
                          setRepTouched((t) => ({ ...t, driverName: true, driverMobile: true }));
                        }
                      }}
                    >
                      <option value="">Choose registered driver...</option>
                      {drivers.map((d: any) => (
                        <option key={d.id || d.name} value={d.driver_name || d.name}>
                          {d.driver_name || d.name} ({d.driver_contact || d.mobile || d.phone || "No phone"})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="rep-driver-name" className="text-xs">Driver Name *</Label>
                    <Input
                      id="rep-driver-name"
                      placeholder="Enter driver name"
                      value={repForm.driverName}
                      onChange={(e) => setRepForm((f) => ({ ...f, driverName: sanitizeAsnDriverName(e.target.value) }))}
                      onBlur={() => setRepTouched((t) => ({ ...t, driverName: true }))}
                      className="mt-1 h-9 rounded-lg"
                    />
                    {repTouched.driverName && !isRepDriverNameValid && (
                      <p className="mt-1 text-[11px] text-destructive">
                        Enter a valid driver name (letters, 2-100 characters).
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="rep-driver-mobile" className="text-xs">Driver Contact Number *</Label>
                    <Input
                      id="rep-driver-mobile"
                      placeholder="10-digit mobile number"
                      maxLength={10}
                      value={repForm.driverMobile}
                      onChange={(e) => setRepForm((f) => ({ ...f, driverMobile: sanitizeMobileNumber(e.target.value) }))}
                      onBlur={() => setRepTouched((t) => ({ ...t, driverMobile: true }))}
                      className="mt-1 h-9 font-mono rounded-lg"
                    />
                    {repTouched.driverMobile && !isRepDriverMobileValid && (
                      <p className="mt-1 text-[11px] text-destructive">
                        Enter a valid 10-digit mobile number starting with 6-9.
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="rep-transporter" className="text-xs">Transporter (Optional)</Label>
                    <Input
                      id="rep-transporter"
                      placeholder="Transport company"
                      value={repForm.transporter}
                      onChange={(e) => setRepForm((f) => ({ ...f, transporter: e.target.value }))}
                      className="mt-1 h-9 rounded-lg"
                    />
                  </div>
                  <div>
                    <Label htmlFor="rep-challan" className="text-xs">Challan Number (Optional)</Label>
                    <Input
                      id="rep-challan"
                      placeholder="Delivery challan"
                      value={repForm.challanNumber}
                      onChange={(e) => setRepForm((f) => ({ ...f, challanNumber: e.target.value }))}
                      className="mt-1 h-9 rounded-lg"
                    />
                  </div>
                  <div>
                    <Label htmlFor="rep-invoice" className="text-xs">Invoice Number (Optional)</Label>
                    <Input
                      id="rep-invoice"
                      placeholder="Invoice reference"
                      value={repForm.invoiceNumber}
                      onChange={(e) => setRepForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
                      className="mt-1 h-9 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-lg"
                  disabled={repSubmitting}
                  onClick={() => setReplacementClaim(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={repSubmitting}
                >
                  {repSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Submit Replacement Delivery Notice
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Enlarged Photo Dialog */}
      <Dialog open={Boolean(previewPhoto)} onOpenChange={(open) => !open && setPreviewPhoto(null)}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-3xl max-h-[calc(100dvh-24px)] gap-0 overflow-y-auto rounded-2xl border-[#DFE7F0] bg-white p-0 text-[#172B4D]">
          <DialogHeader className="border-b border-[#DFE7F0] bg-[#F4F8FD] px-5 py-5 pr-12 text-left">
            <DialogTitle className="text-lg font-semibold">Damage Photo Evidence</DialogTitle>
          </DialogHeader>
          {previewPhoto && (
            <div className="m-4 flex items-center justify-center overflow-hidden rounded-xl border border-[#DFE7F0] bg-[#F4F7FB]">
              <img src={previewPhoto} alt="Enlarged damage evidence" className="max-h-[70dvh] max-w-full object-contain" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
