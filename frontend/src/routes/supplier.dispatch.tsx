import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Eye, Plus, RefreshCw, X } from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import {
  isValidMobileNumber,
  isValidPersonName,
  isValidVehicleNumber,
  parsePositiveNumber,
  requiredText,
  sanitizeMobileNumber,
  sanitizePersonName,
  sanitizeVehicleNumber,
} from "@/lib/input-validation";
import { toast } from "sonner";

export const Route = createFileRoute("/supplier/dispatch")({
  component: SupplierDispatchPage,
});

function SupplierDispatchPage() {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [vehicleNumber, setVehicleNumber] = React.useState("");
  const [driverName, setDriverName] = React.useState("");
  const [driverContact, setDriverContact] = React.useState("");
  const [expectedPickupDate, setExpectedPickupDate] = React.useState("");
  const [finishedGoods, setFinishedGoods] = React.useState<
    Array<{ code: string; name: string; quantity: number; uom: string }>
  >([]);
  const [goods, setGoods] = React.useState([{ name: "", quantity: "", custom: false }]);
  const [dispatchHistory, setDispatchHistory] = React.useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(true);
  const [selectedDispatch, setSelectedDispatch] = React.useState<any | null>(null);
  const dispatchDetailsKey = "kaizen-supplier-dispatch-details";

  const loadAssemblyFinishedGoods = React.useCallback(async () => {
    try {
      const rows = await api.getAssemblyFinishedGoods();
      const available = (Array.isArray(rows) ? rows : [])
        .filter(
          (row: any) =>
            ["AVAILABLE", "QC_APPROVED"].includes(String(row.status).toUpperCase()) &&
            Number(row.quantity) > 0,
        )
        .map((row: any) => ({
          code: row.product_code,
          name: row.product_name || row.product_code,
          quantity: Number(row.quantity),
          uom: row.uom || "PCS",
        }))
        .filter(
          (row, index, all) => all.findIndex((candidate) => candidate.code === row.code) === index,
        );
      setFinishedGoods(available);
    } catch {
      setFinishedGoods([]);
    }
  }, []);

  const loadDispatchHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await api.getSupplierFinishedGoodsDispatchRequests();
      setDispatchHistory(response || []);
    } catch (error) {
      toast.error("Could not load dispatch history", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDispatchHistory();
  }, [loadDispatchHistory]);

  React.useEffect(() => {
    void loadAssemblyFinishedGoods();
  }, [loadAssemblyFinishedGoods]);

  const submitDispatch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const names = goods
      .map((item) => requiredText(item.name))
      .filter((value): value is string => Boolean(value));
    const firstQuantity = parsePositiveNumber(goods[0]?.quantity);
    const vehicle = requiredText(vehicleNumber);
    const driver = requiredText(driverName);
    const contact = requiredText(driverContact);
    if (!names.length || firstQuantity === null || !vehicle || !driver || !contact) {
      toast.error("Enter a finished good, positive quantity, vehicle, driver, and contact");
      return;
    }
    if (
      !isValidVehicleNumber(vehicle) ||
      !isValidPersonName(driver) ||
      !isValidMobileNumber(contact)
    ) {
      toast.error(
        "Use letters, numbers and spaces for vehicle, letters and spaces for driver, and exactly 10 digits for contact",
      );
      return;
    }
    const pickupDate = /^\d{2}-\d{2}-\d{4}$/.test(expectedPickupDate)
      ? expectedPickupDate.split("-").reverse().join("-")
      : expectedPickupDate;
    if (!pickupDate.trim()) {
      toast.error("Enter a valid expected pickup date");
      return;
    }
    const selectedGood = finishedGoods.find(
      (good) => good.name === names[0] || good.code === names[0],
    );
    if (selectedGood && firstQuantity > selectedGood.quantity) {
      toast.error("Quantity exceeds available finished goods stock");
      return;
    }
    setSubmitting(true);
    try {
      const createdDispatch = await api.createSupplierFinishedGoodsDispatchRequest({
        product_code: selectedGood?.code || names[0] || "FINISHED-GOOD",
        product_name: names[0] || "Finished Good",
        quantity: firstQuantity,
        vehicle_number: vehicle,
        driver_name: driver,
        driver_contact: contact,
        expected_pickup_date: pickupDate,
        /* request metadata is persisted by the supplier request endpoint */
        /* legacy dispatch fields below are intentionally ignored */
        order_number: `SUP-DISPATCH-${Date.now()}`,
        customer_name: "Warehouse",
        dispatch_type: "Finished Goods",
        warehouse_id: "WH-01",
        contact_person: driverName,
        contact_phone: driverContact,
        transporter: vehicleNumber,
        notes: `Vehicle: ${vehicleNumber}\nDriver: ${driverName}\nDriver contact: ${driverContact}`,
        items: goods.map((item) => ({
          material_code: item.name.trim().toUpperCase().replace(/\s+/g, "-") || "FINISHED-GOOD",
          material_name: item.name.trim(),
          quantity_ordered: parsePositiveNumber(item.quantity) ?? 0,
          quantity_available: parsePositiveNumber(item.quantity) ?? 0,
          quantity_pending: parsePositiveNumber(item.quantity) ?? 0,
          uom: "PCS",
        })),
      } as any);
      const dispatchKey = String(
        createdDispatch?.dispatch_number ||
          createdDispatch?.order_number ||
          createdDispatch?.id ||
          "",
      );
      if (dispatchKey) {
        const savedDetails = JSON.parse(window.localStorage.getItem(dispatchDetailsKey) || "{}");
        savedDetails[dispatchKey] = {
          vehicle_number: vehicleNumber,
          driver_name: driverName,
          driver_contact: driverContact,
        };
        window.localStorage.setItem(dispatchDetailsKey, JSON.stringify(savedDetails));
      }
      toast.success("Dispatch created successfully");
      setOpen(false);
      setGoods([{ name: "", quantity: "", custom: false }]);
      setExpectedPickupDate("");
      void loadDispatchHistory();
    } catch (error) {
      toast.error("Could not create dispatch", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Supplier Dispatch"
      subtitle="Prepare and submit advance shipment notifications for warehouse arrival."
      actions={
        <Button
          type="button"
          onClick={() => {
            void loadAssemblyFinishedGoods();
            setOpen(true);
          }}
        >
          <Plus className="mr-2 size-4" /> Create Dispatch
        </Button>
      }
    >
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Dispatch history</CardTitle>
            <CardDescription>Track dispatches created by the supplier.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadDispatchHistory()}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Loading dispatch history…
            </div>
          ) : dispatchHistory.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No dispatches created yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Dispatch</th>
                    <th className="px-5 py-3">Finished goods</th>
                    <th className="px-5 py-3">Vehicle</th>
                    <th className="px-5 py-3">Driver</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dispatchHistory.map((dispatch) => (
                    <tr key={dispatch.id}>
                      <td className="px-5 py-3 font-mono font-semibold text-primary">
                        {dispatch.dispatch_number || dispatch.order_number || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {(dispatch.items || [])
                          .map(
                            (item: any) =>
                              `${item.material_name || item.material_code} (${item.quantity_ordered ?? 0})`,
                          )
                          .join(", ") || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {dispatch.vehicle_number || dispatch.transporter || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {dispatch.driver_name || dispatch.contact_person || "—"}
                      </td>
                      <td className="px-5 py-3">{dispatch.status || "—"}</td>
                      <td className="px-5 py-3">
                        {dispatch.created_at
                          ? new Date(dispatch.created_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedDispatch(dispatch)}
                        >
                          <Eye className="mr-1.5 size-4" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Dispatch</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitDispatch} className="space-y-5">
            <div>
              <Label htmlFor="pickup-date">Expected pickup date</Label>
              <Input
                id="pickup-date"
                required
                type="date"
                value={expectedPickupDate}
                onChange={(e) => setExpectedPickupDate(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="vehicle-number">Vehicle number</Label>
                <Input
                  id="vehicle-number"
                  required
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(sanitizeVehicleNumber(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="driver-name">Driver name</Label>
                <Input
                  id="driver-name"
                  required
                  value={driverName}
                  onChange={(e) => setDriverName(sanitizePersonName(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="driver-contact">Driver contact</Label>
                <Input
                  id="driver-contact"
                  required
                  type="tel"
                  maxLength={10}
                  value={driverContact}
                  onChange={(e) => setDriverContact(sanitizeMobileNumber(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold">Finished goods</h3>
              {goods.map((item, index) => (
                <div className="flex gap-2" key={index}>
                  <select
                    required
                    className="h-10 w-full min-w-[220px] flex-[2] rounded-md border bg-background px-3 text-sm"
                    value={item.name}
                    onChange={(e) =>
                      setGoods((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, name: e.target.value, custom: false } : row,
                        ),
                      )
                    }
                  >
                    <option value="">
                      {finishedGoods.length
                        ? "Select finished good"
                        : "No finished goods available in Assembly"}
                    </option>
                    {finishedGoods.map((good) => (
                      <option key={good.code} value={good.name}>
                        {good.name} ({good.quantity} {good.uom})
                      </option>
                    ))}
                  </select>
                  <Input
                    required
                    className="min-w-0 flex-1"
                    min="0.01"
                    step="any"
                    type="number"
                    placeholder="Quantity"
                    value={item.quantity}
                    onChange={(e) =>
                      setGoods((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, quantity: e.target.value } : row,
                        ),
                      )
                    }
                  />
                  {goods.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setGoods((rows) => rows.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create Dispatch"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selectedDispatch)}
        onOpenChange={(value) => !value && setSelectedDispatch(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Dispatch details</DialogTitle>
          </DialogHeader>
          {selectedDispatch && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
                <div>
                  <p className="text-xs text-muted-foreground">Dispatch number</p>
                  <p className="font-mono font-semibold">
                    {selectedDispatch.dispatch_number || selectedDispatch.order_number || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-semibold">{selectedDispatch.status || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vehicle number</p>
                  <p>{selectedDispatch.vehicle_number || selectedDispatch.transporter || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Driver name</p>
                  <p>{selectedDispatch.driver_name || selectedDispatch.contact_person || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Driver contact</p>
                  <p>{selectedDispatch.driver_contact || selectedDispatch.contact_phone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p>
                    {selectedDispatch.created_at
                      ? new Date(selectedDispatch.created_at).toLocaleString()
                      : "—"}
                  </p>
                </div>
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Finished goods</h3>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-left">
                    <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Material</th>
                        <th className="px-3 py-2">Quantity</th>
                        <th className="px-3 py-2">UOM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(selectedDispatch.items || []).map((item: any, index: number) => (
                        <tr key={item.id || index}>
                          <td className="px-3 py-2">
                            {item.material_name || item.material_code || "—"}
                          </td>
                          <td className="px-3 py-2">{item.quantity_ordered ?? 0}</td>
                          <td className="px-3 py-2">{item.uom || "PCS"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
