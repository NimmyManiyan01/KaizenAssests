import { expect, it } from "vitest";
import { normalizeGrnResponse } from "@/lib/grn-response";
it("preserves saved camelCase batch quantities and QR payloads", () => {
 const result: any = normalizeGrnResponse({lines:[{grnLineId:"line-1",itemCode:"MAT-1",batches:[{batchId:"b-1",batchNumber:"LOT-1",batchQuantity:9,qrCode:{qrPayload:"saved"}}]}]});
 expect(result.lines[0].item_code).toBe("MAT-1");
 expect(result.lines[0].batches[0].batch_quantity).toBe(9);
 expect(result.lines[0].batches[0].qr_code.qr_payload).toBe("saved");
 expect(result.lines[0].batches[0].batchQuantity).toBe(9);
});
it("keeps snake case responses and zero quantities intact", () => {
 expect(normalizeGrnResponse({batch_quantity:0,batch_number:"LOT-2"})).toEqual({batch_quantity:0,batch_number:"LOT-2"});
});
