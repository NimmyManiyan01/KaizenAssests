import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { isValidMobileNumber, isValidPersonName, isValidVehicleNumber, sanitizeMobileNumber, sanitizePersonName, sanitizeVehicleNumber } from "@/lib/input-validation";

export const Route = createFileRoute("/gate/finished-goods-pickup")({
  component: FinishedGoodsPickupGatePage,
});

function FinishedGoodsPickupGatePage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [requestNumber, setRequestNumber] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => setRequests(await api.getSupplierFinishedGoodsDispatchRequests());
  useEffect(() => {
    void load();
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidVehicleNumber(vehicleNumber) || !isValidPersonName(driverName) || !isValidMobileNumber(driverContact)) {
      toast.error("Use letters, numbers and spaces for vehicle, letters and spaces for driver, and exactly 10 digits for contact");
      return;
    }
    setBusy(true);
    try {
      const result = await api.createFinishedGoodsPickupGateEntry({
        request_number: requestNumber,
        vehicle_number: vehicleNumber,
        driver_name: driverName,
        driver_contact: driverContact,
      });
      toast.success(`Gate pass ${result.gate_pass_number} generated`);
      setRequestNumber("");
      setVehicleNumber("");
      setDriverName("");
      setDriverContact("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create pickup gate entry");
    } finally {
      setBusy(false);
    }
  };
  const pickupRequests = requests.filter((request) =>
    ["ALLOCATED", "APPROVED"].includes(request.status),
  );
  return (
    <AppShell
      title="Finished-Goods Pickup Gate Entry"
      subtitle="Register an empty supplier vehicle and issue a pickup gate pass."
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <form onSubmit={submit} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm">
          <div>
            <Label>Dispatch request number</Label>
            <Input
              required
              placeholder="FGD-20261012-ABC123"
              value={requestNumber}
              onChange={(event) => setRequestNumber(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Actual vehicle number</Label>
              <Input
                required
                value={vehicleNumber}
                onChange={(event) => setVehicleNumber(sanitizeVehicleNumber(event.target.value))}
              />
            </div>
            <div>
              <Label>Driver name</Label>
              <Input
                required
                value={driverName}
                onChange={(event) => setDriverName(sanitizePersonName(event.target.value))}
              />
            </div>
            <div>
              <Label>Driver contact</Label>
              <Input
                required
                value={driverContact}
                maxLength={10}
                onChange={(event) => setDriverContact(sanitizeMobileNumber(event.target.value))}
              />
            </div>
          </div>
          <Button disabled={busy}>{busy ? "Generating..." : "Generate Pickup Gate Pass"}</Button>
        </form>
        <div className="rounded-2xl border bg-card p-5">
          <h2 className="font-bold">Pickup requests</h2>
          <div className="mt-3 divide-y">
            {pickupRequests.map((request) => (
              <button
                type="button"
                key={request.id}
                onClick={() => setRequestNumber(request.request_number)}
                className="flex w-full justify-between py-3 text-left hover:bg-muted/40"
              >
                <span>
                  <span className="font-mono font-semibold text-primary">
                    {request.request_number}
                  </span>
                  <span className="ml-3 text-sm">
                    {request.product_name} · {request.quantity} {request.uom}
                  </span>
                  {request.gate_pass_number && (
                    <span className="ml-3 text-sm font-semibold text-emerald-600">
                      Gate pass: {request.gate_pass_number}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{request.status}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
