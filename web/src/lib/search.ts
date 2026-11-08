import type { Option, Ticket } from "./api";

// A short reference volunteers and customers can say out loud: the last
// five digits of the HubSpot ticket id, e.g. "07989". Unique enough among
// the tickets open at one time, and the full id is still on the ticket.
export const shortRef = (id: string) => id.slice(-5);

// Filters the open list as you type. Every word typed must match the start
// of a word in the item name, first name or fixer, or the short reference.
export function matchesSearch(ticket: Ticket, query: string, category: string): boolean {
  if (category && ticket.properties.restarters_category !== category) return false;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const p = ticket.properties;
  const text = `${p.subject ?? ""} ${ticket.firstName ?? ""} ${p.repair_fixer ?? ""}`.toLowerCase();
  const textWords = text.split(/[^a-z0-9]+/).filter(Boolean);
  return words.every(
    (w) => textWords.some((t) => t.startsWith(w)) || shortRef(ticket.id).startsWith(w.replace(/^#/, "")),
  );
}

// Only offer categories that open tickets actually use.
export function categoriesInUse(tickets: Ticket[], options: Option[] = []): Option[] {
  const used = new Set(tickets.map((t) => t.properties.restarters_category));
  return options.filter((o) => used.has(o.value));
}
