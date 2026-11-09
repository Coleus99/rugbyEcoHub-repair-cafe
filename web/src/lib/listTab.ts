import type { Stage, Ticket } from "./api";
import { comesBack } from "./ticketForm";

// The list has two tabs. Reception works from "To print": people who have
// booked but haven't arrived and had a job sheet printed. Fixers work from
// "Repairs": everything that's been checked in. Each device remembers its
// last tab (this browser only), so the reception laptop and the fixers'
// tablets each open where they left off.
// "Done" is for checking a session's items reached Restarters.
export type ListTab = "toPrint" | "repairs" | "done";
const TABS: ListTab[] = ["toPrint", "repairs", "done"];

const KEY = "repairCafe.listTab";

export const isPrinted = (ticket: Ticket) => !!ticket.properties.repair_printed_at;

// Still waiting at reception: no job sheet yet and still at the first stage
// (New). A ticket someone has moved on, e.g. to In Progress, is treated as
// checked in even if its sheet was never printed, so fixers can still see it.
export const awaitingPrint = (ticket: Ticket, firstStageId: string | undefined) =>
  !isPrinted(ticket) && ticket.properties.hs_pipeline_stage === firstStageId;

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

// Needs follow-up items with "More time needed": they're coming back.
export const isReturning = (ticket: Ticket, stages: Stage[]) =>
  comesBack(ticket.properties.repair_next_steps) && stages.some((s) => s.id === ticket.properties.hs_pipeline_stage && s.open && s.restartersStatus);

// Reprinting a returning item's sheet checks it back in: back to New with
// no fixer, so it shows on Repairs to be assigned like any new arrival.
export const checkInChanges = (stages: Stage[]): Record<string, string> => ({ hs_pipeline_stage: stages[0]?.id ?? "", repair_fixer: "" });

// The To print tab's groups. Today: new bookings for today or earlier, or
// with no date (in person), plus returning items booked for today or
// earlier. Upcoming: anything booked for a later session, so someone who
// turns up early is still found, then returning items with no date (TBC).
export function printGroups(open: Ticket[], stages: Stage[], today: string) {
  const first = stages[0]?.id;
  const due = (t: Ticket) => !t.properties.requested_repair_date || t.properties.requested_repair_date <= today;
  const awaiting = open.filter((t) => awaitingPrint(t, first));
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
