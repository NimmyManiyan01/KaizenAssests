export type PutawayBatch = {
  id: string; status?: string; quantity?: number | string; remaining_quantity?: number | string;
  material_name?: string; item_code?: string; batch_number?: string; uom?: string;
  destination_bin_id?: string; destination_bin_code?: string; destination_bin?: string;
  location_assignments?: { quantity?: number | string; location_code?: string; destination_bin_id?: string }[];
};
export function isPutawayComplete(task: PutawayBatch) {
  return ["PUTAWAY_COMPLETED", "COMPLETED", "STORED"].includes(String(task.status || "").toUpperCase());
}
export function unassignedPutawayQuantity(task: PutawayBatch): number {
  if (isPutawayComplete(task)) return 0;
  const value = task.remaining_quantity != null ? Number(task.remaining_quantity) :
    Number(task.quantity ?? 0) - (task.location_assignments || []).reduce((total, row) => total + Number(row.quantity || 0), 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
export function canAssignPutaway(task: PutawayBatch) { return unassignedPutawayQuantity(task) > 0; }
export function canScanPutaway(task: PutawayBatch) {
  return !isPutawayComplete(task) && !!(task.destination_bin_id || task.location_assignments?.some(row => row.destination_bin_id));
}
export function assignedPutawayLocations(task: PutawayBatch): string[] {
  const assigned = (task.location_assignments || []).map(row => row.location_code).filter((value): value is string => !!value);
  const destination = task.destination_bin_code || task.destination_bin;
  return [...new Set([...assigned, ...(destination ? [destination] : [])])];
}
export function isAssignableRack(status?: string) {
  return !status || ["ACTIVE", "AVAILABLE", "OCCUPIED", "PARTIALLY_OCCUPIED"].includes(status.toUpperCase());
}
