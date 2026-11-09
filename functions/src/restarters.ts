// Restarters API v2 calls for devices and events.
// See docs/restarters_api/README.md for the quirks handled here.

const BASE = "https://restarters.net/api/v2";

export type RepairStatus = "Fixed" | "Repairable" | "End of life";
export type DeviceFields = Record<string, string>;
export type RestartersEvent = {id: number; start: string; title: string};

/** An error response from Restarters, with a readable message. */
export class RestartersError extends Error {
  /**
   * @param {number} status HTTP status from Restarters.
   * @param {string} message Restarters' error message.
   */
  constructor(public status: number, message: string) {
    super(message);
    this.name = "RestartersError";
  }
}

export type Restarters = ReturnType<typeof createRestarters>;

export const createRestarters = (token: string, fetchFn = fetch) => {
  const call = async <T>(
    method: string,
    path: string,
    body?: FormData | URLSearchParams,
  ): Promise<T> => {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${BASE}${path}${sep}api_token=${encodeURIComponent(token)}`;
    const res = await fetchFn(url, {
      method,
      headers: {Accept: "application/json"},
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new RestartersError(res.status, errorMessage(res, data));
    return data as T;
  };

  return {
    // The group's events between two UK dates (YYYY-MM-DD), inclusive.
    eventsBetween: async (groupId: string, start: string, end: string) => {
      const data = await call<{data: RestartersEvent[]}>(
        "GET",
        `/groups/${groupId}/events?start=${start}T00:00:00Z` +
          `&end=${end}T23:59:59Z`,
      );
      return data.data;
    },

    // The group's latest event on or before the given UK date: that day's
    // session if there is one, otherwise the most recent before it. Looks
    // back 6 months.
    latestEventOnOrBefore: async (groupId: string, date: string) => {
      const from = new Date(`${date}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 183);
      const data = await call<{data: RestartersEvent[]}>(
        "GET",
        `/groups/${groupId}/events?start=${from.toISOString().slice(0, 10)}` +
          `T00:00:00Z&end=${date}T23:59:59Z`,
      );
      const past = data.data
        .filter((e) => londonDate(new Date(e.start)) <= date)
        .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
      return past[0];
    },

    // Create needs multipart. The new id is the top-level id.
    createDevice: async (fields: DeviceFields) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      const data = await call<{id: number | string}>("POST", "/devices", form);
      return Number(data.id);
    },

    // Update must NOT be multipart, or PHP drops every field.
    updateDevice: async (id: number, fields: DeviceFields) => {
      await call("PATCH", `/devices/${id}`, new URLSearchParams(fields));
    },

    deleteDevice: async (id: number) => {
      await call("DELETE", `/devices/${id}`);
    },
  };
};

// Laravel validation errors look like {message, errors: {field: [msg]}}.
const errorMessage = (res: Response, data: unknown) => {
  const d = data as {message?: string; errors?: Record<string, string[]>};
  const fieldErrors = Object.values(d.errors ?? {}).flat();
  if (fieldErrors.length) return fieldErrors.join(" ");
  return d.message || `Restarters returned ${res.status}`;
};

// The calendar date in the UK, as YYYY-MM-DD.
export const londonDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/London"}).format(d);
