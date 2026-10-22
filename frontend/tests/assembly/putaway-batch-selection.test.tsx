import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PutawayBatchTable } from "@/components/wms/putaway-batch-table";
import { canAssignPutaway, canScanPutaway, unassignedPutawayQuantity, assignedPutawayLocations, isAssignableRack, type PutawayBatch } from "@/lib/putaway-task-selection";
const tasks: PutawayBatch[] = [
  { id: "pipe-1", material_name: "Steel Pipe", batch_number: "PIPE-BATCH-1", quantity: 45, remaining_quantity: 0, status: "ASSIGNED", destination_bin_id: "bin-1", destination_bin_code: "BIN-001", uom: "PCS" },
  { id: "pipe-2", material_name: "Steel Pipe", batch_number: "PIPE-BATCH-2", quantity: 45, remaining_quantity: 45, status: "PUTAWAY_PENDING", uom: "PCS" },
  { id: "battery-1", material_name: "Battery", batch_number: "BATTERY-BATCH-1", quantity: 63, remaining_quantity: 63, status: "PUTAWAY_PENDING", uom: "PCS" },
];
it("lets every remaining batch select its own rack instead of repeating the first task", () => {
  const assign = vi.fn(); const scan = vi.fn(); render(<PutawayBatchTable mode="assign" tasks={tasks} onAssign={assign} onScan={scan} />);
  expect(screen.queryByText("PIPE-BATCH-1")).not.toBeInTheDocument();
  const second = screen.getByText("PIPE-BATCH-2").closest("tr")!;
  fireEvent.click(within(second).getByRole("button", { name: "Assign Rack" })); expect(assign).toHaveBeenLastCalledWith(tasks[1]);
  const third = screen.getByText("BATTERY-BATCH-1").closest("tr")!;
  fireEvent.click(within(third).getByRole("button", { name: "Assign Rack" })); expect(assign).toHaveBeenLastCalledWith(tasks[2]);
  expect(assign).not.toHaveBeenCalledWith(tasks[0]);
});
it("scans the selected assigned batch and blocks unassigned scans", () => {
  const scan = vi.fn(); render(<PutawayBatchTable mode="scan" tasks={tasks} onAssign={vi.fn()} onScan={scan} />);
  const first = screen.getByText("PIPE-BATCH-1").closest("tr")!;
  fireEvent.click(within(first).getByRole("button", { name: "Scan QR" })); expect(scan).toHaveBeenCalledWith(tasks[0]);
  expect(screen.queryByText("PIPE-BATCH-2")).not.toBeInTheDocument();
});
it("uses the server's unassigned remainder for partially assigned quantities", () => {
  expect(unassignedPutawayQuantity({ ...tasks[1]!, quantity: 80, remaining_quantity: 20 })).toBe(20);
  expect(canAssignPutaway({ ...tasks[1]!, remaining_quantity: 0 })).toBe(false);
});
it("calculates a legacy remainder from real location assignments", () => {
  expect(unassignedPutawayQuantity({ id: "task", quantity: 80, location_assignments: [{ quantity: 30 }, { quantity: 20 }] })).toBe(30);
});
it.each(["STORED", "COMPLETED", "PUTAWAY_COMPLETED"])("blocks assigning and scanning %s batches", status => {
  const task = { ...tasks[0]!, remaining_quantity: 45, status }; expect(canAssignPutaway(task)).toBe(false); expect(canScanPutaway(task)).toBe(false);
});
it("does not hide compatible partially occupied racks", () => {
  for (const status of ["AVAILABLE", "ACTIVE", "OCCUPIED", "PARTIALLY_OCCUPIED"]) expect(isAssignableRack(status)).toBe(true);
  for (const status of ["INACTIVE", "MAINTENANCE", "BLOCKED"]) expect(isAssignableRack(status)).toBe(false);
});
it("shows all assigned locations without duplicating them", () => {
  expect(assignedPutawayLocations({ id: "task", destination_bin_code: "BIN-002", location_assignments: [{ location_code: "BIN-001" }, { location_code: "BIN-002" }] })).toEqual(["BIN-001", "BIN-002"]);
});

it("keeps View Details read-only and includes every batch", () => {
  render(<PutawayBatchTable mode="details" tasks={tasks} onAssign={vi.fn()} onScan={vi.fn()} />);
  for (const task of tasks) expect(screen.getByText(task.batch_number!)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(screen.getByRole("columnheader",{name:"Remaining to Put Away"})).toBeInTheDocument();
});
it("shows only unassigned quantity and assignment controls in Assign Rack", () => {
  render(<PutawayBatchTable mode="assign" tasks={[{ ...tasks[2]!, remaining_quantity: 3 }]} onAssign={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("3 PCS")).toBeInTheDocument(); expect(screen.queryByText("63 PCS")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1); expect(screen.queryByRole("button",{name:"Scan QR"})).not.toBeInTheDocument();
});
it("does not include completed batches or assignment controls in Scan QR", () => {
  render(<PutawayBatchTable mode="scan" tasks={[...tasks,{...tasks[0]!,id:"done",batch_number:"DONE-BATCH",status:"COMPLETED"}]} onAssign={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("PIPE-BATCH-1")).toBeInTheDocument(); expect(screen.queryByText("DONE-BATCH")).not.toBeInTheDocument();
  expect(screen.queryByText("BATTERY-BATCH-1")).not.toBeInTheDocument(); expect(screen.queryByRole("button",{name:"Assign Rack"})).not.toBeInTheDocument();
});
it("explains when no batches need rack assignment", () => {
  render(<PutawayBatchTable mode="assign" tasks={[tasks[0]!]} onAssign={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("All batch quantities have already been assigned to racks.")).toBeInTheDocument();
});
it("explains when no batches are ready for scanning", () => {
  render(<PutawayBatchTable mode="scan" tasks={[tasks[1]!]} onAssign={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("No assigned batches are waiting for QR putaway confirmation.")).toBeInTheDocument();
});
