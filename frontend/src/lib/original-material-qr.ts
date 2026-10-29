import QRCode from "qrcode";
import type {
  AssemblyFinishedGoodsTraceability,
  AssemblyFinishedGoodsTraceabilityMaterial as Material,
} from "./api-client";

export const ORIGINAL_QR_UNAVAILABLE = "Original material QR is unavailable for this batch.";
export const ORIGINAL_QR_OPTIONS = {
  type: "image/png" as const,
  width: 768,
  margin: 4,
  errorCorrectionLevel: "M" as const,
  color: { dark: "#000000", light: "#ffffff" },
};

export function hasOriginalMaterialQr(material: Material): boolean {
  return Boolean(
    material.grn_batch_id &&
    material.batch_number &&
    material.original_qr_identity &&
    typeof material.original_qr_payload === "string" &&
    material.original_qr_payload.trim(),
  );
}

export async function renderOriginalMaterialQr(material: Material): Promise<string> {
  if (!hasOriginalMaterialQr(material)) throw new Error(ORIGINAL_QR_UNAVAILABLE);
  // Never normalize, rebuild, or append traceability quantities to this payload.
  const url = await QRCode.toDataURL(material.original_qr_payload!, ORIGINAL_QR_OPTIONS);
  if (!url.startsWith("data:image/png;base64,"))
    throw new Error("Unable to render the original material QR.");
  return url;
}

export function originalQrPrintSet(data: AssemblyFinishedGoodsTraceability) {
  const byIdentity = new Map<string, Material>();
  const conflicts = new Set<string>();
  let unavailable = 0;
  for (const material of data.consumed_materials) {
    if (!hasOriginalMaterialQr(material)) {
      unavailable++;
      continue;
    }
    const previous = byIdentity.get(material.original_qr_identity);
    if (
      previous &&
      (previous.grn_batch_id !== material.grn_batch_id ||
        previous.batch_number !== material.batch_number ||
        previous.material_code !== material.material_code ||
        previous.original_qr_payload !== material.original_qr_payload)
    ) {
      conflicts.add(material.original_qr_identity);
    } else if (!previous) byIdentity.set(material.original_qr_identity, material);
  }
  const materials = [...byIdentity.values()].filter(
    (material) => !conflicts.has(material.original_qr_identity),
  );
  const incomplete =
    data.traceability.overall_status !== "COMPLETE" ||
    data.unlinked_material_records.length > 0 ||
    data.traceability.unlinked_material_records > 0 ||
    unavailable > 0 ||
    conflicts.size > 0;
  const warning = incomplete
    ? "This printed set is incomplete. Only verified original material QRs with available payloads are included; historical, unlinked, missing or conflicting QR records are excluded."
    : "";
  return { materials, warning, conflicts };
}

export function originalMaterialQrFilename(material: Material) {
  const safe = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 70) || "UNKNOWN";
  return `${safe(material.material_code)}_${safe(material.batch_number || "UNKNOWN")}_ORIGINAL_QR.png`;
}

export function downloadOriginalMaterialQr(material: Material, url: string) {
  if (!hasOriginalMaterialQr(material) || !url.startsWith("data:image/png;base64,"))
    throw new Error(ORIGINAL_QR_UNAVAILABLE);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = originalMaterialQrFilename(material);
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
  }
}

export async function printOriginalMaterialQrs(materials: Material[], warning = "") {
  if (!materials.length || materials.some((material) => !hasOriginalMaterialQr(material)))
    throw new Error(ORIGINAL_QR_UNAVAILABLE);
  // Reserve the window during the user gesture, before asynchronous QR rendering.
  const popup = window.open("", "_blank", "width=950,height=950");
  if (!popup) throw new Error("Allow pop-ups to print original material QRs.");
  try {
    popup.opener = null;
    const doc = popup.document;
    doc.title = "KAIZENX - Original Material QRs";
    doc.body.textContent = "Preparing original material QR labels...";
    const urls = await Promise.all(materials.map(renderOriginalMaterialQr));
    if (popup.closed) throw new Error("The print window was closed. Please try again.");
    doc.body.replaceChildren();
    const style = doc.createElement("style");
    // Match GRN's 380px card and 260px QR; keep labels intact over multiple pages.
    style.textContent = `@page { margin: 12mm; } body { margin: 0; padding: 16px; background: #fff; color: #000; font: 12px Arial, sans-serif; }
      .labels { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 380px)); gap: 16px; justify-content: center; }
      .label { box-sizing: border-box; border: 2px solid #000; border-radius: 12px; padding: 16px; width: 100%; max-width: 380px; break-inside: avoid; page-break-inside: avoid; }
      h1 { font-size: 12px; text-align: center; border-bottom: 1px solid #999; padding-bottom: 8px; } p { overflow-wrap: anywhere; margin: 6px 0; }
      img { display: block; width: 260px; height: 260px; margin: 12px auto; } .warning { border: 2px solid #000; padding: 10px; font-weight: bold; }
      @media print { body { padding: 0; } .label { margin-bottom: 12px; } }`;
    doc.head.appendChild(style);
    if (warning) {
      const notice = doc.createElement("p");
      notice.className = "warning";
      notice.textContent = warning;
      doc.body.appendChild(notice);
    }
    const grid = doc.createElement("div");
    grid.className = "labels";
    doc.body.appendChild(grid);
    const images: HTMLImageElement[] = [];
    materials.forEach((material, index) => {
      const card = doc.createElement("section");
      card.className = "label";
      const heading = doc.createElement("h1");
      heading.textContent = "KAIZENX — ORIGINAL MATERIAL QR";
      card.appendChild(heading);
      for (const [label, value] of [
        ["Material Name", material.material_name],
        ["Material Code", material.material_code],
        ["GRN Batch", material.batch_number],
        [
          "GRN Reference",
          material.grn_reference.grn_number || material.grn_reference.grn_id || "Unavailable",
        ],
        ["Original QR Identity", material.original_qr_identity],
      ]) {
        const line = doc.createElement("p");
        line.textContent = `${label}: ${value}`;
        card.appendChild(line);
      }
      const image = doc.createElement("img");
      image.alt = `Original material QR - ${material.batch_number}`;
      image.dataset.qrUrl = urls[index];
      images.push(image);
      card.appendChild(image);
      grid.appendChild(card);
    });
    await new Promise<void>((resolve, reject) => {
      let remaining = images.length;
      const cleanup = () => {
        window.clearTimeout(timer);
        images.forEach((image) => {
          image.onload = null;
          image.onerror = null;
        });
      };
      const fail = () => {
        cleanup();
        reject(new Error("Unable to load original material QR images for printing. Please retry."));
      };
      const timer = window.setTimeout(fail, 15000);
      images.forEach((image) => {
        let loaded = false;
        const ready = () => {
          if (loaded) return;
          loaded = true;
          if (--remaining === 0) {
            cleanup();
            resolve();
          }
        };
        image.onload = ready;
        image.onerror = fail;
        image.src = image.dataset.qrUrl!;
        if (image.complete && image.naturalWidth > 0) ready();
      });
    });
    if (popup.closed) throw new Error("The print window was closed. Please try again.");
    popup.focus();
    popup.print();
  } catch (error) {
    popup.close();
    throw new Error(
      error instanceof Error && /pop-ups|print window|images/.test(error.message)
        ? error.message
        : "Unable to print original material QRs. Please try again.",
    );
  }
}
