import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  HubSpotError,
  type HubSpot,
  type Pipeline,
  type Filter,
  type Properties,
  type PropertyOption,
  type Ticket,
} from "./hubspot";
import type {Restarters} from "./restarters";
import {
  removeFromRestarters,
  syncTicket,
  type SyncConfig,
  type SyncDeps,
} from "./sync";

// Properties the app reads from a ticket.
export const READ_PROPERTIES = [
  "subject",
  "content",
  "hs_pipeline",
  "hs_pipeline_stage",
  "createdate",
  "closed_date",
  "requested_repair_date",
  "restarters_category",
  "repair_item_type",
  "repair_item_brand",
  "repair_item_model",
  "repair_item_year_made",
  "repair_item_weight_kg",
  "repair_problem_and_fix",
  "repair_notes",
  "repair_spare_parts",
  "repair_next_steps",
  "repair_barrier",
  "repair_fixer",
  "repair_fixers",
  "restarters_device_id",
  "restarters_event_id",
  "restarters_sync_status",
  "restarters_sync_error",
];

// Properties volunteers can change. Restarters ids are set by the sync only.
export const EDITABLE_PROPERTIES = [
  "subject",
  "content",
  "hs_pipeline_stage",
  "restarters_category",
  "repair_item_type",
  "repair_item_brand",
  "repair_item_model",
  "repair_item_year_made",
  "repair_item_weight_kg",
  "repair_problem_and_fix",
  "repair_notes",
  "repair_spare_parts",
  "repair_next_steps",
  "repair_barrier",
  "repair_fixer",
];

// Dropdowns in the edit form.
export const OPTION_PROPERTIES = [
  "restarters_category",
  "repair_spare_parts",
  "repair_next_steps",
  "repair_barrier",
  "repair_fixer",
];

export type Meta = {
  // restartersStatus is set for stages that sync (Fixed, Repairable...).
  stages: {
    id: string;
    label: string;
    open: boolean;
    restartersStatus: string | null;
  }[];
  options: Record<string, PropertyOption[]>;
};

export type AppDeps = {
  // Called per request, because secrets are only readable at runtime.
  hubspot: () => HubSpot;
  pipelineId: () => string;
  restarters: () => Restarters;
  syncConfig: () => SyncConfig;
  verifyToken: (token: string) => Promise<unknown>;
  metaCacheMs?: number;
};

// How far back "Include completed" looks.
export const COMPLETED_DAYS = 90;

/** A 4xx we raise ourselves, with a message for the volunteer. */
class BadRequest extends HubSpotError {}

