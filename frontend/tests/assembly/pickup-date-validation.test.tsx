import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { localDateInput, pickupDateError } from "@/lib/input-validation";
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: any) => ({ options }) }));
vi.mock("@/components/wms/app-shell", () => ({ AppShell: ({ children, actions }: any) => <div>{actions}{children}</div>, StatusBadge: () => null }));
vi.mock("@/lib/api-client", () => ({ api: {
  getAssemblyFinishedGoods: vi.fn().mockResolvedValue([{ product_code: "CAR", quantity: 10, status: "AVAILABLE" }]),
  getSupplierFinishedGoodsDispatchRequests: vi.fn().mockResolvedValue([]),
} }));
import { Route } from "@/routes/supplier.dispatch";

it.each(["", "2026-02-30", "2026-10-20", "21/10/2026", "2026-10-21T00:00:00", "10000-01-01"])("rejects invalid or past date %s", (value) => {
  expect(pickupDateError(value, "2026-10-21")).not.toBeNull();
});
it.each(["2026-10-21", "2026-10-22", "2028-02-29"])("accepts today or future date %s", (value) => {
  expect(pickupDateError(value, "2026-10-21")).toBeNull();
});
it("limits the calendar and displays an inline error for a past date", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Create Dispatch" }));
  const input = await screen.findByLabelText("Expected pickup date *");
  expect(input).toHaveAttribute("min", localDateInput());
  fireEvent.change(input, { target: { value: "2000-01-01" } });
  fireEvent.blur(input);
  expect(screen.getByRole("alert")).toHaveTextContent("Pickup date must be today or later.");
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Create Dispatch" })).toBeDisabled();
  fireEvent.change(input, { target: { value: localDateInput() } });
  expect(screen.queryByText("Pickup date must be today or later.")).not.toBeInTheDocument();
});
