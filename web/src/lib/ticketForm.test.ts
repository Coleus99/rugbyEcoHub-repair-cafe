import { describe, expect, it } from "vitest";
import {
  bookingLabel,
  changedProperties,
  comesBack,
  itemTypeFromCategory,
  labelFor,
  needsWeight,
  outcomeFields,
  rebookDate,
  toDraft,
} from "./ticketForm";

describe("toDraft", () => {
  it("turns nulls into empty strings for the form", () => {
    expect(toDraft({ subject: "Toaster", repair_notes: null }, ["subject", "repair_notes"]))
      .toEqual({ subject: "Toaster", repair_notes: "" });
  });
});

describe("changedProperties", () => {
  const original = { subject: "Toaster", repair_notes: null, repair_item_brand: "Dualit" };

  it("returns nothing when nothing changed", () => {
    expect(changedProperties(original, toDraft(original, Object.keys(original)))).toEqual({});
  });

  it("ignores whitespace-only changes", () => {
    expect(changedProperties(original, { subject: "Toaster " })).toEqual({});
  });

  it("returns changed and cleared fields only", () => {
    expect(
      changedProperties(original, {
        subject: "Toaster",
        repair_notes: "New element",
        repair_item_brand: "",
      }),
    ).toEqual({ repair_notes: "New element", repair_item_brand: "" });
  });
});

describe("itemTypeFromCategory", () => {
  it("drops the size from Restarters categories", () => {
    expect(itemTypeFromCategory("Laptop medium")).toBe("Laptop");
    expect(itemTypeFromCategory("Small kitchen item")).toBe("Small kitchen item");
    expect(itemTypeFromCategory("Toaster")).toBe("Toaster");
  });
});

describe("labelFor", () => {
  const options = [{ label: "Toaster", value: "43" }];

  it("finds the label for a value", () => {
    expect(labelFor(options, "43")).toBe("Toaster");
  });

  it("falls back to the raw value or blank", () => {
    expect(labelFor(options, "99")).toBe("99");
    expect(labelFor(options, null)).toBe("");
  });
});

describe("bookingLabel", () => {
  it("uses the requested date when there is one", () => {
    expect(bookingLabel({ requested_repair_date: "2026-11-21", createdate: "2026-11-08T10:00:00Z" })).toBe(
      "Booked for Sat 21 Nov 2026",
    );
  });

  it("falls back to the created date for in-person bookings", () => {
    expect(bookingLabel({ requested_repair_date: null, createdate: "2026-11-08T10:00:00Z" })).toBe(
      "Added Sun 8 Nov 2026",
    );
  });
});

describe("outcomeFields", () => {
  it("hides next steps and barrier for Fixed and unsynced stages", () => {
    expect(outcomeFields("Fixed")).toEqual({ nextSteps: false, barrier: false });
    expect(outcomeFields(null)).toEqual({ nextSteps: false, barrier: false });
  });

  it("shows only the field Restarters needs", () => {
    expect(outcomeFields("Repairable")).toEqual({ nextSteps: true, barrier: false });
    expect(outcomeFields("End of life")).toEqual({ nextSteps: false, barrier: true });
  });
});

describe("needsWeight", () => {
  it("only asks for weight on the Misc categories", () => {
    expect(needsWeight("46")).toBe(true);
    expect(needsWeight("50")).toBe(true);
    expect(needsWeight("43")).toBe(false);
    expect(needsWeight(null)).toBe(false);
  });
});

describe("rebookDate", () => {
  const sessions = [{ date: "2026-12-05" }, { date: "2026-12-19" }];

  it("books the next session", () => {
    expect(rebookDate("", sessions, "2026-11-21")).toBe("2026-12-05");
    expect(rebookDate("2026-11-21", sessions, "2026-11-21")).toBe("2026-12-05");
  });

  it("keeps a later booking", () => {
    expect(rebookDate("2026-12-19", sessions, "2026-11-21")).toBe("2026-12-19");
  });

  it("leaves it alone if there are no sessions to offer", () => {
    expect(rebookDate("2026-11-21", [], "2026-11-21")).toBe("2026-11-21");
  });
});

describe("comesBack", () => {
  it("is only for More time needed", () => {
    expect(comesBack("More time needed")).toBe(true);
    expect(comesBack("Professional help")).toBe(false);
    expect(comesBack("Do it yourself")).toBe(false);
    expect(comesBack(null)).toBe(false);
  });
});
