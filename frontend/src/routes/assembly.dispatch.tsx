import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, PackageCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/assembly/dispatch")({ component: AssemblyDispatchPage });

function availableQuantity(batch: any) {
  return Math.max(0, Number(batch.remaining_quantity ?? batch.available_quantity ?? batch.quantity ?? 0));
}

function completionTime(batch: any) {
  return new Date(batch.production_completed_at || batch.completed_at || batch.certified_date || batch.created_at || 0).getTime();
}

function AssemblyDispatchPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [allocation, setAllocation] = useState<any | null>(null);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const remindedOrders = useRef(new Set<string>());

  const load = async () => {
    setLoading(true);
    try {
      const [dispatchResponse, fgResponse] = await Promise.all([
        api.getDispatches(),
        api.getAssemblyFinishedGoods(),
      ]);
      setOrders((dispatchResponse.items || []).filter((order: any) => !["DISPATCHED", "CANCELLED", "GATE_OUT"].includes(String(order.status || "").toUpperCase())));
      setFinishedGoods(fgResponse || []);
    } catch (error) {
      toast.error("Unable to load Assembly dispatch data", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const orderItems = selectedOrder?.items || [];
  const productCode = orderItems[0]?.material_code || orderItems[0]?.product_code || orderItems[0]?.item_code;
  const batches = useMemo(() => finishedGoods
    .filter((batch: any) => availableQuantity(batch) > 0 && (!productCode || batch.product_code === productCode || batch.material_code === productCode))
    .sort((a: any, b: any) => completionTime(a) - completionTime(b)), [finishedGoods, productCode]);
  const totalAvailable = batches.reduce((sum, batch) => sum + availableQuantity(batch), 0);
  const required = orderItems.reduce((sum: number, item: any) => sum + Number(item.quantity_ordered || item.quantity || 0), 0);
  const showFifoReminder = Boolean(selectedOrder && batches.length > 0 && totalAvailable >= required && !remindedOrders.current.has(String(selectedOrder.id)));

  const openOrder = (order: any) => {
    setSelectedOrder(order);
    setAllocation(null);
    setAllocationError(null);
    if (!remindedOrders.current.has(String(order.id))) {
      remindedOrders.current.add(String(order.id));
      toast.info("FIFO reminder", { description: "Use the oldest eligible Assembly finished-goods batch first." });
    }
  };

  const allocate = async () => {
    if (!selectedOrder) return;
    try {
      setAllocationError(null);
      setAllocation(await api.allocateAssemblyFinishedGoodsFifo(selectedOrder.id));
      toast.success("Finished goods allocated using FIFO");
    } catch (error) {
      setAllocationError(error instanceof Error ? error.message : "Insufficient eligible Assembly stock");
    }
  };

  return (
    <AppShell title="Assembly Dispatch" subtitle="Allocate QC-approved finished goods from Assembly using FIFO, then continue to packing">
      <div className="space-y-4">
        <div className="flex justify-end"><Button variant="outline" className="rounded-xl" onClick={() => void load()}><RefreshCw className="mr-2 size-4" />Refresh</Button></div>
        <Card className="overflow-hidden rounded-2xl">
          <div className="border-b p-4"><h2 className="font-bold">Finished-goods requests assigned to Assembly</h2><p className="mt-1 text-xs text-muted-foreground">Only persisted dispatch orders and Assembly FG records are shown.</p></div>
          {loading ? <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div> : orders.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No open finished-goods requests.</div> : <div className="divide-y">{orders.map((order) => <button key={order.id} type="button" onClick={() => openOrder(order)} className={`flex w-full items-center justify-between p-4 text-left hover:bg-muted/40 ${selectedOrder?.id === order.id ? "bg-primary/5" : ""}`}><div><p className="font-mono font-bold text-primary">{order.dispatch_number || order.order_number || order.id}</p><p className="text-xs text-muted-foreground">{order.customer_name || "Customer"} · {(order.items || []).map((item: any) => item.material_name || item.product_name || item.material_code).join(", ") || "Product not specified"}</p></div><div className="flex items-center gap-3"><Badge variant="outline">{order.status}</Badge><ArrowRight className="size-4" /></div></button>)}</div>}
        </Card>

        {selectedOrder && <Card className="rounded-2xl p-5">
          <Button className="mb-3 rounded-xl" onClick={() => void allocate()}>Allocate FIFO</Button>
          {allocationError && <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">Required: {required} · Available: {totalAvailable}. {allocationError}</div>}
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">FIFO allocation · {selectedOrder.dispatch_number || selectedOrder.order_number}</h2><p className="mt-1 text-xs text-muted-foreground">Required {required} · Available in Assembly {totalAvailable} · Stock remains physically in Assembly</p></div><Link to="/dispatch-picking-packing"><Button className="rounded-xl">Open Packing <ArrowRight className="ml-2 size-4" /></Button></Link></div>
          {showFifoReminder && <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 size-4" /><div><p className="font-bold">FIFO reminder</p><p>Older eligible finished-goods stock is available. Allocate the oldest batch first.</p></div></div>}
          <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="p-2">Batch / QR</th><th className="p-2">Completed</th><th className="p-2">Available</th><th className="p-2">Location</th><th className="p-2">FIFO</th></tr></thead><tbody>{batches.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No eligible Assembly finished goods available.</td></tr> : batches.map((batch: any, index: number) => <tr key={batch.id} className="border-b"><td className="p-2 font-mono text-xs">{batch.serial_number || batch.qr_code || batch.batch_number || batch.id}</td><td className="p-2">{batch.production_completed_at || batch.completed_at || batch.certified_date || "—"}</td><td className="p-2 font-bold">{availableQuantity(batch)} {batch.uom || "PCS"}</td><td className="p-2">{batch.location_code || "Assembly FG Area"}</td><td className="p-2">{index === 0 ? <Badge className="bg-emerald-100 text-emerald-700">Oldest first</Badge> : <span className="text-muted-foreground">Next</span>}</td></tr>)}</tbody></table></div>
        </Card>}
      </div>
    </AppShell>
  );
}
