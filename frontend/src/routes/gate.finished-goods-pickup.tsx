import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Plus, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/gate/finished-goods-pickup")({
  component: FinishedGoodsPickupGatePage,
});
const eligibleStatuses = ["ALLOCATED", "APPROVED", "READY_FOR_PICKUP"];
const vehiclePattern = /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4}$/;
const statusLabel = (status: string) => status.replaceAll("_", " ");

function FinishedGoodsPickupGatePage() {
  const [entryOpen, setEntryOpen] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [mismatchReason, setMismatchReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<any | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitPass, setExitPass] = useState("");
  const [exitDetails, setExitDetails] = useState<any | null>(null);
  const [exitDocs, setExitDocs] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);

  const lookupExitPass = async () => {
    const normalized = exitPass.trim().toUpperCase();
    setExitPass(normalized);
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      toast.error("Enter or scan a valid six-character gate pass.");
      return;
    }
    try {
      const result = await api.getFinishedGoodsPickupGatePass(normalized);
      setExitDetails(result);
      setExitDocs(false);
    } catch (err) {
      setExitDetails(null);
      toast.error(err instanceof Error ? err.message : "Gate pass not found.");
    }
  };

  const confirmExit = async () => {
    if (!exitDetails || !exitDocs) return;
    setExitBusy(true);
    try {
      const result = await api.completeFinishedGoodsPickupGateExit(exitPass, {
        vehicle_number: exitDetails.vehicle_number,
        driver_name: exitDetails.driver_name,
        documents_verified: true,
      });
      toast.success(`${result.request_number} exited successfully`, {
        description: `Exit recorded at ${new Date(result.exited_at).toLocaleString()}.`,
      });
      setExitOpen(false);
      setExitPass("");
      setExitDetails(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gate exit failed.");
    } finally {
      setExitBusy(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRequests(await api.getSupplierFinishedGoodsDispatchRequests());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load pickup requests.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const filteredRequests = useMemo(
    () =>
      requests.filter((request) => {
        const text =
          `${request.request_number} ${request.supplier_name ?? ""} ${request.vehicle_number ?? ""} ${request.driver_name ?? ""}`.toLowerCase();
        return (
          (!query.trim() || text.includes(query.trim().toLowerCase())) &&
          (statusFilter === "ALL" ||
            request.status === statusFilter ||
            request.gate_pass_status === statusFilter)
        );
      }),
    [requests, query, statusFilter],
  );
  const vehicle = vehicleNumber.trim().toUpperCase().replace(/\s+/g, " ");
  const contact = driverContact.replace(/\D/g, "");
  const vehicleMismatch = Boolean(
    selected?.vehicle_number &&
    vehicle &&
    selected.vehicle_number.toUpperCase().replace(/\s/g, "") !== vehicle.replace(/\s/g, ""),
  );
  const driverMismatch = Boolean(
    selected?.driver_name &&
    driverName.trim() &&
    selected.driver_name.trim().toLowerCase() !== driverName.trim().toLowerCase(),
  );
  const hasMismatch = vehicleMismatch || driverMismatch;
  const transportValid =
    vehiclePattern.test(vehicle) &&
    /^[A-Z .-]+$/i.test(driverName.trim()) &&
    /^[6-9]\d{9}$/.test(contact);

  const chooseRequest = (request: any) => {
    setSelected(request);
    setVehicleNumber(request.vehicle_number || "");
    setDriverName(request.driver_name || "");
    setDriverContact(request.driver_contact || "");
    setMismatchReason("");
    setSuccess(null);
  };
  const lookupRequest = () => {
    const requestNumber = query.trim().toLowerCase();
    if (!requestNumber) return;
    const match = requests.find(
      (request) => String(request.request_number || "").toLowerCase() === requestNumber,
    );
    if (match) chooseRequest(match);
    else if (requestNumber.includes("-") || requestNumber.length > 5)
      toast.error("Dispatch request not found", {
        description: "Enter an existing dispatch request number.",
      });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) {
      toast.error("Select an eligible dispatch request.");
      return;
    }
    if (!eligibleStatuses.includes(selected.status)) {
      toast.error("This dispatch request is not approved.");
      return;
    }
    if (selected.gate_pass_number) {
      toast.error("A gate pass already exists for this request.");
      return;
    }
    if (!transportValid) {
      toast.error("Enter a valid vehicle number, driver name and 10-digit Indian mobile number.");
      return;
    }
    if (hasMismatch && !mismatchReason.trim()) {
      toast.error("Enter a reason for the vehicle or driver mismatch.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.createFinishedGoodsPickupGateEntry({
        request_number: selected.request_number,
        vehicle_number: vehicle,
        driver_name: driverName.trim().replace(/\s+/g, " "),
        driver_contact: contact,
      });
      setSuccess(result);
      toast.success(`Gate pass ${result.gate_pass_number} generated`);
      await load();
      window.setTimeout(() => setEntryOpen(false), 1800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create pickup gate entry");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Finished Goods Pickup Entry & Exit"
      subtitle="Create pickup gate entries, generate gate passes, and securely manage finished-goods vehicle exits."
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={() => setEntryOpen(true)}>
            <Plus className="mr-2 size-4" /> FG Entry
          </Button>
          <Button variant="outline" onClick={() => setExitOpen(true)}>
            <RefreshCw className="mr-2 size-4" /> Exit Vehicle
          </Button>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 size-4" /> Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Dialog open={exitOpen} onOpenChange={setExitOpen}>
          <DialogContent className="w-[min(92vw,520px)] rounded-2xl">
            <DialogHeader>
              <DialogTitle>FG Pickup Vehicle Exit</DialogTitle>
              <DialogDescription>Enter or scan the original gate pass. Exit is enabled only after the pass and required documents are verified.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="fg-exit-pass">Gate Pass Number</Label>
                <div className="flex gap-2">
                  <Input id="fg-exit-pass" autoFocus className="font-mono uppercase" value={exitPass} onChange={(e) => setExitPass(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookupExitPass(); } }} placeholder="Scan or enter pass" />
                  <Button type="button" variant="outline" onClick={() => void lookupExitPass()}>Verify</Button>
                </div>
              </div>
              {exitDetails && (
                <Card className="grid gap-2 border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                  <p><span className="text-muted-foreground">Request:</span> {exitDetails.request_number}</p>
                  <p><span className="text-muted-foreground">Status:</span> {exitDetails.status}</p>
                  <p><span className="text-muted-foreground">Vehicle:</span> {exitDetails.vehicle_number}</p>
                  <p><span className="text-muted-foreground">Driver:</span> {exitDetails.driver_name}</p>
                  <p className="sm:col-span-2"><span className="text-muted-foreground">Entry:</span> {exitDetails.entered_at ? new Date(exitDetails.entered_at).toLocaleString() : "—"}</p>
                </Card>
              )}
              {exitDetails && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={exitDocs} onChange={(e) => setExitDocs(e.target.checked)} /> Packing list and dispatch documents verified</label>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExitOpen(false)}>Cancel</Button>
              <Button disabled={!exitDetails || !exitDocs || exitBusy} onClick={() => void confirmExit()}>{exitBusy ? "Recording exit…" : "Confirm Exit"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
          <DialogContent className="w-[min(92vw,620px)] max-w-[620px] max-h-[90vh] overflow-y-auto rounded-2xl">
            {success && (
              <Card className="border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <div className="flex items-center justify-between gap-2 font-semibold">
                  <CheckCircle2 className="size-5" /> Pickup gate pass generated: {success.gate_pass_number}
                  <Button size="sm" variant="outline" onClick={() => { setExitPass(success.gate_pass_number); setExitOpen(true); }}>
                    Exit Vehicle
                  </Button>
                </div>
                <p className="mt-1 text-sm">
                  Request {success.request_number} is now {statusLabel(success.status || "INSIDE_FACILITY")}.
                </p>
              </Card>
            )}
            <Card className="border-0 p-1 shadow-none">
              <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4">
                  <div>
                    <Label htmlFor="pickup-request">Dispatch Number *</Label>
                    <Input
                      id="pickup-request"
                      value={query}
                      onChange={(e) => {
                        const value = e.target.value;
                        setQuery(value);
                        if (
                          selected &&
                          value.trim().toLowerCase() !==
                            String(selected.request_number || "").toLowerCase()
                        ) {
                          setSelected(null);
                          setVehicleNumber("");
                          setDriverName("");
                          setDriverContact("");
                        }
                      }}
                      onBlur={lookupRequest}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          lookupRequest();
                        }
                      }}
                      placeholder="Enter dispatch request number"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Enter the request number and press Enter to auto-fill the details.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="finished-goods">Finished goods</Label>
                          <Input
                            id="finished-goods"
                            readOnly
                            value={selected ? `${selected.product_name || "—"} · ${selected.quantity || 0} ${selected.uom || "PCS"}` : ""}
                            placeholder="Auto-filled from dispatch"
                          />
                        </div>
                        <div>
                          <Label htmlFor="expected-pickup">Expected pickup</Label>
                          <Input
                            id="expected-pickup"
                            readOnly
                            value={selected?.expected_pickup_date || ""}
                            placeholder="Auto-filled from dispatch"
                          />
                        </div>
                    </div>
                    <div className="hidden">
                      {filteredRequests
                        .filter((r) => !r.gate_pass_number && eligibleStatuses.includes(r.status))
                        .map((request) => (
                          <button
                            type="button"
                            key={request.id}
                            onClick={() => {
                              setQuery(request.request_number);
                              chooseRequest(request);
                            }}
                            className={`block w-full border-b p-3 text-left last:border-0 hover:bg-muted/50 ${selected?.id === request.id ? "bg-primary/10" : ""}`}
                          >
                            <span className="font-mono font-semibold text-primary">
                              {request.request_number}
                            </span>
                            <span className="ml-2 text-sm">
                              {request.supplier_name || "Supplier not specified"}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {request.product_name} · {request.quantity} {request.uom} ·{" "}
                              {request.vehicle_number || "Vehicle pending"} ·{" "}
                              {statusLabel(request.status)}
                            </span>
                          </button>
                        ))}
                      {!loading &&
                        filteredRequests.filter(
                          (r) => !r.gate_pass_number && eligibleStatuses.includes(r.status),
                        ).length === 0 && (
                          <p className="p-4 text-sm text-muted-foreground">
                            No eligible dispatch requests found.
                          </p>
                        )}
                    </div>
                  </div>
                  <div className="hidden">
                    <h2 className="font-bold">Selected request summary</h2>
                    {selected ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 [&>p]:rounded-lg [&>p]:border [&>p]:bg-background [&>p]:p-2.5">
                        <p>
                          <span className="text-muted-foreground">Supplier:</span>{" "}
                          {selected.supplier_name || "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Finished goods:</span>{" "}
                          {selected.product_name} · {selected.quantity} {selected.uom}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Expected pickup:</span>{" "}
                          {selected.expected_pickup_date || "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Expected vehicle:</span>{" "}
                          {selected.vehicle_number || "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Expected driver:</span>{" "}
                          {selected.driver_name || "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Approval:</span>{" "}
                          {statusLabel(selected.status)}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Gate pass:</span>{" "}
                          {selected.gate_pass_number || "None"}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 text-muted-foreground">
                        Choose an eligible request to verify its details.
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label htmlFor="actual-vehicle">Actual vehicle number *</Label>
                    <Input
                      id="actual-vehicle"
                      readOnly={Boolean(selected)}
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                      aria-invalid={Boolean(vehicleNumber && !vehiclePattern.test(vehicle))}
                      placeholder="Auto-filled from dispatch request"
                    />
                    {vehicleNumber && !vehiclePattern.test(vehicle) && (
                      <p className="mt-1 text-xs text-destructive">
                        Enter a valid Indian vehicle number.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="pickup-driver">Driver name *</Label>
                    <Input
                      id="pickup-driver"
                      readOnly={Boolean(selected)}
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder="Auto-filled from dispatch request"
                    />
                  </div>
                  <div>
                    <Label htmlFor="pickup-contact">Driver contact *</Label>
                    <Input
                      id="pickup-contact"
                      readOnly={Boolean(selected)}
                      type="tel"
                      inputMode="numeric"
                      value={driverContact}
                      onChange={(e) =>
                        setDriverContact(e.target.value.replace(/\D/g, "").slice(0, 10))
                      }
                      aria-invalid={Boolean(driverContact && !/^[6-9]\d{9}$/.test(contact))}
                      placeholder="Auto-filled from dispatch request"
                    />
                  </div>
                </div>
                {hasMismatch && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="size-4" /> Details differ from the dispatch request
                    </div>
                    <p className="mt-1">
                      Expected: {selected?.vehicle_number || "—"} / {selected?.driver_name || "—"} ·
                      Actual: {vehicle || "—"} / {driverName || "—"}
                    </p>
                    <Input
                      className="mt-2 bg-white"
                      value={mismatchReason}
                      onChange={(e) => setMismatchReason(e.target.value)}
                      placeholder="Mismatch reason required"
                      aria-label="Mismatch reason"
                    />
                  </div>
                )}
                <Button type="submit" disabled={busy || !selected}>
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" /> Generating...
                    </>
                  ) : (
                    "Generate Pickup Gate Pass"
                  )}
                </Button>
              </form>
            </Card>
          </DialogContent>
        </Dialog>
        {success && (
          <Card className="border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="size-5" /> Pickup gate pass generated:{" "}
              {success.gate_pass_number}
            </div>
            <p className="mt-1 text-sm">
              Request {success.request_number} is now{" "}
              {statusLabel(success.status || "INSIDE_FACILITY")}.
            </p>
          </Card>
        )}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <h2 className="font-bold">Pickup Requests</h2>
            <div className="flex gap-2">
              <Input
                className="w-56"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search requests…"
                aria-label="Search pickup requests"
              />
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter pickup request status"
              >
                <option value="ALL">All statuses</option>
                {[
                  "ALLOCATED",
                  "APPROVED",
                  "INSIDE_FACILITY",
                  "ON_HOLD",
                  "DISPATCHED",
                  "CANCELLED",
                ].map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto size-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">
              {error}
              <br />
              <Button className="mt-2" variant="outline" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>No pickup requests are available.</p>
              <p className="text-sm">Approved finished-goods dispatch requests will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm [&_th:nth-child(2)]:hidden [&_td:nth-child(2)]:hidden">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    {[
                      "Request Number",
                      "Supplier",
                      "Finished Goods",
                      "Quantity",
                      "Expected Pickup",
                      "Vehicle",
                      "Driver",
                      "Status",
                      "Gate Pass",
                    ].map((heading) => (
                      <th key={heading} className="whitespace-nowrap px-4 py-3">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRequests.map((request) => (
                    <tr key={request.id}>
                      <td className="px-4 py-3 font-mono font-semibold text-primary">
                        {request.request_number}
                      </td>
                      <td className="px-4 py-3">{request.supplier_name || "—"}</td>
                      <td className="px-4 py-3">{request.product_name || "—"}</td>
                      <td className="px-4 py-3">
                        {request.quantity} {request.uom}
                      </td>
                      <td className="px-4 py-3">{request.expected_pickup_date || "—"}</td>
                      <td className="px-4 py-3">{request.vehicle_number || "—"}</td>
                      <td className="px-4 py-3">{request.driver_name || "—"}</td>
                      <td className="px-4 py-3">
                        {statusLabel(request.gate_pass_status || request.status)}
                      </td>
                      <td className="px-4 py-3">{request.gate_pass_number || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
