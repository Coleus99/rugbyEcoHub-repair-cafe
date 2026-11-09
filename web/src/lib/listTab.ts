import type { Ticket } from "./api";

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
// now working on it. Later stages are left as they are.
export function assignChanges(ticket: Ticket, fixer: string, stages: { id: string; label: string; open: boolean }[]): Record<string, string> {
  const changes: Record<string, string> = { repair_fixer: fixer };
  const open = stages.filter((s) => s.open);
  const inProgress = open.find((s) => /in progress/i.test(s.label)) ?? open[1];
  if (fixer && inProgress && ticket.properties.hs_pipeline_stage === stages[0]?.id) {
    changes.hs_pipeline_stage = inProgress.id;
  }
  return changes;
}
