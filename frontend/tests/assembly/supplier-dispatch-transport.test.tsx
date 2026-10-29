import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { localDateInput } from "@/lib/input-validation";

const apiMocks = vi.hoisted(() => ({
  getSupplierPickupFinishedGoods: vi.fn(),
  getSupplierFinishedGoodsDispatchRequests: vi.fn(),
  createSupplierFinishedGoodsDispatchRequest: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({ children, actions }: { children: React.ReactNode; actions: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock("@/components/ui/information-tooltip", () => ({
  InformationTooltip: () => null,
}));
vi.mock("@/lib/api-client", () => ({ api: apiMocks }));

import { Route } from "@/routes/supplier.dispatch";

describe("Supplier dispatch transport entries", () => {
  it("explains when Assembly has no finished goods records", async () => {
    apiMocks.getSupplierPickupFinishedGoods.mockResolvedValue([]);
    apiMocks.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([]);
    const Page = Route.options.component as React.ComponentType;
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: /create dispatch/i }));
    expect(await screen.findByText(/No finished goods records are currently available in Assembly/)).toBeInTheDocument();
    expect(screen.getByLabelText("Finished good *")).toBeDisabled();
  });
  it("lists all FGs and explains why historical records cannot yet be dispatched", async () => {
    apiMocks.getSupplierPickupFinishedGoods.mockResolvedValue([
      {id:"legacy",main_fg_id:"LEGACY-BATCH",product_code:"OLD",product_name:"Historical product",remaining_sections:0,uom:"PCS",dispatch_eligible:false,eligibility_reason:"Assembly must create transport sections"},
      {id:"ready",main_fg_id:"FG-0003",product_code:"READY",product_name:"Ready product",remaining_sections:8,uom:"PCS",dispatch_eligible:true},
    ]);
    apiMocks.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([]);
    const Page = Route.options.component as React.ComponentType;
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", {name:/create dispatch/i}));
    expect(await screen.findByRole("option", {name:/Historical product.*Assembly must create transport sections/})).toBeDisabled();
    expect(screen.getByRole("option", {name:/Ready product.*8 sections available/})).toBeEnabled();
    expect(screen.getByLabelText("Finished good *")).toBeEnabled();
  });
  it("adds validated vehicle and driver pairs to one dispatch", async () => {
    apiMocks.getSupplierPickupFinishedGoods.mockResolvedValue([
      {
        id: "fg-record-1", main_fg_id: "FG-0001", remaining_sections: 8,
        product_code: "FG-PIPE-001",
        product_name: "Finished Pipe",
        quantity: 5,
        uom: "PCS",
        status: "AVAILABLE",
      },
    ]);
    apiMocks.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([]);
    apiMocks.createSupplierFinishedGoodsDispatchRequest.mockResolvedValue({
      request_number: "FGD-TEST-001",
    });

    const Page = Route.options.component as React.ComponentType;
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: /create dispatch/i }));
    const dialog = await screen.findByRole("dialog");
    const addButton = within(dialog).getByRole("button", { name: "Add Vehicle & Driver" });
    fireEvent.click(addButton);

    const vehicles = within(dialog).getAllByLabelText("Vehicle number *");
    const drivers = within(dialog).getAllByLabelText("Driver name *");
    const contacts = within(dialog).getAllByLabelText("Driver contact *");
    expect(vehicles).toHaveLength(2);
    expect(drivers).toHaveLength(2);
    expect(contacts).toHaveLength(2);

    fireEvent.change(vehicles[0]!, { target: { value: "ka-02-ah-2755" } });
    fireEvent.change(drivers[0]!, { target: { value: "Ravi123 Kumar" } });
    fireEvent.change(contacts[0]!, { target: { value: "9876543210" } });
    fireEvent.change(vehicles[1]!, { target: { value: "22BH1234AA" } });
    fireEvent.change(drivers[1]!, { target: { value: "Asha Devi" } });
    fireEvent.change(contacts[1]!, { target: { value: "8765432109" } });

    expect(drivers[0]).toHaveValue("Ravi Kumar");
    expect(vehicles[1]).toHaveValue("22BH1234AA");
    expect(contacts[1]).toHaveAttribute("maxlength", "10");

    fireEvent.change(within(dialog).getByLabelText("Expected pickup date *"), {
      target: { value: localDateInput() },
    });
    fireEvent.change(within(dialog).getByLabelText("Finished good *"), {
      target: { value: "Finished Pipe - FG-0001" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Dispatch" }));

    await waitFor(() =>
      expect(apiMocks.createSupplierFinishedGoodsDispatchRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          finished_goods_id: "fg-record-1",
          vehicle_number: "KA02AH2755",
          driver_name: "Ravi Kumar",
          driver_contact: "9876543210",
          transport_entries: [
            {
              vehicle_number: "KA02AH2755",
              driver_name: "Ravi Kumar",
              driver_contact: "9876543210",
            },
            {
              vehicle_number: "22BH1234AA",
              driver_name: "Asha Devi",
              driver_contact: "8765432109",
            },
          ],
        }),
      ),
    );
  });
});
