// Checks the Restarters client against LIVE Restarters: creates one device
// on the test event, updates it, then deletes it. Run rarely.
// Run with: npm run test:restarters
import {afterAll, describe, expect, it} from "vitest";
import {createRestarters} from "../../src/restarters";

try {
  process.loadEnvFile(".secret.local");
  process.loadEnvFile(".env.repair-cafe-dev");
} catch {
  // checked below
}
const TOKEN = process.env.RESTARTERS_TOKEN ?? "";
const EVENT_ID = process.env.RESTARTERS_EVENT_ID ?? "";
if (!TOKEN || !EVENT_ID) {
  throw new Error("Needs RESTARTERS_TOKEN and RESTARTERS_EVENT_ID");
}

const restarters = createRestarters(TOKEN);
let deviceId = 0;

afterAll(async () => {
  // Clean up even if an assertion failed part way.
  if (deviceId) await restarters.deleteDevice(deviceId).catch(() => undefined);
});

describe("Restarters (live)", () => {
  it("finds the latest event up to the test event's date", async () => {
    const event = await restarters.latestEventOnOrBefore("116", "2026-11-07");
    expect(event?.id).toBe(Number(EVENT_ID));
  });

  it("creates, updates and deletes a device", async () => {
    deviceId = await restarters.createDevice({
      eventid: EVENT_ID,
      category: "43",
      item_type: "Toaster",
      brand: "App test - delete me",
      repair_status: "Repairable",
      next_steps: "More time needed",
    });
    expect(deviceId).toBeGreaterThan(0);

    await restarters.updateDevice(deviceId, {
      eventid: EVENT_ID,
      category: "43",
      item_type: "Toaster",
      brand: "App test - delete me",
      repair_status: "Fixed",
      spare_parts: "No",
    });

    await restarters.deleteDevice(deviceId);
    deviceId = 0;
  });
});
