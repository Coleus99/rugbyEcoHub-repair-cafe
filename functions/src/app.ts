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
import {londonDate, londonMidnight, type Restarters} from "./restarters";
import {upcomingSessions, type UpcomingSession} from "./sessions";
import {
  keyAllows,
  signTicketKey,
  TICKET_KEY_HOURS,
  verifyTicketKey,
} from "./ticketKey";
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
  "repair_printed_at",
  "repair_checked_in_at",
  "repair_queue_number",
  "repair_item_fixer_attachments",
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
  // Set when rebooking a Needs follow-up item for a later session.
  "requested_repair_date",
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

// Someone who can be picked as the fixer. signedUp: confirmed on
// Restarters for the current or next session.
export type Fixer = {value: string; label: string; signedUp: boolean};

// "Martin B" in HubSpot and "Martin Bryant" on Restarters are the same
// person: same first name, and the HubSpot surname (or initial) starts the
// Restarters one.
export const sameFixer = (option: string, fullName: string) => {
  const words = (s: string) =>
    s.toLowerCase().replace(/\./g, "").split(/\s+/).filter(Boolean);
  const [a, b] = [words(option), words(fullName)];
  if (a.join(" ") === b.join(" ")) return true;
  if (a.length < 2 || b.length < 2 || a[0] !== b[0]) return false;
  return b[b.length - 1].startsWith(a[a.length - 1]);
};

// Signed-up volunteers first, using the HubSpot option where there is one
// so past tickets still match, then the other HubSpot options. Each group
// is in alphabetical order.
export const mergeFixers = (
  signedUp: string[], options: PropertyOption[],
): Fixer[] => {
  const used = new Set<string>();
  const first = signedUp.map((name) => {
    const option = options.find((o) =>
      !used.has(o.value) && sameFixer(o.label, name));
    if (option) {
      used.add(option.value);
      return {value: option.value, label: option.label, signedUp: true};
    }
    return {value: name, label: name, signedUp: true};
  });
  const rest = options.filter((o) => !used.has(o.value) &&
    !first.some((f) => f.value === o.value));
  const byLabel = (a: {label: string}, b: {label: string}) =>
    a.label.localeCompare(b.label, "en-GB", {sensitivity: "base"});
  return [
    ...first.sort(byLabel),
    ...rest.map((o) => ({...o, signedUp: false})).sort(byLabel),
  ];
};

export type AppDeps = {
  // Called per request, because secrets are only readable at runtime.
  hubspot: () => HubSpot;
  pipelineId: () => string;
  restarters: () => Restarters;
  syncConfig: () => SyncConfig;
  verifyToken: (token: string) => Promise<unknown>;
  metaCacheMs?: number;
  now?: () => Date;
  // Signs the ticket keys in job sheet QR codes. Blank turns them off.
  ticketKeySecret?: () => string;
};

// The group's most recent repair session (Restarters event) up to today.
export type Session = {id: number; date: string; start: string; title: string};

// How far ahead to look for sessions to rebook a Needs follow-up item.
// Restarters usually lists about four weeks ahead. Anything it has within
// this window is offered.
export const REBOOK_WEEKS = 8;

// How far back "Also search completed" looks.
export const COMPLETED_DAYS = 90;

// Fixer attachments: photos or documents added from the ticket page. The
// file property holds HubSpot file ids separated by semicolons.
export const ATTACHMENTS = "repair_item_fixer_attachments";
export const ATTACHMENT_FOLDER = "/repair-cafe/fixer-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export const attachmentIds = (value: string | null | undefined) =>
  (value ?? "").split(";").map((id) => id.trim()).filter(Boolean);

/** A 4xx we raise ourselves, with a message for the volunteer. */
class BadRequest extends HubSpotError {}

