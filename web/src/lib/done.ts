import type { Stage, Ticket } from "./api";

// The UK calendar day a timestamp falls on, as YYYY-MM-DD.
export const ukDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));

// Open stages that still sync, such as Needs follow-up (Repairable). Items
// there are finished with for now, so they show on Done rather than Repairs.
export const followUpStages = (stages: Stage[]) => new Set(stages.filter((s) => s.open && s.restartersStatus).map((s) => s.id));

export type DoneView = {
  // The most recent day anything was completed: the latest session.
  day?: string;
  // Sync failures, from any day. Each needs opening and fixing.
  failed: Ticket[];
  // Needs follow-up items, from any day, until they're reopened or closed.
  followUps: Ticket[];
  // Completed items to show: the latest session's, or every day's when
  // searching.
  completed: Ticket[];
  // Of the latest session's completed items whose outcome goes to
  // Restarters, how many are on it. Won't repair and No show don't count.
  synced: number;
  syncable: number;
};

export function doneView(completed: Ticket[], followUps: Ticket[], stages: Stage[], allDays: boolean): DoneView {
  const syncs = new Set(stages.filter((s) => s.restartersStatus).map((s) => s.id));
  const day = completed
    .map((t) => t.properties.closed_date)
    .filter((d): d is string => !!d)
    .map(ukDay)
    .sort()
    .at(-1);
  const onDay = (t: Ticket) => !!day && !!t.properties.closed_date && ukDay(t.properties.closed_date) === day;
  const failedSync = (t: Ticket) => t.properties.restarters_sync_status === "Error";

  const session = completed.filter((t) => onDay(t) && syncs.has(t.properties.hs_pipeline_stage ?? ""));
  return {
    day,
    failed: [...followUps, ...completed].filter(failedSync),
    followUps: followUps.filter((t) => !failedSync(t)),
    completed: completed.filter((t) => !failedSync(t) && (allDays || onDay(t))),
    synced: session.filter((t) => t.properties.restarters_sync_status === "Synced").length,
    syncable: session.length,
  };
}

export const doneCount = (v: DoneView) => v.failed.length + v.followUps.length + v.completed.length;
