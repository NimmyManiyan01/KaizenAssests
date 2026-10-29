import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import type {
  AssemblyFinishedGoodsTraceability,
  AssemblyFinishedGoodsTraceabilityMaterial as Material,
} from "@/lib/api-client";
import {
  OriginalMaterialQrPreview,
  PrintAllMaterialQrs,
} from "@/components/wms/original-material-qr";
import {
  downloadOriginalMaterialQr,
  ORIGINAL_QR_OPTIONS,
  originalMaterialQrFilename,
  originalQrPrintSet,
  printOriginalMaterialQrs,
  renderOriginalMaterialQr,
} from "@/lib/original-material-qr";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));
const png = "data:image/png;base64,b3JpZ2luYWw=";
const material: Material = {
  material_name: "Steel Pipe",
  material_code: "STEEL-PIPE",
  grn_batch_id: "batch-a",
  batch_number: "LOT-001",
  original_qr_identity: "QR-001",
  original_qr_payload: "  GRN|LOT-001\nMaterial: Steel Pipe\nQty: 100  ",
  quantity_consumed: 1.2345,
  uom: "PCS",
  grn_reference: { grn_id: "grn-1", grn_number: "GRN-001" },
  supplier: { supplier_name: "Acme", source: "GRN supplier snapshot" },
  consumption_event_ids: ["event-1", "event-2"],
};
const batchB: Material = {
  ...material,
  grn_batch_id: "batch-b",
  batch_number: "LOT-002",
  original_qr_identity: "QR-002",
  original_qr_payload: "ORIGINAL-B",
};
const data = (
  materials = [material, batchB],
  status = "COMPLETE",
): AssemblyFinishedGoodsTraceability => ({
  finished_goods: {
    fg_id: "fg-a",
    fg_batch_number: "FG-001",
    serial_number: "S-001",
    product_code: "PUMP",
    product_name: "Pump",
    finished_quantity: 2,
    uom: "PCS",
    qc_status: "QC_APPROVED",
    qr_identity: "FG-QR",
  },
  assembly: {
    assembly_order_id: "order-1",
    assembly_order_number: "ASM-001",
    production_status: "COMPLETED",
  },
  traceability: {
    overall_status: status as "COMPLETE",
    total_material_batches: materials.length,
    verified_material_batches: materials.length,
    unlinked_material_records: 0,
    data_quality_warnings: [],
  },
  consumed_materials: materials,
  consumption_events: [],
  unlinked_material_records: [],
});

