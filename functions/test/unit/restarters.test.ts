import {describe, expect, it, vi} from "vitest";
import {
  createRestarters,
  londonDate,
  RestartersError,
} from "../../src/restarters";

const respond = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => Response.json(body, {status}));

describe("Restarters client", () => {
  it("creates a device with multipart and returns the top-level id",
    async () => {
      const fetchFn = respond(200, {id: 253142, device: {}, stats: {}});
      const restarters = createRestarters("tok", fetchFn);

      const id = await restarters.createDevice({eventid: "1", category: "43"});

      expect(id).toBe(253142);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe("https://restarters.net/api/v2/devices?api_token=tok");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
    });

  it("updates with a url-encoded body, because PHP drops multipart PATCH",
    async () => {
      const fetchFn = respond(200, {id: "253142"});
      const restarters = createRestarters("tok", fetchFn);

      await restarters.updateDevice(253142, {eventid: "1"});

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toContain("/devices/253142?api_token=tok");
      expect(init?.method).toBe("PATCH");
      expect(init?.body).toBeInstanceOf(URLSearchParams);
    });

  it("joins Laravel's field errors into one message", async () => {
    const fetchFn = respond(422, {
      message: "The given data was invalid.",
      errors: {eventid: ["The eventid field is required."]},
    });
    const restarters = createRestarters("tok", fetchFn);

    const err = await restarters.createDevice({}).catch((e) => e);

    expect(err).toBeInstanceOf(RestartersError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("The eventid field is required.");
  });

  it("picks that day's event, or the most recent before it", async () => {
    const fetchFn = respond(200, {data: [
      {id: 1, start: "2026-11-07T10:00:00+00:00", title: "Earlier"},
      {id: 2, start: "2026-11-21T10:00:00+00:00", title: "Latest"},
      {id: 3, start: "2026-10-17T09:00:00+00:00", title: "Oldest"},
    ]});
    const restarters = createRestarters("tok", fetchFn);

    expect((await restarters.latestEventOnOrBefore("116", "2026-11-21"))?.id)
      .toBe(2);
    expect(fetchFn.mock.calls[0][0]).toContain(
      "/groups/116/events?start=2026-05-22T00:00:00Z&end=2026-11-21T23:59:59Z",
    );
  });

  it("ignores events after the date, even if the API returns them",
    async () => {
      const fetchFn = respond(200, {data: [
        {id: 1, start: "2026-11-07T10:00:00+00:00", title: "Past"},
        {id: 2, start: "2026-11-21T10:00:00+00:00", title: "Future"},
      ]});
      const restarters = createRestarters("tok", fetchFn);
      expect((await restarters.latestEventOnOrBefore("116", "2026-11-08"))?.id)
        .toBe(1);
    });

  it("returns undefined when there are no events", async () => {
    const restarters = createRestarters("tok", respond(200, {data: []}));
    expect(await restarters.latestEventOnOrBefore("116", "2026-11-08"))
      .toBeUndefined();
  });
});

describe("londonDate", () => {
  it("uses UK time, so late evening in summer is still the same day", () => {
    expect(londonDate(new Date("2026-07-04T23:30:00Z"))).toBe("2026-07-05");
    expect(londonDate(new Date("2026-11-21T23:30:00Z"))).toBe("2026-11-21");
  });
});
