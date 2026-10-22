import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import QRCode from "qrcode";
import { PackageQrActions } from "@/components/wms/package-qr-actions";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,cGtn") } }));
afterEach(() => vi.restoreAllMocks());

it("views the saved package QR and downloads the same PNG", async () => {
  let downloaded: HTMLAnchorElement | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloaded = this; });
  render(<PackageQrActions packageNumber="PKG-001" />);
  const view = screen.getByRole("button", { name: "View Package QR" });
  await waitFor(() => expect(view).toBeEnabled());
  expect(QRCode.toDataURL).toHaveBeenCalledWith("PKG-001", expect.any(Object));
  fireEvent.click(view);
  expect(screen.getByRole("dialog", { name: "Package QR" })).toBeVisible();
  expect(screen.getByAltText("QR for package PKG-001")).toHaveAttribute("src", "data:image/png;base64,cGtn");
  fireEvent.click(screen.getByRole("button", { name: "Download QR" }));
  expect(downloaded?.download).toBe("PKG-001.png");
  expect(downloaded?.href).toBe("data:image/png;base64,cGtn");
});

it("prints the same package QR only after the image loads", async () => {
  const doc = document.implementation.createHTMLDocument();
  const popup = { document: doc, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(popup as any);
  render(<PackageQrActions packageNumber="PKG-001" />);
  const view = screen.getByRole("button", { name: "View Package QR" });
  await waitFor(() => expect(view).toBeEnabled());
  fireEvent.click(view);
  fireEvent.click(screen.getByRole("button", { name: "Print QR" }));
  expect(doc.body.textContent).toContain("PKG-001");
  expect(doc.querySelector("img")?.src).toBe("data:image/png;base64,cGtn");
  expect(popup.print).not.toHaveBeenCalled();
  doc.querySelector("img")!.dispatchEvent(new Event("load"));
  expect(popup.print).toHaveBeenCalledOnce();
});

it("disables QR actions until a package has been saved", () => {
  render(<PackageQrActions />);
  expect(screen.getByRole("button", { name: "View Package QR" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Print Package QR" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download Package QR" })).not.toBeInTheDocument();
});
