import { describe, expect, it } from "vitest";
import type { Ticket } from "./api";
import { categoriesInUse, matchesSearch, shortRef } from "./search";

const ticket = (id: string, subject: string, firstName: string | null, category = "40"): Ticket => ({
  id,
  firstName,
  properties: { subject, restarters_category: category },
});

const lamp = ticket("448927467747", "Desk lamp", "Priya");

describe("shortRef", () => {
  it("is the last five digits of the ticket id", () => {
    expect(shortRef("448927467747")).toBe("67747");
  });
});

describe("matchesSearch", () => {
  it("matches the start of words in the item name", () => {
    expect(matchesSearch(lamp, "desk la", "")).toBe(true);
    expect(matchesSearch(lamp, "amp", "")).toBe(false);
  });

  it("matches the first name, and item and name together", () => {
    expect(matchesSearch(lamp, "pri", "")).toBe(true);
    expect(matchesSearch(lamp, "priya lamp", "")).toBe(true);
    expect(matchesSearch(lamp, "priya kettle", "")).toBe(false);
  });

  it("matches the short reference, with or without #", () => {
    expect(matchesSearch(lamp, "67747", "")).toBe(true);
    expect(matchesSearch(lamp, "#677", "")).toBe(true);
  });

  it("filters by category, alone or with text", () => {
    expect(matchesSearch(lamp, "", "40")).toBe(true);
    expect(matchesSearch(lamp, "", "43")).toBe(false);
    expect(matchesSearch(lamp, "desk", "43")).toBe(false);
  });

  it("matches the assigned fixer", () => {
    const assigned: Ticket = { ...lamp, properties: { ...lamp.properties, repair_fixer: "Irene M" } };
    expect(matchesSearch(assigned, "irene", "")).toBe(true);
  });

  it("copes with no first name", () => {
    expect(matchesSearch(ticket("1", "Kettle", null), "kett", "")).toBe(true);
  });
});

describe("categoriesInUse", () => {
  it("keeps only categories on open tickets, in the original order", () => {
    const options = [
      { label: "Toaster", value: "43" },
      { label: "Lamp", value: "40" },
      { label: "Kettle", value: "39" },
    ];
    expect(categoriesInUse([lamp, ticket("2", "Toaster", null, "43")], options)).toEqual([
      { label: "Toaster", value: "43" },
      { label: "Lamp", value: "40" },
    ]);
  });
});
