import {beforeEach, describe, expect, it, vi} from "vitest";
import type {HubSpot, Ticket} from "../../src/hubspot";
import {RestartersError, type Restarters} from "../../src/restarters";
import {
  parseStageStatus,
  removeFromRestarters,
  syncTicket,
  toDevice,
  type SyncDeps,
} from "../../src/sync";

const repaired = (props: Ticket["properties"] = {}): Ticket => ({
  id: "100",
  properties: {
    hs_pipeline_stage: "3",
    closed_date: "2026-11-21T11:30:00Z",
    restarters_category: "43",
    repair_item_type: "Toaster",
    repair_item_brand: "Dualit",
    repair_item_model: "",
    repair_item_year_made: "1999",
    repair_problem_and_fix: "Spring snapped. Replaced.",
    repair_spare_parts: "Third party",
    restarters_device_id: null,
    restarters_event_id: null,
    ...props,
  },
});

let hubspot: {updateTicket: ReturnType<typeof vi.fn>};
let restarters: {
  latestEventOnOrBefore: ReturnType<typeof vi.fn>;
  createDevice: ReturnType<typeof vi.fn>;
  updateDevice: ReturnType<typeof vi.fn>;
  deleteDevice: ReturnType<typeof vi.fn>;
};
let deps: SyncDeps;

