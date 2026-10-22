import { describe, expect, it } from "vitest";
import {
  completionDateError,
  isValidInspectorName,
  localDateInput,
  isValidDateInput,
} from "@/lib/input-validation";

describe("Date input validation", () => {
  it.each(["2026-10-24", "2026-01-01", "2024-02-29", "2026-12-31"])(
    "accepts calendar date %s without timezone conversion",
    (value) => {
      expect(isValidDateInput(value)).toBe(true);
    },
  );
  it.each([
    "",
    " ",
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-10-00",
    "10/24/2026",
    "2026-1-1",
    "2026-10-24T00:00:00Z",
  ])("rejects invalid calendar input %s", (value) => {
    expect(isValidDateInput(value)).toBe(false);
  });
});

describe("Required completion date", () => {
  it.each(["2026-10-16", "2026-10-17", "2027-01-01"])(
    "allows today and future date %s",
    (value) => {
      expect(completionDateError(value, "2026-10-16")).toBeNull();
    },
  );
  it("rejects past dates across year boundaries", () => {
    expect(completionDateError("2025-12-31", "2026-01-01")).toMatch(/today or later/);
  });
  it("requires a date and rejects invalid manual input", () => {
    expect(completionDateError("", "2026-10-16")).toMatch(/required/);
    for (const value of ["2026-02-30", "invalid", "10/16/2026"]) {
      expect(completionDateError(value, "2026-10-16")).toMatch(/valid completion date/);
    }
  });
  it("uses local calendar components without converting to UTC", () => {
    expect(localDateInput(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });
});

describe("Inspector name validation", () => {
  it.each(["", " ", "A", "123", "<script>", "X".repeat(129)])(
    "rejects invalid name %s",
    (value) => {
      expect(isValidInspectorName(value)).toBe(false);
    },
  );
  it.each(["Asha Kumar", "Anne-Marie O'Neil", "Dr. Rao", "Jos\u00e9 Silva", "\u674e\u660e"])(
    "accepts name %s",
    (value) => {
      expect(isValidInspectorName(value)).toBe(true);
    },
  );
});
