import type { Stage, Ticket } from "./api";

// The UK calendar day a timestamp falls on, as YYYY-MM-DD.
export const ukDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));

// Open stages that still sync, such as Needs follow-up (Repairable). Items
// there are finished with for now, so they show on Done rather than Repairs.
export const followUpStages = (stages: Stage[]) => new Set(stages.filter((s) => s.open && s.restartersStatus).map((s) => s.id));

export type DoneView = {
  // The latest session's date: the most recent Restarters event, or if
  // that isn't known, the most recent day anything was completed.
  day?: string;
  // What to list, grouped by stage on the page: the latest session's
  // completed items (every day's when searching), plus Needs follow-up
  // items and sync failures from any day.
  items: Ticket[];
  failed: number;
  // Of the latest session's completed items whose outcome goes to
  // Restarters, how many are on it. Won't repair and No show don't count.
  synced: number;
  syncable: number;
};

type Options = {
  // The latest Restarters session's date, YYYY-MM-DD.
  sessionDay?: string;
  // Searching: list every day's completed items, not just the session's.
  allDays?: boolean;
  onlyFailed?: boolean;
};

export function doneView(completed: Ticket[], followUps: Ticket[], stages: Stage[], { sessionDay, allDays = false, onlyFailed = false }: Options = {}): DoneView {
  const syncs = new Set(stages.filter((s) => s.restartersStatus).map((s) => s.id));
  const day =
    sessionDay ??
    completed
      .map((t) => t.properties.closed_date)
      .filter((d): d is string => !!d)
      .map(ukDay)
      .sort()
      .at(-1);
  // On or after, so anything closed since the session (e.g. typed up from
  // paper the next day) counts as part of it.
  const onDay = (t: Ticket) => !!day && !!t.properties.closed_date && ukDay(t.properties.closed_date) >= day;
  const failedSync = (t: Ticket) => t.properties.restarters_sync_status === "Error";

  const all = [...followUps, ...completed.filter((t) => allDays || onDay(t) || failedSync(t))];
  const session = completed.filter((t) => onDay(t) && syncs.has(t.properties.hs_pipeline_stage ?? ""));
  const failed = all.filter(failedSync);
  return {
    day,
    // Once the last failure is fixed, go back to showing everything.
    items: onlyFailed && failed.length ? failed : all,
    failed: failed.length,
    synced: session.filter((t) => t.properties.restarters_sync_status === "Synced").length,
    syncable: session.length,
  };
}
