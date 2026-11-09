import type { Option, Properties } from "./api";
import { formatDate } from "./format";

// Form values are always strings. HubSpot's null becomes "".
export type Draft = Record<string, string>;

export function toDraft(properties: Properties, names: string[]): Draft {
  const draft: Draft = {};
  for (const name of names) draft[name] = properties[name] ?? "";
  return draft;
}

// Only send what the volunteer changed, so two people editing different
// fields of the same ticket don't overwrite each other.
export function changedProperties(original: Properties, draft: Draft): Draft {
  const changes: Draft = {};
  for (const [name, value] of Object.entries(draft)) {
    if (value.trim() !== (original[name] ?? "").trim()) changes[name] = value;
  }
  return changes;
}

// Suggest a Restarters item type from the category: "Laptop medium" becomes
// "Laptop". Volunteers can change it.
export function itemTypeFromCategory(label: string): string {
  return label.replace(/\s+(small|medium|large)$/i, "").trim();
}

export const labelFor = (options: Option[] | undefined, value: string | null) =>
  options?.find((o) => o.value === value)?.label ?? value ?? "";

// "Booked for Sat 21 Nov 2026", or for in-person bookings with no requested
// date, the day the ticket was created.
export function bookingLabel(p: Properties): string {
  if (p.requested_repair_date) return `Booked for ${formatDate(p.requested_repair_date)}`;
  if (p.createdate) return `Added ${formatDate(p.createdate)}`;
  return "";
}

// Restarters only takes next steps for Repairable items and a barrier for
// End of life ones, so the form only shows them then.
export function outcomeFields(restartersStatus: string | null | undefined) {
  return {
    nextSteps: restartersStatus === "Repairable",
    barrier: restartersStatus === "End of life",
  };
}

// Restarters uses its own average weight for every category except the two
// Misc ones (46 powered, 50 unpowered), so only ask for a weight on those.
const MISC_CATEGORIES = ["46", "50"];
export const needsWeight = (category: string | null | undefined) => MISC_CATEGORIES.includes(category ?? "");

// When an item is marked Needs follow-up, book it in for the next session
// unless it's already booked for a later one.
export function rebookDate(current: string, sessions: { date: string }[], today: string): string {
  if (current && current > today) return current;
  return sessions[0]?.date ?? current;
}
