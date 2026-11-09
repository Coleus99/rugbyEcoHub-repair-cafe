import { describe, expect, it } from "vitest";
import { assignChanges, awaitingPrint, isPrinted, printGroups } from "./listTab";

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

describe("assignChanges", () => {
  const stages = [
    { id: "1", label: "New", open: true, restartersStatus: null },
    { id: "2", label: "In Progress", open: true, restartersStatus: null },
    { id: "6", label: "Needs follow-up", open: true, restartersStatus: "Repairable" },
    { id: "3", label: "Repaired", open: false, restartersStatus: "Fixed" },
  ];

  it("moves a new item to In Progress", () => {
    expect(assignChanges(ticket(null, "1"), "Paul F", stages)).toEqual({ repair_fixer: "Paul F", hs_pipeline_stage: "2" });
  });

  it("moves a returning follow-up to In Progress", () => {
    expect(assignChanges(ticket(null, "6"), "Irene M", stages)).toEqual({ repair_fixer: "Irene M", hs_pipeline_stage: "2" });
  });

  it("moves an In Progress item back to New when unassigned", () => {
    expect(assignChanges(ticket(null, "2"), "", stages)).toEqual({ repair_fixer: "", hs_pipeline_stage: "1" });
  });

  it("only changes the fixer once it's past New", () => {
    expect(assignChanges(ticket(null, "2"), "Pete N", stages)).toEqual({ repair_fixer: "Pete N" });
  });
});

describe("printGroups", () => {
  const stages = [
    { id: "1", label: "New", open: true, restartersStatus: null },
    { id: "2", label: "In Progress", open: true, restartersStatus: null },
    { id: "6", label: "Needs follow-up", open: true, restartersStatus: "Repairable" },
  ];
  const t = (id: string, stage: string, date: string | null, extra: Record<string, string | null> = {}) => ({
    id,
    firstName: null,
    properties: { hs_pipeline_stage: stage, requested_repair_date: date, repair_printed_at: null, ...extra },
  });
  const ids = (list: { id: string }[]) => list.map((x) => x.id);
  const today = "2026-11-21";
  const tickets = [
    t("walk-in", "1", null),
    t("today", "1", "2026-11-21"),
    t("missed", "1", "2026-11-07"),
    t("later", "1", "2026-12-19"),
    t("soon", "1", "2026-12-05"),
    t("printed", "1", "2026-11-21", { repair_printed_at: "2026-11-21T10:00:00Z" }),
    t("back-today", "6", "2026-11-21", { repair_next_steps: "More time needed" }),
    t("back-later", "6", "2026-12-05", { repair_next_steps: "More time needed" }),
    t("back-unbooked", "6", null, { repair_next_steps: "More time needed" }),
    t("pro-help", "6", null, { repair_next_steps: "Professional help" }),
    t("working", "2", "2026-11-21"),
  ];

  it("splits bookings into today, upcoming and returning-but-unbooked", () => {
    const groups = printGroups(tickets, stages, today);
    expect(ids(groups.today)).toEqual(["walk-in", "today", "missed", "back-today"]);
    expect(ids(groups.upcoming)).toEqual(["soon", "back-later", "later"]);
    expect(ids(groups.unbooked)).toEqual(["back-unbooked"]);
  });
});
