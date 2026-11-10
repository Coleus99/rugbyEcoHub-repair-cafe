import { auth } from "./firebase";
import { activeTicketKey } from "./ticketKey";

// Shapes returned by the functions in functions/src/app.ts.
export type Properties = Record<string, string | null>;
// firstName is the only contact detail the API returns.
export type Ticket = { id: string; firstName: string | null; properties: Properties };
export type SyncResult =
  | { status: "Synced"; deviceId: number; eventId: number }
  | { status: "Error"; error: string }
  | { status: "Skipped" };
// restartersStatus is set for stages that sync: Fixed, Repairable or End of life.
export type Stage = { id: string; label: string; open: boolean; restartersStatus: string | null };
export type Option = { label: string; value: string };
// The latest repair session (Restarters event) up to today.
export type Session = { id: number; date: string; start: string; title: string };
export type Meta = { stages: Stage[]; options: Record<string, Option[]> };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// fetch for /api routes. Adds the signed-in user's ID token (refreshed by
// Firebase when it's near expiry), or if nobody is signed in, the ticket
// key from a scanned QR code. Turns error responses into ApiError.
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const idToken = await auth.currentUser?.getIdToken();
  const key = idToken ? undefined : activeTicketKey();
  const authorization = idToken ? `Bearer ${idToken}` : key ? `Ticket ${key}` : undefined;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
      ...init.headers,
    },
  }).catch(() => {
    throw new ApiError(0, "No connection. Check the Wi-Fi and try again.");
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

// Stages and dropdown options hardly change, so fetch them once per page load.
let metaPromise: Promise<Meta> | undefined;
export function getMeta(): Promise<Meta> {
  metaPromise ??= apiFetch<Meta>("/meta").catch((err) => {
    metaPromise = undefined; // let the next call retry
    throw err;
  });
  return metaPromise;
}

// Upcoming sessions on Restarters, for rebooking a Needs follow-up item.
export type UpcomingSession = { date: string; title: string };
let upcomingPromise: Promise<UpcomingSession[]> | undefined;
export function getUpcomingSessions(): Promise<UpcomingSession[]> {
  upcomingPromise ??= apiFetch<{ sessions: UpcomingSession[] }>("/sessions/upcoming").then(
    (r) => r.sessions,
    () => {
      upcomingPromise = undefined; // let the next call retry
      return [];
    },
  );
  return upcomingPromise;
}

export const getTickets = () => apiFetch<{ tickets: Ticket[]; failedSyncs: number }>("/tickets");

// Tickets completed in the last `days` days (90), newest first.
export const getCompletedTickets = () => apiFetch<{ tickets: Ticket[]; days: number; session: Session | null }>("/tickets/completed");

export const getTicket = (id: string) =>
  apiFetch<{ ticket: Ticket }>(`/tickets/${id}`).then((r) => r.ticket);

// Saves to HubSpot, then syncs to Restarters if the stage calls for it.
export const updateTicket = (id: string, properties: Properties) =>
  apiFetch<{ ticket: Ticket; sync: SyncResult }>(`/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });

export const syncTicket = (id: string) =>
  apiFetch<{ ticket: Ticket; sync: SyncResult }>(`/tickets/${id}/sync`, { method: "POST" });

export const removeFromRestarters = (id: string) =>
  apiFetch<{ ticket: Ticket }>(`/tickets/${id}/restarters`, { method: "DELETE" }).then((r) => r.ticket);

// A key for the job sheet's QR code (null if keys aren't set up).
export const getTicketKey = (id: string) => apiFetch<{ key: string | null; expires?: number }>(`/tickets/${id}/key`, { method: "POST" }).then((r) => r.key);

// Marks the job sheet as printed, which also checks the visitor in.
export const markPrinted = (id: string) =>
  apiFetch<{ printedAt: string }>(`/tickets/${id}/printed`, { method: "POST" });

