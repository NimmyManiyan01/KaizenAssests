import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, resolveMediaUrl } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import { isValidVehicleNumber } from "@/lib/input-validation";

export const Route = createFileRoute("/damage-claims")({ component: Page });
const resolutions = [
  { value: "REPLACEMENT", label: "Replace Materials" },
  { value: "CREDIT_NOTE", label: "Credit Note" },
  { value: "REFUND", label: "Refund" },
  { value: "RETURN_REPLACEMENT", label: "Return and Replace" },
];
const actionButtonClass = "h-10 rounded-lg";
function Page() {
  const [claims, setClaims] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState<string>();
  const [forms, setForms] = useState<Record<string, any>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const roles: string[] = getUserInfo()?.roles || [];
  const has = (role: string) => roles.includes(role) || roles.includes("ADMIN");
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await api.getDamageClaims();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load damage returns";
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
  const submitResponse = (claim: any, form: any) => {
    if (!form.response) {
      patch(claim.id, { validation: "Select a response before submitting this claim." });
      return;
    }
    if (form.response === "ACCEPT" && !form.resolution) {
      patch(claim.id, { validation: "Select a resolution before accepting this claim." });
      return;
    }
    patch(claim.id, { validation: "" });
    void run(claim.id, () => api.respondToDamageClaim(claim.id, form), "Claim response submitted");
  };
  const patch = (id: string, data: any) =>
    setForms((all) => ({ ...all, [id]: { ...all[id], ...data } }));
  return (
    <AppShell
      title="Damage Returns"
      subtitle="Review damaged or rejected goods sent from GRN, respond to the supplier claim, and track returns"
      actions={
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-lg"
          onClick={() => void load()}
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      }
    >
      {loading ? (
        <div
          className="grid h-48 place-items-center rounded-xl border border-border bg-card text-sm text-muted-foreground"
          role="status"
        >
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading damage returns…
          </span>
        </div>
      ) : error ? (
        <Card className="rounded-xl border-border bg-card p-6 text-center shadow-sm sm:p-8">
          <p className="font-medium text-destructive">Damage returns could not be loaded.</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button type="button" className="mt-4 h-10 rounded-lg" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      ) : claims.length === 0 ? (
        <Card className="rounded-xl border-border bg-card p-6 text-center shadow-sm sm:p-10">
          <h3 className="text-base font-semibold">No damage returns</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Completed GRNs with damaged or rejected quantities will appear here when published to
            this supplier.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {claims.map((c) => {
            const f = forms[c.id] || {};
            const s = c.shipment;
            return (
              <Card key={c.id} className="rounded-xl border-border bg-card p-3 shadow-sm sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-mono text-base font-semibold text-foreground">
                      {c.claim_number || "Claim —"}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {c.po_number || "—"} · {c.material || "Material not specified"} · Damaged{" "}
                      {c.damaged_quantity ?? "—"} {c.uom || ""} · Rejected{" "}
                      {c.rejected_quantity ?? "—"} {c.uom || ""}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                {(c.damage_reason || c.remarks || c.photos?.length) && (
                  <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
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
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">Original GRN</span>
                    <p className="font-medium">{c.grn_number || "—"}</p>
                  </div>
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
                </div>
                {has("SUPPLIER") && !c.response && (
                  <div className="mt-3 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`claim-${c.id}-response`}>Your response *</Label>
                      <Select
                        value={f.response || "unselected"}
                        onValueChange={(value) => patch(c.id, { response: value === "unselected" ? "" : value, validation: "" })}
                      >
                        <SelectTrigger id={`claim-${c.id}-response`} className="damage-return-select-trigger h-11 rounded-[10px] border-[#DFE7F0] bg-white text-sm text-[#172B4D] shadow-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="damage-return-select-menu">
                          <SelectItem value="unselected">Select response</SelectItem>
                          <SelectItem value="ACCEPT">Accept</SelectItem>
                          <SelectItem value="REJECT">Reject</SelectItem>
                          <SelectItem value="PARTIALLY_ACCEPT">Partially Accept</SelectItem>
                          <SelectItem value="REQUEST_MORE_INFORMATION">Request More Information</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`claim-${c.id}-resolution`}>Resolution</Label>
                      <Select
                        value={f.resolution || "unselected"}
                        onValueChange={(value) =>
                          patch(c.id, { resolution: value === "unselected" ? "" : value, validation: "" })
                        }
                      >
                        <SelectTrigger id={`claim-${c.id}-resolution`} className="damage-return-select-trigger h-11 rounded-[10px] border-[#DFE7F0] bg-white text-sm text-[#172B4D] shadow-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="damage-return-select-menu">
                          <SelectItem value="unselected">Select resolution</SelectItem>
                          {resolutions.map((r) => (
                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`claim-${c.id}-remarks`}>Supplier remarks</Label>
                      <Input
                        id={`claim-${c.id}-remarks`}
                        className="h-10 rounded-lg text-sm"
                        placeholder="Add a note (optional)"
                        value={f.remarks || ""}
                        onChange={(e) => patch(c.id, { remarks: e.target.value })}
                      />
                    </div>
                    <label className="flex min-h-10 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!f.return_required}
                        onChange={(e) => patch(c.id, { return_required: e.target.checked })}
                      />
                      Original damaged goods must be returned
                    </label>
                    {f.validation && (
                      <p
                        className="text-sm font-medium text-destructive md:col-span-2"
                        role="alert"
                      >
                        {f.validation}
                      </p>
                    )}
                    <Button
                      type="button"
                      className="h-10 rounded-lg"
                      disabled={busy === c.id}
                      onClick={() => submitResponse(c, f)}
                    >
                      {busy === c.id && <Loader2 className="size-4 animate-spin" />}
                      Submit Response
                    </Button>
                  </div>
                )}
                {has("SUPPLIER") &&
                  ["REPLACEMENT", "RETURN_REPLACEMENT"].includes(c.resolution) &&
                  !s && (
                    <div className="mt-3 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Input
                        aria-label="Replacement vehicle number"
                        className="h-10 rounded-lg"
                        placeholder="Replacement vehicle number"
                        value={f.vehicle || ""}
                        onChange={(e) => patch(c.id, { vehicle: e.target.value })}
                      />
                      <Button
                        type="button"
                        className={actionButtonClass}
                        disabled={busy === c.id}
                        onClick={() =>
                          void run(
                            c.id,
                            () =>
                              api.createReplacementShipment(c.id, { vehicle_number: f.vehicle }),
                            "Replacement shipment created",
                          )
                        }
                      >
                        {busy === c.id && <Loader2 className="size-4 animate-spin" />}
                        Send Replacement
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
