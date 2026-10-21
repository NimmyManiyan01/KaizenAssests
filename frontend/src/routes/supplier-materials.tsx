import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  ToggleLeft,
  ToggleRight,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/supplier-materials")({ component: SupplierMaterials });
const UOMS = ["PCS", "BUNDLE", "SET", "KG", "LITER", "METER", "BOX"];
const emptyForm = { code: "", name: "", category: "", description: "", uom: "PCS" };

function SupplierMaterials() {
  const [materials, setMaterials] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [uomFilter, setUomFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [details, setDetails] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: "status" | "delete";
    material: any;
  } | null>(null);

  const loadMaterials = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.getMaterialComponents("ALL");
      setMaterials(
        (rows || []).map((m: any) => ({
          ...m,
          code: m.code || m.material_code,
          name: m.name || m.material_name,
          uom: m.uom || m.base_uom,
        })),
      );
    } catch (err: any) {
      setError(err?.message || "Unable to load materials");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadMaterials();
  }, []);
  const filtered = useMemo(
    () =>
      materials.filter(
        (m) =>
          `${m.code || ""} ${m.name || ""}`.toLowerCase().includes(query.toLowerCase()) &&
          (uomFilter === "ALL" || m.uom === uomFilter),
      ),
    [materials, query, uomFilter],
  );
  const uoms = [...new Set([...UOMS, ...materials.map((m) => m.uom).filter(Boolean)])];
  const openAdd = async () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };
  const generateMaterialCode = (materialName = form.name) => {
    if (editing || !materialName.trim()) return;
    const prefix =
      materialName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 4) || "MAT";
    const usedCodes = new Set(
      materials.map((material) => String(material.code || "").toUpperCase()),
    );
    let sequence = materials.length + 1;
    let generated = `MAT-${prefix}-${String(sequence).padStart(3, "0")}`;
    while (usedCodes.has(generated)) {
      sequence += 1;
      generated = `MAT-${prefix}-${String(sequence).padStart(3, "0")}`;
    }
    setForm((current) => ({ ...current, code: generated }));
  };
  const openEdit = (m: any) => {
    setEditing(m);
    setForm({
      code: m.code || "",
      name: m.name || "",
      category: m.category || "",
      description: m.description || "",
      uom: m.uom || "PCS",
    });
    setDialogOpen(true);
  };
  const saveMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = { ...form, code: form.code.trim().toUpperCase(), name: form.name.trim() };
    if (!next.code || !next.name || !next.uom) {
      toast.error("Complete all required material fields");
      return;
    }
    if (
      materials.some(
        (m) =>
          m.id !== editing?.id &&
          (String(m.code).toUpperCase() === next.code ||
            String(m.name).toLowerCase() === next.name.toLowerCase()),
      )
    ) {
      toast.error("Material code or name already exists");
      return;
    }
    setSaving(true);
    try {
      const saved = editing
        ? await api.updateGateMaterial(editing.id, { material_name: next.name, base_uom: next.uom })
        : await api.createMaterialComponent(next.name, next.uom, next.code);
      setMaterials((rows) =>
        editing
          ? rows.map((row) => (row.id === editing.id ? { ...row, ...saved, ...next } : row))
          : [{ ...saved, ...next }, ...rows],
      );
      setDialogOpen(false);
      toast.success(editing ? "Material updated" : "Material created");
    } catch (err: any) {
      toast.error(err?.message || "Unable to save material");
    } finally {
      setSaving(false);
    }
  };
  const toggleStatus = async (m: any) => {
    const nextStatus = String(m.status).toUpperCase() === "ACTIVE" ? "Inactive" : "Active";
    try {
      const result = await api.updateGateMaterialStatus(m.id, nextStatus);
      setMaterials((rows) =>
        rows.map((row) =>
          row.id === m.id ? { ...row, status: result.status || nextStatus } : row,
        ),
      );
      toast.success(`Material ${nextStatus.toLowerCase()}`);
    } catch (err: any) {
      toast.error(err?.message || "Unable to change material status");
    }
  };
  const deleteMaterial = async (m: any) => {
    try {
      const result = await api.deleteGateMaterial(m.id);
      if (result?.deleted === false) {
        setMaterials((rows) =>
          rows.map((row) => (row.id === m.id ? { ...row, status: "Inactive" } : row)),
        );
        toast.success("Material was deactivated because it is in use");
      } else {
        setMaterials((rows) => rows.filter((row) => row.id !== m.id));
        toast.success("Material deleted");
      }
    } catch (err: any) {
      if (err?.status === 404) {
        setMaterials((rows) => rows.filter((row) => row.id !== m.id));
        toast.info("This material was already removed. The list was refreshed.");
      } else {
        toast.error(err?.message || "Material cannot be deleted because it is in use");
      }
    }
  };
  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    if (action.type === "status") await toggleStatus(action.material);
    else await deleteMaterial(action.material);
  };
  return (
    <AppShell
      title="Materials"
      subtitle="Create and manage the materials available for your ASN submissions."
      actions={
        <Button onClick={openAdd} className="rounded-xl">
          <Plus className="mr-2 size-4" /> Add Material
        </Button>
      }
    >
      <Card className="rounded-2xl border-border/70 shadow-sm">
        <CardHeader className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackagePlus className="size-4 text-sky-600" /> Material Catalog
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search code or name..."
                className="pl-9"
              />
            </div>
            <Select value={uomFilter} onValueChange={setUomFilter}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All UOM</SelectItem>
                {uoms.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setUomFilter("ALL");
              }}
            >
              Clear Filters
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {error ? (
            <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
              <span>{error}</span>
              <Button variant="outline" onClick={() => void loadMaterials()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    {[
                      "Material Code",
                      "Material Name",
                      "UOM",
                      "Status",
                      "Actions",
                    ].map((title) => (
                      <th key={title} className="px-4 py-3">
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                        <td colSpan={5} className="px-4 py-10 text-center">
                        <Loader2 className="mx-auto size-5 animate-spin" />
                      </td>
                    </tr>
                  ) : !filtered.length ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                        {materials.length
                          ? "No materials match your filters."
                          : "No materials found."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((m) => (
                      <tr key={m.id || m.code} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono font-bold text-sky-700">{m.code}</td>
                        <td className="px-4 py-3 font-semibold">{m.name}</td>
                        <td className="px-4 py-3">{m.uom}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              String(m.status).toUpperCase() === "ACTIVE"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-100 text-slate-600"
                            }`}
                          >
                            {String(m.status).toUpperCase() === "ACTIVE" ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Material actions"
                                aria-label={`Actions for ${m.name}`}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => setDetails(m)}>
                                <Eye /> View
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEdit(m)}>
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setPendingAction({ type: "status", material: m })}
                              >
                                {String(m.status).toUpperCase() === "ACTIVE" ? (
                                  <ToggleLeft />
                                ) : (
                                  <ToggleRight />
                                )}
                                {String(m.status).toUpperCase() === "ACTIVE"
                                  ? "Deactivate"
                                  : "Activate"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-rose-600 focus:text-rose-700"
                                onClick={() => setPendingAction({ type: "delete", material: m })}
                              >
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {filtered.length} of {materials.length} materials
          </p>
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Material" : "Add Material"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveMaterial} className="space-y-4">
            <div>
              <Label>Material Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => {
                  setForm({
                    ...form,
                    name: e.target.value,
                    code: editing ? form.code : "",
                  });
                  if (!editing && e.target.value.trim()) generateMaterialCode(e.target.value);
                }}
                onBlur={() => generateMaterialCode()}
                placeholder="Enter material name"
              />
            </div>
            <div>
              <Label>Material Code *</Label>
              <Input
                value={form.code}
                disabled={Boolean(editing)}
                readOnly={!editing}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="Generated after entering material name"
                className={!editing ? "bg-muted font-mono font-bold text-sky-700" : ""}
              />
              {!editing && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Generated automatically after entering the material name.
                </p>
              )}
            </div>
            <div>
              <Label>Base UOM *</Label>
              <Select value={form.uom} onValueChange={(value) => setForm({ ...form, uom: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {uoms.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.code.trim() || !form.name.trim() || !form.uom}
              >
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                {editing ? "Save Changes" : "Save Material"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(details)} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Material Details</DialogTitle>
          </DialogHeader>
          {details && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ["Material Code", details.code],
                ["Material Name", details.name],
                ["UOM", details.uom],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-semibold">{String(value)}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.type === "delete" ? "Delete material?" : "Change material status?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === "delete"
                ? `Delete ${pendingAction.material?.code}? This cannot be undone. Materials referenced by transactions will be deactivated instead.`
                : `Deactivate this material? It will no longer be available for new ASN submissions.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmPendingAction()}>
              {pendingAction?.type === "delete" ? "Delete" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
