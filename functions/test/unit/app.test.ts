import {beforeEach, describe, expect, it, vi} from "vitest";
import request from "supertest";
import {addFixer, createApp, READ_PROPERTIES} from "../../src/app";
import {signTicketKey} from "../../src/ticketKey";
import {
  HubSpotError,
  type HubSpot,
  type Pipeline,
  type Ticket,
} from "../../src/hubspot";
import type {Restarters} from "../../src/restarters";
import {fixture} from "../fixtures";

const PIPELINE = fixture<Pipeline>("getRepairCafePipelineResponse.json");
const TICKET = fixture<Ticket>("getTicketResponse.json");
const OPTIONS = {
  restarters_category: [{label: "Toaster", value: "43"}],
};

const ticket = (id: string, props: Ticket["properties"]): Ticket => ({
  id,
  properties: {...TICKET.properties, hs_object_id: id, ...props},
});

// A fake HubSpot backed by the saved sandbox responses.
const fakeHubSpot = () => ({
  getPipeline: vi.fn(async () => PIPELINE),
  getPropertyOptions: vi.fn(async () => OPTIONS),
  searchTickets: vi.fn<HubSpot["searchTickets"]>(async () => [TICKET]),
  getTicket: vi.fn(async (): Promise<Ticket> => TICKET),
  updateTicket: vi.fn(async (): Promise<Ticket> => TICKET),
  firstNames: vi.fn(async (): Promise<Record<string, string>> => ({})),
  countTickets: vi.fn<HubSpot["countTickets"]>(async () => 0),
});

const fakeRestarters = () => ({
  eventsBetween: vi.fn(async () =>
    [{id: 19170, start: "2026-12-05T10:00:00+00:00", title: ""}]),
  latestEventOnOrBefore: vi.fn(async () =>
    ({id: 19168, start: "", title: ""})),
  createDevice: vi.fn(async () => 555),
  updateDevice: vi.fn(async () => undefined),
  deleteDevice: vi.fn(async () => undefined),
});

