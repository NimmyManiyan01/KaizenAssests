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
import { toast } from "sonner";

export const Route = createFileRoute("/supplier/dispatch")({
  component: SupplierDispatchPage,
});

function SupplierDispatchPage() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [vehicleNumber, setVehicleNumber] = React.useState("");
  const [driverName, setDriverName] = React.useState("");
  const [driverContact, setDriverContact] = React.useState("");
  const [expectedPickupDate, setExpectedPickupDate] = React.useState("");
  const [finishedGoods, setFinishedGoods] = React.useState<
    Array<{
      code: string;
      name: string;
      quantity: number;
      uom: string;
      batch?: string;
      serial?: string;
    }>
  >([]);
  const [goods, setGoods] = React.useState([{ name: "", quantity: "", custom: false }]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const firstInvalidRef = React.useRef<HTMLInputElement | HTMLSelectElement | null>(null);
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
          batch: row.batch_number,
          serial: row.serial_number,
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
    const selectedGood = finishedGoods.find(
      (good) => good.name === goods[0]?.name || good.code === goods[0]?.name,
    );
    const quantity = Number(goods[0]?.quantity);
    const nextErrors: Record<string, string> = {};
    if (!expectedPickupDate || expectedPickupDate < today)
      nextErrors.pickupDate = "Select today or a future pickup date.";
    if (!/^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}$/.test(vehicleNumber.trim().toUpperCase()))
      nextErrors.vehicle = "Enter a valid vehicle number.";
    if (!/^[A-Za-z][A-Za-z .-]*$/.test(driverName.trim()))
      nextErrors.driver = "Driver name is required.";
    if (!/^[6-9]\d{9}$/.test(driverContact))
      nextErrors.contact = "Enter a valid 10-digit mobile number.";
    if (!selectedGood) nextErrors.goods = "Select an available finished good.";
    if (!Number.isInteger(quantity) || quantity <= 0)
      nextErrors.quantity = "Enter a whole number greater than zero.";
    else if (selectedGood && quantity > selectedGood.quantity)
      nextErrors.quantity = `Quantity cannot exceed available stock (${selectedGood.quantity} ${selectedGood.uom}).`;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      firstInvalidRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const createdDispatch = await api.createSupplierFinishedGoodsDispatchRequest({
        product_code: selectedGood.code,
        product_name: selectedGood.name,
        quantity,
        vehicle_number: vehicleNumber.trim().toUpperCase(),
        driver_name: driverName.trim().replace(/\s+/g, " "),
        driver_contact: driverContact,
        expected_pickup_date: expectedPickupDate,
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
          material_code: selectedGood.code,
          material_name: selectedGood.name,
          quantity_ordered: quantity,
          quantity_available: selectedGood.quantity,
          quantity_pending: quantity,
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
      setErrors({});
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
      title="Finished Goods Dispatch Requests"
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
            <p className="text-sm text-muted-foreground">Dispatch Details</p>
          </DialogHeader>
          <form onSubmit={submitDispatch} className="space-y-5">
            <section className="space-y-3">
              <h3 className="font-semibold">Pickup Details</h3>
              <div>
                <Label htmlFor="pickup-date">Expected pickup date *</Label>
                <Input
                  ref={firstInvalidRef as React.RefObject<HTMLInputElement>}
                  id="pickup-date"
                  aria-invalid={Boolean(errors.pickupDate)}
                  aria-describedby={errors.pickupDate ? "pickup-date-error" : undefined}
                  required
                  type="date"
                  min={today}
                  value={expectedPickupDate}
                  onChange={(e) => {
                    setExpectedPickupDate(e.target.value);
                    setErrors((x) => ({ ...x, pickupDate: "" }));
                  }}
                />
                {errors.pickupDate && (
                  <p id="pickup-date-error" className="text-sm text-destructive">
                    {errors.pickupDate}
                  </p>
                )}
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Transport Details</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="vehicle-number">Vehicle number *</Label>
                  <Input
                    ref={firstInvalidRef as React.RefObject<HTMLInputElement>}
                    id="vehicle-number"
                    aria-invalid={Boolean(errors.vehicle)}
                    placeholder="KA42EH6948"
                    required
                    value={vehicleNumber}
                    onChange={(e) =>
                      setVehicleNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ""))
                    }
                  />
                  {errors.vehicle && <p className="text-sm text-destructive">{errors.vehicle}</p>}
                </div>
                <div>
                  <Label htmlFor="driver-name">Driver name *</Label>
                  <Input
                    ref={firstInvalidRef as React.RefObject<HTMLInputElement>}
                    id="driver-name"
                    aria-invalid={Boolean(errors.driver)}
                    required
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value.replace(/[^A-Za-z .-]/g, ""))}
                  />
                  {errors.driver && <p className="text-sm text-destructive">{errors.driver}</p>}
                </div>
                <div>
                  <Label htmlFor="driver-contact">Driver contact *</Label>
                  <Input
                    ref={firstInvalidRef as React.RefObject<HTMLInputElement>}
                    id="driver-contact"
                    aria-invalid={Boolean(errors.contact)}
                    required
                    type="tel"
                    maxLength={10}
                    value={driverContact}
                    onChange={(e) =>
                      setDriverContact(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                  />
                  {errors.contact && <p className="text-sm text-destructive">{errors.contact}</p>}
                </div>
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Finished Goods</h3>
              {!finishedGoods.length && (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    No finished goods are available for dispatch.
                  </p>
                  <p>Complete assembly receipt and quality approval before creating a dispatch.</p>
                </div>
              )}
              {goods.map((item, index) => (
                <div className="flex gap-2" key={index}>
                  <select
                    ref={firstInvalidRef as React.RefObject<HTMLSelectElement>}
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
                        : "No finished goods available for dispatch"}
                    </option>
                    {finishedGoods.map((good) => (
                      <option key={good.code} value={good.name}>
                        {good.code} — {good.name} ({good.quantity} {good.uom})
                        {good.batch ? ` · Batch ${good.batch}` : ""}
                      </option>
                    ))}
                  </select>
                  <Input
                    required
                    className="min-w-0 flex-1"
                    min="1"
                    step="1"
                    type="number"
                    inputMode="numeric"
                    placeholder="Dispatch quantity"
                    value={item.quantity}
                    onChange={(e) =>
                      setGoods((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? { ...row, quantity: e.target.value.replace(/\D/g, "") }
                            : row,
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
            </section>
            {errors.quantity && <p className="text-sm text-destructive">{errors.quantity}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !finishedGoods.length}>
                {submitting ? "Creating…" : "Create Dispatch Request"}
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
