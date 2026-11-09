import type { Stage, Ticket } from "./api";

// The UK calendar day a timestamp falls on, as YYYY-MM-DD.
export const ukDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));

export type DoneView = {
  // The most recent day anything was completed: the latest session.
  day?: string;
  // Sync failures, from any day. Each needs opening and fixing.
  failed: Ticket[];
  // Everything else to show: the latest session's items, or all of them.
  rest: Ticket[];
  // Of the latest session's items whose outcome goes to Restarters, how
  // many are on it. Won't repair and No show don't count.
  synced: number;
  syncable: number;
};

// What the Done tab shows. By default the latest session plus any sync
// failures, so checking a session's sync is one glance.
export function doneView(completed: Ticket[], stages: Stage[], showAll: boolean): DoneView {
  const syncs = new Set(stages.filter((s) => s.restartersStatus).map((s) => s.id));
  const days = completed.map((t) => t.properties.closed_date).filter((d): d is string => !!d).map(ukDay);
  const day = days.sort().at(-1);
  const onDay = (t: Ticket) => !!day && !!t.properties.closed_date && ukDay(t.properties.closed_date) === day;

  const failed = completed.filter((t) => t.properties.restarters_sync_status === "Error");
  const rest = completed.filter((t) => t.properties.restarters_sync_status !== "Error" && (showAll || onDay(t)));
  const session = completed.filter((t) => onDay(t) && syncs.has(t.properties.hs_pipeline_stage ?? ""));
  return {
    day,
    failed,
    rest,
    synced: session.filter((t) => t.properties.restarters_sync_status === "Synced").length,
    syncable: session.length,
  };
}
