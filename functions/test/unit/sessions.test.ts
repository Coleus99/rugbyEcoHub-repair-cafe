import {describe, expect, it} from "vitest";
import {upcomingSessions} from "../../src/sessions";

const event = (start: string) => ({id: 1, start, title: "Rugby Eco Hub"});

describe("upcomingSessions", () => {
  it("lists Restarters events after today, soonest first", () => {
    const events = [
      event("2026-12-05T10:00:00+00:00"),
      event("2026-11-21T10:00:00+00:00"),
      event("2026-11-07T10:00:00+00:00"),
    ];
    expect(upcomingSessions(events, "2026-11-09").map((s) => s.date))
      .toEqual(["2026-11-21", "2026-12-05"]);
  });

  it("doesn't offer today's session", () => {
    expect(upcomingSessions([event("2026-11-21T10:00:00+00:00")],
      "2026-11-21")).toEqual([]);
  });
});
