// Thin wrapper around the HubSpot CRM API calls the app needs.
// Takes the token and fetch as arguments so tests can pass fakes.

const BASE = "https://api.hubapi.com";

export type Properties = Record<string, string | null>;
export type Ticket = {id: string; properties: Properties};
export type Stage = {
  id: string;
  label: string;
  displayOrder: number;
  metadata: {ticketState?: "OPEN" | "CLOSED"};
};
export type Pipeline = {id: string; label: string; stages: Stage[]};
export type PropertyOption = {label: string; value: string};
export type Filter = {
  propertyName: string;
  operator: "EQ" | "IN";
  value?: string;
  values?: string[];
};

/** An error response from HubSpot, keeping its status code. */
export class HubSpotError extends Error {
  /**
   * @param {number} status HTTP status from HubSpot.
   * @param {string} message HubSpot's error message.
   */
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HubSpotError";
  }
}

export type HubSpot = ReturnType<typeof createHubSpot>;

export const createHubSpot = (token: string, fetchFn = fetch) => {
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const res = await fetchFn(BASE + path, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (data as {message?: string}).message ??
        `HubSpot returned ${res.status}`;
      throw new HubSpotError(res.status, message);
    }
    return data as T;
  };

  const search = async (
    groups: Filter[][],
    properties: string[],
  ): Promise<Ticket[]> => {
    const data = await call<{results: Ticket[]}>(
      "POST",
      "/crm/v3/objects/tickets/search",
      {
        filterGroups: groups.map((filters) => ({filters})),
        properties,
        sorts: [{propertyName: "createdate", direction: "ASCENDING"}],
        limit: 100,
      },
    );
    return data.results;
  };

  return {
    getPipeline: (pipelineId: string) =>
      call<Pipeline>("GET", `/crm/v3/pipelines/tickets/${pipelineId}`),

    // HubSpot search returns at most 100 per page. A session has far
    // fewer open tickets than that, so one page is enough.
    searchTickets: (filters: Filter[], properties: string[]) =>
      search([filters], properties),

    countTickets: async (filters: Filter[]) => {
      const data = await call<{total: number}>(
        "POST", "/crm/v3/objects/tickets/search",
        {filterGroups: [{filters}], properties: ["hs_object_id"], limit: 1},
      );
      return data.total;
    },

    // First name of the contact on each ticket, keyed by ticket id. Only the
    // first name is read, to keep personal details out of the app.
    firstNames: async (ticketIds: string[]) => {
      const names: Record<string, string> = {};
      if (ticketIds.length === 0) return names;
      const links = await call<{
        results: {from: {id: string}; to: {toObjectId: number}[]}[];
      }>("POST", "/crm/v4/associations/tickets/contacts/batch/read", {
        inputs: ticketIds.map((id) => ({id})),
      });
      const contactOf: Record<string, string> = {};
      for (const r of links.results) {
        if (r.to[0]) contactOf[r.from.id] = String(r.to[0].toObjectId);
      }
      const contactIds = [...new Set(Object.values(contactOf))];
      if (contactIds.length === 0) return names;
      const contacts = await call<{results: Ticket[]}>(
        "POST",
        "/crm/v3/objects/contacts/batch/read",
        {properties: ["firstname"], inputs: contactIds.map((id) => ({id}))},
      );
      const firstName: Record<string, string> = {};
      for (const c of contacts.results) {
        if (c.properties.firstname) firstName[c.id] = c.properties.firstname;
      }
      for (const [ticketId, contactId] of Object.entries(contactOf)) {
        if (firstName[contactId]) names[ticketId] = firstName[contactId];
      }
      return names;
    },

    getTicket: (id: string, properties: string[]) =>
      call<Ticket>(
        "GET",
        `/crm/v3/objects/tickets/${encodeURIComponent(id)}` +
          `?properties=${properties.join(",")}`,
      ),

    updateTicket: (id: string, properties: Properties) =>
      call<Ticket>(
        "PATCH",
        `/crm/v3/objects/tickets/${encodeURIComponent(id)}`,
        {properties},
      ),

    // Dropdown options, read from HubSpot so the app always matches it.
    getPropertyOptions: async (names: string[]) => {
      const data = await call<{
        results: {name: string; options: PropertyOption[]}[];
      }>("POST", "/crm/v3/properties/tickets/batch/read", {
        archived: false,
        inputs: names.map((name) => ({name})),
      });
      const options: Record<string, PropertyOption[]> = {};
      for (const p of data.results) {
        options[p.name] = p.options.map(({label, value}) => ({label, value}));
      }
      return options;
    },
  };
};
