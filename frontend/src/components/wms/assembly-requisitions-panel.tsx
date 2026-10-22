import { InformationTooltip } from "@/components/ui/information-tooltip";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";

export function AssemblyRequisitionsPanel({ onUpdated }: { onUpdated?: () => void | Promise<void> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [storeChoice, setStoreChoice] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [requests, materialRequests, storeRows] = await Promise.all([
        api.getAssemblyRequisitions("Assembly"),
        api.getAssemblyMaterialRequests(),
        api.getStores().catch(() => []),
      ]);
      const requisitionRows = Array.isArray(requests) ? requests : [];
      const existingIds = new Set(requisitionRows.map((request: any) => String(request.id)));
      const legacyRows = (Array.isArray(materialRequests) ? materialRequests : [])
        .filter((request: any) => !existingIds.has(String(request.id)))
        .map((request: any) => ({
          ...request,
          id: String(request.id),
          requisition_number: request.request_number,
          requested_by: request.requested_by || "Assembly",
          priority: request.priority || "NORMAL",
          items: (request.items || []).map((item: any) => ({
            ...item,
            requested_quantity: item.requested_quantity ?? item.quantity ?? 0,
            available_quantity: item.available_quantity ?? 0,
            reserved_quantity: item.reserved_quantity ?? 0,
          })),
          legacy_material_request: true,
        }));
      setRows([...requisitionRows, ...legacyRows]);
      setStores(
        Array.isArray(storeRows)
          ? storeRows.filter((store: any) => String(store.status).toUpperCase() === "ACTIVE")
          : [],
      );
    } catch (error: any) {
      toast.error(error?.message || "Unable to load Assembly requisitions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const runAction = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(message);
      await refresh();
      await onUpdated?.();
    } catch (error: any) {
      toast.error(error?.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-5" aria-label="Assembly requisitions">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold"><ClipboardList className="size-5" />Assembly Requisitions</h2>
        <Button variant="outline" onClick={() => void refresh()} aria-label="Refresh Assembly requisitions">
          <RefreshCw className="mr-2 size-4" />Refresh
        </Button>
      </div>
      {loading ? (
        <div className="grid min-h-64 place-items-center">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="rounded-lg border-slate-300 bg-white shadow-none dark:border-slate-700 dark:bg-slate-900">
          <CardContent className="p-10 text-center text-muted-foreground">
            No Assembly requisitions have been submitted.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((request) => {
            const id = String(request.id);
            const status = String(request.status || "").toUpperCase();
            const statusBorderTone = ["ISSUED", "ASSEMBLY_RECEIVED", "COMPLETED"].includes(status)
              ? "border-l-emerald-600 dark:border-l-emerald-500"
              : ["REJECTED", "CANCELLED"].includes(status)
                ? "border-l-rose-600 dark:border-l-rose-500"
                : ["APPROVED", "RESERVED", "PARTIALLY_RESERVED"].includes(status)
                  ? "border-l-blue-700 dark:border-l-blue-500"
                  : "border-l-amber-600 dark:border-l-amber-500";
            const statusPillTone = ["ISSUED", "ASSEMBLY_RECEIVED", "COMPLETED"].includes(status)
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
              : ["REJECTED", "CANCELLED"].includes(status)
                ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
                : ["APPROVED", "RESERVED", "PARTIALLY_RESERVED"].includes(status)
                  ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"
                  : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200";
            const approvalRequired = status === "PENDING_WAREHOUSE_APPROVAL";
            const canReview =
              approvalRequired || ["PENDING", "SUBMITTED", "PARTIALLY_RESERVED"].includes(status);
            const hasReservation = (request.reservations || []).some(
              (reservation: any) => Number(reservation.reserved_quantity) > 0,
            );
            const selectedStore =
              storeChoice[id] ||
              request.assigned_store_id ||
              request.suggested_store_id ||
              request.reservations?.find((r: any) => r.store_id)?.store_id ||
              "";
            const isBusy = busyId === id;
            const productionQuantity = Number(
              request.target_quantity || request.planned_quantity || 0,
            );
            const firstItem = request.items?.[0];
            const bomQuantityPerUnit =
              productionQuantity > 0 && firstItem
                ? Number(firstItem.requested_quantity || firstItem.quantity || 0) /
                  productionQuantity
                : 0;
            return (
              <Card key={id} className={`rounded-lg border-slate-300 border-l-[3px] bg-white shadow-none dark:border-slate-700 dark:bg-slate-900 ${statusBorderTone}`}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{request.requisition_number}</h2>
                      <p className="text-xs text-muted-foreground">
                        {request.department} · Requested by {request.requested_by} ·{" "}
                        {request.required_date}
                      </p>
                    </div>
                    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${statusPillTone}`}>
                      {status || ""}
                    </span>
                  </div>
                  {productionQuantity > 0 && firstItem && (
                    <div className="rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-slate-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-slate-200">
                      <span className="font-semibold text-blue-900 dark:text-blue-200">BOM calculation: </span>
                      {request.product_name || "Finished good"} × {productionQuantity}{" "}
                      {request.uom || "PCS"}
                      {" → "}
                      {firstItem.material_name || firstItem.material_code} × {bomQuantityPerUnit}{" "}
                      {firstItem.uom || ""}/{request.uom || "PCS"}
                      {" → Required "}
                      {firstItem.requested_quantity ?? firstItem.quantity ?? 0}{" "}
                      {firstItem.uom || ""}
                    </div>
                  )}
                  {status === "ISSUED" && !request.issue_transaction_exists && (
                    <p className="text-xs text-amber-600">
                      Issue status requires a persisted warehouse issue transaction; this request is
                      awaiting verification.
                    </p>
                  )}
                  {status === "ISSUED" && request.issue_transaction && (
                    <p className="text-xs text-emerald-700">
                      Issued under {request.issue_transaction.issue_number} by{" "}
                      {request.issue_transaction.issued_by || "Warehouse"}
                      {request.issue_transaction.issued_at
                        ? ` on ${new Date(request.issue_transaction.issued_at).toLocaleString()}`
                        : ""}
                      . Reserved quantity is 0 because the reservation was consumed by issue.
                    </p>
                  )}
                  {(request.items || []).length > 0 &&
                    (request.items || []).every(
                      (item: any) =>
                        Number(item.received_quantity || 0) >=
                        Number(
                          item.required_quantity ?? item.requested_quantity ?? item.quantity ?? 0,
                        ),
                    ) && (
                      <p className="text-xs font-semibold text-emerald-700">
                        Materials Received — Ready for Production. Warehouse stock is tracked
                        separately.
                      </p>
                    )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                          <th className="px-3 py-2">Material</th>
                          <th className="px-3 py-2">Requested</th>
                          <th className="px-3 py-2">Available<InformationTooltip help="inventory" /></th>
                          <th className="px-3 py-2">Reserved<InformationTooltip help="reserved" /></th>
                          <th className="px-3 py-2">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(request.items || []).map((item: any) => (
                          <tr
                            key={item.id || item.material_code}
                            className="border-b border-slate-100 text-slate-700 transition-colors hover:bg-blue-50/50 last:border-0 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-blue-950/20"
                          >
                            <td className="px-3 py-2.5 font-medium">
                              {item.material_code} · {item.material_name}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums">{item.requested_quantity}</td>
                            <td className="px-3 py-2.5 tabular-nums">{item.available_quantity}</td>
                            <td className="px-3 py-2.5 tabular-nums font-medium text-blue-800 dark:text-blue-300">{item.reserved_quantity}</td>
                            <td className="px-3 py-2.5 text-slate-500">{item.uom || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {request.availability_message && (
                    <p className="text-xs text-muted-foreground">{request.availability_message}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {canReview && (
                      <>
                        <Button
                          disabled={isBusy}
                          onClick={() =>
                            void runAction(
                              id,
                              () =>
                                request.legacy_material_request || approvalRequired
                                  ? api.approveAssemblyMaterialRequest(id)
                                  : api.reserveAssemblyRequisitionStock(id),
                              approvalRequired
                                ? "Material request approved"
                                : "Stock approved and request released for picking",
                            )
                          }
                        >
                          {isBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                          {approvalRequired ? "Approve Request" : "Approve &amp; Reserve Stock"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => {
                            const reason = window
                              .prompt("Reason for rejecting this requisition:")
                              ?.trim();
                            if (reason)
                              void runAction(
                                id,
                                () =>
                                  request.legacy_material_request || approvalRequired
                                    ? api.rejectAssemblyMaterialRequest(id, reason)
                                    : api.rejectAssemblyRequisition(id, reason),
                                "Requisition rejected",
                              );
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {(hasReservation || request.assigned_store_id) &&
                      !["REJECTED", "ASSEMBLY_RECEIVED"].includes(status) && (
                        <>
                          <select
                            className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm"
                            value={selectedStore}
                            onChange={(event) =>
                              setStoreChoice((current) => ({
                                ...current,
                                [id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Select fulfilling store</option>
                            {stores.map((store: any) => (
                              <option key={store.id} value={store.id}>
                                {store.store_code} · {store.store_name}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="secondary"
                            disabled={isBusy || !selectedStore}
                            onClick={() =>
                              void runAction(
                                id,
                                () => api.assignAssemblyRequisitionStore(id, selectedStore),
                                "Store picking task created",
                              )
                            }
                          >
                            Assign store and create pick task
                          </Button>
                        </>
                      )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
