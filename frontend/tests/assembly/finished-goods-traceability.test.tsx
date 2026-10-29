import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const { api } = vi.hoisted(() => ({
  api: {
    getAssemblyFinishedGoods: vi.fn(),
    getFgLoading: vi.fn().mockResolvedValue([]),
    getAssemblyFinishedGoodsTraceability: vi.fn(),
    getAssemblyFinishedGoodsDetail: vi.fn(),
    verifyAssemblyFinishedGoodsQr: vi.fn(),
  },
}));

vi.mock("@/lib/api-client", () => ({ api }));
vi.mock("@/lib/auth-utils", () => ({ requireRole: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { Route } from "@/routes/assembly.finished-goods";
import QRCode from "qrcode";
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,original") },
}));

const materialA = {
  material_code: "STEEL-PIPE",
  material_name: "Steel Pipe",
  grn_batch_id: "grn-batch-a",
  batch_number: "LOT-001",
  original_qr_identity: "MAT-QR-001",
  original_qr_payload: "GRN|BATCH:LOT-001|QR:MAT-QR-001",
  quantity_consumed: 15,
  uom: "PCS",
  grn_reference: { grn_id: "grn-a", grn_number: "GRN-001" },
  supplier: { supplier_name: "Acme Metals", source: "GRN supplier snapshot" },
  consumption_event_ids: ["event-a1", "event-a2"],
};
const materialB = {
  ...materialA,
  grn_batch_id: "grn-batch-b",
  batch_number: "LOT-002",
  original_qr_identity: "MAT-QR-002",
  original_qr_payload: "GRN|BATCH:LOT-002|QR:MAT-QR-002",
  quantity_consumed: 20,
  grn_reference: { grn_id: "grn-b", grn_number: "GRN-002" },
  consumption_event_ids: ["event-b1"],
};
const event = (id: string, batchId: string, batchNumber: string, qr: string, quantity: number) => ({
  consumption_event_id: id,
  material_code: "STEEL-PIPE",
  grn_batch_id: batchId,
  batch_number: batchNumber,
  original_material_qr_reference: qr,
  quantity_consumed: quantity,
  uom: "PCS",
  consumed_at: "2026-10-28T10:00:00+00:00",
  recorded_by: "operator-1",
  traceability_status: "VERIFIED" as const,
});
const traceability = (fgId = "fg-a") => ({
  finished_goods: {
    fg_id: fgId,
    fg_batch_number: fgId === "fg-a" ? "FG-BATCH-A" : "FG-BATCH-B",
    serial_number: `SERIAL-${fgId}`,
    product_code: "PUMP-001",
    product_name: "Water Pump",
    finished_quantity: 5,
    uom: "PCS",
    qc_status: "QC_APPROVED",
    qr_identity: `FG-QR-${fgId}`,
  },
  assembly: {
    assembly_order_id: `order-${fgId}`,
    assembly_order_number: `ASM-${fgId}`,
    production_status: "COMPLETED",
  },
  traceability: {
    overall_status: "COMPLETE" as const,
    total_material_batches: 2,
    verified_material_batches: 2,
    unlinked_material_records: 0,
    data_quality_warnings: [],
  },
  consumed_materials: [materialA, materialB],
  consumption_events: [
    event("event-a1", "grn-batch-a", "LOT-001", "MAT-QR-001", 10),
    event("event-a2", "grn-batch-a", "LOT-001", "MAT-QR-001", 5),
    event("event-b1", "grn-batch-b", "LOT-002", "MAT-QR-002", 20),
  ],
  unlinked_material_records: [],
});
const fgA = {
  id: "fg-a",
  order_id: "order-fg-a",
  order_number: "ASM-fg-a",
  product_code: "PUMP-001",
  product_name: "Water Pump",
  quantity: 5,
  uom: "PCS",
  status: "QC_APPROVED",
  warehouse_id: "WH-1",
  location_code: "ASSEMBLY-STORAGE-01",
  batch_number: "FG-BATCH-A",
  serial_number: "SERIAL-fg-a",
  posted_at: "2026-10-28T10:00:00Z",
};
const fgB = { ...fgA, id: "fg-b", order_number: "ASM-fg-b", batch_number: "FG-BATCH-B" };
const productGroup = (batches = [fgA, fgB]) => ({
  ...fgA,
  id: "product-row",
  batches,
  quantity: 10,
  produced_quantity: 10,
});

