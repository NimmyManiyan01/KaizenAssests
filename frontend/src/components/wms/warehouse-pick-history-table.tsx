import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowUpDown,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  History,
  MapPin,
  RotateCcw,
  Search,
  User,
} from "lucide-react";

export interface PickHistoryTask {
  id: string;
  task_number?: string;
  assembly_order_number?: string;
  material_code?: string;
  material_name?: string;
  material_qr?: string;
  quantity?: number;
  requested_quantity?: number;
  picked_quantity?: number;
  batch_number?: string;
  uom?: string;
  pick_location?: string;
  confirmation?: {
    confirmed?: boolean;
    confirmed_by?: string;
    confirmed_at?: string;
    material_qr?: string;
    rack_qr?: string;
    batch_number?: string;
  };
  status?: string;
  assembly_pick_task_id?: string;
}

interface WarehousePickHistoryTableProps {
  tasks: PickHistoryTask[];
  onBackToQueue?: () => void;
}

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

export function WarehousePickHistoryTable({
  tasks,
  onBackToQueue,
}: WarehousePickHistoryTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMaterial, setSelectedMaterial] = useState("ALL");
  const [selectedLocation, setSelectedLocation] = useState("ALL");
  const [selectedConfirmer, setSelectedConfirmer] = useState("ALL");
  const [sortBy, setSortBy] = useState<
    "date_desc" | "date_asc" | "task_asc" | "task_desc" | "qty_desc" | "qty_asc" | "material_asc"
  >("date_desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Dynamic filter options strictly derived from actual backend records
  const materialOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      if (t.material_code) {
        map.set(t.material_code, t.material_name || t.material_code);
      }
    }
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const loc = t.pick_location?.trim();
      if (loc && loc !== "—" && loc !== "-") {
        set.add(loc);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const confirmerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const by = t.confirmation?.confirmed_by?.trim();
      if (by && by !== "—" && by !== "-") {
        set.add(by);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  // Filtering
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Search matching across all displayable fields
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          String(t.task_number || "").toLowerCase().includes(q) ||
          String(t.assembly_order_number || "").toLowerCase().includes(q) ||
          String(t.material_name || "").toLowerCase().includes(q) ||
          String(t.material_code || "").toLowerCase().includes(q) ||
          String(t.pick_location || "").toLowerCase().includes(q) ||
          String(t.confirmation?.confirmed_by || "").toLowerCase().includes(q) ||
          String(t.batch_number || "").toLowerCase().includes(q);
        if (!match) return false;
      }

      // Material filter
      if (selectedMaterial !== "ALL" && t.material_code !== selectedMaterial) {
        return false;
      }

      // Pick Location filter
      if (selectedLocation !== "ALL" && t.pick_location !== selectedLocation) {
        return false;
      }

      // Confirmed By filter
      if (
        selectedConfirmer !== "ALL" &&
        (t.confirmation?.confirmed_by || "—") !== selectedConfirmer
      ) {
        return false;
      }

      return true;
    });
  }, [tasks, searchQuery, selectedMaterial, selectedLocation, selectedConfirmer]);

  // Sorting
  const sortedTasks = useMemo(() => {
    const list = [...filteredTasks];
    list.sort((a, b) => {
      if (sortBy === "date_desc" || sortBy === "date_asc") {
        const dateA = a.confirmation?.confirmed_at
          ? new Date(a.confirmation.confirmed_at).getTime()
          : 0;
        const dateB = b.confirmation?.confirmed_at
          ? new Date(b.confirmation.confirmed_at).getTime()
          : 0;
        return sortBy === "date_desc" ? dateB - dateA : dateA - dateB;
      }
      if (sortBy === "task_asc" || sortBy === "task_desc") {
        const taskA = String(a.task_number || "");
        const taskB = String(b.task_number || "");
        return sortBy === "task_asc" ? taskA.localeCompare(taskB) : taskB.localeCompare(taskA);
      }
      if (sortBy === "qty_desc" || sortBy === "qty_asc") {
        const qtyA = Number(a.picked_quantity ?? a.quantity ?? 0);
        const qtyB = Number(b.picked_quantity ?? b.quantity ?? 0);
        return sortBy === "qty_desc" ? qtyB - qtyA : qtyA - qtyB;
      }
      if (sortBy === "material_asc") {
        const matA = String(a.material_name || a.material_code || "");
        const matB = String(b.material_name || b.material_code || "");
        return matA.localeCompare(matB);
      }
      return 0;
    });
    return list;
  }, [filteredTasks, sortBy]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedTasks.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const paginatedTasks = useMemo(() => {
    const start = (effectivePage - 1) * pageSize;
    return sortedTasks.slice(start, start + pageSize);
  }, [sortedTasks, effectivePage, pageSize]);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    selectedMaterial !== "ALL" ||
    selectedLocation !== "ALL" ||
    selectedConfirmer !== "ALL" ||
    sortBy !== "date_desc";

  const handleClearFilters = () => {
    setSearchQuery("");
    setSelectedMaterial("ALL");
    setSelectedLocation("ALL");
    setSelectedConfirmer("ALL");
    setSortBy("date_desc");
    setCurrentPage(1);
  };

  return (
    <Card className="warehouse-pick-history-card overflow-hidden border-border/70 bg-card p-5 shadow-sm">
      {/* Header and Controls */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <History className="size-5 text-primary" />
              <h2 className="text-base font-bold text-foreground">Warehouse Pick History</h2>
              <Badge variant="outline" className="font-mono text-xs font-semibold text-primary">
                {tasks.length} {tasks.length === 1 ? "Record" : "Records"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Audit log of completed assembly material picks, confirmed quantities, storage bins, and operators.
            </p>
          </div>
          {onBackToQueue && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onBackToQueue}
              className="rounded-xl gap-1.5 text-xs font-semibold"
            >
              <ArrowLeft className="size-3.5" /> Back to Active Queue
            </Button>
          )}
        </div>

        {/* Filter Toolbar */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
          {/* Search Input */}
          <div className="lg:col-span-2">
            <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
              Search Records
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by task no, request, material, location, confirmer..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-9 pl-9 text-xs rounded-xl"
              />
            </div>
          </div>

          {/* Material Filter */}
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
              Material Filter
            </label>
            <select
              value={selectedMaterial}
              onChange={(e) => {
                setSelectedMaterial(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="ALL">All Materials ({materialOptions.length})</option>
              {materialOptions.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name} ({m.code})
                </option>
              ))}
            </select>
          </div>

          {/* Pick Location Filter */}
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
              Pick Location
            </label>
            <select
              value={selectedLocation}
              onChange={(e) => {
                setSelectedLocation(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="ALL">All Locations ({locationOptions.length})</option>
              {locationOptions.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By & Clear */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as any);
                  setCurrentPage(1);
                }}
                className="h-9 w-full rounded-xl border border-input bg-background px-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="date_desc">Newest First</option>
                <option value="date_asc">Oldest First</option>
                <option value="task_asc">Task No (A-Z)</option>
                <option value="task_desc">Task No (Z-A)</option>
                <option value="qty_desc">Quantity (High to Low)</option>
                <option value="qty_asc">Quantity (Low to High)</option>
                <option value="material_asc">Material (A-Z)</option>
              </select>
            </div>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-9 px-2 text-xs font-bold text-destructive hover:bg-destructive/10 rounded-xl self-end"
                title="Clear all active filters"
              >
                <RotateCcw className="size-3.5 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Secondary Filter Row: Confirmer Filter + Active Indicators */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              Confirmed By:
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedConfirmer("ALL");
                  setCurrentPage(1);
                }}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  selectedConfirmer === "ALL"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                All
              </button>
              {confirmerOptions.map((confirmer) => (
                <button
                  key={confirmer}
                  type="button"
                  onClick={() => {
                    setSelectedConfirmer(confirmer);
                    setCurrentPage(1);
                  }}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    selectedConfirmer === confirmer
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {confirmer}
                </button>
              ))}
            </div>
          </div>

          <div className="text-muted-foreground text-[11px] tabular-nums">
            Showing <span className="font-bold text-foreground">{sortedTasks.length}</span> of{" "}
            <span className="font-bold text-foreground">{tasks.length}</span> total completed picks
          </div>
        </div>
      </div>

      {/* Structured History Data Table */}
      <div className="overflow-x-auto rounded-xl border border-border/70 mt-4">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="border-b bg-muted/40 font-bold uppercase text-muted-foreground">
            <tr>
              <th className="px-3.5 py-3">Task No</th>
              <th className="px-3.5 py-3">Assembly Request</th>
              <th className="px-3.5 py-3">Material</th>
              <th className="px-3.5 py-3">Pick Location</th>
              <th className="px-3.5 py-3 text-right">Picked Qty</th>
              <th className="px-3.5 py-3">Confirmed By</th>
              <th className="px-3.5 py-3">Confirmed At</th>
              <th className="px-3.5 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {paginatedTasks.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Boxes className="size-8 text-muted-foreground/40" />
                    <p className="font-semibold text-foreground text-sm">
                      {tasks.length === 0
                        ? "No completed picks have been recorded yet."
                        : "No historical pick records match the selected filter criteria."}
                    </p>
                    {hasActiveFilters && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleClearFilters}
                        className="mt-2 text-xs font-bold rounded-xl"
                      >
                        <RotateCcw className="size-3.5 mr-1.5" /> Reset Filters
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              paginatedTasks.map((task) => (
                <tr
                  key={task.id}
                  className="hover:bg-muted/30 transition-colors"
                >
                  {/* Task No */}
                  <td className="px-3.5 py-3.5 font-mono font-bold text-primary whitespace-nowrap">
                    {task.task_number || task.id}
                  </td>

                  {/* Assembly Request */}
                  <td className="px-3.5 py-3.5 font-mono font-semibold text-foreground whitespace-nowrap">
                    {task.assembly_order_number || "—"}
                  </td>

                  {/* Material */}
                  <td className="px-3.5 py-3.5">
                    <span className="block font-bold text-foreground">
                      {task.material_name || task.material_code || "—"}
                    </span>
                    {task.material_name && task.material_code && (
                      <span className="block font-mono text-[11px] text-muted-foreground mt-0.5">
                        {task.material_code}
                      </span>
                    )}
                  </td>

                  {/* Pick Location */}
                  <td className="px-3.5 py-3.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold bg-muted/50 border border-border/70 rounded-md px-2 py-0.5 text-foreground">
                      <MapPin className="size-3 text-primary shrink-0" />
                      {task.pick_location || "—"}
                    </span>
                  </td>

                  {/* Picked Quantity */}
                  <td className="px-3.5 py-3.5 text-right font-bold tabular-nums text-foreground whitespace-nowrap">
                    <span className="text-sm">
                      {task.picked_quantity ?? task.quantity ?? "—"}
                    </span>{" "}
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {task.uom || "PCS"}
                    </span>
                  </td>

                  {/* Confirmed By */}
                  <td className="px-3.5 py-3.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                      <User className="size-3 text-muted-foreground shrink-0" />
                      {task.confirmation?.confirmed_by || "—"}
                    </span>
                  </td>

                  {/* Confirmed At */}
                  <td className="px-3.5 py-3.5 text-muted-foreground whitespace-nowrap tabular-nums">
                    {formatDateTime(task.confirmation?.confirmed_at)}
                  </td>

                  {/* Status */}
                  <td className="px-3.5 py-3.5 text-center whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/80 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="size-3" />
                      {task.status || "COMPLETED"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {sortedTasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border/60 mt-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs font-bold"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-muted-foreground tabular-nums">
              Page <span className="font-bold text-foreground">{effectivePage}</span> of{" "}
              <span className="font-bold text-foreground">{totalPages}</span>
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={effectivePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="size-8 p-0 rounded-lg"
                aria-label="Previous Page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={effectivePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="size-8 p-0 rounded-lg"
                aria-label="Next Page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

