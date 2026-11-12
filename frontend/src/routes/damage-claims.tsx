import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Eye, History, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, resolveMediaUrl } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import { isValidVehicleNumber } from "@/lib/input-validation";

export const Route = createFileRoute("/damage-claims")({ component: Page });
const actionButtonClass = "h-10 rounded-lg";
function Page() {
  const navigate = useNavigate();
  const [claims, setClaims] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState<string>();
  const [forms, setForms] = useState<Record<string, any>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null);
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
  const historyClaims = claims.filter(claim => Boolean(claim.shipment));
  const visibleClaims = has("SUPPLIER")
    ? claims.filter(claim => showHistory ? Boolean(claim.shipment) : !claim.shipment)
    : showHistory ? historyClaims : claims;
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
      ) : visibleClaims.length === 0 ? (
        <Card className="supplier-module-page rounded-xl border-border bg-card p-6 text-center shadow-sm sm:p-10">
          <h3 className="text-base font-semibold">{showHistory ? "No replacement history yet" : "No pending damage claims"}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {showHistory ? "Claims appear here after a replacement is sent." : "Claims remain here until you send a replacement."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {showHistory && <h2 className="text-lg font-semibold">Replacement history</h2>}
          {visibleClaims.map((c) => {
            const f = forms[c.id] || {};
            const s = c.shipment;
            const details = (
              <Card key={c.id} className="damage-claim-card supplier-module-page rounded-xl border-border bg-card p-3 shadow-sm sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-mono text-base font-semibold text-foreground">
                      {c.claim_number || "Claim —"}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{c.material || "Material not specified"}</p>

                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <dl className="claim-quantity-summary">
                  <div><dt>Damaged quantity</dt><dd className="text-destructive">{c.damaged_quantity ?? "Not recorded"} {c.uom || ""}</dd></div>
                  <div><dt>Rejected quantity</dt><dd>{c.rejected_quantity ?? "Not recorded"} {c.uom || ""}</dd></div>
                </dl>
                <div className="claim-information-layout">
                <section className="claim-shipment-section">
                  <h4 className="mb-3 text-sm">Original shipment</h4>
                <div className="claim-shipment-details grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Original GRN</span>
                    <p className="font-medium">{c.grn_number || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Original ASN</span>
                    <p className="font-medium">{c.asn_number || "Not recorded"}</p>
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
                  {!roles.includes("SUPPLIER") && <>
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
                  </>}
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
                {!roles.includes("SUPPLIER") && showHistory && c.response && <div className="mt-3 rounded-lg bg-muted/30 p-3 text-sm">
                  {c.responded_at && <p><span className="text-muted-foreground">Responded: </span>{new Date(c.responded_at).toLocaleString()}</p>}
                  <p><span className="text-muted-foreground">Supplier remarks: </span>{c.supplier_remarks || "No remarks"}</p>
                  <p className="mt-1"><span className="text-muted-foreground">Return required: </span>{c.return_required ? "Yes" : "No"}</p>
                </div>}
                {roles.includes("SUPPLIER") && !s && !showHistory && (
                    <div className="claim-replacement-footer mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                      <div><p className="text-sm">Arrange a replacement delivery</p><p className="mt-1 text-xs text-muted-foreground">Create an ASN with the replacement material and shipment details.</p></div>
                      <Button
                        type="button"
                        className={actionButtonClass}
                        disabled={busy === c.id}
                        onClick={() => void navigate({ to: "/supplier/asns/new", search: { open: "create" } as any })}
                      >
                        {busy === c.id && <Loader2 className="size-4 animate-spin" />}
                        Replacement <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                {s && (
                  <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{s.shipment_number || "Replacement shipment"}</strong>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Vehicle {s.vehicle_number || "—"} · Expected {s.expected_quantity ?? "—"}{" "}
                      {c.uom || ""} · Gate {s.gate_entry_number || "Pending"} · RGRN{" "}
                      {s.replacement_grn_number || "Pending"}
                    </p>
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
                    {c.vehicle_number && <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
                      <span>Inbound vehicle: <strong>{c.vehicle_number}</strong>. {c.inbound_exited_at ? "Its inbound gate exit is already recorded; confirm availability before reusing it." : "Confirm the vehicle is still on site before using it for the return."}</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => patch(c.id, { returnVehicle: c.vehicle_number, validation: "" })}>Use inbound vehicle</Button>
                    </div>}
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
                    <StatusBadge status={s?.status || c.status} />
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
          })}
        </div>
      )}
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

// Trigger update