function showPage() {
  const Page = (Route as any).options.component;
  return render(<Page />);
}

async function openTraceability(batchNumber = "FG-BATCH-A") {
  await userEvent.click(await screen.findByRole("button", { name: "View Details" }));
  const details = within(screen.getByRole("dialog"));
  const batchDetails = details.getAllByRole("button", { name: "Batch details" });
  const wantedBatch = batchNumber === "FG-BATCH-A" ? 0 : 1;
  await userEvent.click(batchDetails[wantedBatch]);
  const batchRow = details.getByText(batchNumber).closest("tr");
  if (!batchRow) throw new Error(`Could not locate ${batchNumber} row`);
  await userEvent.click(within(batchRow).getByRole("button", { name: "Material Traceability" }));
  return within(await screen.findByRole("dialog", { name: "Material Traceability" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getAssemblyFinishedGoods.mockResolvedValue([productGroup()]);
  api.getAssemblyFinishedGoodsTraceability.mockImplementation(async (id: string) =>
    traceability(id),
  );
});

describe("Finished Goods material traceability", () => {
  it("opens the original material QR from its verified traceability row", async () => {
    showPage();
    const view = await openTraceability();
    await userEvent.click(
      within(view.getAllByRole("row")[1]).getByRole("button", { name: "View Original QR" }),
    );
    const preview = within(screen.getByRole("dialog", { name: "Original Material QR" }));
    expect(await preview.findByRole("img")).toBeInTheDocument();
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      materialA.original_qr_payload,
      expect.objectContaining({ margin: 4, type: "image/png" }),
    );
    expect(preview.getByText("GRN-001")).toBeInTheDocument();
  });

  it("preserves fractional consumed quantities from the API", async () => {
    api.getAssemblyFinishedGoodsTraceability.mockResolvedValue({
      ...traceability(),
      consumed_materials: [{ ...materialA, quantity_consumed: 1.2345 }],
    });
    showPage();
    const view = await openTraceability();
    expect(view.getByRole("cell", { name: "1.2345" })).toBeInTheDocument();
    await userEvent.click(view.getByRole("button", { name: "View Details" }));
    expect(await screen.findByText("1.2345 PCS")).toBeInTheDocument();
  });

  it("keeps the existing finished-goods QR generation payload and label actions", async () => {
    api.getAssemblyFinishedGoodsDetail.mockResolvedValue({
      ...fgA,
      qr_code: "FG|ORIGINAL-IDENTITY|BATCH:A",
    });
    showPage();
    await userEvent.click(await screen.findByRole("button", { name: "View Details" }));
    const row = screen.getByText("FG-BATCH-A").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "View/Print QR" }));
    expect(await screen.findByRole("img", { name: "QR Matrix" })).toBeInTheDocument();
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      "FG|ORIGINAL-IDENTITY|BATCH:A",
      expect.any(Object),
    );
    expect(screen.getByRole("button", { name: "Download QR" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Print Physical Label" })).toBeEnabled();
    expect(api.getAssemblyFinishedGoodsTraceability).not.toHaveBeenCalled();
  });

  it("keeps a failed FG QR verification out of traceability and opens the verified batch after a matching scan", async () => {
    api.verifyAssemblyFinishedGoodsQr
      .mockRejectedValueOnce(Object.assign(new Error("database detail"), { status: 422 }))
      .mockResolvedValueOnce({ status: "LABEL_VERIFIED", fg_id: "fg-a" });
    showPage();
    await userEvent.click(await screen.findByRole("button", { name: "View Details" }));
    const batchRow = screen.getByText("FG-BATCH-A").closest("tr")!;
    await userEvent.click(within(batchRow).getByRole("button", { name: "Scan FG QR" }));
    const scanner = within(screen.getByRole("dialog", { name: "Verify Finished Goods QR" }));
    expect(scanner.getByRole("button", { name: "Verify QR" })).toBeDisabled();
    const input = scanner.getByLabelText("Finished goods / package QR");
    fireEvent.change(input, { target: { value: "WRONG-QR" } });
    await userEvent.click(scanner.getByRole("button", { name: "Verify QR" }));
    expect(await scanner.findByRole("alert")).toHaveTextContent("This QR does not match");
    expect(api.getAssemblyFinishedGoodsTraceability).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "FG|PUMP-001|ASM-fg-a|BATCH:FG-BATCH-A" } });
    await userEvent.click(scanner.getByRole("button", { name: "Verify QR" }));
    expect(api.verifyAssemblyFinishedGoodsQr).toHaveBeenLastCalledWith(
      "fg-a",
      "FG|PUMP-001|ASM-fg-a|BATCH:FG-BATCH-A",
    );
    const view = within(await screen.findByRole("dialog", { name: "Material Traceability" }));
    expect(await view.findByText("COMPLETE")).toBeInTheDocument();
    expect(api.getAssemblyFinishedGoodsTraceability).toHaveBeenCalledWith("fg-a");
  });

  it("displays missing QR, batch, supplier and GRN information without generating substitutes", async () => {
    api.getAssemblyFinishedGoodsTraceability.mockResolvedValue({
      ...traceability(),
      consumed_materials: [
        {
          ...materialA,
          original_qr_payload: null,
          batch_number: null,
          grn_reference: { grn_id: null, grn_number: null },
          supplier: { supplier_name: null, source: null },
        },
      ],
    });
    showPage();
    const view = await openTraceability();
    await userEvent.click(view.getByRole("button", { name: "View Details" }));
    const details = within(screen.getByRole("dialog", { name: "Material Batch Details" }));
    expect(details.getByText("Original QR Payload").parentElement).toHaveTextContent("Unavailable");
    expect(details.getByText("Supplier Name").parentElement).toHaveTextContent("Unavailable");
    expect(details.getByText("GRN Reference").parentElement).toHaveTextContent("Unavailable");
    expect(details.queryByText("Stored Payload (read-only)")).not.toBeInTheDocument();
  });

  it("retains the backend UNLINKED status for legacy-only history", async () => {
    api.getAssemblyFinishedGoodsTraceability.mockResolvedValue({
      ...traceability(),
      traceability: {
        ...traceability().traceability,
        overall_status: "UNLINKED",
        verified_material_batches: 0,
        total_material_batches: 0,
        unlinked_material_records: 1,
      },
      consumed_materials: [],
      consumption_events: [],
      unlinked_material_records: [
        {
          consumption_id: "legacy-1",
          material_code: "STEEL-PIPE",
          quantity_consumed: 35,
          uom: "PCS",
          traceability_status: "UNLINKED",
          reason: "No verified allocation.",
        },
      ],
    });
    showPage();
    const view = await openTraceability();
    expect(view.getAllByText("UNLINKED")).toHaveLength(2);
    expect(view.queryByText("COMPLETE")).not.toBeInTheDocument();
    expect(
      view.getByText(
        "Traceability information is unavailable for this historical production record.",
      ),
    ).toBeInTheDocument();
  });

  it("ignores a late response from a previously closed batch and retries a network failure", async () => {
    let resolveFirst!: (value: ReturnType<typeof traceability>) => void;
    api.getAssemblyFinishedGoodsTraceability
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(traceability("fg-b"));
    showPage();
    let view = await openTraceability();
    await userEvent.click(view.getAllByRole("button", { name: "Close" }).at(-1)!);
    const row = screen.getByText("FG-BATCH-B").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Material Traceability" }));
    view = within(screen.getByRole("dialog", { name: "Material Traceability" }));
    expect(await view.findByRole("alert")).toHaveTextContent("Check your connection");
    await userEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(await view.findByText("ASM-fg-b")).toBeInTheDocument();
    await actResolve(resolveFirst, traceability("fg-a"));
    expect(view.queryByText("ASM-fg-a")).not.toBeInTheDocument();
    expect(view.getByText("ASM-fg-b")).toBeInTheDocument();
  });

  it("opens from the selected batch and shows backend status, FG/order information, counts, and separate material batches", async () => {
    showPage();
    const view = await openTraceability();
    expect(api.getAssemblyFinishedGoodsTraceability).toHaveBeenCalledWith("fg-a");
    for (const text of [
      "COMPLETE",
      "FG-BATCH-A",
      "Water Pump",
      "PUMP-001",
      "SERIAL-fg-a",
      "5 PCS",
      "QC_APPROVED",
      "ASM-fg-a",
      "LOT-001",
      "LOT-002",
      "MAT-QR-001",
      "MAT-QR-002",
    ]) {
      expect(view.getByText(text)).toBeInTheDocument();
    }
    const rows = view.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("15");
    expect(rows[1]).toHaveTextContent("LOT-001");
    expect(rows[2]).toHaveTextContent("20");
    expect(rows[2]).toHaveTextContent("LOT-002");
    expect(view.getByText("Verified Material Batches").parentElement).toHaveTextContent("2");
    expect(view.getByText("Unlinked Material Records").parentElement).toHaveTextContent("0");
  });

  it("shows GRN, supplier, original QR payload, and the individual events behind a batch total", async () => {
    showPage();
    const view = await openTraceability();
    const materialRow = view.getAllByRole("row")[1];
    await userEvent.click(within(materialRow).getByRole("button", { name: "View Details" }));
    const details = within(await screen.findByRole("dialog", { name: "Material Batch Details" }));
    for (const text of [
      "Steel Pipe",
      "STEEL-PIPE",
      "LOT-001",
      "GRN-001",
      "Acme Metals",
      "15 PCS",
      "MAT-QR-001",
      "GRN|BATCH:LOT-001|QR:MAT-QR-001",
      "event-a1",
      "event-a2",
    ]) {
      expect(details.getByText(text)).toBeInTheDocument();
    }
    expect(details.getByText("event-a1").parentElement).toHaveTextContent("10 PCS");
    expect(details.getByText("event-a2").parentElement).toHaveTextContent("5 PCS");
  });

  it("keeps partial and unlinked legacy records distinct and displays backend warnings", async () => {
    api.getAssemblyFinishedGoodsTraceability.mockResolvedValue({
      ...traceability(),
      traceability: {
        ...traceability().traceability,
        overall_status: "PARTIAL",
        total_material_batches: 2,
        verified_material_batches: 1,
        unlinked_material_records: 1,
        data_quality_warnings: ["One material batch has no verified QR link."],
      },
      consumed_materials: [materialA],
      unlinked_material_records: [
        {
          consumption_event_id: "event-orphan",
          material_code: "STEEL-PIPE",
          batch_number: "LOT-UNKNOWN",
          original_material_qr_reference: "MAT-QR-ORPHAN",
          quantity_consumed: 3,
          uom: "PCS",
          traceability_status: "UNLINKED",
          reason:
            "Original GRN batch, QR identity, or stored QR payload is missing or inconsistent.",
        },
      ],
    });
    showPage();
    const view = await openTraceability();
    expect(view.getByText("PARTIAL")).toBeInTheDocument();
    expect(view.getByText("Legacy / Unlinked Material Records")).toBeInTheDocument();
    expect(
      view.getByText(
        "Original GRN batch, QR identity, or stored QR payload is missing or inconsistent.",
      ),
    ).toBeInTheDocument();
    expect(view.getByText("MAT-QR-ORPHAN")).toBeInTheDocument();
    expect(view.getByText("One material batch has no verified QR link.")).toBeInTheDocument();
    expect(view.getByText("UNLINKED")).toBeInTheDocument();
  });

  it("shows the required historical message when backend status is NOT_AVAILABLE", async () => {
    api.getAssemblyFinishedGoodsTraceability.mockResolvedValue({
      ...traceability(),
      traceability: {
        ...traceability().traceability,
        overall_status: "NOT_AVAILABLE",
        total_material_batches: 0,
        verified_material_batches: 0,
      },
      consumed_materials: [],
      consumption_events: [],
      unlinked_material_records: [],
    });
    showPage();
    const view = await openTraceability();
    expect(view.getByText("NOT_AVAILABLE")).toBeInTheDocument();
    expect(
      view.getByText(
        "Traceability information is unavailable for this historical production record.",
      ),
    ).toBeInTheDocument();
    expect(view.getByText("No verified material batch records are available.")).toBeInTheDocument();
  });

  it("renders loading state and safely switches to the newly selected finished-goods record", async () => {
    let resolveFirst!: (value: ReturnType<typeof traceability>) => void;
    api.getAssemblyFinishedGoodsTraceability.mockImplementation((id: string) =>
      id === "fg-a"
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(traceability(id)),
    );
    showPage();
    await userEvent.click(await screen.findByRole("button", { name: "View Details" }));
    const details = within(screen.getByRole("dialog"));
    await userEvent.click(details.getAllByRole("button", { name: "Batch details" })[0]);
    let row = details.getByText("FG-BATCH-A").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Material Traceability" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Loading material traceability");
    await actResolve(resolveFirst, traceability("fg-a"));
    const traceDialog = within(
      await screen.findByRole("dialog", { name: "Material Traceability" }),
    );
    expect(traceDialog.getByText("FG-BATCH-A")).toBeInTheDocument();
    await userEvent.click(traceDialog.getAllByRole("button", { name: "Close" }).at(-1)!);
    row = details.getByText("FG-BATCH-B").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Material Traceability" }));
    expect(await screen.findByText("ASM-fg-b")).toBeInTheDocument();
    expect(api.getAssemblyFinishedGoodsTraceability).toHaveBeenNthCalledWith(2, "fg-b");
  });

  it.each([
    [
      400,
      "This finished-goods identifier is invalid. Refresh the inventory and select the batch again.",
    ],
    [401, "Your session has expired. Sign in again to view material traceability."],
    [
      403,
      "You do not have permission to view material traceability for this finished-goods batch.",
    ],
    [404, "This finished-goods record could not be found. Refresh the inventory and try again."],
    [500, "Material traceability could not be loaded. Check your connection and try again."],
  ])("shows a safe operator message for API status %i", async (status, message) => {
    api.getAssemblyFinishedGoodsTraceability.mockRejectedValue(
      Object.assign(new Error("raw database error"), { status }),
    );
    showPage();
    const view = await openTraceability();
    expect(await view.findByRole("alert")).toHaveTextContent(message);
    expect(view.queryByText("raw database error")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Print All Material QRs" })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "View Original QR" })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("uses traceability read without invoking QR verification or generation", async () => {
    showPage();
    await openTraceability();
    expect(api.getAssemblyFinishedGoodsTraceability).toHaveBeenCalledTimes(1);
    expect(api.verifyAssemblyFinishedGoodsQr).not.toHaveBeenCalled();
    expect(api.getAssemblyFinishedGoodsDetail).not.toHaveBeenCalled();
  });
});

async function actResolve(
  resolve: (value: ReturnType<typeof traceability>) => void,
  value: ReturnType<typeof traceability>,
) {
  await act(async () => {
    resolve(value);
  });
}
