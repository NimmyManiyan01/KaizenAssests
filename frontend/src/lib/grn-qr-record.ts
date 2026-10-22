// Completed-GRN labels must use persisted batches, never the wizard snapshot.
export async function loadGrnQrRecord(record: any, fetchDetail: (id: string) => Promise<any>) {
  const ids = [...new Set(
    [record.grn_id, record.id, record.grn_number, record.grnNumber].filter(Boolean).map(String),
  )];
  for (const id of ids) {
    try {
      const detail = await fetchDetail(id);
      if (detail && Array.isArray(detail.lines)) return { ...record, ...detail };
    } catch {
      // A legacy record may have a display number rather than a UUID.
    }
  }
  throw new Error("Could not load saved GRN batches. Refresh and retry downloading the QR.");
}
