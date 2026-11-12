import { AsnJourneyPanel } from "@/components/wms/asn-journey-panel";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, BUSINESS_API_URL } from "@/lib/api-client";
import { getAuthToken, getUserInfo, requireAuth } from "@/lib/auth-utils";
import { toast } from "sonner";

export const Route = createFileRoute("/reports")({
  beforeLoad: () => requireAuth(),
  component: ReportsPage,
});
type Bucket = "PENDING" | "IN_PROGRESS" | "DONE" | "ATTENTION" | "CANCELLED" | "OTHER";
type Definition = {
  key: string;
  module: string;
  label: string;
  columns: string[];
  reference: string;
  date_field: string;
  date_basis: string;
};
type ReportSummary = Definition & {
  open_over_7_days: number;
  total: number;
  counts: Record<Bucket, number>;
  statuses: { status: string; count: number }[];
};
type Catalog = {
  journey_access: boolean;
  modules: { key: string; label: string }[];
  reports: Definition[];
  scope: string;
};
type Summary = {
  total: number;
  counts: Record<Bucket, number>;
  reports: ReportSummary[];
  trend: { date: string; count: number }[];
  generated_at: string;
  note: string;
};
type Row = Record<string, unknown> & { id: string; lifecycle: Bucket };
const BUCKETS: Bucket[] = ["PENDING", "IN_PROGRESS", "DONE", "ATTENTION", "CANCELLED", "OTHER"];
const COLORS: Record<Bucket, string> = {
  PENDING: "#8A5100",
  IN_PROGRESS: "#16479C",
  DONE: "#166044",
  ATTENTION: "#991B1B",
  CANCELLED: "#334155",
  OTHER: "#51308C",
};
const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 });
function display(value: unknown, key = ""): string {
  if (value == null || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return number(value);
  if (typeof value === "object") return JSON.stringify(value);
  if (/(?:_at|_date)$/.test(key) || key === "expected_arrival") {
    const raw = String(value);
    if (!Number.isNaN(Date.parse(raw))) {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
      const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
      const date = new Date(dateOnly ? raw + "T00:00:00" : raw);
      const formatted = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      return dateOnly || (!zoned && date.getHours() === 0 && date.getMinutes() === 0)
        ? formatted : formatted + ", " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    }
  }
  if (key === "status" || key.endsWith("_type")) return label(String(value)).toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return String(value);
}
const moduleDescriptions: Record<string, string> = {
  supplier: "Review your shipment notices, damage claims, returns, replacements, and finished-goods requests.",
  gate: "Review inbound gate arrivals and finished-goods pickup entry and exit records.",
  grn: "Review goods receipt notes, received quantities, and quarantine dispositions.",
  warehouse: "Review putaway batches, stock by location, requisitions, and material movements.",
  assembly: "Review production orders, quality inspections, finished goods, rework, and scrap.",
  dispatch: "Review dispatch orders, picking, packing, loading, and delivery progress.",
};
function detailGroups(record: Record<string, unknown>) {
  const groups: { title: string; fields: [string, unknown][] }[] = [
    { title: "Record overview", fields: [] }, { title: "Shipment & assignment", fields: [] },
    { title: "Quantities & quality", fields: [] }, { title: "Dates & progress", fields: [] },
    { title: "Additional details", fields: [] },
  ];
  for (const entry of Object.entries(record)) {
    const [key, value] = entry;
    if (key === "id" || key.endsWith("_id") || value == null || value === "") continue;
    const index = /status|number$|name$|code$|type$|priority|reference/.test(key) ? 0
      : /quantity|uom|quality|result/.test(key) ? 2
      : /_at$|_date$|expected_arrival/.test(key) ? 3
      : /vehicle|driver|dock|location|warehouse|transporter|destination|assigned/.test(key) ? 1 : 4;
    groups[index].fields.push(entry);
  }
  return groups.filter((group) => group.fields.length);
}
function Breakdown({ counts, total }: { counts: Record<Bucket, number>; total: number }) {
  return (
    <div
      className="flex h-2.5 overflow-hidden rounded-full bg-slate-100"
      role="img"
      aria-label={BUCKETS.map((b) => label(b) + ": " + counts[b]).join(", ")}
    >
      {BUCKETS.map(
        (b) =>
          counts[b] > 0 && (
            <span
              key={b}
              style={{
                width: (counts[b] / Math.max(total, 1)) * 100 + "%",
                backgroundColor: COLORS[b],
              }}
            />
          ),
      )}
    </div>
  );
}
function ReportsPage() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [summary, setSummary] = useState<Summary>();
  const [records, setRecords] = useState<{
    rows: Row[];
    total: number;
    definition: Definition;
    quantity_totals: Record<string, number | string>[];
  }>();
  const [module, setModule] = useState("");
  const [section, setSection] = useState<"analytics" | "journey">("analytics");
  const [report, setReport] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [bucket, setBucket] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState("");
  const [tableError, setTableError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<{
    record: Record<string, unknown>;
    lines: Record<string, unknown>[];
  }>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequest = useRef(0);
  const invalidDates = !!start && !!end && start > end;
  const reports = useMemo(
    () => (catalog?.reports || []).filter((r) => !module || r.module === module),
    [catalog, module],
  );
  const definition = reports.find((r) => r.key === report);
  const selectedSummary = summary?.reports.find((r) => r.key === report);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    api
      .getOperationalReport("catalog", {})
      .then((data: Catalog) => {
        if (active) {
          setCatalog(data);
          const roles = getUserInfo()?.roles || [];
          const preferred = roles.includes("SUPPLIER") ? "supplier" : roles.includes("ASSEMBLY_MANAGER") ? "assembly" : roles.includes("DISPATCH_MANAGER") ? "dispatch" : roles.includes("GRN") ? "grn" : roles.includes("GATE_SECURITY") ? "gate" : roles.some((role) => role.startsWith("WAREHOUSE")) ? "warehouse" : "";
          const initialModule = data.modules.some((item) => item.key === preferred) ? preferred : "";
          setModule(initialModule);
          setReport((current) => current || data.reports.find((item) => !initialModule || item.module === initialModule)?.key || "");
        }
      })
      .catch((e: Error) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!catalog || invalidDates) return;
    let active = true;
    setLoading(true);
    setError("");
    api
      .getOperationalReport("summary", { module, start, end })
      .then((data: Summary) => {
        if (active) setSummary(data);
      })
      .catch((e: Error) => {
        if (active) {
          setSummary(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [catalog, module, start, end, refresh, invalidDates]);
  useEffect(() => {
    if (!report || invalidDates) return;
    let active = true;
    setTableLoading(true);
    setTableError("");
    api
      .getOperationalReport("records", {
        report,
        start,
        end,
        bucket,
        status,
        search: query,
        limit: "25",
        offset: String(page * 25),
      })
      .then((data) => {
        if (active) setRecords(data);
      })
      .catch((e: Error) => {
        if (active) {
          setRecords(undefined);
          setTableError(e.message);
        }
      })
      .finally(() => {
        if (active) setTableLoading(false);
      });
    return () => {
      active = false;
    };
  }, [report, start, end, bucket, status, query, page, refresh, invalidDates]);
  const chooseReport = (key: string) => {
    setReport(key);
    setPage(0);
    setBucket("");
    setStatus("");
    setSearch("");
    setQuery("");
  };
  const chooseModule = (key: string) => {
    setModule(key);
    chooseReport(catalog?.reports.find((r) => !key || r.module === key)?.key || "");
  };
  const openDetail = async (row: Row) => {
    const version = ++detailRequest.current;
    setDetailOpen(true);
    setDetail(undefined);
    setDetailError("");
    setDetailLoading(true);
    try {
      const data = await api.getOperationalReport("detail", { report, id: row.id });
      if (version === detailRequest.current) setDetail(data);
    } catch (e) {
      if (version === detailRequest.current)
        setDetailError(e instanceof Error ? e.message : "Unable to load record");
    } finally {
      if (version === detailRequest.current) setDetailLoading(false);
    }
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams(
        Object.entries({ report, start, end, bucket, status, search: query }).filter(([, v]) => v),
      );
      const response = await fetch(BUSINESS_API_URL + "/api/v1/reports/export?" + params, {
        headers: { Authorization: "Bearer " + (getAuthToken() || "") },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Export failed");
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = report + "-" + new Date().toISOString().slice(0, 10) + ".csv";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Filtered report exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to export report");
    } finally {
      setExporting(false);
    }
  };
  const columns = definition
    ? Array.from(
        new Set([
          definition.reference,
          ...definition.columns.filter((k) =>
            [
              "asn_number",
              "grn_number",
              "vehicle_number",
              "material_name",
              "product_name",
              "customer_name",
              "quantity",
              "requested_quantity",
              "picked_quantity",
              "planned_quantity",
              "completed_quantity",
              "passed_quantity",
              "available_quantity",
              "damaged_quantity",
              "uom",
            ].includes(k),
          ),
          ...(definition.columns.includes("status") ? ["status"] : []),
          definition.date_field,
        ]),
      ).filter((k) => k !== "id")
    : [];
  const lineColumns = detail
    ? Array.from(new Set(detail.lines.flatMap((row) => Object.keys(row))))
    : [];
  const controls =
    "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200";
  return (
    <AppShell
      title={
        <span className="supplier-page-title inline-flex items-center gap-3">
          <span className="supplier-page-title-icon inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/30 bg-white/15 text-white">
            <BarChart3 className="size-5" aria-hidden="true" />
          </span>
          Reports &amp; Analytics
        </span>
      }
      subtitle="Operational progress, shipment history, and workflow status."
      actions={
        <Button
          data-refresh-control="true"
          variant="outline"
          size="icon"
          className="rounded-xl"
          aria-label="Refresh reports"
          title="Refresh reports"
          onClick={() => setRefresh((r) => r + 1)}
          disabled={loading || tableLoading}
        >
          <RefreshCw className={"size-4 " + (loading || tableLoading ? "animate-spin" : "")} />
        </Button>
      }
    >
      <div className="reports-workspace space-y-5 pb-8">
        <section className="reports-overview rounded-2xl border border-blue-200 p-5 shadow-sm">
          <div className="reports-overview-layout">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                <BarChart3 className="size-4" />
                Operational intelligence
              </p>
              <h2
                className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl"
                style={{ color: "#10213A", fontSize: "22px" }}
              >
                {module
                  ? catalog?.modules.find((m) => m.key === module)?.label
                  : "Your operational overview"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {moduleDescriptions[module] || "Review authorized operational records. Select a module to focus its workflows and source records."}
              </p>
            </div>
            <div className="reports-scope rounded-xl border border-blue-200 bg-white/40 p-4 text-xs leading-6">
              <div className="flex items-start gap-2 font-semibold text-primary">
                <ShieldCheck className="mt-1 size-4 shrink-0" />
                {catalog?.scope || "Checking reporting access"}
              </div>
              <p>
                {summary
                  ? "Updated " + new Date(summary.generated_at).toLocaleString()
                  : "Read-only operational reports"}
              </p>
            </div>
          </div>
        </section>
        {catalog?.journey_access && (
          <div
            className="reports-tabs flex flex-wrap gap-2 rounded-xl border bg-white p-2"
            role="tablist"
            aria-label="Report sections"
          >
            <button
              type="button"
              role="tab"
              aria-selected={section === "analytics"}
              className={
                "rounded-xl px-5 py-2.5 text-sm font-semibold " +
                (section === "analytics"
                  ? "bg-blue-700 text-white"
                  : "text-slate-600 hover:bg-slate-50")
              }
              onClick={() => setSection("analytics")}
            >
              Analytics & records
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === "journey"}
              className={
                "rounded-xl px-5 py-2.5 text-sm font-semibold " +
                (section === "journey"
                  ? "bg-blue-700 text-white"
                  : "text-slate-600 hover:bg-slate-50")
              }
              onClick={() => {
                setSection("journey");
                chooseModule("");
              }}
            >
              ASN journey
            </button>
          </div>
        )}
        <section
          className="reports-filters rounded-2xl border bg-white p-5 shadow-sm"
          aria-label="Report filters"
        >
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Module
            <select
              disabled={section === "journey"}
              aria-label="Report module"
              className={controls}
              value={module}
              onChange={(e) => chooseModule(e.target.value)}
            >
              <option value="">All authorized modules</option>
              {catalog?.modules.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            From date
            <input
              aria-label="Report start date"
              className={controls}
              type="date"
              value={start}
              max={end || undefined}
              onChange={(e) => {
                setStart(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Through date
            <input
              aria-label="Report end date"
              className={controls}
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => {
                setEnd(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {(start || end || module) && (
            <Button
              variant="ghost"
              onClick={() => {
                setStart("");
                setEnd("");
                chooseModule("");
              }}
            >
              Reset
            </Button>
          )}
          <p className="ml-auto max-w-sm text-xs leading-5 text-muted-foreground">
            Filter records by module and date range. Status reflects the latest saved state.
          </p>
        </section>
        {(error || invalidDates) && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {invalidDates ? "Choose an end date on or after the start date." : error}
          </div>
        )}
        {section === "journey" && catalog?.journey_access && (
          <AsnJourneyPanel start={start} end={end} refreshKey={refresh} />
        )}
        <div className={section === "analytics" ? "reports-analytics-content" : "hidden"}>
          {loading && !summary && !error ? (
            <div className="flex h-40 items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Loading analytics...
            </div>
          ) : (
            summary &&
            !invalidDates && (
              <>
                <section className="reports-kpis grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Activity summary">
                  {[
                    {
                      title: "Activity records",
                      value: summary.total,
                      icon: Activity,
                      help: "Source records across selected workflows",
                      color: "text-slate-800",
                    },
                    {
                      title: "Pending",
                      value: summary.counts.PENDING,
                      icon: Clock3,
                      help: "Waiting to start or for approval",
                      color: "text-amber-700",
                    },
                    {
                      title: "In progress",
                      value: summary.counts.IN_PROGRESS,
                      icon: RefreshCw,
                      help: "Assigned or active in the workflow",
                      color: "text-blue-700",
                    },
                    {
                      title: "Done",
                      value: summary.counts.DONE,
                      icon: CheckCircle2,
                      help: "Complete at the workflow boundary",
                      color: "text-emerald-700",
                    },
                  ].map((k) => (
                    <div key={k.title} className="rounded-2xl border bg-white p-5 shadow-sm">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        {k.title}
                        <k.icon className={"size-5 " + k.color} />
                      </div>
                      <p className={"mt-3 text-3xl font-semibold tabular-nums " + k.color}>
                        {number(k.value)}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">{k.help}</p>
                    </div>
                  ))}
                </section>
                <section className="reports-chart-grid grid gap-5 lg:grid-cols-[1.4fr_1fr]" aria-label="Activity charts">
                  <div className="rounded-2xl border bg-white p-5 shadow-sm">
                    <h3 className="font-semibold">Activity over time</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Record counts by each workflow's reporting date.
                    </p>
                    {summary.trend.length ? (
                      <div
                        className="reports-trend-chart mt-5 h-64"
                        role="img"
                        aria-label="Activity record counts by date"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={summary.trend} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
                            <defs>
                              <linearGradient id="reportArea" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#16479C" stopOpacity={0.25} />
                                <stop offset="100%" stopColor="#16479C" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="#e2e8f0"
                            />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 11 }}
                              tickMargin={10}
                              tickFormatter={(v) => new Date(String(v) + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                            />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={38} />
                            <Tooltip />
                            <Area
                              type="monotone"
                              dataKey="count"
                              name="Activity records"
                              stroke="#16479C"
                              strokeWidth={3}
                              dot={{ r: 4, fill: "#16479C", stroke: "#FFFFFF", strokeWidth: 2 }}
                              activeDot={{ r: 6 }}
                              fill="url(#reportArea)"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="py-20 text-center text-sm text-muted-foreground">
                        No activity in the selected period.
                      </p>
                    )}
                  </div>
                  <div className="rounded-2xl border bg-white p-5 shadow-sm">
                    <h3 className="font-semibold">Lifecycle distribution</h3>
                    <p className="mb-5 mt-1 text-xs text-muted-foreground">
                      Exact module statuses are shown in the record table.
                    </p>
                    <Breakdown counts={summary.counts} total={summary.total} />
                    <div className="reports-lifecycle-list mt-5">
                      {BUCKETS.map((b) => (
                        <div key={b} className="reports-lifecycle-row text-sm">
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2.5 rounded-full"
                              style={{ background: COLORS[b] }}
                            />
                            {label(b)}
                          </span>
                          <span className="reports-lifecycle-values font-medium tabular-nums">
                            <span>{number(summary.counts[b])}</span>
                            <span className="ml-3 text-xs text-muted-foreground">
                              {summary.total
                                ? Math.round((summary.counts[b] / summary.total) * 100)
                                : 0}
                              %
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
                <section className="reports-workflows rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">Workflow performance</h3>
                    <span className="text-xs text-muted-foreground">
                      Select a workflow to view its records
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {summary.reports.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => chooseReport(r.key)}
                        className={
                          "rounded-xl border p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/30 " +
                          (report === r.key
                            ? "border-blue-300 bg-blue-50/50 ring-1 ring-blue-100"
                            : "border-slate-200")
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{r.label}</span>
                          <ArrowRight className="size-4 text-muted-foreground" />
                        </div>
                        <div className="mb-3 mt-2 flex items-baseline gap-2">
                          <strong className="text-2xl tabular-nums">{number(r.total)}</strong>
                          <span className="text-xs text-muted-foreground">
                            {r.key === "putaways" ? "batch records" : "records"}
                          </span>
                        </div>
                        <Breakdown counts={r.counts} total={r.total} />
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {r.counts.PENDING} pending / {r.counts.IN_PROGRESS} in progress /{" "}
                          {r.counts.DONE} done
                          {r.counts.ATTENTION ? " / " + r.counts.ATTENTION + " attention" : ""}
                        </p>
                        {r.open_over_7_days > 0 && (
                          <p className="mt-2 text-xs font-medium text-amber-700">
                            {r.open_over_7_days} open over 7 days
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )
          )}
          <section
            className="overflow-hidden rounded-2xl border bg-white shadow-sm"
            aria-label="Detailed report records"
          >
            <div className="space-y-4 border-b p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Detailed records</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {definition?.date_basis || "Select a report"}
                    {report === "stock"
                      ? " - Current stock snapshot."
                      : " - Open a record for all fields and line quantities."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={!records?.total || tableLoading || exporting || invalidDates}
                  onClick={() => void exportCsv()}
                  className="rounded-xl"
                >
                  {exporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="size-4" />
                  )}
                  Export filtered CSV
                </Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <select
                  aria-label="Report workflow"
                  value={report}
                  onChange={(e) => chooseReport(e.target.value)}
                  className={controls}
                >
                  {reports.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Lifecycle group"
                  value={bucket}
                  onChange={(e) => {
                    setBucket(e.target.value);
                    setPage(0);
                  }}
                  className={controls}
                >
                  <option value="">All lifecycle groups</option>
                  {BUCKETS.map((b) => (
                    <option key={b} value={b}>
                      {label(b)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Exact workflow status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(0);
                  }}
                  className={controls}
                >
                  <option value="">All exact statuses</option>
                  {selectedSummary?.statuses.map((s) => (
                    <option key={s.status} value={s.status}>
                      {label(s.status)} ({s.count})
                    </option>
                  ))}
                </select>
                <label className="relative min-w-52 flex-1">
                  <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                  <input
                    aria-label="Search report records"
                    value={search}
                    maxLength={200}
                    onChange={(e) => setSearch(e.target.value)}
                    className={controls + " w-full pl-9"}
                    placeholder="Search reference, vehicle, material..."
                  />
                </label>
              </div>
            </div>
            {!tableLoading &&
              !tableError &&
              !invalidDates &&
              !!records?.quantity_totals?.length && (
                <div
                  className="flex flex-wrap gap-3 border-b bg-blue-50/30 p-4"
                  aria-label="Filtered quantity totals"
                >
                  {records.quantity_totals.map((row) => (
                    <div
                      key={String(row.uom)}
                      className="rounded-xl border border-blue-100 bg-white p-3 text-xs"
                    >
                      <p className="mb-2 font-semibold text-blue-900">{String(row.uom)} totals</p>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {Object.entries(row)
                          .filter(([key]) => key !== "uom")
                          .map(([key, value]) => (
                            <span key={key} className="text-muted-foreground">
                              {label(key)}:{" "}
                              <strong className="font-semibold tabular-nums text-slate-800">
                                {number(Number(value))}
                              </strong>
                            </span>
                          ))}
                      </div>
                    </div>
                  ))}
                  <p className="w-full text-[11px] text-muted-foreground">
                    Totals cover all filtered records, not just this page. Different units are kept
                    separate.
                  </p>
                </div>
              )}
            {tableError && (
              <p role="alert" className="bg-red-50 p-4 text-sm text-red-800">
                {tableError}
              </p>
            )}
            {tableLoading ? (
              <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                Loading records...
              </div>
            ) : (
              !tableError &&
              !invalidDates && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[850px] text-left text-sm">
                      <thead className="border-b bg-slate-50 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          {columns.map((c) => (
                            <th key={c} className="whitespace-nowrap px-4 py-3">
                              {label(c)}
                            </th>
                          ))}
                          <th className="px-4 py-3">Lifecycle</th>
                          <th className="px-4 py-3">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {records?.rows.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/60">
                            {columns.map((c) => (
                              <td
                                key={c}
                                className={
                                  "max-w-64 px-4 py-3 " +
                                  (c === definition?.reference ? "font-medium text-blue-800" : "")
                                }
                              >
                                {display(row[c], c)}
                              </td>
                            ))}
                            <td className="px-4 py-3">
                              <span
                                className="whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                                style={{
                                  color: COLORS[row.lifecycle],
                                  borderColor: COLORS[row.lifecycle] + "40",
                                  backgroundColor: COLORS[row.lifecycle] + "0d",
                                }}
                              >
                                {label(row.lifecycle)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void openDetail(row)}
                              >
                                View details
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {!records?.rows.length && (
                          <tr>
                            <td
                              colSpan={columns.length + 2}
                              className="p-12 text-center text-muted-foreground"
                            >
                              <Filter className="mx-auto mb-3 size-6" />
                              No records match these filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
                    <span>
                      {records?.total
                        ? page * 25 +
                          1 +
                          "-" +
                          Math.min((page + 1) * 25, records.total) +
                          " of " +
                          number(records.total) +
                          " records"
                        : "0 records"}{" "}
                      - Quantities retain their source UOM
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
                        disabled={(page + 1) * 25 >= (records?.total || 0)}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )
            )}
          </section>
          {summary && (
            <p className="text-xs leading-5 text-muted-foreground">
              {summary.note} Unmapped statuses appear under Other. CSV exports contain filtered
              parent records; line details are available through View details.
            </p>
          )}
        </div>
      </div>
      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) detailRequest.current++;
        }}
      >
        <DialogContent className="report-record-dialog max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{definition?.label} - Record details</DialogTitle>
            <DialogDescription>
              {detail && definition ? String(detail.record[definition.reference] || definition.label) : "Record details"} - Recorded workflow details and quantities.
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <Loader2 className="mx-auto my-10 size-6 animate-spin" />
          ) : detailError ? (
            <p role="alert" className="text-destructive">
              {detailError}
            </p>
          ) : (
            detail && (
              <>
                <div className="report-detail-sections">
                  {detailGroups(detail.record).map((group) => (
                    <section key={group.title} className="report-detail-section">
                      <h3>{group.title}</h3>
                      <dl>
                        {group.fields.map(([key, value]) => (
                          <div key={key}>
                            <dt>{label(key).replace(/Asn/g, "ASN").replace(/Grn/g, "GRN").replace(/Uom/g, "UOM")}</dt>
                            <dd>{key === "status" ? <StatusBadge status={String(value)} /> : display(value, key)}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                  <details className="report-technical-details">
                    <summary>Record references</summary>
                    <dl>{Object.entries(detail.record).filter(([key, value]) => (key === "id" || key.endsWith("_id")) && value).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{String(value)}</dd></div>)}</dl>
                  </details>
                </div>
                {detail.lines.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-semibold">Material and line details</h4>
                    <div className="overflow-x-auto rounded-xl border">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            {lineColumns.map((c) => (
                              <th key={c} className="whitespace-nowrap p-3">
                                {label(c)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detail.lines.map((row, i) => (
                            <tr key={i} className="border-t">
                              {lineColumns.map((c) => (
                                <td key={c} className="p-3">
                                  {display(row[c], c)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
