import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InformationTooltip } from "@/components/ui/information-tooltip";
import { informationHelp, type HelpId } from "@/lib/information-help";

afterEach(() => vi.unstubAllGlobals());

it.each(Object.keys(informationHelp) as HelpId[])("opens accessible help for %s on keyboard focus", async (help) => {
  render(<InformationTooltip help={help} />);
  const trigger = screen.getByRole("button", { name: `Information: ${informationHelp[help].title}` });
  expect(trigger).toHaveAttribute("type", "button");
  fireEvent.focus(trigger);
  const tooltip = await screen.findByRole("tooltip");
  expect(within(tooltip).getByText(informationHelp[help].purpose)).toBeInTheDocument();
  expect(tooltip.textContent).toContain(informationHelp[help].instructions);
  expect(tooltip.textContent).toContain(informationHelp[help].next);
  fireEvent.keyDown(trigger, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
});

it("opens on desktop hover and dismisses with Escape", async () => {
  const user = userEvent.setup();
  render(<InformationTooltip help="vehicle" placement="title" />);
  const trigger = screen.getByRole("button");
  expect(trigger).toHaveClass("ml-2");
  await user.hover(trigger);
  expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  await user.unhover(trigger);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
});

it("opens on mobile tap, closes on a second tap, and fits the viewport", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(<InformationTooltip help="pickupDate" />);
  const trigger = screen.getByRole("button");
  fireEvent.click(trigger);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveClass("max-w-[calc(100vw-2rem)]");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
});

it("does not submit the form or toggle its surrounding field label", async () => {
  const submit = vi.fn((event) => event.preventDefault());
  render(<form onSubmit={submit}><label>Confirmed<input type="checkbox" /><InformationTooltip help="loading" /></label></form>);
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(submit).not.toHaveBeenCalled();
});

it("dismisses mobile help with Escape and restores focus to the trigger", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(<InformationTooltip help="qr" />);
  const trigger = screen.getByRole("button");
  fireEvent.click(trigger);
  const tooltip = await screen.findByRole("tooltip");
  fireEvent.keyDown(tooltip, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});
