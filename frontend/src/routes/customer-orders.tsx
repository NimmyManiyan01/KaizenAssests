import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/customer-orders")({ component: CustomerOrdersPage });

function CustomerOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState("");
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [delivery, setDelivery] = useState("");
  const [phone, setPhone] = useState("");
  const [expected, setExpected] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const load = async () => {
    const [customerOrders, finishedGoods] = await Promise.all([api.getCustomerOrders(), api.getCustomerOrderFinishedGoods()]);
    setOrders(customerOrders);
    setProducts((finishedGoods || []).filter((fg: any) => {
      const status = String(fg.status || "").toUpperCase().replace(/[ -]/g, "_");
      const available = Number(fg.available_quantity ?? fg.quantity ?? 0);
      return available > 0 && ["AVAILABLE", "QC_CERTIFIED", "QC_APPROVED", "QC_PASSED", "PASSED", "READY"].includes(status);
    }).map((fg: any) => ({ ...fg, quantity: Number(fg.available_quantity ?? fg.quantity ?? 0) })));
  };
  useEffect(() => { void load(); }, []);
  const create = async (confirm: boolean) => {
    try {
      const orderDate = new Date().toISOString().slice(0, 10);
      if (expected < orderDate) { toast.error("Expected delivery cannot be earlier than the order date"); return; }
      const selectedProduct = products.find((p) => p.product_code === product);
      if (!selectedProduct || Number(quantity) > Number(selectedProduct.quantity || 0)) { toast.error("Quantity exceeds available Assembly finished goods stock"); return; }
      const created = await api.createCustomerOrder({ customer_name: customer, order_date: orderDate, expected_delivery_date: expected, delivery_address: delivery, phone, remarks, items: [{ product_code: product, ordered_quantity: Number(quantity), uom: selectedProduct.uom || "PCS" }] });
      if (confirm) await api.confirmCustomerOrder(created.id);
      setOpen(false); setCustomer(""); setProduct(""); setQuantity(""); setDelivery(""); setPhone(""); setRemarks(""); await load(); toast.success(confirm ? "Customer order confirmed" : "Customer order saved as draft");
    } catch (e) { toast.error("Unable to save customer order", { description: e instanceof Error ? e.message : undefined }); }
  };
  return <AppShell title="Customer Orders" subtitle="Capture customer orders received by email or phone" actions={<Button onClick={() => setOpen(true)}><Plus className="size-4 mr-2" /> New Customer Order</Button>}>
    {open && <div className="mb-6 rounded-2xl border bg-card p-5 space-y-4"><h2 className="font-bold">Create Customer Order</h2><div className="grid md:grid-cols-2 gap-3"><div><Label>Customer Name *</Label><Input value={customer} onChange={(e) => setCustomer(e.target.value)} /></div><div><Label>Product / Assembly FG *</Label><select value={product} onChange={(e) => setProduct(e.target.value)} className="mt-1 w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="">{products.length ? "Select product" : "No QC-approved Assembly finished goods available"}</option>{products.map((p) => <option key={p.id || p.product_code} value={p.product_code}>{p.product_name} ({p.product_code}) — {p.quantity} {p.uom} Available · Assembly Storage · {p.location_code || "—"}</option>)}</select>{product && (() => { const selected = products.find((p) => p.product_code === product); return selected ? <p className="mt-1 text-xs text-emerald-600">Available: {selected.quantity} {selected.uom} · {selected.location_code || "Assembly FG Area"}</p> : null; })()}</div><div><Label>Quantity *</Label><Input type="number" min="0.0001" max={products.find((p) => p.product_code === product)?.quantity || undefined} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div><div><Label>Expected Delivery *</Label><Input type="date" min={new Date().toISOString().slice(0, 10)} value={expected} onChange={(e) => setExpected(e.target.value)} /></div><div className="md:col-span-2"><Label>Delivery Address *</Label><Input required value={delivery} onChange={(e) => setDelivery(e.target.value)} /></div><div><Label>Customer Contact Number</Label><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div><div><Label>Remarks</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button variant="outline" disabled={!customer || !product || !delivery || Number(quantity) <= 0} onClick={() => void create(false)}>Save Draft</Button><Button disabled={!customer || !product || !delivery || Number(quantity) <= 0} onClick={() => void create(true)}><CheckCircle2 className="size-4 mr-2" /> Confirm Order</Button></div></div>}
    <div className="rounded-2xl border bg-card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/50 text-xs uppercase"><tr><th className="p-4">Order Number</th><th className="p-4">Customer</th><th className="p-4">Products</th><th className="p-4">Quantity</th><th className="p-4">Delivery Date</th><th className="p-4">Status</th></tr></thead><tbody>{orders.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">No customer orders found.</td></tr> : orders.map((o) => <tr key={o.id} className="border-t"><td className="p-4 font-mono font-bold text-primary">{o.order_number}</td><td className="p-4">{o.customer_name}</td><td className="p-4">{o.items?.map((i: any) => `${i.product_name} (${i.remaining_quantity}/${i.ordered_quantity} ${i.uom})`).join(", ")}</td><td className="p-4">{o.items?.reduce((s: number, i: any) => s + i.ordered_quantity, 0)}</td><td className="p-4">{o.expected_delivery_date}</td><td className="p-4 font-semibold">{o.status}</td></tr>)}</tbody></table></div>
  </AppShell>;
}
