import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Route } from "@/routes/supplier-materials";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: any) => ({ options }) }));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({ title, actions, children }: any) => <main><h1>{title}</h1>{actions}{children}</main>,
}));
vi.mock("@/lib/api-client", () => ({ api: {
  getMaterialComponents: vi.fn().mockResolvedValue([{
    id: "mat-1", material_code: "MAT-001", material_name: "Steel Pipe", base_uom: "PCS", status: "ACTIVE",
  }]),
} }));

it("renders the supplier catalog and its material action tooltips without missing symbols", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  expect(await screen.findByText("Steel Pipe")).toBeVisible();
  expect(screen.getByRole("button", { name: "Add Material" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Actions for Steel Pipe" })).toBeVisible();
});

it("opens the Add Material form from the tooltip-wrapped action", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  await screen.findByText("Steel Pipe");
  fireEvent.click(screen.getByRole("button", { name: "Add Material" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
});