let hubspot: ReturnType<typeof fakeHubSpot>;
let restarters: ReturnType<typeof fakeRestarters>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  hubspot = fakeHubSpot();
  restarters = fakeRestarters();
  app = createApp({
    hubspot: () => hubspot as unknown as HubSpot,
    pipelineId: () => "0",
    restarters: () => restarters as unknown as Restarters,
    // Stage 3 (Repaired) syncs as Fixed. Stage 2 (In Progress) doesn't.
    syncConfig: () => ({groupId: "116", stageStatus: {"3": "Fixed"}}),
    verifyToken: async (token) => {
      if (token !== "good") throw new Error("bad token");
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const get = (path: string) =>
  request(app).get(path).set("Authorization", "Bearer good");
const patch = (path: string, body: object) =>
  request(app).patch(path).set("Authorization", "Bearer good").send(body);
const post = (path: string) =>
  request(app).post(path).set("Authorization", "Bearer good");

describe("sign-in check", () => {
  it("rejects requests with no token", async () => {
    const res = await request(app).get("/api/tickets");
    expect(res.status).toBe(401);
    expect(hubspot.searchTickets).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", async () => {
    const res = await request(app)
      .get("/api/tickets")
      .set("Authorization", "Bearer forged");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/meta", () => {
  it("returns stages in board order with open/closed", async () => {
    const res = await get("/api/meta");

    expect(res.status).toBe(200);
    expect(res.body.stages[0]).toEqual(
      {id: "1", label: "New", open: true, restartersStatus: null},
    );
    expect(res.body.stages.find((s: {id: string}) => s.id === "3")
      .restartersStatus).toBe("Fixed");
    expect(res.body.stages.map((s: {label: string}) => s.label)).toEqual(
      PIPELINE.stages.map((s) => s.label),
    );
    expect(res.body.options).toEqual(OPTIONS);
  });

  it("caches HubSpot's answer between requests", async () => {
    await get("/api/meta");
    await get("/api/tickets");
    expect(hubspot.getPipeline).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/tickets", () => {
  it("searches only the open stages of the repair pipeline", async () => {
    await get("/api/tickets");

    const open = PIPELINE.stages
      .filter((s) => s.metadata.ticketState === "OPEN")
      .map((s) => s.id);
    expect(hubspot.searchTickets).toHaveBeenCalledWith([
      {propertyName: "hs_pipeline", operator: "EQ", value: "0"},
      {propertyName: "hs_pipeline_stage", operator: "IN", values: open},
    ], READ_PROPERTIES);
  });

  it("adds the contact's first name only", async () => {
    hubspot.firstNames.mockResolvedValue({[TICKET.id]: "Chris"});
    const res = await get("/api/tickets");
    expect(res.body.tickets[0].firstName).toBe("Chris");
    expect(res.body.tickets[0].properties).not.toHaveProperty("email");
  });

  it("still lists tickets if contacts can't be read", async () => {
    hubspot.firstNames.mockRejectedValue(new HubSpotError(403, "scopes"));
    const res = await get("/api/tickets");
    expect(res.status).toBe(200);
    expect(res.body.tickets[0].firstName).toBeNull();
  });

  it("sorts by stage, then newest booking first", async () => {
    hubspot.searchTickets.mockResolvedValue([
      // Booked in person: no requested date, so the created date counts.
      ticket("old-walk-in", {
        hs_pipeline_stage: "1",
        requested_repair_date: null,
        createdate: "2026-11-01T09:00:00Z",
      }),
      ticket("in-progress", {hs_pipeline_stage: "2"}),
      ticket("booked-dec", {
        hs_pipeline_stage: "1",
        requested_repair_date: "2026-12-05",
      }),
      ticket("booked-nov", {
        hs_pipeline_stage: "1",
        requested_repair_date: "2026-11-21",
      }),
    ]);

    const res = await get("/api/tickets");

    expect(res.body.tickets.map((t: Ticket) => t.id)).toEqual(
      ["booked-dec", "booked-nov", "old-walk-in", "in-progress"],
    );
  });

  it("says how many tickets failed to sync", async () => {
    hubspot.countTickets.mockResolvedValue(2);
    const res = await get("/api/tickets");
    expect(res.body.failedSyncs).toBe(2);
    expect(hubspot.countTickets.mock.calls[0][0]).toContainEqual({
      propertyName: "restarters_sync_status", operator: "EQ", value: "Error",
    });
  });

  it("only returns the properties the app uses", async () => {
    const res = await get("/api/tickets");
    expect(Object.keys(res.body.tickets[0].properties).sort())
      .toEqual([...READ_PROPERTIES].sort());
  });
});

describe("GET /api/tickets/:id", () => {
  it("returns a repair ticket", async () => {
    const res = await get("/api/tickets/448850507989");
    expect(res.status).toBe(200);
    expect(res.body.ticket.properties.subject).toBe("Toaster");
  });

  it("404s for a ticket in another pipeline", async () => {
    hubspot.getTicket.mockResolvedValue(ticket("9", {hs_pipeline: "123"}));
    const res = await get("/api/tickets/9");
    expect(res.status).toBe(404);
  });

  it("404s for an id that isn't a number, without calling HubSpot",
    async () => {
      const res = await get("/api/tickets/abc");
      expect(res.status).toBe(404);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
    });

  it("passes HubSpot's 404 through", async () => {
    hubspot.getTicket.mockRejectedValue(new HubSpotError(404, "Not found"));
    const res = await get("/api/tickets/1");
    expect(res.status).toBe(404);
  });

  it("returns 502 when HubSpot fails", async () => {
    hubspot.getTicket.mockRejectedValue(new HubSpotError(500, "down"));
    const res = await get("/api/tickets/1");
    expect(res.status).toBe(502);
  });
});

describe("PATCH /api/tickets/:id", () => {
  it("saves allowed properties, trimmed, with null clearing", async () => {
    const res = await patch("/api/tickets/448850507989", {
      properties: {
        hs_pipeline_stage: "2",
        repair_item_brand: "  Toastmaster ",
        repair_item_weight_kg: 1.5,
        repair_notes: null,
      },
    });

    expect(res.status).toBe(200);
    expect(hubspot.updateTicket).toHaveBeenCalledWith("448850507989", {
      hs_pipeline_stage: "2",
      repair_item_brand: "Toastmaster",
      repair_item_weight_kg: "1.5",
      repair_notes: "",
    });
    expect(res.body.ticket.id).toBe("448850507989");
  });

  it("adds a newly assigned fixer to the worked-on-by list", async () => {
    hubspot.getTicket.mockResolvedValue(
      ticket(TICKET.id, {repair_fixers: "Paul F"}),
    );

    await patch(`/api/tickets/${TICKET.id}`, {
      properties: {repair_fixer: "Irene M"},
    });

    expect(hubspot.updateTicket).toHaveBeenCalledWith(TICKET.id, {
      repair_fixer: "Irene M",
      repair_fixers: "Paul F; Irene M",
    });
  });

  it("doesn't let the worked-on-by list be edited directly", async () => {
    const res = await patch(`/api/tickets/${TICKET.id}`, {
      properties: {repair_fixers: "Someone"},
    });
    expect(res.status).toBe(400);
  });

  it("rejects properties volunteers can't edit", async () => {
    const res = await patch("/api/tickets/1", {
      properties: {restarters_device_id: "5", hs_pipeline: "9"},
    });

    expect(res.status).toBe(400);
    expect(res.body.error)
      .toBe("Can't edit: restarters_device_id, hs_pipeline");
    expect(hubspot.updateTicket).not.toHaveBeenCalled();
  });

  it("rejects a status from another pipeline", async () => {
    const res = await patch("/api/tickets/1", {
      properties: {hs_pipeline_stage: "999"},
    });
    expect(res.status).toBe(400);
    expect(hubspot.updateTicket).not.toHaveBeenCalled();
  });

  it("rejects a blank item name", async () => {
    const res = await patch("/api/tickets/1", {properties: {subject: " "}});
    expect(res.status).toBe(400);
  });

  it("rejects an empty or malformed body", async () => {
    expect((await patch("/api/tickets/1", {properties: {}})).status).toBe(400);
    expect((await patch("/api/tickets/1", {})).status).toBe(400);
    expect((await patch("/api/tickets/1", {
      properties: {repair_notes: {a: 1}},
    })).status).toBe(400);
  });

  it("won't edit a ticket in another pipeline", async () => {
    hubspot.getTicket.mockResolvedValue(ticket("9", {hs_pipeline: "123"}));
    const res = await patch("/api/tickets/9", {properties: {subject: "x"}});
    expect(res.status).toBe(404);
    expect(hubspot.updateTicket).not.toHaveBeenCalled();
  });

  it("shows HubSpot's validation message", async () => {
    hubspot.updateTicket.mockRejectedValue(
      new HubSpotError(400, "Property values were not valid"),
    );
    const res = await patch("/api/tickets/1", {
      properties: {repair_barrier: "Nope"},
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Property values were not valid");
  });
});

describe("Restarters sync", () => {
  const synced = ticket(TICKET.id, {
    hs_pipeline_stage: "3",
    repair_item_type: "Toaster",
  });

  it("doesn't sync a ticket that's still in progress", async () => {
    await patch(`/api/tickets/${TICKET.id}`, {
      properties: {hs_pipeline_stage: "2"},
    });
    expect(restarters.createDevice).not.toHaveBeenCalled();
  });

  it("saves to HubSpot, then syncs when moved to Repaired", async () => {
    hubspot.getTicket.mockResolvedValue(synced);

    const res = await patch(`/api/tickets/${TICKET.id}`, {
      properties: {hs_pipeline_stage: "3"},
    });

    expect(res.status).toBe(200);
    expect(res.body.sync).toEqual(
      {status: "Synced", deviceId: 555, eventId: 19168},
    );
    const order = [
      hubspot.updateTicket.mock.invocationCallOrder[0],
      restarters.createDevice.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it("keeps the HubSpot save when Restarters fails", async () => {
    hubspot.getTicket.mockResolvedValue(synced);
    restarters.createDevice.mockRejectedValue(new Error("network down"));

    const res = await patch(`/api/tickets/${TICKET.id}`, {
      properties: {hs_pipeline_stage: "3"},
    });

    expect(res.status).toBe(200);
    expect(res.body.sync.status).toBe("Error");
    expect(hubspot.updateTicket).toHaveBeenCalledWith(TICKET.id, {
      hs_pipeline_stage: "3",
    });
  });

  it("retries every failed ticket", async () => {
    hubspot.searchTickets.mockResolvedValue([synced, synced]);

    const res = await post("/api/sync");

    expect(hubspot.searchTickets.mock.calls[0][0]).toContainEqual({
      propertyName: "restarters_sync_status", operator: "EQ", value: "Error",
    });
    expect(res.body).toMatchObject({retried: 2, synced: 2});
  });

  it("removes a device and clears its id", async () => {
    hubspot.getTicket.mockResolvedValue(
      ticket(TICKET.id, {restarters_device_id: "555"}),
    );

    const res = await request(app)
      .delete(`/api/tickets/${TICKET.id}/restarters`)
      .set("Authorization", "Bearer good");

    expect(res.status).toBe(200);
    expect(restarters.deleteDevice).toHaveBeenCalledWith(555);
    expect(hubspot.updateTicket).toHaveBeenCalledWith(TICKET.id,
      expect.objectContaining({restarters_device_id: ""}));
  });
});

describe("POST /api/tickets/:id/printed", () => {
  it("records the first print", async () => {
    hubspot.getTicket.mockResolvedValue(
      ticket(TICKET.id, {repair_printed_at: null}),
    );
    const res = await post(`/api/tickets/${TICKET.id}/printed`);
    expect(res.status).toBe(200);
    expect(hubspot.updateTicket).toHaveBeenCalledWith(TICKET.id, {
      repair_printed_at: res.body.printedAt,
    });
    expect(restarters.createDevice).not.toHaveBeenCalled();
  });

  it("keeps the first print time on a reprint", async () => {
    hubspot.getTicket.mockResolvedValue(
      ticket(TICKET.id, {repair_printed_at: "2026-11-21T10:05:00Z"}),
    );
    const res = await post(`/api/tickets/${TICKET.id}/printed`);
    expect(res.body).toEqual({printedAt: "2026-11-21T10:05:00Z"});
    expect(hubspot.updateTicket).not.toHaveBeenCalled();
  });

  it("won't mark a ticket in another pipeline", async () => {
    hubspot.getTicket.mockResolvedValue(ticket("9", {hs_pipeline: "123"}));
    const res = await post("/api/tickets/9/printed");
    expect(res.status).toBe(404);
    expect(hubspot.updateTicket).not.toHaveBeenCalled();
  });
});

describe("addFixer", () => {
  it("adds a name once, keeping the order people worked on it", () => {
    expect(addFixer(null, "Paul F")).toBe("Paul F");
    expect(addFixer("Paul F; Pete N", "Paul F")).toBe("Paul F; Pete N");
    expect(addFixer("Paul F", "Rob D")).toBe("Paul F; Rob D");
  });
});

describe("GET /api/tickets/completed", () => {
  it("searches closed stages closed in the last 90 days", async () => {
    vi.useFakeTimers({now: new Date("2026-11-09T12:00:00Z"), toFake: ["Date"]});
    hubspot.searchTickets.mockResolvedValue([]);

    const res = await get("/api/tickets/completed");
    vi.useRealTimers();

    expect(res.status).toBe(200);
    expect(hubspot.getTicket).not.toHaveBeenCalled(); // not treated as an id
    const closed = PIPELINE.stages
      .filter((s) => s.metadata.ticketState === "CLOSED")
      .map((s) => s.id);
    expect(hubspot.searchTickets.mock.calls[0][0]).toEqual([
      {propertyName: "hs_pipeline", operator: "EQ", value: "0"},
      {propertyName: "hs_pipeline_stage", operator: "IN", values: closed},
      {
        propertyName: "closed_date",
        operator: "GTE",
        value: String(Date.parse("2026-08-11T12:00:00Z")),
      },
    ]);
  });

  it("lists the most recently completed first", async () => {
    hubspot.searchTickets.mockResolvedValue([
      ticket("older", {closed_date: "2026-11-07T11:00:00Z"}),
      ticket("newer", {closed_date: "2026-11-08T11:00:00Z"}),
    ]);
    const res = await get("/api/tickets/completed");
    expect(res.body.tickets.map((t: Ticket) => t.id))
      .toEqual(["newer", "older"]);
  });
});

describe("closing after the session", () => {
  // Saturday's session. Can't repair (4) is a closed stage.
  const SESSION = {id: 19170, start: "2026-11-21T10:00:00Z", title: "Sat"};
  const appOn = (now: string) => createApp({
    hubspot: () => hubspot as unknown as HubSpot,
    pipelineId: () => "0",
    restarters: () => restarters as unknown as Restarters,
    syncConfig: () => ({groupId: "116", stageStatus: {}}),
    verifyToken: async () => undefined,
    now: () => new Date(now),
  });
  const close = (now: string) => request(appOn(now))
    .patch(`/api/tickets/${TICKET.id}`).set("Authorization", "Bearer x")
    .send({properties: {hs_pipeline_stage: "4"}});

  beforeEach(() => {
    restarters.latestEventOnOrBefore.mockResolvedValue(SESSION);
  });

  it("dates a ticket closed the next day to the session", async () => {
    await close("2026-11-23T09:00:00Z");
    expect(restarters.latestEventOnOrBefore)
      .toHaveBeenCalledWith("116", "2026-11-23");
    expect(hubspot.updateTicket).toHaveBeenLastCalledWith(TICKET.id,
      {closed_date: "2026-11-21T10:00:00Z"});
  });

  it("leaves the close time alone on the day of the session", async () => {
    await close("2026-11-21T15:00:00Z");
    expect(hubspot.updateTicket).toHaveBeenCalledTimes(1);
  });

  it("doesn't re-date a ticket that was already closed", async () => {
    hubspot.getTicket.mockResolvedValue(
      ticket(TICKET.id, {hs_pipeline_stage: "6385079534"}),
    );
    await close("2026-11-23T09:00:00Z");
    expect(hubspot.updateTicket).toHaveBeenCalledTimes(1);
  });

  it("still saves if Restarters can't be reached", async () => {
    restarters.latestEventOnOrBefore.mockRejectedValue(new Error("down"));
    const res = await close("2026-11-23T09:00:00Z");
    expect(res.status).toBe(200);
    expect(hubspot.updateTicket).toHaveBeenCalledTimes(1);
  });

  it("returns the latest session with completed tickets", async () => {
    const res = await request(appOn("2026-11-23T09:00:00Z"))
      .get("/api/tickets/completed").set("Authorization", "Bearer x");
    expect(res.body.session).toEqual({...SESSION, date: "2026-11-21"});
  });
});

describe("GET /api/sessions/upcoming", () => {
  it("lists the group's upcoming Restarters sessions", async () => {
    const res = await request(createApp({
      hubspot: () => hubspot as unknown as HubSpot,
      pipelineId: () => "0",
      restarters: () => restarters as unknown as Restarters,
      syncConfig: () => ({groupId: "116", stageStatus: {}}),
      verifyToken: async () => undefined,
      now: () => new Date("2026-11-22T09:00:00Z"),
    })).get("/api/sessions/upcoming").set("Authorization", "Bearer x");
    expect(restarters.eventsBetween)
      .toHaveBeenCalledWith("116", "2026-11-22", "2027-01-17");
    expect(res.body.sessions).toEqual([{date: "2026-12-05", title: ""}]);
  });
});

describe("QR ticket keys", () => {
  const NOW = new Date("2026-11-21T10:00:00Z");
  const keyApp = () => createApp({
    hubspot: () => hubspot as unknown as HubSpot,
    pipelineId: () => "0",
    restarters: () => restarters as unknown as Restarters,
    syncConfig: () => ({groupId: "116", stageStatus: {}}),
    verifyToken: async (token) => {
      if (token !== "good") throw new Error("bad token");
    },
    now: () => NOW,
    ticketKeySecret: () => "secret",
  });
  const key = (id: string, expires = NOW.getTime() + 1000) =>
    `Ticket ${signTicketKey("secret", id, expires)}`;

  it("issues a 3-hour key to a signed-in user", async () => {
    const res = await request(keyApp()).post(`/api/tickets/${TICKET.id}/key`)
      .set("Authorization", "Bearer good");
    expect(res.body.expires).toBe(NOW.getTime() + 3 * 60 * 60 * 1000);
    expect(res.body.key).toMatch(new RegExp(`^${TICKET.id}\\.`));
  });

  it("opens and saves its own ticket", async () => {
    const auth = key(TICKET.id);
    expect((await request(keyApp()).get(`/api/tickets/${TICKET.id}`)
      .set("Authorization", auth)).status).toBe(200);
    expect((await request(keyApp()).patch(`/api/tickets/${TICKET.id}`)
      .set("Authorization", auth)
      .send({properties: {repair_notes: "x"}})).status).toBe(200);
  });

  it("won't open the list or another ticket", async () => {
    expect((await request(keyApp()).get("/api/tickets")
      .set("Authorization", key(TICKET.id))).status).toBe(403);
    expect((await request(keyApp()).get("/api/tickets/999")
      .set("Authorization", key(TICKET.id))).status).toBe(403);
  });

  it("can't issue more keys", async () => {
    const res = await request(keyApp()).post(`/api/tickets/${TICKET.id}/key`)
      .set("Authorization", key(TICKET.id));
    expect(res.status).toBe(403);
  });

  it("says when the key has expired", async () => {
    const res = await request(keyApp()).get(`/api/tickets/${TICKET.id}`)
      .set("Authorization", key(TICKET.id, NOW.getTime() - 1));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/);
  });
});
