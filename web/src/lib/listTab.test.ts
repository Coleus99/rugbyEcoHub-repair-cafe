import { describe, expect, it } from "vitest";
import { awaitingPrint, isPrinted } from "./listTab";

const ticket = (repair_printed_at: string | null, hs_pipeline_stage = "1") => ({
  id: "1",
  firstName: null,
  properties: { repair_printed_at, hs_pipeline_stage },
});

describe("isPrinted", () => {
  it("is true once a job sheet has been printed", () => {
    expect(isPrinted(ticket("2026-11-21T10:05:00Z"))).toBe(true);
    expect(isPrinted(ticket(null))).toBe(false);
  });
});

describe("awaitingPrint", () => {
  it("is a new booking with no job sheet yet", () => {
    expect(awaitingPrint(ticket(null), "1")).toBe(true);
    expect(awaitingPrint(ticket("2026-11-21T10:05:00Z"), "1")).toBe(false);
  });

  it("counts a ticket moved past New as checked in, printed or not", () => {
    expect(awaitingPrint(ticket(null, "2"), "1")).toBe(false);
  });
});
