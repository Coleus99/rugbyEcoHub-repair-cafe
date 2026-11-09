import { describe, expect, it } from "vitest";
import type { Stage, Ticket } from "./api";
import { doneView } from "./done";

const stages: Stage[] = [
  { id: "2", label: "In Progress", open: true, restartersStatus: null },
  { id: "6", label: "Needs follow-up", open: true, restartersStatus: "Repairable" },
  { id: "3", label: "Repaired", open: false, restartersStatus: "Fixed" },
  { id: "7", label: "No show", open: false, restartersStatus: null },
];

const t = (id: string, closed: string | null, stage: string, sync: string | null): Ticket => ({
  id,
  firstName: null,
  properties: { closed_date: closed, hs_pipeline_stage: stage, restarters_sync_status: sync },
});

const completed = [
  t("1", "2026-11-21T11:00:00Z", "3", "Synced"),
  t("2", "2026-11-21T12:30:00Z", "3", "Synced"),
  t("3", "2026-11-21T12:45:00Z", "7", null),
  t("4", "2026-11-07T11:00:00Z", "3", "Synced"),
  t("5", "2026-11-07T11:30:00Z", "3", "Error"),
];
const ids = (list: Ticket[]) => list.map((x) => x.id);

describe("doneView", () => {
  it("lists the latest session, plus failures from any day", () => {
    const view = doneView(completed, [], stages);
    expect(view.day).toBe("2026-11-21");
    expect(ids(view.items)).toEqual(["1", "2", "3", "5"]);
    expect(view.failed).toBe(1);
  });

  it("adds finished-with follow-ups whatever their date", () => {
    const followUp = t("7", null, "6", "Synced");
    expect(ids(doneView(completed, [followUp], stages).items)).toEqual(["7", "1", "2", "3", "5"]);
  });

  it("can show only the sync failures", () => {
    expect(ids(doneView(completed, [], stages, { onlyFailed: true }).items)).toEqual(["5"]);
  });

  it("counts synced items in the session, leaving out stages that don't sync", () => {
    const view = doneView(completed, [], stages);
    expect([view.synced, view.syncable]).toEqual([2, 2]);
  });

  it("lists every day when searching", () => {
    expect(doneView(completed, [], stages, { allDays: true }).items).toHaveLength(5);
  });

  it("uses the UK day, so a late-evening BST close counts as that day", () => {
    const view = doneView([t("9", "2026-07-04T23:30:00Z", "3", "Synced")], [], stages);
    expect(view.day).toBe("2026-07-05");
  });

  it("uses the Restarters session date, counting anything closed since", () => {
    const view = doneView([...completed, t("10", "2026-11-23T09:00:00Z", "3", "Synced")], [], stages, { sessionDay: "2026-11-21" });
    expect(view.day).toBe("2026-11-21");
    expect(ids(view.items)).toEqual(["1", "2", "3", "5", "10"]);
    expect([view.synced, view.syncable]).toEqual([3, 3]);
  });

  it("copes with nothing completed", () => {
    expect(doneView([], [], stages)).toMatchObject({ day: undefined, items: [], synced: 0, syncable: 0 });
  });
});
