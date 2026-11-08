import {describe, expect, it, vi} from "vitest";
import {createHubSpot, HubSpotError} from "../../src/hubspot";
import {fixture} from "../fixtures";

// A fake fetch that returns one canned response and records the request.
const fakeFetch = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), {status}),
  );

describe("HubSpot client", () => {
  it("sends the token and reads a ticket", async () => {
    const fetchFn = fakeFetch(200, fixture("getTicketResponse.json"));
    const hubspot = createHubSpot("test-token", fetchFn);

    const ticket = await hubspot.getTicket("448850507989", ["subject"]);

    expect(ticket.properties.subject).toBe("Toaster");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      "https://api.hubapi.com/crm/v3/objects/tickets/448850507989" +
        "?properties=subject",
    );
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization)
      .toBe("Bearer test-token");
  });

  it("searches with the filters given", async () => {
    const fetchFn = fakeFetch(200, fixture("searchOpenTicketsResponse.json"));
    const hubspot = createHubSpot("t", fetchFn);
    const filters = [
      {propertyName: "hs_pipeline", operator: "EQ" as const, value: "0"},
    ];

    const tickets = await hubspot.searchTickets(filters, ["subject"]);

    expect(tickets).toHaveLength(1);
    const body = JSON.parse(fetchFn.mock.calls[0][1]?.body as string);
    expect(body.filterGroups).toEqual([{filters}]);
  });

  it("looks up first names through the ticket's contact", async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({results: [
        {from: {id: "1"}, to: [{toObjectId: 99}]},
        {from: {id: "2"}, to: []},
      ]}))
      .mockResolvedValueOnce(Response.json({results: [
        {id: "99", properties: {firstname: "Margaret"}},
      ]}));
    const hubspot = createHubSpot("t", fetchFn);

    expect(await hubspot.firstNames(["1", "2"])).toEqual({"1": "Margaret"});
    const body = JSON.parse(fetchFn.mock.calls[1][1]?.body as string);
    expect(body.properties).toEqual(["firstname"]);
  });

  it("turns property definitions into dropdown options", async () => {
    const fetchFn = fakeFetch(
      200, fixture("batchReadEnumPropertiesResponse.json"),
    );
    const hubspot = createHubSpot("t", fetchFn);

    const options = await hubspot.getPropertyOptions(["restarters_category"]);

    expect(options.restarters_category).toContainEqual(
      {label: "Toaster", value: "43"},
    );
    expect(options.repair_spare_parts).toEqual([
      {label: "No spare parts required", value: "No"},
      {label: "Parts required from manufacturer", value: "Manufacturer"},
      {label: "Parts required from third party", value: "Third party"},
    ]);
  });

  it("throws HubSpotError with HubSpot's message", async () => {
    const fetchFn = fakeFetch(400, {message: "Property values were not valid"});
    const hubspot = createHubSpot("t", fetchFn);

    const err = await hubspot.updateTicket("1", {repair_barrier: "x"})
      .catch((e) => e);

    expect(err).toBeInstanceOf(HubSpotError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Property values were not valid");
  });
});