function popup() {
  const doc = document.implementation.createHTMLDocument("Print test");
  const win = {
    document: doc,
    closed: false,
    opener: window,
    focus: vi.fn(),
    print: vi.fn(),
    close: vi.fn(),
  };
  vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
  return win;
}
async function loadPrintImages(win: ReturnType<typeof popup>) {
  await waitFor(() => expect(win.document.querySelectorAll("img").length).toBeGreaterThan(0));
  win.document.querySelectorAll("img").forEach((image) => image.dispatchEvent(new Event("load")));
}
beforeEach(() => {
  vi.mocked(QRCode.toDataURL).mockReset().mockResolvedValue(png);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("original material QR output", () => {
  it("renders PNG with exact stored whitespace and high contrast quiet zone without changing the material", async () => {
    const snapshot = JSON.stringify(material);
    expect(await renderOriginalMaterialQr(material)).toBe(png);
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      material.original_qr_payload,
      ORIGINAL_QR_OPTIONS,
    );
    expect(ORIGINAL_QR_OPTIONS).toMatchObject({
      type: "image/png",
      margin: 4,
      width: 768,
      color: { dark: "#000000", light: "#ffffff" },
    });
    expect(JSON.stringify(material)).toBe(snapshot);
  });

  it.each([
    { original_qr_payload: null },
    { original_qr_payload: " \n " },
    { batch_number: null },
    { grn_batch_id: "" },
    { original_qr_identity: "" },
  ])("rejects unavailable original relationships: %j", async (missing) => {
    await expect(renderOriginalMaterialQr({ ...material, ...missing })).rejects.toThrow(
      "Original material QR is unavailable for this batch.",
    );
    expect(QRCode.toDataURL).not.toHaveBeenCalled();
  });

  it("deduplicates original identities and preserves separate batches and different QRs in one batch", () => {
    const anotherQr = {
      ...material,
      original_qr_identity: "QR-003",
      original_qr_payload: "THIRD-QR",
    };
    const result = originalQrPrintSet(
      data([material, { ...material, consumption_event_ids: ["event-3"] }, batchB, anotherQr]),
    );
    expect(result.materials.map((m) => m.original_qr_identity)).toEqual([
      "QR-001",
      "QR-002",
      "QR-003",
    ]);
    expect(result.warning).toBe("");
  });

  it("excludes conflicting QR identities instead of merging different batches or payloads", () => {
    const result = originalQrPrintSet(
      data([material, { ...batchB, original_qr_identity: material.original_qr_identity }]),
    );
    expect(result.materials).toHaveLength(0);
    expect(result.conflicts.has("QR-001")).toBe(true);
    expect(result.warning).toContain("incomplete");
  });

  it("prints only verified available materials and warns on partial/unlinked history", () => {
    const response = data([material, { ...batchB, original_qr_payload: null }], "PARTIAL");
    response.unlinked_material_records.push({
      material_code: "LEGACY",
      quantity_consumed: 5,
      uom: "PCS",
      traceability_status: "UNLINKED",
      reason: "No original QR",
    });
    const result = originalQrPrintSet(response);
    expect(result.materials).toEqual([material]);
    expect(result.warning).toContain("historical, unlinked, missing or conflicting");
  });

  it("prints two labels only after both QR images load and preserves safe material text", async () => {
    const win = popup();
    const result = printOriginalMaterialQrs(
      [{ ...material, material_name: '<img src=x onerror="bad()">' }, batchB],
      "Incomplete set",
    );
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(win.print).not.toHaveBeenCalled();
    await loadPrintImages(win);
    await result;
    expect(win.document.querySelectorAll(".label")).toHaveLength(2);
    expect(win.document.querySelectorAll("img")).toHaveLength(2);
    expect(win.document.body.textContent).toContain('<img src=x onerror="bad()">');
    expect(win.document.body.textContent).toContain("LOT-001");
    expect(win.document.body.textContent).toContain("LOT-002");
    expect(win.document.body.textContent).toContain("GRN-001");
    expect(win.document.querySelector(".warning")?.textContent).toContain("Incomplete set");
    expect(win.document.body.querySelector("style")).toBeNull();
    expect(win.document.head.textContent).toContain("break-inside: avoid");
    expect(win.print).toHaveBeenCalledOnce();
    expect(vi.mocked(QRCode.toDataURL).mock.calls.map((call) => call[0])).toEqual([
      material.original_qr_payload,
      batchB.original_qr_payload,
    ]);
  });

  it("handles blocked print windows", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await expect(printOriginalMaterialQrs([material])).rejects.toThrow("Allow pop-ups");
    expect(QRCode.toDataURL).not.toHaveBeenCalled();
  });

  it("closes failed render jobs without printing an incomplete set", async () => {
    const win = popup();
    vi.mocked(QRCode.toDataURL).mockRejectedValueOnce(new Error("raw render failure"));
    await expect(printOriginalMaterialQrs([material, batchB])).rejects.toThrow(
      "Unable to print original material QRs",
    );
    expect(win.print).not.toHaveBeenCalled();
    expect(win.close).toHaveBeenCalledOnce();
  });

  it("handles image load and browser print failures", async () => {
    const win = popup();
    const result = printOriginalMaterialQrs([material]);
    const assertion = expect(result).rejects.toThrow("Unable to load original material QR images");
    await waitFor(() => expect(win.document.querySelector("img")).not.toBeNull());
    win.document.querySelector("img")!.dispatchEvent(new Event("error"));
    await assertion;
    expect(win.print).not.toHaveBeenCalled();
    win.print.mockImplementation(() => {
      throw new Error("print unavailable");
    });
    const retry = printOriginalMaterialQrs([material]);
    const retryAssertion = expect(retry).rejects.toThrow("Unable to print original material QRs");
    await loadPrintImages(win);
    await retryAssertion;
  });

  it("downloads a PNG with a sanitized filename and removes the temporary link", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.href).toBe(png);
      expect(this.download).toBe("STEEL-PIPE_LOT-001_ORIGINAL_QR.png");
    });
    downloadOriginalMaterialQr(material, png);
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a[download]")).toBeNull();
    const unsafe = originalMaterialQrFilename({
      ...material,
      material_code: "../../C:\\STEEL",
      batch_number: "a/b<>:*?",
    });
    expect(unsafe).not.toMatch(/[\\/:*?<>]/);
    expect(unsafe.endsWith("_ORIGINAL_QR.png")).toBe(true);
  });

  it("round-trips the unchanged original payload through the existing jsQR scanner", async () => {
    const actual = await vi.importActual<typeof import("qrcode")>("qrcode");
    const qr = actual.default.create(material.original_qr_payload!, {
      errorCorrectionLevel: ORIGINAL_QR_OPTIONS.errorCorrectionLevel,
    });
    const scale = 6,
      margin = ORIGINAL_QR_OPTIONS.margin;
    const size = (qr.modules.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < qr.modules.size; y++)
      for (let x = 0; x < qr.modules.size; x++) {
        if (!qr.modules.get(y, x)) continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
          }
      }
    expect(jsQR(pixels, size, size)?.data).toBe(material.original_qr_payload);
  });
});

