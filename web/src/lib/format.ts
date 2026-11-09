// HubSpot dates come as "2026-12-12" (date properties) or ISO timestamps.
// Show them as "Sat 12 Dec 2026".
export function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  // Some engines put a comma after the weekday. Drop it so it reads the same
  // everywhere.
  return date
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .replace(",", "");
}

// "Sat 21 Nov 10:05", in UK time.
export function formatDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
    .replace(/,/g, "");
}
