import { describe, expect, it } from "vitest";
import type { Stage, Ticket } from "./api";
import { doneCount, doneView, followUpStages } from "./done";

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
const followUps = [t("6", null, "6", "Synced"), t("8", null, "6", "Error")];
const ids = (list: Ticket[]) => list.map((x) => x.id);

describe("followUpStages", () => {
  it("is the open stages that sync", () => {
    expect([...followUpStages(stages)]).toEqual(["6"]);
  });
});

describe("doneView", () => {
  it("shows the latest session, follow-ups and failures from any day", () => {
    const view = doneView(completed, followUps, stages, false);
    expect(view.day).toBe("2026-11-21");
    expect(ids(view.failed)).toEqual(["8", "5"]);
    expect(ids(view.followUps)).toEqual(["6"]);
    expect(ids(view.completed)).toEqual(["1", "2", "3"]);
    expect(doneCount(view)).toBe(6);
  });

  it("counts synced items in the session, leaving out stages that don't sync", () => {
    const view = doneView(completed, followUps, stages, false);
    expect([view.synced, view.syncable]).toEqual([2, 2]);
  });

  it("shows every day when searching", () => {
    expect(doneView(completed, [], stages, true).completed).toHaveLength(4);
  });

  it("uses the UK day, so a late-evening BST close counts as that day", () => {
    const view = doneView([t("9", "2026-07-04T23:30:00Z", "3", "Synced")], [], stages, false);
    expect(view.day).toBe("2026-07-05");
  });

  it("copes with nothing completed", () => {
    expect(doneView([], [], stages, false)).toMatchObject({ day: undefined, synced: 0, syncable: 0 });
  });
});
