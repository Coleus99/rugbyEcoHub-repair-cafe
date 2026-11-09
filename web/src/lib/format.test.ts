import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format";

describe("formatDateTime", () => {
  it("shows the day and UK time", () => {
    expect(formatDateTime("2026-11-21T10:05:00Z")).toBe("Sat 21 Nov 10:05");
    expect(formatDateTime("2026-07-04T09:30:00Z")).toBe("Sat 4 Jul 10:30");
    expect(formatDateTime(null)).toBe("");
  });
});
