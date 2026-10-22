import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { assignedPutawayLocations, canAssignPutaway, canScanPutaway, unassignedPutawayQuantity, type PutawayBatch } from "@/lib/putaway-task-selection";

export type PutawayView = "assign" | "scan" | "details";
export function PutawayBatchTable({ tasks, mode = "details", onAssign, onScan }: {
  tasks: PutawayBatch[]; mode?: PutawayView; onAssign: (task: PutawayBatch) => void; onScan: (task: PutawayBatch) => void;
}) {
  const visible = tasks.filter(task => mode === "assign" ? canAssignPutaway(task) : mode === "scan" ? canScanPutaway(task) : true);
  return <div className="max-h-[55dvh] overflow-auto rounded-xl border">
    <table className="w-full min-w-[700px] table-fixed text-left text-xs">
      <colgroup><col className="w-[32%]" /><col className="w-[19%]" /><col className="w-[27%]" /><col className="w-[22%]" /></colgroup>
      <thead className="sticky top-0 z-10 bg-muted text-muted-foreground"><tr>
        <th className="px-4 py-3">Material / Batch</th><th className="px-4 py-3">{mode === "assign" ? "Unassigned Quantity" : "Remaining to Put Away"}</th><th className="px-4 py-3">{mode === "assign" ? "Existing Assignments" : "Assigned Rack"}</th><th className="px-4 py-3 text-right">{mode === "details" ? "Status" : "Action"}</th>
      </tr></thead>
      <tbody className="divide-y">{visible.map(task => {
        const locations = assignedPutawayLocations(task);
        return <tr key={task.id} className="align-middle hover:bg-muted/20">
          <td className="px-4 py-4"><p className="font-semibold">{task.material_name || task.item_code}</p><p className="mt-1 break-words font-mono leading-5 text-muted-foreground">{task.batch_number || "No batch recorded"}</p></td>
          <td className="px-4 py-4"><p className="font-semibold tabular-nums">{mode === "assign" ? unassignedPutawayQuantity(task) : task.quantity ?? "Unavailable"} {task.uom}</p>{mode === "details" && <p className="mt-1 text-muted-foreground">Unassigned: {unassignedPutawayQuantity(task)} {task.uom}</p>}</td>
          <td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{locations.length ? locations.map(code => <Badge key={code} variant="outline" className="max-w-full break-all whitespace-normal text-[10px]">{code}</Badge>) : <span className="text-muted-foreground">Unassigned</span>}</div></td>
          <td className="px-4 py-4 text-right">
            {mode === "assign" && <Button size="sm" variant="outline" className="min-w-28" onClick={() => onAssign(task)}>Assign Rack</Button>}
            {mode === "scan" && <Button size="sm" variant="outline" className="min-w-28" onClick={() => onScan(task)}>Scan QR</Button>}
            {mode === "details" && <Badge variant="outline" className="max-w-full whitespace-normal text-[10px]">{task.status || "Status unavailable"}</Badge>}
          </td>
        </tr>;
      })}
      {!visible.length && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">{mode === "assign" ? "All batch quantities have already been assigned to racks." : mode === "scan" ? "No assigned batches are waiting for QR putaway confirmation." : "No material batches found."}</td></tr>}
      </tbody>
    </table>
  </div>;
}
