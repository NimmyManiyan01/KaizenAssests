import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/assembly/dispatch")({ component: AssemblyDispatchPage });

function AssemblyDispatchPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.getSupplierFinishedGoodsDispatchRequests();
      setRequests((response || []).filter((request: any) => !["DISPATCHED", "CANCELLED", "GATE_OUT"].includes(String(request.status || "").toUpperCase())));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load supplier requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const pendingRequests = useMemo(() => requests.filter((request) => ["PENDING_ASSEMBLY", "APPROVED"].includes(request.status)), [requests]);
  const allocatedRequests = useMemo(() => requests.filter((request) => request.status === "ALLOCATED"), [requests]);

  const allocate = async (request: any) => {
    try {
      await api.allocateSupplierFinishedGoodsFifo(request.id);
      toast.success("FIFO allocation confirmed");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "FIFO allocation failed");
    }
  };

  return <AppShell title="Assembly Dispatch" subtitle="Allocate QC-approved finished goods from Assembly using FIFO, then continue to packing"><div className="space-y-4"><div className="flex justify-end"><Button variant="outline" className="rounded-xl" onClick={() => void load()}><RefreshCw className="mr-2 size-4" />Refresh</Button></div><Card className="overflow-hidden rounded-2xl"><div className="border-b p-4"><h2 className="font-bold">Supplier finished-goods requests</h2><p className="mt-1 text-xs text-muted-foreground">The oldest eligible Assembly finished-goods batch is allocated first.</p></div>{loading ? <div className="p-10 text-center text-sm text-muted-foreground">Loading...</div> : requests.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No supplier requests ready for pickup.</div> : <div className="divide-y">{requests.map((request) => <div key={request.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-mono font-bold text-primary">{request.request_number}</p><p className="text-xs text-muted-foreground">{request.product_name} · {request.quantity} {request.uom} · pickup {request.expected_pickup_date}</p></div><div className="flex items-center gap-3"><Badge variant="outline">{request.status}</Badge>{pendingRequests.includes(request) && <Button className="rounded-xl" onClick={() => void allocate(request)}>Allocate FIFO</Button>}{allocatedRequests.includes(request) && <Link to="/dispatch-picking-packing"><Button variant="outline" className="rounded-xl">Continue to Packing<ArrowRight className="ml-2 size-4" /></Button></Link>}</div></div>)}</div>}</Card></div></AppShell>;
}
