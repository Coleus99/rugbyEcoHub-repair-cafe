// Ticket keys from job sheet QR codes. Scanning one opens that ticket
// without signing in, for a few hours. The key ("<id>.<expiry>.<sig>") is
// kept in this browser tab's session storage so a reload still works, and
// sent with API calls when nobody is signed in.
const PREFIX = "repairCafe.ticketKey.";
let active: string | undefined;

const expiry = (key: string) => Number(key.split(".")[1]) || 0;

export function storeTicketKey(key: string): void {
  try {
    sessionStorage.setItem(PREFIX + key.split(".")[0], key);
  } catch {
    // ignore: it still works until the page is reloaded
  }
  active = key;
}

// A key for this ticket that hasn't expired, kept in this tab.
export function ticketKeyFor(id: string): string | undefined {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(PREFIX + id);
  } catch {
    // ignore
  }
  const key = [stored, active].find((k) => k?.startsWith(`${id}.`) && expiry(k) > Date.now());
  return key ?? undefined;
}

export const setActiveKey = (key: string | undefined) => {
  active = key;
};

export const activeTicketKey = () => active;

// "1:05pm" for the QR caption.
export const keyExpiresAt = (key: string) => new Date(expiry(key)).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).replace(" ", "");
