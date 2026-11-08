// Sends a repair ticket to Restarters and records the result on the ticket.
// HubSpot is always saved first. A sync failure is stored on the ticket
// (restarters_sync_status = Error) and never undoes the HubSpot save.
import type {HubSpot, Properties, Ticket} from "./hubspot";
import {
  londonDate,
  RestartersError,
  type DeviceFields,
  type RepairStatus,
  type Restarters,
} from "./restarters";

export type SyncConfig = {
  groupId: string;
  // Pipeline stage id -> Restarters repair_status. Stages not listed
  // (New, In Progress, No show...) aren't synced.
  stageStatus: Record<string, RepairStatus>;
  // Dev only: log everything against one test event instead of looking up
  // the event for the day.
  eventIdOverride?: string;
};

export type SyncDeps = {
  hubspot: HubSpot;
  restarters: Restarters;
  config: SyncConfig;
  now?: () => Date;
};

export type SyncResult =
  | {status: "Synced"; deviceId: number; eventId: number}
  | {status: "Error"; error: string}
  | {status: "Skipped"};

// Restarters' two Misc categories (powered, unpowered).
const MISC_CATEGORIES = ["46", "50"];

const STATUSES: RepairStatus[] = ["Fixed", "Repairable", "End of life"];

// "3=Fixed,4=End of life" -> {"3": "Fixed", "4": "End of life"}
export const parseStageStatus = (text: string) => {
  const map: Record<string, RepairStatus> = {};
  for (const pair of text.split(",").filter((p) => p.trim())) {
    const [stage, status] = pair.split("=").map((s) => s.trim());
    if (!STATUSES.includes(status as RepairStatus)) {
      throw new Error(`Unknown Restarters status "${status}" for ${stage}`);
    }
    map[stage] = status as RepairStatus;
  }
  return map;
};

/** A problem the volunteer can fix, shown on the ticket. */
class SyncProblem extends Error {}

// Turn ticket properties into Restarters device fields. Throws SyncProblem
// for anything Restarters would reject, so we don't send a bad request.
export const toDevice = (
  p: Properties,
  status: RepairStatus,
  eventId: number,
  eventYear: number,
): DeviceFields => {
  if (!p.restarters_category) throw new SyncProblem("Choose a category.");
  if (!p.repair_item_type?.trim()) {
    throw new SyncProblem("Add an item type.");
  }
  if (status === "End of life" && !p.repair_barrier) {
    throw new SyncProblem("Choose a barrier to repair.");
  }
  if (status === "Repairable" && !p.repair_next_steps) {
    throw new SyncProblem("Choose next steps.");
  }

  const year = Number(p.repair_item_year_made);
  const fields: Record<string, string | null | undefined> = {
    eventid: String(eventId),
    category: p.restarters_category,
    item_type: p.repair_item_type,
    brand: p.repair_item_brand,
    model: p.repair_item_model,
    age: year > 0 ? String(Math.max(0, eventYear - year)) : undefined,
    // Restarters uses its category average weight except for Misc.
    estimate: MISC_CATEGORIES.includes(p.restarters_category) ?
      p.repair_item_weight_kg : undefined,
    problem: p.repair_problem_and_fix,
    notes: p.repair_notes,
    repair_status: status,
    spare_parts: p.repair_spare_parts,
    next_steps: status === "Repairable" ? p.repair_next_steps : undefined,
    barrier: status === "End of life" ? p.repair_barrier : undefined,
  };
  // Leave out blanks. Restarters rejects "" for its dropdown fields.
  const out: DeviceFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v && v.trim()) out[k] = v.trim();
  }
  return out;
};

// Items go on that day's session, or the most recent one before it, so a
// session missing from Restarters or a date mix-up doesn't block the sync.
// The reference day is when the ticket was completed (closed_date), or
// today for open stages such as Needs follow-up.
const findEvent = async (deps: SyncDeps, p: Properties) => {
  const stored = Number(p.restarters_event_id);
  const date = londonDate(
    p.closed_date ? new Date(p.closed_date) : (deps.now?.() ?? new Date()),
  );
  if (stored) return {eventId: stored, date};
  const override = Number(deps.config.eventIdOverride);
  if (override) return {eventId: override, date};

  const event = await deps.restarters.latestEventOnOrBefore(
    deps.config.groupId, date,
  );
  if (!event) {
    throw new SyncProblem(
      `No Restarters event in the 6 months up to ${date}. ` +
        "Add the session on Restarters, then Resync.",
    );
  }
  return {eventId: event.id, date};
};

export const syncTicket = async (
  deps: SyncDeps,
  ticket: Ticket,
): Promise<SyncResult> => {
  const p = ticket.properties;
  const status = deps.config.stageStatus[p.hs_pipeline_stage ?? ""];
  if (!status) return {status: "Skipped"};

  let deviceId = Number(p.restarters_device_id) || 0;
  let eventId = 0;
  try {
    const event = await findEvent(deps, p);
    eventId = event.eventId;
    const fields = toDevice(p, status, eventId, Number(event.date.slice(0, 4)));

    if (deviceId) {
      try {
        await deps.restarters.updateDevice(deviceId, fields);
      } catch (err) {
        // Deleted on Restarters by hand: create it again.
        if (!(err instanceof RestartersError && err.status === 404)) throw err;
        deviceId = await deps.restarters.createDevice(fields);
      }
    } else {
      deviceId = await deps.restarters.createDevice(fields);
    }
  } catch (err) {
    const error = describe(err);
    await recordOnTicket(deps, ticket.id, {
      restarters_sync_status: "Error",
      restarters_sync_error: error,
    });
    return {status: "Error", error};
  }

  try {
    await deps.hubspot.updateTicket(ticket.id, {
      restarters_device_id: String(deviceId),
      restarters_event_id: String(eventId),
      restarters_sync_status: "Synced",
      restarters_sync_error: "",
    });
  } catch (err) {
    // The device exists on Restarters but the ticket doesn't know its id.
    // Resyncing would create a duplicate, so a host has to fix this by hand.
    console.error(
      `Restarters device ${deviceId} created for ticket ${ticket.id}, ` +
        "but saving the id to HubSpot failed",
      err,
    );
    return {
      status: "Error",
      error: `Saved to Restarters as device ${deviceId}, but couldn't store ` +
        "the id on the ticket. Add it to Restarters Device ID by hand.",
    };
  }
  return {status: "Synced", deviceId, eventId};
};

// Delete the device from Restarters and clear its id, so the next sync
// creates a fresh record.
export const removeFromRestarters = async (deps: SyncDeps, ticket: Ticket) => {
  const deviceId = Number(ticket.properties.restarters_device_id);
  if (deviceId) {
    try {
      await deps.restarters.deleteDevice(deviceId);
    } catch (err) {
      if (!(err instanceof RestartersError && err.status === 404)) throw err;
    }
  }
  await deps.hubspot.updateTicket(ticket.id, {
    restarters_device_id: "",
    restarters_sync_status: "Not synced",
    restarters_sync_error: "",
  });
};

const recordOnTicket = async (
  deps: SyncDeps,
  id: string,
  properties: Properties,
) => {
  try {
    await deps.hubspot.updateTicket(id, properties);
  } catch (err) {
    console.error(`Couldn't record sync result on ticket ${id}`, err);
  }
};

const describe = (err: unknown) => {
  if (err instanceof SyncProblem) return err.message;
  if (err instanceof RestartersError) {
    return `Restarters said: ${err.message}`;
  }
  console.error("Restarters sync failed", err);
  return "Couldn't reach Restarters. Try Resync later.";
};
