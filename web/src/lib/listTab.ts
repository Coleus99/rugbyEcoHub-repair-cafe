import type { Stage, Ticket } from "./api";
import { comesBack } from "./ticketForm";
import { ukDay } from "./done";

// The list has three tabs. Reception works from "Check in" (stored as
// "toPrint", so remembered tabs still work): people who have booked but
// haven't arrived and been checked in yet. Fixers work from "Repairs":
// everything that's been checked in. Each device remembers its
// last tab (this browser only), so the reception laptop and the fixers'
// tablets each open where they left off.
// "Done" is for checking a session's items reached Restarters.
export type ListTab = "toPrint" | "repairs" | "done";
const TABS: ListTab[] = ["toPrint", "repairs", "done"];

const KEY = "repairCafe.listTab";

export const isPrinted = (ticket: Ticket) => !!ticket.properties.repair_printed_at;

// Checked in with the Check in button, or (before that existed) by printing
// the job sheet.
export const isCheckedIn = (ticket: Ticket) => !!(ticket.properties.repair_checked_in_at || ticket.properties.repair_printed_at);

// Still waiting at reception: not checked in and still at the first stage
// (New). A ticket someone has moved on, e.g. to In Progress, is treated as
// checked in anyway, so fixers can still see it.
export const awaitingCheckIn = (ticket: Ticket, firstStageId: string | undefined) =>
  !isCheckedIn(ticket) && ticket.properties.hs_pipeline_stage === firstStageId;

// The queue number if the item was checked in today, else null. Numbers
// restart at 1 each session, so an old one means nothing on its own.
export const todaysNumber = (ticket: Ticket, today: string) => {
  const { repair_queue_number: n, repair_checked_in_at: at } = ticket.properties;
  return n && at && ukDay(at) === today ? n : null;
};

// "7" for today's items. "No. 7 · Sat 21 Nov" for an earlier session.
export const queueLabel = (ticket: Ticket, today: string) => {
  const { repair_queue_number: n, repair_checked_in_at: at } = ticket.properties;
  if (!n || !at) return "";
  if (ukDay(at) === today) return n;
  const day = new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).replace(",", "");
  return `No. ${n} · ${day}`;
};

// Today's queue first, in number order, so the longest waiting is at the
// top. Everything else keeps its order after them.
export function byQueue(tickets: Ticket[], today: string): Ticket[] {
  const num = (t: Ticket) => Number(todaysNumber(t, today) ?? Infinity);
  return tickets.map((t, i) => ({ t, i })).sort((a, b) => num(a.t) - num(b.t) || a.i - b.i).map(({ t }) => t);
}

export function rememberedTab(): ListTab {
  try {
    const saved = localStorage.getItem(KEY) as ListTab;
    return TABS.includes(saved) ? saved : "repairs";
  } catch {
    return "repairs";
  }
}

export function rememberTab(tab: ListTab): void {
  try {
    localStorage.setItem(KEY, tab);
  } catch {
    // ignore
  }
}

// Assigning a fixer from the Repairs list. An item still at the first
// stage (New) moves on to In Progress at the same time, since someone is
// now working on it. Unassigning (fixer "") moves an In Progress item back
// to New. Other stages are left as they are.
export function assignChanges(ticket: Ticket, fixer: string, stages: Stage[]): Record<string, string> {
  const changes: Record<string, string> = { repair_fixer: fixer };
  const open = stages.filter((s) => s.open);
  const inProgress = open.find((s) => /in progress/i.test(s.label)) ?? open[1];
  const stage = ticket.properties.hs_pipeline_stage;
  const first = stages[0]?.id;
  if (fixer && inProgress && stage === first) changes.hs_pipeline_stage = inProgress.id;
  if (!fixer && first && inProgress && stage === inProgress.id) changes.hs_pipeline_stage = first;
  return changes;
}

// Needs follow-up items (open stages that sync).
export const isFollowUp = (ticket: Ticket, stages: Stage[]) => stages.some((s) => s.id === ticket.properties.hs_pipeline_stage && s.open && s.restartersStatus);

// Needs follow-up items with "More time needed": they're coming back.
export const isReturning = (ticket: Ticket, stages: Stage[]) =>
  comesBack(ticket.properties.repair_next_steps) && stages.some((s) => s.id === ticket.properties.hs_pipeline_stage && s.open && s.restartersStatus);

// The To print tab's groups. Today: new bookings for today or earlier, or
// with no date (in person), plus returning items booked for today or
// earlier. Upcoming: anything booked for a later session, so someone who
// turns up early is still found, then returning items with no date (TBC).
export function printGroups(open: Ticket[], stages: Stage[], today: string) {
  const first = stages[0]?.id;
  const due = (t: Ticket) => !t.properties.requested_repair_date || t.properties.requested_repair_date <= today;
  const awaiting = open.filter((t) => awaitingCheckIn(t, first));
  const returning = open.filter((t) => isReturning(t, stages));
  const booked = returning.filter((t) => t.properties.requested_repair_date);
  const tbc = returning.filter((t) => !t.properties.requested_repair_date);
  return {
    today: [...awaiting.filter(due), ...booked.filter(due)],
    upcoming: [
      ...[...awaiting, ...booked].filter((t) => !due(t)).sort((a, b) => (a.properties.requested_repair_date ?? "").localeCompare(b.properties.requested_repair_date ?? "")),
      ...tbc,
    ],
  };
}
