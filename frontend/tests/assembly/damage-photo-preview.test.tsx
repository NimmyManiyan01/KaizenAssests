import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DamagePhoto } from "@/components/wms/damage-photo";

vi.mock("@/lib/api-client", () => ({ api: {} }));

it("opens the evidence thumbnail at full size and closes with Escape", async () => {
  const image = "data:image/png;base64,aGVsbG8=";
  render(<DamagePhoto lineId="line-1" damagedQuantity={10} initialPreviewUrl={image} />);
  fireEvent.click(screen.getByRole("button", { name: "View damage evidence photo" }));
  expect(screen.getByRole("dialog", { name: "Damage evidence photo" })).toBeVisible();
  expect(screen.getByAltText("Enlarged damage evidence")).toHaveAttribute("src", image);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByAltText("Selected damage evidence")).toHaveAttribute("src", image);
});