export const createApp = (deps: AppDeps) => {
  const app = express();
  app.use(express.json());

  // Pipeline stages and dropdown options rarely change, so cache them
  // rather than asking HubSpot on every page load.
  let metaCache: {value: Meta; expires: number} | undefined;
  const getMeta = async (): Promise<Meta> => {
    if (metaCache && metaCache.expires > Date.now()) return metaCache.value;
    const hubspot = deps.hubspot();
    const [pipeline, options] = await Promise.all([
      hubspot.getPipeline(deps.pipelineId()),
      hubspot.getPropertyOptions(OPTION_PROPERTIES),
    ]);
    const value = {
      stages: toStages(pipeline, deps.syncConfig().stageStatus),
      options,
    };
    metaCache = {value, expires: Date.now() + (deps.metaCacheMs ?? 300_000)};
    return value;
  };

  // Every /api route needs a valid Firebase ID token.
  app.use(async (req, res, next) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      res.status(401).json({error: "Not signed in"});
      return;
    }
    try {
      await deps.verifyToken(token);
    } catch {
      res.status(401).json({error: "Invalid sign-in"});
      return;
    }
    next();
  });

  app.get("/api/meta", async (_req, res) => {
    res.json(await getMeta());
  });

  const syncDeps = (): SyncDeps => ({
    hubspot: deps.hubspot(),
    restarters: deps.restarters(),
    config: deps.syncConfig(),
  });

  // First names are a nice-to-have. If the HubSpot key can't read contacts,
  // show tickets without them rather than failing.
  const firstNames = async (ids: string[]) => {
    try {
      return await deps.hubspot().firstNames(ids);
    } catch (err) {
      console.warn("Couldn't read contact first names", err);
      return {} as Record<string, string>;
    }
  };

  const inPipeline = (): Filter => ({
    propertyName: "hs_pipeline", operator: "EQ", value: deps.pipelineId(),
  });

  // Open tickets in the repair pipeline, in stage order, newest booking
  // first within each stage. Also says how many tickets failed to sync, so
  // the app only shows Resync failed when there's something to retry.
  app.get("/api/tickets", async (_req, res) => {
    const {stages} = await getMeta();
    const open = stages.filter((s) => s.open).map((s) => s.id);
    const hubspot = deps.hubspot();
    const [tickets, failedSyncs] = await Promise.all([
      open.length === 0 ? [] : hubspot.searchTickets([
        inPipeline(),
        {propertyName: "hs_pipeline_stage", operator: "IN", values: open},
      ], READ_PROPERTIES),
      hubspot.countTickets([inPipeline(), {
        propertyName: "restarters_sync_status", operator: "EQ", value: "Error",
      }]),
    ]);
    const order = (t: {properties: Properties}) =>
      open.indexOf(t.properties.hs_pipeline_stage ?? "");
    tickets.sort((a, b) =>
      order(a) - order(b) ||
      compare(bookingDate(b.properties), bookingDate(a.properties)) ||
      compare(b.properties.createdate, a.properties.createdate),
    );
    const names = await firstNames(tickets.map((t) => t.id));
    res.json({
      tickets: tickets.map((t) => toDto(t, names[t.id])),
      failedSyncs,
    });
  });

  // Tickets completed in the last COMPLETED_DAYS days, newest first, so a
  // volunteer can fix a wrong outcome or add notes. Must be registered
  // before /api/tickets/:id.
  app.get("/api/tickets/completed", async (_req, res) => {
    const {stages} = await getMeta();
    const closed = stages.filter((s) => !s.open).map((s) => s.id);
    if (closed.length === 0) {
      res.json({tickets: []});
      return;
    }
    const since = Date.now() - COMPLETED_DAYS * 24 * 60 * 60 * 1000;
    const tickets = await deps.hubspot().searchTickets([
      inPipeline(),
      {propertyName: "hs_pipeline_stage", operator: "IN", values: closed},
      {propertyName: "closed_date", operator: "GTE", value: String(since)},
    ], READ_PROPERTIES);
    tickets.sort((a, b) =>
      compare(b.properties.closed_date, a.properties.closed_date));
    const names = await firstNames(tickets.map((t) => t.id));
    res.json({
      tickets: tickets.map((t) => toDto(t, names[t.id])),
      days: COMPLETED_DAYS,
    });
  });

  app.get("/api/tickets/:id", async (req, res) => {
    const ticket = await getRepairTicket(deps, req.params.id as string);
    res.json(await withName(ticket));
  });

  const withName = async (ticket: Ticket) => {
    const names = await firstNames([ticket.id]);
    return {ticket: toDto(ticket, names[ticket.id])};
  };

  // Save changes to HubSpot, then sync to Restarters if the ticket is at a
  // stage that maps to a Restarters status. Only editable properties are
  // accepted.
  app.patch("/api/tickets/:id", async (req, res) => {
    const id = req.params.id as string;
    const properties = parseEdits(req.body?.properties);

    const stage = properties.hs_pipeline_stage;
    if (stage !== undefined) {
      const {stages} = await getMeta();
      if (!stages.some((s) => s.id === stage)) {
        throw new BadRequest(400, `Unknown status: ${stage}`);
      }
    }

    // 404 if it isn't a repair ticket.
    const before = await getRepairTicket(deps, id);
    // Keep a record of everyone who's been assigned the item.
    if (properties.repair_fixer) {
      properties.repair_fixers = addFixer(
        before.properties.repair_fixers, properties.repair_fixer,
      );
    }
    await deps.hubspot().updateTicket(id, properties);
    let ticket = await getRepairTicket(deps, id);
    const sync = await syncTicket(syncDeps(), ticket);
    if (sync.status !== "Skipped") ticket = await getRepairTicket(deps, id);
    res.json({...(await withName(ticket)), sync});
  });

  // Sync one ticket now, e.g. after fixing the cause of an error.
  app.post("/api/tickets/:id/sync", async (req, res) => {
    const id = req.params.id as string;
    const sync = await syncTicket(syncDeps(), await getRepairTicket(deps, id));
    res.json({...(await withName(await getRepairTicket(deps, id))), sync});
  });

  // Delete the Restarters device and clear its id on the ticket.
  app.delete("/api/tickets/:id/restarters", async (req, res) => {
    const id = req.params.id as string;
    await removeFromRestarters(syncDeps(), await getRepairTicket(deps, id));
    res.json(await withName(await getRepairTicket(deps, id)));
  });

  // Retry every ticket whose last sync failed. One at a time, to stay well
  // inside both APIs' rate limits.
  app.post("/api/sync", async (_req, res) => {
    const failed = await deps.hubspot().searchTickets([
      {propertyName: "hs_pipeline", operator: "EQ", value: deps.pipelineId()},
      {propertyName: "restarters_sync_status", operator: "EQ", value: "Error"},
    ], READ_PROPERTIES);
    const results = [];
    for (const ticket of failed) {
      const sync = await syncTicket(syncDeps(), ticket);
      results.push({id: ticket.id, subject: ticket.properties.subject, sync});
    }
    res.json({
      retried: results.length,
      synced: results.filter((r) => r.sync.status === "Synced").length,
      results,
    });
  });

  // Turn errors into JSON. HubSpot's 400s (e.g. a bad dropdown value) and
  // 404s pass through. Anything else is a 502 with details in the log.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof HubSpotError && (err.status === 400 ||
      err.status === 404)) {
      res.status(err.status).json({error: err.message});
      return;
    }
    console.error(err);
    res.status(502).json({error: "Couldn't reach HubSpot. Try again."});
  });

  return app;
};

