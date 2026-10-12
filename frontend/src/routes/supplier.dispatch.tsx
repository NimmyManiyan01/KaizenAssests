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
  const finishedGoodsKey = "kaizen-supplier-finished-goods";
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [vehicleNumber, setVehicleNumber] = React.useState("");
  const [driverName, setDriverName] = React.useState("");
  const [driverContact, setDriverContact] = React.useState("");
  const [finishedGoods, setFinishedGoods] = React.useState<string[]>([]);
  const [goods, setGoods] = React.useState([{ name: "", quantity: "", custom: false }]);
  const [customMaterialOpen, setCustomMaterialOpen] = React.useState(false);
  const [customMaterialName, setCustomMaterialName] = React.useState("");
  const [customMaterialRow, setCustomMaterialRow] = React.useState<number | null>(null);
  const [dispatchHistory, setDispatchHistory] = React.useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(true);
  const [selectedDispatch, setSelectedDispatch] = React.useState<any | null>(null);
  const dispatchDetailsKey = "kaizen-supplier-dispatch-details";

  const loadDispatchHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await api.getDispatches();
      const savedDetails = JSON.parse(window.localStorage.getItem(dispatchDetailsKey) || "{}");
      setDispatchHistory((response.items || []).map((dispatch: any) => ({
        ...dispatch,
        ...(savedDetails[String(dispatch.dispatch_number || dispatch.order_number || dispatch.id)] || {}),
      })));
    } catch (error) {
      toast.error("Could not load dispatch history", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadDispatchHistory(); }, [loadDispatchHistory]);

  React.useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(finishedGoodsKey) || "[]");
      if (Array.isArray(saved)) setFinishedGoods(saved.filter((value): value is string => typeof value === "string"));
    } catch { /* Ignore malformed browser storage. */ }
  }, []);

  const submitDispatch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const names = goods.map((item) => item.name.trim()).filter(Boolean);
    const savedGoods = Array.from(new Set([...finishedGoods, ...names])).sort((a, b) => a.localeCompare(b));
    window.localStorage.setItem(finishedGoodsKey, JSON.stringify(savedGoods));
    setFinishedGoods(savedGoods);
    setSubmitting(true);
    try {
      const createdDispatch = await api.createDispatch({
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
          quantity_ordered: Number(item.quantity),
          quantity_available: Number(item.quantity),
          quantity_pending: Number(item.quantity),
          uom: "PCS",
        })),
      });
      const dispatchKey = String(createdDispatch?.dispatch_number || createdDispatch?.order_number || createdDispatch?.id || "");
      if (dispatchKey) {
        const savedDetails = JSON.parse(window.localStorage.getItem(dispatchDetailsKey) || "{}");
        savedDetails[dispatchKey] = { vehicle_number: vehicleNumber, driver_name: driverName, driver_contact: driverContact };
        window.localStorage.setItem(dispatchDetailsKey, JSON.stringify(savedDetails));
      }
      toast.success("Dispatch created successfully");
      setOpen(false);
      setGoods([{ name: "", quantity: "", custom: false }]);
      void loadDispatchHistory();
    } catch (error) {
      toast.error("Could not create dispatch", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Supplier Dispatch"
      subtitle="Prepare and submit advance shipment notifications for warehouse arrival."
      actions={
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus className="mr-2 size-4" /> Create Dispatch
        </Button>
      }
    >
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div><CardTitle>Dispatch history</CardTitle><CardDescription>Track dispatches created by the supplier.</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => void loadDispatchHistory()}><RefreshCw className="mr-2 size-4" />Refresh</Button>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading dispatch history…</div> : dispatchHistory.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No dispatches created yet.</div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y bg-muted/30 text-xs uppercase text-muted-foreground"><tr><th className="px-5 py-3">Dispatch</th><th className="px-5 py-3">Finished goods</th><th className="px-5 py-3">Vehicle</th><th className="px-5 py-3">Driver</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Created</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y">{dispatchHistory.map((dispatch) => <tr key={dispatch.id}><td className="px-5 py-3 font-mono font-semibold text-primary">{dispatch.dispatch_number || dispatch.order_number || "—"}</td><td className="px-5 py-3">{(dispatch.items || []).map((item: any) => `${item.material_name || item.material_code} (${item.quantity_ordered ?? 0})`).join(", ") || "—"}</td><td className="px-5 py-3">{dispatch.vehicle_number || dispatch.transporter || "—"}</td><td className="px-5 py-3">{dispatch.driver_name || dispatch.contact_person || "—"}</td><td className="px-5 py-3">{dispatch.status || "—"}</td><td className="px-5 py-3">{dispatch.created_at ? new Date(dispatch.created_at).toLocaleDateString() : "—"}</td><td className="px-5 py-3"><Button variant="outline" size="sm" onClick={() => setSelectedDispatch(dispatch)}><Eye className="mr-1.5 size-4" />View</Button></td></tr>)}</tbody></table></div>}
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Create Dispatch</DialogTitle></DialogHeader>
          <form onSubmit={submitDispatch} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Label htmlFor="vehicle-number">Vehicle number</Label><Input id="vehicle-number" required value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} /></div>
              <div><Label htmlFor="driver-name">Driver name</Label><Input id="driver-name" required value={driverName} onChange={(e) => setDriverName(e.target.value)} /></div>
              <div><Label htmlFor="driver-contact">Driver contact</Label><Input id="driver-contact" required type="tel" value={driverContact} onChange={(e) => setDriverContact(e.target.value)} /></div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><h3 className="font-semibold">Finished goods</h3><Button type="button" variant="outline" size="sm" onClick={() => setGoods((rows) => [...rows, { name: "", quantity: "", custom: false }])}>Add item</Button></div>
              {goods.map((item, index) => <div className="flex gap-2" key={index}>
                {item.custom || finishedGoods.length === 0 ? <Input required className="min-w-0 flex-[2]" placeholder="Name of goods" value={item.name} onChange={(e) => setGoods((rows) => rows.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} /> : <select required className="h-10 w-full min-w-[220px] flex-[2] rounded-md border bg-background px-3 text-sm" value={item.name} onChange={(e) => { const value = e.target.value; if (value === "__custom__") { setCustomMaterialRow(index); setCustomMaterialName(""); setCustomMaterialOpen(true); return; } setGoods((rows) => rows.map((row, i) => i === index ? { ...row, name: value, custom: false } : row)); }}><option value="">Select finished good</option>{finishedGoods.map((name) => <option key={name} value={name}>{name}</option>)}<option value="__custom__">＋ Add custom material</option></select>}
                <Input required className="min-w-0 flex-1" min="0.01" step="any" type="number" placeholder="Quantity" value={item.quantity} onChange={(e) => setGoods((rows) => rows.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} />
                {goods.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setGoods((rows) => rows.filter((_, i) => i !== index))}><X className="size-4" /></Button>}
              </div>)}
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create Dispatch"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(selectedDispatch)} onOpenChange={(value) => !value && setSelectedDispatch(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Dispatch details</DialogTitle></DialogHeader>
          {selectedDispatch && <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3"><div><p className="text-xs text-muted-foreground">Dispatch number</p><p className="font-mono font-semibold">{selectedDispatch.dispatch_number || selectedDispatch.order_number || "—"}</p></div><div><p className="text-xs text-muted-foreground">Status</p><p className="font-semibold">{selectedDispatch.status || "—"}</p></div><div><p className="text-xs text-muted-foreground">Vehicle number</p><p>{selectedDispatch.vehicle_number || selectedDispatch.transporter || "—"}</p></div><div><p className="text-xs text-muted-foreground">Driver name</p><p>{selectedDispatch.driver_name || selectedDispatch.contact_person || "—"}</p></div><div><p className="text-xs text-muted-foreground">Driver contact</p><p>{selectedDispatch.driver_contact || selectedDispatch.contact_phone || "—"}</p></div><div><p className="text-xs text-muted-foreground">Created</p><p>{selectedDispatch.created_at ? new Date(selectedDispatch.created_at).toLocaleString() : "—"}</p></div></div>
            <div><h3 className="mb-2 font-semibold">Finished goods</h3><div className="overflow-hidden rounded-lg border"><table className="w-full text-left"><thead className="bg-muted/30 text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Material</th><th className="px-3 py-2">Quantity</th><th className="px-3 py-2">UOM</th></tr></thead><tbody className="divide-y">{(selectedDispatch.items || []).map((item: any, index: number) => <tr key={item.id || index}><td className="px-3 py-2">{item.material_name || item.material_code || "—"}</td><td className="px-3 py-2">{item.quantity_ordered ?? 0}</td><td className="px-3 py-2">{item.uom || "PCS"}</td></tr>)}</tbody></table></div></div>
          </div>}
        </DialogContent>
      </Dialog>
      <Dialog open={customMaterialOpen} onOpenChange={setCustomMaterialOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add custom material</DialogTitle></DialogHeader>
          <form onSubmit={(event) => {
            event.preventDefault();
            const name = customMaterialName.trim();
            if (!name) return;
            const savedGoods = Array.from(new Set([...finishedGoods, name])).sort((a, b) => a.localeCompare(b));
            window.localStorage.setItem(finishedGoodsKey, JSON.stringify(savedGoods));
            setFinishedGoods(savedGoods);
            if (customMaterialRow !== null) setGoods((rows) => rows.map((row, i) => i === customMaterialRow ? { ...row, name, custom: false } : row));
            setCustomMaterialOpen(false);
          }} className="space-y-4">
            <div><Label htmlFor="custom-material-name">Material name</Label><Input id="custom-material-name" autoFocus required placeholder="Enter material name" value={customMaterialName} onChange={(event) => setCustomMaterialName(event.target.value)} /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCustomMaterialOpen(false)}>Cancel</Button><Button type="submit">Add material</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
