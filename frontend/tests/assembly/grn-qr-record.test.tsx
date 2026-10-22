import { expect, it, vi } from "vitest";
import { loadGrnQrRecord } from "@/lib/grn-qr-record";

it("replaces wizard batches with saved batches immediately after completion", async () => {
  const stale = { grn_id: "id-1", grn_number: "GRN-001", lines: [{ batches: [{ batch_number: "DRAFT-001" }] }] };
  const saved = { grn_number: "GRN-001", lines: [{ batches: [{ batch_number: "LOT-SAVED-001" }] }] };
  const fetchDetail = vi.fn().mockResolvedValue(saved);
  const result = await loadGrnQrRecord(stale, fetchDetail);
  expect(fetchDetail).toHaveBeenCalledWith("id-1");
  expect(result.lines[0].batches[0].batch_number).toBe("LOT-SAVED-001");
  expect(stale.lines[0].batches[0].batch_number).toBe("DRAFT-001");
});

it("uses identical saved batches before and after logging in again", async () => {
  const saved = { grn_number: "GRN-001", lines: [{ batches: [{ batch_number: "LOT-SAVED-001" }] }] };
  const fetchDetail = vi.fn().mockResolvedValue(saved);
  expect(await loadGrnQrRecord({ grn_id: "id-1", materials: [{ batch_number: "DRAFT" }] }, fetchDetail))
    .toMatchObject(await loadGrnQrRecord({ grn_id: "id-1" }, fetchDetail));
});

it("does not offer stale QR downloads when the saved receipt cannot be loaded", async () => {
  await expect(loadGrnQrRecord({ grn_id: "id-1", lines: [{ batches: [{ batch_number: "DRAFT" }] }] },
    vi.fn().mockRejectedValue(new Error("offline")))).rejects.toThrow("Could not load saved GRN batches");
});

it("tries the GRN number when the record UUID is stale", async () => {
  const fetchDetail = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ lines: [] });
  await loadGrnQrRecord({ grn_id: "stale", grn_number: "GRN-001" }, fetchDetail);
  expect(fetchDetail.mock.calls.map(([id]) => id)).toEqual(["stale", "GRN-001"]);
});