const toStages = (
  pipeline: Pipeline,
  stageStatus: Record<string, string>,
): Meta["stages"] =>
  [...pipeline.stages]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => ({
      id: s.id,
      label: s.label,
      open: s.metadata.ticketState === "OPEN",
      restartersStatus: stageStatus[s.id] ?? null,
    }));

// The date the customer asked for. In-person bookings have none, so use
// the day the ticket was created.
const bookingDate = (p: Properties) =>
  p.requested_repair_date || p.createdate?.slice(0, 10) || null;

const compare = (a: string | null, b: string | null) => {
  if (a === b) return 0;
  if (!a) return 1; // blanks last
  if (!b) return -1;
  return a < b ? -1 : 1;
};

// "Paul F; Pete N" plus a name, without repeats.
export const addFixer = (list: string | null, name: string) => {
  const names = (list ?? "").split(";").map((n) => n.trim()).filter(Boolean);
  if (!names.includes(name)) names.push(name);
  return names.join("; ");
};

// What the web app gets: the properties it uses, plus the contact's first
// name. No other contact details leave HubSpot.
const toDto = (t: Ticket, firstName?: string) => {
  const properties: Properties = {};
  for (const name of READ_PROPERTIES) {
    properties[name] = t.properties[name] ?? null;
  }
  return {id: t.id, firstName: firstName ?? null, properties};
};

// Fetch a ticket, and 404 if it's in another pipeline. Stops the app
// being used to read or edit unrelated help desk tickets.
const getRepairTicket = async (deps: AppDeps, id: string) => {
  if (!/^\d+$/.test(id)) throw new BadRequest(404, "Ticket not found");
  const ticket = await deps.hubspot().getTicket(id, READ_PROPERTIES);
  if (ticket.properties.hs_pipeline !== deps.pipelineId()) {
    throw new BadRequest(404, "Ticket not found");
  }
  return ticket;
};

// Check the request body and return HubSpot-ready values.
// null and "" both clear a property.
export const parseEdits = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequest(400, "Send { properties: { ... } }");
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) throw new BadRequest(400, "Nothing to save");

  const unknown = entries
    .map(([name]) => name)
    .filter((name) => !EDITABLE_PROPERTIES.includes(name));
  if (unknown.length) {
    throw new BadRequest(400, `Can't edit: ${unknown.join(", ")}`);
  }

  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (value === null) out[name] = "";
    else if (typeof value === "string") out[name] = value.trim();
    else if (typeof value === "number" && Number.isFinite(value)) {
      out[name] = String(value);
    } else throw new BadRequest(400, `Invalid value for ${name}`);
  }
  if (out.subject === "") throw new BadRequest(400, "Item name is required");
  if (out.hs_pipeline_stage === "") {
    throw new BadRequest(400, "Status is required");
  }
  return out;
};
