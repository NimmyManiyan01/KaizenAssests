import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  Loader2,
  Search,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";

type Evidence = {
  id: string;
  reference: string;
  status?: string;
  at?: string;
  fields: Record<string, unknown>;
};
type Stage = {
  key: string;
  label: string;
  state: string;
  records: Evidence[];
  note: string;
  completed_count: number;
  total_count: number;
};
type Journey = {
  id: string;
  asn_number: string;
  supplier_name?: string;
  vehicle_number?: string;
  source_status: string;
  current_stage: string;
  created_at: string;
  stages: Stage[];
  warnings: string[];
  quantities: {
    uom: string;
    received: number;
    approved: number;
    damaged: number;
    rejected: number;
  }[];
};
type Result = {
  total: number;
  rows: Journey[];
  can_open_workspaces: boolean;
  generated_at: string;
};
const title = (s: string) =>
  s
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
function valueText(value: unknown, key = ""): string {
  if (value == null || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (key.endsWith("_at") || key === "at") {
    const raw = String(value);
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)
      ? new Date(raw).toLocaleString()
      : raw.replace("T", " ").slice(0, 19) + " (timezone not recorded)";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
const tone = (s: string) =>
  s === "DONE"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : s === "IN_PROGRESS"
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : s === "ATTENTION"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-slate-200 bg-slate-50 text-slate-600";
export function AsnJourneyPanel({
  start,
  end,
  refreshKey,
}: {
  start: string;
  end: string;
  refreshKey: number;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<Result>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);
  const [selection, setSelection] = useState<{ journey: Journey; key: string }>();
  const invalidDates = !!start && !!end && start > end;
  const selectedJourney =
    data?.rows.find((j) => j.id === selection?.journey.id) || selection?.journey;
  const selectedStage = selectedJourney?.stages.find((s) => s.key === selection?.key);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setPage(0);
  }, [start, end]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (invalidDates) return;
    let active = true;
    if (tick === 0) setLoading(true);
    setError("");
    api
      .getOperationalReport("journeys", {
        start,
        end,
        search: query,
        limit: "10",
        offset: String(page * 10),
      })
      .then((response: Result) => {
        if (active) setData(response);
      })
      .catch((e: Error) => {
        if (active) {
          setData(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [start, end, query, page, refreshKey, tick, invalidDates]);
  const openWorkspace = () => {
    if (!selectedJourney || !selectedStage || !data?.can_open_workspaces) return;
    const j = selectedJourney,
      s = selectedStage;
    const gate = j.stages.find((n) => n.key === "gate")?.records[0]?.reference || j.asn_number;
    const grn = j.stages.find((n) => n.key === "grn")?.records[0]?.reference || j.asn_number;
    const routes: Record<string, { to: string; search: Record<string, string> }> = {
      asn: { to: "/supplier/asns/new", search: { search: j.asn_number } },
      gate: { to: "/vehicle-queue", search: { search: gate } },
      dock: {
        to: "/dock-management",
        search: {
          search: gate,
          history: j.stages.find((n) => n.key === "release")?.state === "DONE" ? "1" : "0",
        },
      },
      grn: { to: "/grn", search: { tab: "records", search: grn } },
      release: { to: "/dock-management", search: { search: gate, history: "1" } },
      putaway: { to: "/inventory", search: { tab: "putaway", search: grn } },
      exit: { to: "/vehicle-queue", search: { search: gate } },
    };
    const target = routes[s.key];
    if (target) void navigate({ to: target.to as never, search: target.search as never });
  };
  return (
    <section className="space-y-5" aria-label="ASN journey tracker">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-white p-5 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Truck className="size-5 text-blue-700" />
            ASN journey tracker
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Follow each shipment from its ASN through gate entry, dock allocation, receiving, dock
            release, putaway, and vehicle exit. Select a stage to inspect its linked records.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Live records only. Refreshes every 15 seconds. Putaway and vehicle exit are independent
            after receiving.
          </p>
        </div>
        <label className="relative min-w-64">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <input
            aria-label="Search ASN journeys"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ASN, gate pass, GRN, supplier or vehicle"
            className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-sm"
          />
        </label>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {loading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Loading linked shipment records...
        </div>
      ) : (
        data &&
        !invalidDates && (
          <>
            {!data.rows.length && (
              <div className="rounded-2xl border bg-white p-10 text-center text-muted-foreground">
                No ASNs match these filters.
              </div>
            )}
            {data.rows.map((j) => (
              <article
                key={j.id}
                className="overflow-hidden rounded-2xl border bg-white shadow-sm"
                aria-label={"Journey " + j.asn_number}
              >
                <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
                  <div>
                    <h3 className="font-mono text-lg font-semibold text-blue-900">
                      {j.asn_number}
                    </h3>
                    <p className="mt-1 text-sm">
                      {j.supplier_name || "Supplier not recorded"} / Vehicle{" "}
                      <strong className="font-mono">{j.vehicle_number || "Not recorded"}</strong>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created: {valueText(j.created_at, "created_at")} / Saved ASN status:{" "}
                      {title(j.source_status || "UNKNOWN")}
                    </p>
                  </div>
                  <div className="max-w-sm rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm">
                    <p className="text-xs font-medium text-blue-700">Current linked progress</p>
                    <p className="mt-1 font-semibold text-blue-950">{j.current_stage}</p>
                  </div>
                </div>
                <div className="overflow-x-auto p-5">
                  <ol
                    className="flex min-w-[1060px] items-stretch gap-2"
                    aria-label={"Stages for " + j.asn_number}
                  >
                    {j.stages.map((s, i) => (
                      <li key={s.key} className="flex min-w-0 flex-1 items-center gap-2">
                        <button
                          type="button"
                          aria-label={"View " + s.label + " for " + j.asn_number}
                          onClick={() => setSelection({ journey: j, key: s.key })}
                          className={
                            "flex h-full w-full flex-col gap-2 rounded-xl border p-3 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 " +
                            tone(s.state)
                          }
                        >
                          <span className="flex items-center gap-2 text-xs font-semibold">
                            {s.state === "DONE" ? (
                              <CheckCircle2 className="size-4 shrink-0" />
                            ) : s.state === "IN_PROGRESS" ? (
                              <Clock3 className="size-4 shrink-0" />
                            ) : (
                              <Circle className="size-4 shrink-0" />
                            )}
                            {i + 1}. {s.label}
                          </span>
                          <span className="text-[11px] font-medium">{title(s.state)}</span>
                          <span className="text-[11px]">
                            {s.total_count > 0
                              ? s.completed_count +
                                "/" +
                                s.total_count +
                                (s.key === "putaway" ? " batches stored" : " recorded")
                              : s.records.length
                                ? s.records.length + " linked records"
                                : "No recorded event"}
                          </span>
                          {s.records[0] && (
                            <span className="break-all font-mono text-[11px]">
                              {s.records[0].reference}
                              {s.records.length > 1 ? " +" + (s.records.length - 1) : ""}
                            </span>
                          )}
                        </button>
                        {i < j.stages.length - 1 && (
                          <ArrowRight
                            aria-hidden="true"
                            className="size-3 shrink-0 text-slate-300"
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
                {!!j.quantities.length && (
                  <div className="flex flex-wrap gap-3 border-t bg-slate-50/50 px-5 py-3">
                    {j.quantities.map((q) => (
                      <p key={q.uom} className="text-xs text-slate-700">
                        <strong>{q.uom}:</strong> Received {valueText(q.received)} / Approved{" "}
                        {valueText(q.approved)} / Damaged {valueText(q.damaged)} / Rejected{" "}
                        {valueText(q.rejected)}
                      </p>
                    ))}
                  </div>
                )}
                {!!j.warnings.length && (
                  <div className="space-y-1 border-t border-amber-100 bg-amber-50 px-5 py-3">
                    {j.warnings.map((w) => (
                      <p key={w} className="text-xs leading-5 text-amber-900">
                        {w}
                      </p>
                    ))}
                  </div>
                )}
              </article>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {data.total
                  ? page * 10 +
                    1 +
                    "-" +
                    Math.min((page + 1) * 10, data.total) +
                    " of " +
                    data.total +
                    " ASNs"
                  : "0 ASNs"}{" "}
                / Updated {new Date(data.generated_at).toLocaleTimeString()}
              </span>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>Page {page + 1}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(page + 1) * 10 >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )
      )}
      <Dialog
        open={!!selection}
        onOpenChange={(open) => {
          if (!open) setSelection(undefined);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedJourney?.asn_number} / {selectedStage?.label}
            </DialogTitle>
            <DialogDescription>{selectedStage?.note}</DialogDescription>
          </DialogHeader>
          {selectedStage && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span
                  className={
                    "rounded-full border px-3 py-1 text-xs font-semibold " +
                    tone(selectedStage.state)
                  }
                >
                  {title(selectedStage.state)}
                </span>
                {data?.can_open_workspaces && (
                  <Button variant="outline" onClick={openWorkspace}>
                    <ExternalLink className="size-4" />
                    Open {selectedStage.label} workspace
                  </Button>
                )}
              </div>
              {!data?.can_open_workspaces && (
                <p className="text-xs text-muted-foreground">
                  Read-only shipment details. Operational updates remain with the responsible Gate,
                  Warehouse, and GRN teams.
                </p>
              )}
              {!selectedStage.records.length ? (
                <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No source record exists for this stage yet.
                </p>
              ) : (
                selectedStage.records.map((r) => (
                  <div key={r.id} className="rounded-xl border p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <strong className="font-mono text-sm">{r.reference}</strong>
                      <span className="text-xs text-muted-foreground">
                        {r.status ? title(r.status) : "Status not recorded"}
                      </span>
                    </div>
                    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(r.fields).map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{title(k)}</dt>
                          <dd className="mt-1 break-words text-sm font-medium">
                            {valueText(v, k)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