describe("material QR preview and bulk actions", () => {
  it("shows original GRN context and downloads and prints the original QR", async () => {
    const win = popup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<OriginalMaterialQrPreview material={material} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByRole("img")).toHaveAttribute("src", png);
    for (const text of [
      "Steel Pipe",
      "STEEL-PIPE",
      "LOT-001",
      "GRN-001",
      "1.2345",
      "PCS",
      "QR-001",
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download QR" }));
    expect(click).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Print QR" }));
    await act(async () => {
      await loadPrintImages(win);
    });
    await waitFor(() => expect(win.print).toHaveBeenCalledOnce());
  });

  it("does not offer output for missing original payload", () => {
    render(
      <OriginalMaterialQrPreview
        material={{ ...material, original_qr_payload: null }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Original material QR is unavailable for this batch.",
    );
    expect(screen.getByRole("button", { name: "Print QR" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download QR" })).toBeDisabled();
    expect(QRCode.toDataURL).not.toHaveBeenCalled();
  });

  it("shows a safe render failure without a substitute QR", async () => {
    vi.mocked(QRCode.toDataURL).mockRejectedValue(new Error("raw error"));
    render(<OriginalMaterialQrPreview material={material} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to render the original material QR",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print QR" })).toBeDisabled();
  });

  it("handles download failure with a safe operator message", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<OriginalMaterialQrPreview material={material} onClose={vi.fn()} />);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Download QR" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to download the original material QR",
    );
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("bulk prints unique verified identities and includes partial-history warnings", async () => {
    const win = popup();
    render(<PrintAllMaterialQrs data={data([material, material, batchB], "PARTIAL")} />);
    expect(screen.getByText(/This printed set is incomplete/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Print All Material QRs" }));
    await act(async () => {
      await loadPrintImages(win);
    });
    await waitFor(() => expect(win.print).toHaveBeenCalledOnce());
    expect(win.document.querySelectorAll(".label")).toHaveLength(2);
    expect(win.document.querySelector(".warning")?.textContent).toContain("incomplete");
  });

  it("disables bulk printing for empty or unlinked history", () => {
    render(<PrintAllMaterialQrs data={data([], "UNLINKED")} />);
    expect(screen.getByRole("button", { name: "Print All Material QRs" })).toBeDisabled();
    expect(
      screen.getByText("No verified original material QRs are available to print."),
    ).toBeInTheDocument();
    expect(QRCode.toDataURL).not.toHaveBeenCalled();
  });
});