beforeEach(() => {
  hubspot = {updateTicket: vi.fn(async () => ({}))};
  restarters = {
    latestEventOnOrBefore: vi.fn(async () =>
      ({id: 19169, start: "", title: ""})),
    createDevice: vi.fn(async () => 555),
    updateDevice: vi.fn(async () => undefined),
    deleteDevice: vi.fn(async () => undefined),
  };
  deps = {
    hubspot: hubspot as unknown as HubSpot,
    restarters: restarters as unknown as Restarters,
    config: {
      groupId: "116",
      stageStatus: {"3": "Fixed", "4": "End of life", "9": "Repairable"},
    },
    now: () => new Date("2026-11-21T12:00:00Z"),
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("parseStageStatus", () => {
  it("reads stage=status pairs", () => {
    expect(parseStageStatus("3=Fixed, 4=End of life")).toEqual(
      {"3": "Fixed", "4": "End of life"},
    );
  });

  it("rejects a status Restarters doesn't have", () => {
    expect(() => parseStageStatus("3=Done")).toThrow("Done");
  });
});

describe("toDevice", () => {
  it("maps ticket properties to Restarters fields", () => {
    expect(toDevice(repaired().properties, "Fixed", 19169, 2026)).toEqual({
      eventid: "19169",
      category: "43",
      item_type: "Toaster",
      brand: "Dualit",
      age: "27",
      problem: "Spring snapped. Replaced.",
      repair_status: "Fixed",
      spare_parts: "Third party",
    });
  });

  it("only sends barrier for End of life and next steps for Repairable",
    () => {
      const p = repaired({
        repair_barrier: "Lack of equipment",
        repair_next_steps: "Professional help",
      }).properties;
      expect(toDevice(p, "Fixed", 1, 2026)).not.toHaveProperty("barrier");
      expect(toDevice(p, "Fixed", 1, 2026)).not.toHaveProperty("next_steps");
      expect(toDevice(p, "End of life", 1, 2026).barrier)
        .toBe("Lack of equipment");
      expect(toDevice(p, "Repairable", 1, 2026).next_steps)
        .toBe("Professional help");
    });

  it("only sends weight for Misc categories", () => {
    const p = repaired({repair_item_weight_kg: "2.5"}).properties;
    expect(toDevice(p, "Fixed", 1, 2026)).not.toHaveProperty("estimate");
    expect(toDevice({...p, restarters_category: "46"}, "Fixed", 1, 2026)
      .estimate).toBe("2.5");
  });

  it("asks for what Restarters requires", () => {
    const p = repaired().properties;
    expect(() => toDevice({...p, restarters_category: null}, "Fixed", 1, 2026))
      .toThrow("Choose a category.");
    expect(() => toDevice({...p, repair_item_type: " "}, "Fixed", 1, 2026))
      .toThrow("Add an item type.");
    expect(() => toDevice(p, "End of life", 1, 2026))
      .toThrow("Choose a barrier to repair.");
    expect(() => toDevice(p, "Repairable", 1, 2026))
      .toThrow("Choose next steps.");
  });
});

describe("syncTicket", () => {
  it("skips stages that don't map to Restarters", async () => {
    const result = await syncTicket(deps, repaired({hs_pipeline_stage: "2"}));
    expect(result).toEqual({status: "Skipped"});
    expect(hubspot.updateTicket).not.toHaveBeenCalled();
  });

  it("creates a device on the latest event up to the day it closed",
    async () => {
      const result = await syncTicket(deps, repaired());

      expect(restarters.latestEventOnOrBefore)
        .toHaveBeenCalledWith("116", "2026-11-21");
      expect(result).toEqual({status: "Synced", deviceId: 555, eventId: 19169});
      expect(hubspot.updateTicket).toHaveBeenCalledWith("100", {
        restarters_device_id: "555",
        restarters_event_id: "19169",
        restarters_sync_status: "Synced",
        restarters_sync_error: "",
      });
    });

  it("uses today for open stages with no closed date", async () => {
    await syncTicket(deps, repaired({
      hs_pipeline_stage: "9",
      closed_date: null,
      repair_next_steps: "More time needed",
    }));
    expect(restarters.latestEventOnOrBefore)
      .toHaveBeenCalledWith("116", "2026-11-21");
  });

  it("updates the existing device on its stored event", async () => {
    await syncTicket(deps, repaired({
      restarters_device_id: "555",
      restarters_event_id: "19168",
    }));

    expect(restarters.latestEventOnOrBefore).not.toHaveBeenCalled();
    expect(restarters.createDevice).not.toHaveBeenCalled();
    expect(restarters.updateDevice).toHaveBeenCalledWith(
      555, expect.objectContaining({eventid: "19168"}),
    );
  });

  it("recreates a device that was deleted on Restarters", async () => {
    restarters.updateDevice.mockRejectedValue(new RestartersError(404, "x"));
    const result = await syncTicket(deps, repaired({
      restarters_device_id: "555", restarters_event_id: "19168",
    }));
    expect(restarters.createDevice).toHaveBeenCalled();
    expect(result.status).toBe("Synced");
  });

  it("uses the dev test event when set", async () => {
    deps.config.eventIdOverride = "19168";
    await syncTicket(deps, repaired());
    expect(restarters.latestEventOnOrBefore).not.toHaveBeenCalled();
    expect(restarters.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({eventid: "19168"}),
    );
  });

  it("records an error when the group has no recent event", async () => {
    restarters.latestEventOnOrBefore.mockResolvedValue(undefined);

    const result = await syncTicket(deps, repaired());

    expect(result).toEqual({
      status: "Error",
      error: "No Restarters event in the 6 months up to 2026-11-21. " +
        "Add the session on Restarters, then Resync.",
    });
    expect(hubspot.updateTicket).toHaveBeenCalledWith("100",
      expect.objectContaining({restarters_sync_status: "Error"}));
    expect(restarters.createDevice).not.toHaveBeenCalled();
  });

  it("records Restarters' validation message", async () => {
    restarters.createDevice.mockRejectedValue(
      new RestartersError(422, "The category field is required."),
    );
    const result = await syncTicket(deps, repaired());
    expect(result).toEqual({
      status: "Error",
      error: "Restarters said: The category field is required.",
    });
  });

  it("flags a device whose id couldn't be saved to HubSpot", async () => {
    hubspot.updateTicket.mockRejectedValue(new Error("HubSpot down"));
    const result = await syncTicket(deps, repaired());
    expect(result.status).toBe("Error");
    expect(result).toHaveProperty("error",
      expect.stringContaining("device 555"));
  });
});

describe("removeFromRestarters", () => {
  it("deletes the device and clears the id", async () => {
    await removeFromRestarters(deps, repaired({restarters_device_id: "555"}));
    expect(restarters.deleteDevice).toHaveBeenCalledWith(555);
    expect(hubspot.updateTicket).toHaveBeenCalledWith("100", {
      restarters_device_id: "",
      restarters_sync_status: "Not synced",
      restarters_sync_error: "",
    });
  });

  it("still clears the id if Restarters already deleted it", async () => {
    restarters.deleteDevice.mockRejectedValue(new RestartersError(404, "x"));
    await removeFromRestarters(deps, repaired({restarters_device_id: "555"}));
    expect(hubspot.updateTicket).toHaveBeenCalled();
  });
});