export const createApp = (deps: AppDeps) => {
  const app = express();
  app.use(express.json());

  // Pipeline stages and dropdown options rarely change, so cache them
  // rather than asking HubSpot on every page load.
  let metaCache: {value: Meta; expires: number} | undefined;
  const getMeta = async (fresh = false): Promise<Meta> => {
    if (!fresh && metaCache && metaCache.expires > Date.now()) {
      return metaCache.value;
    }
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

  const nowMs = () => (deps.now?.() ?? new Date()).getTime();

  // Every /api route needs a valid Firebase ID token, or a ticket key from
  // a job sheet's QR code, which only opens that one ticket.
  app.use(async (req, res, next) => {
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Ticket ")) {
      const check = verifyTicketKey(
        deps.ticketKeySecret?.() ?? "", header.slice(7), nowMs(),
      );
      if (!check.ok) {
        res.status(401).json({error: check.reason === "expired" ?
          "This QR code has expired. Sign in, or reprint the job sheet." :
          "This QR code isn't valid. Sign in to open the ticket."});
        return;
      }
      if (!keyAllows(check.ticketId, req.method, req.path)) {
        res.status(403).json({error: "Sign in to do that."});
        return;
      }
      next();
      return;
    }
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

  // Volunteers signed up on Restarters for today's session, or the next
  // one if there's none today. Cached for 10 minutes. If Restarters can't
  // be reached, nobody is marked as signed up and the HubSpot list is used.
  // fresh skips the cache, for the list's Refresh button.
  let signUpCache: {value: string[]; expires: number} | undefined;
  const signedUp = async (fresh = false): Promise<string[]> => {
    if (!fresh && signUpCache && signUpCache.expires > Date.now()) {
      return signUpCache.value;
    }
    let value: string[] = [];
    try {
      const today = londonDate(deps.now?.() ?? new Date());
      const end = new Date(`${today}T12:00:00Z`);
      end.setUTCDate(end.getUTCDate() + REBOOK_WEEKS * 7);
      const restarters = deps.restarters();
      const events = await restarters.eventsBetween(
        deps.syncConfig().groupId, today, end.toISOString().slice(0, 10));
      const next = [...events]
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
      if (next) value = await restarters.eventVolunteers(next.id);
    } catch (err) {
      console.warn("Couldn't read Restarters sign-ups", err);
      return [];
    }
    signUpCache = {value, expires: Date.now() + 10 * 60 * 1000};
    return value;
  };
  const getFixers = async () => mergeFixers(
    await signedUp(), (await getMeta()).options.repair_fixer ?? [],
  );

  // ?fresh=1 re-reads HubSpot and Restarters instead of using the cached
  // copies, so a late sign-up shows as soon as someone presses Refresh.
  app.get("/api/meta", async (req, res) => {
    const fresh = req.query.fresh === "1";
    const [meta, names] = await Promise.all([
      getMeta(fresh), signedUp(fresh),
    ]);
    const fixers = mergeFixers(names, meta.options.repair_fixer ?? []);
    res.json({...meta, fixers});
  });

  // Sessions a Needs follow-up item can be rebooked for: the group's
  // upcoming Restarters events. Empty if Restarters can't be reached.
  let upcomingCache: {value: UpcomingSession[]; expires: number} | undefined;
  app.get("/api/sessions/upcoming", async (_req, res) => {
    if (!upcomingCache || upcomingCache.expires <= Date.now()) {
      const today = londonDate(deps.now?.() ?? new Date());
      const end = new Date(`${today}T12:00:00Z`);
      end.setUTCDate(end.getUTCDate() + REBOOK_WEEKS * 7);
      let events: Awaited<ReturnType<Restarters["eventsBetween"]>> = [];
      try {
        events = await deps.restarters().eventsBetween(
          deps.syncConfig().groupId, today, end.toISOString().slice(0, 10),
        );
      } catch (err) {
        console.warn("Couldn't read upcoming Restarters events", err);
      }
      upcomingCache = {
        value: upcomingSessions(events, today),
        expires: Date.now() + 10 * 60 * 1000,
      };
    }
    res.json({sessions: upcomingCache.value});
  });

  // The latest session changes at most once a week, so cache it briefly.
  // If Restarters can't be reached, carry on without it.
  let sessionCache: {value: Session | null; expires: number} | undefined;
  const latestSession = async (): Promise<Session | null> => {
    if (sessionCache && sessionCache.expires > Date.now()) {
      return sessionCache.value;
    }
    let value: Session | null = null;
    try {
      const today = londonDate(deps.now?.() ?? new Date());
      const event = await deps.restarters().latestEventOnOrBefore(
        deps.syncConfig().groupId, today,
      );
      if (event) {
        value = {
          id: event.id,
          start: event.start,
          title: event.title,
          date: londonDate(new Date(event.start)),
        };
      }
    } catch (err) {
      console.warn("Couldn't look up the latest Restarters session", err);
      return null;
    }
    sessionCache = {value, expires: Date.now() + 10 * 60 * 1000};
    return value;
  };

  const syncDeps = (): SyncDeps => ({
    hubspot: deps.hubspot(),
    restarters: deps.restarters(),
    config: deps.syncConfig(),
    categoryLabel: async (value) =>
      (await getMeta()).options.restarters_category
        ?.find((o) => o.value === value)?.label,
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
    const session = await latestSession();
    if (closed.length === 0) {
      res.json({tickets: [], days: COMPLETED_DAYS, session});
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
      session,
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
    const {stages} = await getMeta();
    if (stage !== undefined && !stages.some((s) => s.id === stage)) {
      throw new BadRequest(400, `Unknown status: ${stage}`);
    }
    const isOpen = (id?: string | null) =>
      stages.find((s) => s.id === id)?.open ?? true;

    // 404 if it isn't a repair ticket.
    const before = await getRepairTicket(deps, id);
    // A volunteer signed up on Restarters but not yet in HubSpot's Fixer
    // list: add them, so HubSpot accepts the name. Other names are left
    // for HubSpot to reject.
    const fixer = properties.repair_fixer;
    const options = (await getMeta()).options.repair_fixer ?? [];
    if (fixer && !options.some((o) => o.value === fixer)) {
      const match = (await getFixers())
        .find((f) => f.signedUp && f.value === fixer);
      if (match) {
        await deps.hubspot().addPropertyOption("repair_fixer",
          {label: match.label, value: match.value});
        metaCache = undefined;
      }
    }
    // Keep a record of everyone who's been assigned the item.
    if (properties.repair_fixer) {
      properties.repair_fixers = addFixer(
        before.properties.repair_fixers, properties.repair_fixer,
      );
    }
    await deps.hubspot().updateTicket(id, properties);
    // Closed after the session, e.g. typed up from paper sheets the next
    // day: date it to the session it happened at. HubSpot sets
    // closed_date when the stage changes, so this comes after.
    const wasOpen = isOpen(before.properties.hs_pipeline_stage);
    if (stage && !isOpen(stage) && wasOpen) {
      const session = await latestSession();
      const today = londonDate(deps.now?.() ?? new Date());
      if (session && session.date < today) {
        await deps.hubspot().updateTicket(id, {closed_date: session.start});
      }
    }
    let ticket = await getRepairTicket(deps, id);
    const sync = await syncTicket(syncDeps(), ticket);
    if (sync.status !== "Skipped") ticket = await getRepairTicket(deps, id);
    res.json({...(await withName(ticket)), sync});
  });

  // A key for the job sheet's QR code, so a fixer can open this ticket
  // by scanning it, without signing in, for the next few hours.
  app.post("/api/tickets/:id/key", async (req, res) => {
    const id = req.params.id as string;
    const secret = deps.ticketKeySecret?.() ?? "";
    await getRepairTicket(deps, id); // 404 if it isn't a repair ticket
    if (!secret) {
      res.json({key: null});
      return;
    }
    const expires = nowMs() + TICKET_KEY_HOURS * 60 * 60 * 1000;
    res.json({key: signTicketKey(secret, id, expires), expires});
  });

  // Check a visitor in at reception, with or without printing a job sheet.
  // An item that hasn't been checked in yet, or a returning one (More time
  // needed), gets the time and the next number in today's queue. A
  // returning item also goes back to New with no fixer, so it's assigned
  // like any new arrival. { printed: true } also records the first print.
  // Anything else (e.g. a reprint) changes nothing. Doesn't sync to
  // Restarters.
  const checkIn = async (id: string, printed: boolean) => {
    const {stages} = await getMeta();
    const before = await getRepairTicket(deps, id);
    const p = before.properties;
    const now = deps.now?.() ?? new Date();
    const changes: Properties = {};
    if (printed && !p.repair_printed_at) {
      changes.repair_printed_at = now.toISOString();
    }
    const returning = p.repair_next_steps === "More time needed" &&
      stages.some((s) => s.id === p.hs_pipeline_stage && s.open &&
        s.restartersStatus);
    const neverCheckedIn = !p.repair_checked_in_at && !p.repair_printed_at;
    if (neverCheckedIn || returning) {
      // The number restarts at 1 each day: it counts today's check-ins only.
      // Two hosts checking in within the same second could get the same
      // number. That's rare and the whiteboard sorts it out.
      const since = londonMidnight(londonDate(now));
      const today = await deps.hubspot().countTickets([inPipeline(), {
        propertyName: "repair_checked_in_at", operator: "GTE",
        value: String(since),
      }]);
      changes.repair_checked_in_at = now.toISOString();
      changes.repair_queue_number = String(today + 1);
      if (returning) {
        changes.hs_pipeline_stage = stages[0]?.id ?? "";
        changes.repair_fixer = "";
      }
    }
    if (Object.keys(changes).length === 0) return before;
    await deps.hubspot().updateTicket(id, changes);
    return getRepairTicket(deps, id);
  };

  app.post("/api/tickets/:id/checkin", async (req, res) => {
    const ticket = await checkIn(req.params.id as string,
      req.body?.printed === true);
    res.json(await withName(ticket));
  });

  // Older pages call this after printing. Same as checkin with printed.
  app.post("/api/tickets/:id/printed", async (req, res) => {
    const ticket = await checkIn(req.params.id as string, true);
    res.json({
      printedAt: ticket.properties.repair_printed_at,
      ...(await withName(ticket)),
    });
  });

  // The ticket's fixer attachments, with short-lived links to view them.
  // A file that's been deleted in HubSpot is left out.
  app.get("/api/tickets/:id/attachments", async (req, res) => {
    const ticket = await getRepairTicket(deps, req.params.id as string);
    const hubspot = deps.hubspot();
    const links = await Promise.all(
      attachmentIds(ticket.properties[ATTACHMENTS]).map((id) =>
        hubspot.fileLink(id).catch((err) => {
          console.warn(`Couldn't get a link for file ${id}`, err);
          return null;
        })),
    );
    res.json({attachments: links.filter(Boolean)});
  });

  // Add one file. The body is the raw file, and ?name= its file name.
  // Uploaded to HubSpot as private, then added to the ticket's property.
  app.post("/api/tickets/:id/attachments",
    express.raw({type: () => true, limit: MAX_ATTACHMENT_BYTES}),
    async (req, res) => {
      const id = req.params.id as string;
      // Cloud Functions reads the body before Express does. Use its copy.
      const raw = req as Request & {rawBody?: Buffer};
      const data = Buffer.isBuffer(req.body) ? req.body : raw.rawBody;
      if (!data || data.length === 0) throw new BadRequest(400, "No file sent");
      if (data.length > MAX_ATTACHMENT_BYTES) {
        throw new BadRequest(400, "That file is too big. The limit is 10 MB.");
      }
      const name = safeFileName(String(req.query.name ?? ""));
      const ticket = await getRepairTicket(deps, id);
      const ids = attachmentIds(ticket.properties[ATTACHMENTS]);
      if (ids.length >= MAX_ATTACHMENTS) {
        throw new BadRequest(400,
          `This ticket already has ${MAX_ATTACHMENTS} attachments.`);
      }
      const hubspot = deps.hubspot();
      let fileId: string;
      try {
        fileId = await hubspot.uploadFile(
          `${ATTACHMENT_FOLDER}/${id}`, name, data);
      } catch (err) {
        if (err instanceof HubSpotError && err.status === 403) {
          throw new BadRequest(400, "HubSpot won't accept files yet. " +
            "The service key needs the \"files\" scope.");
        }
        throw err;
      }
      await hubspot.updateTicket(id, {
        [ATTACHMENTS]: [...ids, fileId].join(";"),
      });
      res.json(await withName(await getRepairTicket(deps, id)));
    });

  // Take a file off the ticket. The file stays in HubSpot's file manager.
  app.delete("/api/tickets/:id/attachments/:fileId", async (req, res) => {
    const id = req.params.id as string;
    const fileId = req.params.fileId as string;
    const ticket = await getRepairTicket(deps, id);
    const ids = attachmentIds(ticket.properties[ATTACHMENTS]);
    if (!ids.includes(fileId)) {
      throw new BadRequest(404, "That file isn't on this ticket");
    }
    await deps.hubspot().updateTicket(id, {
      [ATTACHMENTS]: ids.filter((f) => f !== fileId).join(";"),
    });
    res.json(await withName(await getRepairTicket(deps, id)));
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

// Letters, numbers, spaces and a few marks, so the name is safe as a
// HubSpot file name. Keeps the extension, which HubSpot uses for the type.
export const safeFileName = (name: string) => {
  const cleaned = name.normalize("NFKD").replace(/[^\w .()-]+/g, "")
    .replace(/\s+/g, " ").trim().slice(-100);
  return cleaned.replace(/^\.+/, "") || "attachment";
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
