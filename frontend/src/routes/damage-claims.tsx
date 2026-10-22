import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
function Page() {
  const [claims, setClaims] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState<string>();
  const [forms, setForms] = useState<Record<string, any>>({});
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
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <p className="font-medium text-destructive">Damage returns could not be loaded.</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button className="mt-4" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      ) : claims.length === 0 ? (
        <Card className="p-12 text-center">
          <h3 className="text-lg font-semibold">No damage returns</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Completed GRNs with damaged or rejected quantities will appear here when published to
            this supplier.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {claims.map((c) => {
            const f = forms[c.id] || {};
            const s = c.shipment;
            return (
              <Card key={c.id} className="rounded-2xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-mono text-lg font-bold">{c.claim_number}</h3>
                    <p className="text-sm text-muted-foreground">
                      {c.po_number} · {c.material} · Damaged {c.damaged_quantity || 0} {c.uom} ·
                      Rejected {c.rejected_quantity || 0} {c.uom}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                {(c.damage_reason || c.remarks || c.photos?.length) && (
                  <div className="mt-4 rounded-xl border bg-muted/20 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Damage Evidence
                    </p>
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
                          <img
                            key={`${photo.file_path}-${index}`}
                            src={resolveMediaUrl(photo.file_path)}
                            alt={`Damage evidence ${index + 1}`}
                            className="h-28 w-36 rounded-lg border object-cover"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">Original GRN</span>
                    <p className="font-medium">{c.grn_number || "Pending"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Response</span>
                    <p className="font-medium">
                      {c.response?.replaceAll("_", " ") || "Awaiting supplier"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Resolution</span>
                    <p className="font-medium">{c.resolution?.replaceAll("_", " ") || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Quarantine</span>
                    <p className="font-medium text-orange-600">Original goods retained</p>
                  </div>
                </div>
                {has("SUPPLIER") && !c.response && (
                  <div className="mt-4 grid gap-3 rounded-xl border p-4 md:grid-cols-2">
                    <select
                      className="h-10 rounded-md border bg-background px-3"
                      value={f.response || ""}
                      onChange={(e) => patch(c.id, { response: e.target.value, validation: "" })}
                    >
                      <option value="">Select response</option>
                      <option value="ACCEPT">Accept</option>
                      <option value="REJECT">Reject</option>
                      <option value="PARTIALLY_ACCEPT">Partially Accept</option>
                      <option value="REQUEST_MORE_INFORMATION">Request More Information</option>
                    </select>
                    <select
                      className="h-10 rounded-md border bg-background px-3"
                      value={f.resolution || ""}
                      onChange={(e) => patch(c.id, { resolution: e.target.value, validation: "" })}
                    >
                      <option value="">Select resolution</option>
                      {resolutions.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      placeholder="Supplier remarks"
                      value={f.remarks || ""}
                      onChange={(e) => patch(c.id, { remarks: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-sm">
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
                    <Button disabled={busy === c.id} onClick={() => submitResponse(c, f)}>
                      Submit Response
                    </Button>
                  </div>
                )}
                {has("SUPPLIER") &&
                  ["REPLACEMENT", "RETURN_REPLACEMENT"].includes(c.resolution) &&
                  !s && (
                    <div className="mt-4 flex gap-3 rounded-xl border p-4">
                      <Input
                        placeholder="Replacement vehicle number"
                        value={f.vehicle || ""}
                        onChange={(e) => patch(c.id, { vehicle: e.target.value })}
                      />
                      <Button
                        onClick={() =>
                          void run(
                            c.id,
                            () =>
                              api.createReplacementShipment(c.id, { vehicle_number: f.vehicle }),
                            "Replacement shipment created",
                          )
                        }
                      >
                        Send Replacement
                      </Button>
                    </div>
                  )}
                {s && (
                  <div className="mt-4 rounded-xl border p-4">
                    <div className="flex justify-between">
                      <strong>{s.shipment_number}</strong>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Vehicle {s.vehicle_number} · Expected {s.expected_quantity} {c.uom} · Gate{" "}
                      {s.gate_entry_number || "pending"} · RGRN{" "}
                      {s.replacement_grn_number || "pending"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {has("GATE_SECURITY") && s.status === "IN_TRANSIT" && (
                        <Button
                          onClick={() =>
                            void run(
                              s.id,
                              () => api.replacementGateEntry(s.id, s.vehicle_number),
                              "Replacement gate entry recorded",
                            )
                          }
                        >
                          Record Gate Entry
                        </Button>
                      )}
                      {has("WAREHOUSE") && s.status === "AT_RECEIVING" && (
                        <Button
                          onClick={() =>
                            void run(
                              s.id,
                              () => api.receiveReplacement(s.id, s.expected_quantity),
                              "Replacement GRN created",
                            )
                          }
                        >
                          Receive {s.expected_quantity} & Create RGRN
                        </Button>
                      )}
                      {has("WAREHOUSE") && s.status === "AWAITING_INSPECTION" && (
                        <Button
                          onClick={() =>
                            void run(
                              s.id,
                              () => api.inspectReplacement(s.id, s.received_quantity, 0),
                              "Replacement inspection passed",
                            )
                          }
                        >
                          Accept All {s.received_quantity}
                        </Button>
                      )}
                      {has("WAREHOUSE") && s.status === "INSPECTION_PASSED" && (
                        <>
                          <Input
                            className="max-w-52"
                            placeholder="Storage location"
                            value={f.location || ""}
                            onChange={(e) => patch(c.id, { location: e.target.value })}
                          />
                          <Button
                            onClick={() =>
                              void run(
                                s.id,
                                () => api.putawayReplacement(s.id, f.location),
                                "Replacement put away",
                              )
                            }
                          >
                            Complete Putaway
                          </Button>
                        </>
                      )}
                      {has("WAREHOUSE") && s.status === "PUTAWAY_COMPLETED" && (
                        <Button
                          onClick={() =>
                            void run(
                              s.id,
                              () => api.postReplacementInventory(s.id),
                              "Replacement added to available inventory",
                            )
                          }
                        >
                          Post to Inventory
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {c.return_required && has("WAREHOUSE") && !c.return && (
                  <div className="mt-4 flex gap-3">
                    <Input
                      placeholder="Return vehicle number"
                      value={f.returnVehicle || ""}
                      onChange={(e) =>
                        patch(c.id, { returnVehicle: e.target.value.replace(/[^A-Za-z0-9 ]/g, "") })
                      }
                    />
                    <Button
                      variant="destructive"
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
                      Create Supplier Return
                    </Button>
                  </div>
                )}
                {c.return && (
                  <div className="mt-4 flex items-center justify-between rounded-xl border p-4">
                    <span>
                      {c.return.return_number} · {c.return.status.replaceAll("_", " ")}
                    </span>
                    {has("GATE_SECURITY") && c.return.status === "AWAITING_GATE_EXIT" && (
                      <Button
                        onClick={() =>
                          void run(
                            c.return.id,
                            () => api.completeSupplierReturn(c.return.id),
                            "Damaged goods returned to supplier",
                          )
                        }
                      >
                        Complete Gate Exit
                      </Button>
                    )}
                  </div>
                )}
                {has("PROCUREMENT") && c.status !== "CLOSED" && (
                  <Button
                    className="mt-4"
                    variant="outline"
                    onClick={() =>
                      void run(c.id, () => api.closeDamageClaim(c.id), "Damage claim closed")
                    }
                  >
                    Close Claim
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

// Trigger update
