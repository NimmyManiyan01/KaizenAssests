import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

export const Route = createFileRoute("/gate/finished-goods-pickup-exit")({ component: PickupExitPage });
function PickupExitPage() {
  const [pass, setPass] = useState(""); const [vehicle, setVehicle] = useState(""); const [driver, setDriver] = useState(""); const [docs, setDocs] = useState(false); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { const r = await api.completeFinishedGoodsPickupGateExit(pass, { vehicle_number: vehicle, driver_name: driver, documents_verified: docs }); toast.success(`${r.request_number} closed and marked dispatched`); setPass(""); } catch (err) { toast.error(err instanceof Error ? err.message : "Gate exit failed"); } finally { setBusy(false); } };
  return <AppShell title="Finished-Goods Pickup Gate Exit" subtitle="Verify the original pickup pass and close the outbound vehicle visit."><form onSubmit={submit} className="mx-auto max-w-xl space-y-4 rounded-2xl border bg-card p-5 shadow-sm"><div><Label>Original six-character gate pass</Label><Input required minLength={6} maxLength={6} className="font-mono uppercase" value={pass} onChange={(e) => setPass(e.target.value.toUpperCase())} /></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>Vehicle number</Label><Input required value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></div><div><Label>Driver name</Label><Input required value={driver} onChange={(e) => setDriver(e.target.value)} /></div></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} /> Packing list and dispatch documents verified</label><Button disabled={busy || !docs}>{busy ? "Closing visit…" : "Approve Gate Exit"}</Button></form></AppShell>;
}
