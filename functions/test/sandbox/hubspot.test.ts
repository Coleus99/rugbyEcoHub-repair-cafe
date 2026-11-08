// Runs the HubSpot client against the real sandbox. Reads data, and edits
// repair_notes on the test ticket only, putting the old value back after.
// Run with: npm run test:sandbox
import {describe, expect, it} from "vitest";
import {createHubSpot} from "../../src/hubspot";
import {OPTION_PROPERTIES, READ_PROPERTIES} from "../../src/app";
import {PIPELINE_ID, TEST_TICKET_ID, TOKEN} from "../env";

const hubspot = createHubSpot(TOKEN);

describe("HubSpot sandbox", () => {
  it("has the repair pipeline with open and closed stages", async () => {
    const pipeline = await hubspot.getPipeline(PIPELINE_ID);
    const states = pipeline.stages.map((s) => s.metadata.ticketState);

    expect(states).toContain("OPEN");
    expect(states).toContain("CLOSED");
  });

  it("has every property the app reads", async () => {
    // HubSpot silently returns nothing for a misspelt property, so check
    // the names exist rather than trusting the ticket read.
    const ticket = await hubspot.getTicket(TEST_TICKET_ID, READ_PROPERTIES);
    const missing = READ_PROPERTIES.filter((p) => !(p in ticket.properties));
    expect(missing).toEqual([]);
    expect(ticket.properties.hs_pipeline).toBe(PIPELINE_ID);
  });

  it("reads first names, which needs the contacts read scope", async () => {
    const names = await hubspot.firstNames([TEST_TICKET_ID]);
    expect(names[TEST_TICKET_ID]).toBeTruthy();
  });

  it("has options for every dropdown", async () => {
    const options = await hubspot.getPropertyOptions(OPTION_PROPERTIES);
    for (const name of OPTION_PROPERTIES) {
      expect(options[name]?.length, name).toBeGreaterThan(0);
    }
  });

  it("finds open tickets only in the repair pipeline", async () => {
    const pipeline = await hubspot.getPipeline(PIPELINE_ID);
    const open = pipeline.stages
      .filter((s) => s.metadata.ticketState === "OPEN")
      .map((s) => s.id);

    const tickets = await hubspot.searchTickets([
      {propertyName: "hs_pipeline", operator: "EQ", value: PIPELINE_ID},
      {propertyName: "hs_pipeline_stage", operator: "IN", values: open},
    ], ["hs_pipeline", "hs_pipeline_stage"]);

    for (const t of tickets) {
      expect(t.properties.hs_pipeline).toBe(PIPELINE_ID);
      expect(open).toContain(t.properties.hs_pipeline_stage);
    }
  });

  it("saves an edit to the test ticket and reads it back", async () => {
    const before = await hubspot.getTicket(TEST_TICKET_ID, ["repair_notes"]);
    const note = `Sandbox test ${new Date().toISOString()}`;

    try {
      await hubspot.updateTicket(TEST_TICKET_ID, {repair_notes: note});
      const after = await hubspot.getTicket(TEST_TICKET_ID, ["repair_notes"]);
      expect(after.properties.repair_notes).toBe(note);
    } finally {
      await hubspot.updateTicket(TEST_TICKET_ID, {
        repair_notes: before.properties.repair_notes ?? "",
      });
    }
  });
});
