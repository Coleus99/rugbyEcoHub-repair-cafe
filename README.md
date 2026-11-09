# Rugby Eco Hub Repair Cafe

A tool for running the Repair Cafe at Rugby Eco Hub. Customers book items in through a HubSpot form, which creates a ticket. Volunteers work from a web app that lists open tickets, prints a paper form with a QR code for each item, and records the repair. When a repair is complete, the details are sent to [Restarters](https://restarters.net) so they count towards the group's repair stats.

Status: API exploration done. HubSpot ticket properties and the booking form exist in the sandbox. Firebase is set up and the app is scaffolded (Vite web app, one `api` function, emulators working). The ticket pages and HubSpot and Restarters calls aren't built yet. See [Next steps](#next-steps).

## How it will work

1. **Customer books an item in** using the HubSpot form. They can use the Eco Hub tablet or laptop, scan a QR code on their phone, or fill in a paper form that a host types up. This creates a ticket.
2. **Host accepts the item.** They open the ticket in the app, check the details and print it, either as an A4 form or a Dymo label. The printout has a QR code that links back to the ticket. The paper copy is the backup if the app is down.
3. **Host assigns a fixer** (optional).
4. **Fixer repairs the item**, scans the QR code and records the outcome. They can also pass it to another fixer.
5. **Completed items sync to Restarters automatically.** The returned Restarters device id is stored on the ticket so the record can be edited or deleted later.

The app shows a clickable list of tickets sorted by status. Each ticket opens to its details and an update form.

## Architecture

```
Customer ──► HubSpot form ──► HubSpot ticket
                                   ▲
Volunteer ──► Web app (Vite + React, Firebase Auth, Firebase Hosting)
                 │  /api/** with Firebase ID token
                 ▼
              Cloud Functions (v2, Node 22)
                 │  verify login
                 │  HUBSPOT_TOKEN, RESTARTERS_TOKEN from Secret Manager
                 ├──► HubSpot CRM API (read and update tickets)
                 └──► Restarters API (create, update, delete devices)
```

- **No API token ever reaches the browser.** Every HubSpot and Restarters call goes through a Cloud Function. Tokens are stored with `defineSecret()`, not in `.env` files.
- The function only allows writes to the properties the form edits. It doesn't pass the browser's request body straight through.
- Restarters writes need the API token of a **host** account on the Repair Cafe Rugby group (group 116).
- Functions and Secret Manager need the Firebase **Blaze** plan. At Repair Cafe volumes the cost should be close to nothing, but set a budget alert.

### Stack decisions

- **Vite, not Create React App.** CRA was deprecated in February 2025 and no longer gets updates. Vite's `react-ts` template is the standard choice for a single-page app.
- **No Next.js.** Server rendering isn't needed and Firebase Hosting handles it awkwardly.
- **TypeScript in the web app and in the functions**, so the ticket and device types are defined once.
- **Two Firebase projects:** `repair-cafe-dev` (HubSpot sandbox) and `repair-cafe-prod` (live portal), set up as aliases in `.firebaserc`.
- **A Library of Things loan system may follow.** It should get its own repo and Firebase projects. Keep HubSpot logic in `functions/src/hubspot.ts` behind plain functions so that module can be copied across.

## Repo contents

| Path | What it is |
|---|---|
| `api/` | [Bruno](https://www.usebruno.com) collection for the Restarters and HubSpot APIs. Open it in Bruno with "Open Collection". |
| `api/.env` | Your tokens (gitignored). Copy `api/.env.example` to create it. |
| `docs/restarters_api/` | Restarters API notes, the routes file from their GitHub repo, the OpenAPI spec and real responses. Start with its [README](docs/restarters_api/README.md). |
| `docs/hubspot_api/` | Ticket property definitions and the response from creating them |
| `steps.md` | Original notes on the volunteer workflow |

To save responses from Bruno into `docs/`, switch the collection to Developer Mode. Any request with a `fixture` variable then writes its response body there.

### Restarters API: what we learned

The full detail is in [docs/restarters_api/README.md](docs/restarters_api/README.md). The parts that will catch you out:

- Writes need a **host** account's `api_token` as a query parameter.
- `category` must be one of the 47 Restarters category ids (6 to 52). `item_type` is required.
- `eventid` is required on update as well as on create.
- PATCH must be sent as form-urlencoded or JSON, not multipart.
- The response shape differs for each call, and `id` is a string in some responses. Use `Number(id)`.
- Upcoming events come from `GET /api/v2/groups/116/events?start=<date>`, with no token needed.

## HubSpot ticket properties

The live portal already has a repair form that creates tickets. The new form keeps the properties that already match Restarters and adds the rest. All the new ones are in the `repair_cafe_info` group.

| Field | Property | Restarters field | Status |
|---|---|---|---|
| Repair item name | `subject` | none | Existing, HubSpot default |
| Repair item issue | `content` | none | Existing, HubSpot default |
| Brand | `repair_item_brand` | `brand` | Existing |
| Year made | `repair_item_year_made` | `age` (event year minus year made, 0 if blank) | Existing |
| Requested date | `requested_repair_date` | none | Existing. Filled by the date dropdown script. For host planning only. |
| Image | `repair_item_image` | `images` | Existing. Not synced yet. |
| Category | `restarters_category` | `category` | **New.** Replaces `repair_item_category`. |
| Item type | `repair_item_type` | `item_type` (required) | **New.** Filled in from the category when the ticket syncs. Only asked for (in the app and on the job sheet) for the Misc categories. |
| Model | `repair_item_model` | `model` | **New** |
| Weight (kg) | `repair_item_weight_kg` | `estimate` | **New.** Only asked for and sent for the Misc categories (46, 50). Restarters uses its own average weight for the rest. |
| Problem and fix | `repair_problem_and_fix` | `problem` | **New** |
| Notes | `repair_notes` | `notes` | **New** |
| Outcome | pipeline stage (`hs_pipeline_stage`) | `repair_status` | Set from the stage. `repair_outcome` exists but isn't used (see [Decisions](#decisions)). |
| Spare parts | `repair_spare_parts` | `spare_parts` | **New** |
| Next steps | `repair_next_steps` | `next_steps` | **New** |
| Barrier | `repair_barrier` | `barrier` | **New** |
| Fixer | `repair_fixer` (dropdown, current fixer) and `repair_fixers` (text, everyone assigned so far, added to by the app) | none | **New** (sandbox 8 November 2026, via `api/hubspot/create-fixer-properties.bru`). Add or remove fixers by editing the `repair_fixer` options in HubSpot. No code change is needed. Each device remembers the last fixer saved on it (browser storage only) and fills it in on a ticket with no fixer as soon as another field is edited (not on open, so viewing or printing changes nothing). |
| Job sheet printed | `repair_printed_at` (date and time) | none | **New** (sandbox 9 November 2026, via `api/hubspot/create-printed-property.bru`). Set by the app the first time the job sheet is printed. Reprints keep the first time. See [Check-in](#check-in-printing-the-job-sheet). |
| Restarters ids | `restarters_device_id`, `restarters_event_id` | returned `id`, `eventid` | **New** |
| Sync status | `restarters_sync_status`, `restarters_sync_error` | none | **New** (sandbox 8 November 2026, via `api/hubspot/create-sync-properties.bru`). Set by the app. Options: Not synced, Synced, Error. |

The new properties exist in the **sandbox only**. For go-live, run Bruno's "Create ticket properties (new)" against the live portal. Don't run the two "(sandbox)" requests on live, because the live portal already has those properties.

HubSpot can't rename a property's internal name. Mark old properties as legacy by changing the label only, for example "Legacy: Repair Item Category".

## HubSpot ticket pipeline

The sandbox reuses the default help desk pipeline, renamed "Repair Cafe", id `0`. HubSpot makes it hard to point a help desk form at another pipeline, and live only uses one pipeline anyway. Response saved in [docs/hubspot_api/getRepairCafePipelineResponse.json](docs/hubspot_api/getRepairCafePipelineResponse.json).

| Stage | Id | State |
|---|---|---|
| New | `1` | Open |
| In Progress | `2` | Open |
| Needs follow-up | `6385083617` | Open |
| Repaired | `3` | Closed |
| Can't repair | `4` | Closed |
| Won't repair | `6385079534` | Closed |
| No show | `6385079535` | Closed |

The app lists tickets in the Open stages and reads stage names and open/closed from HubSpot, so stages can be renamed or added without code changes. Only the pipeline id is configured, in `functions/.env.<project id>` (`HUBSPOT_PIPELINE_ID`). The app won't read or edit tickets in other pipelines.

## Next steps

1. ~~Create the booking form in the HubSpot sandbox.~~ Done 8 November 2026, built in the HubSpot UI. `repair_item_type` was left off because customers wouldn't know what to put. The app fills it in (see [Decisions](#decisions)).
2. ~~Create the Firebase projects.~~ Done. `repair-cafe-dev` is on Blaze with `HUBSPOT_TOKEN` (sandbox key) and `RESTARTERS_TOKEN` stored as secrets. `repair-cafe-prod` exists with its web app registered. It stays on the free plan with no secrets until the proof of concept is approved.
3. ~~Scaffold the app.~~ Done. `web/` is Vite `react-ts`. `functions/` is TypeScript with one Express function, `api`, in `europe-west2`, which checks the Firebase ID token on every `/api` route. `firebase.json` rewrites `/api/**` to it.
4. ~~Finish local config and sign-in.~~ Done. `web/.env.development` and `web/.env.production` hold the public Firebase web config. Email sign-in, a route guard that returns you to the page you asked for, and placeholder pages are in place.
5. ~~List and edit tickets.~~ Done. `GET /api/meta` (stages and dropdown options, cached for 5 minutes), `GET /api/tickets` (open tickets by stage, then booked date), `GET /api/tickets/:id` and `PATCH /api/tickets/:id` (editable properties only, changed fields only). The web app has the ticket list and the edit form.
6. ~~Restarters sync.~~ Built, with unit tests. The client is tested against live Restarters (create, update, delete on the test event). The full save-and-sync flow still needs a manual end-to-end run (see [Testing the sync](#testing-the-sync)).
   - Saving a ticket always writes to HubSpot first. If its stage maps to a Restarters status (`RESTARTERS_STAGE_STATUS`), the device is then created, or updated if `restarters_device_id` is set. A device deleted on Restarters by hand is recreated.
   - The event is the stored `restarters_event_id`. Otherwise it's group 116's latest event on or before the day the ticket closed (`closed_date`, or today for open stages such as Needs follow-up). That's the day's session if it exists, otherwise the most recent one. Dev uses the test event in `RESTARTERS_EVENT_ID` instead.
   - The result goes on the ticket: `restarters_sync_status` and `restarters_sync_error`. Missing category, item type, barrier or next steps are caught before calling Restarters, with a message saying what to fill in.
   - `POST /api/tickets/:id/sync` (Resync now), `POST /api/sync` (retries every failed ticket. No longer used by the web app, kept for a possible scheduled retry) and `DELETE /api/tickets/:id/restarters` (Remove from Restarters).
7. ~~Print view.~~ A4 job sheet: condensed booking details, a QR code to the ticket page, write-in boxes, and tick boxes for outcome, spare parts, next steps and barrier. The Dymo label is still to do.
8. ~~Search.~~ Filters by item name, first name, fixer, short reference and category, with an option to include repairs completed in the last 90 days (see [Search](#search-in-the-browser-open-tickets-plus-recent-completed-ones)).
9. ~~Test against the sandbox.~~ Done 8 November 2026. Next, deploy to dev and try it on a phone, then prod.
10. **Go live:** see [Go-live checklist](#go-live-checklist).
11. Later: sync item images to Restarters. Move to individual logins if the shared one causes problems.

## Go-live checklist

Do these in order. Steps 1 to 5 are in HubSpot and Firebase, not code.

1. **Live HubSpot key.** Create the service key in the live portal with ticket read/write, `crm.objects.contacts.read`, `crm.schemas.tickets.write` (to create the properties) and forms read.
2. **Live properties.** Run the Bruno requests against live: `create-ticket-property-group`, `create-ticket-properties`, `create-sync-properties`, `create-fixer-properties` and `create-printed-property`. Relabel the old properties as "Legacy: …".
3. **Live pipeline.** Set up the stages to match the sandbox (New, In Progress, Needs follow-up, Repaired, Can't repair, Won't repair, No show), with Repaired, Can't repair, Won't repair and No show marked **Closed**. Point both booking forms (online and in-person) at it.
4. **Firebase prod project.** Upgrade `repair-cafe-prod` to Blaze with a budget alert. Give its default compute service account the Cloud Build role (see [Local development](#local-development), as for dev). Turn on Email/Password sign-in and add the user `repaircaferugby@gmail.com`.
5. **Secrets:** `firebase functions:secrets:set HUBSPOT_TOKEN --project prod`, then the same for `RESTARTERS_TOKEN`.
6. **Config.** Create `functions/.env.repair-cafe-prod` with `HUBSPOT_PIPELINE_ID`, `RESTARTERS_STAGE_STATUS` and `ALLOWED_EMAILS` using the live stage ids. Leave out `RESTARTERS_EVENT_ID` so items go on the real session. The live ids can be read with Bruno's pipeline request once the live key is in `api/.env`.
7. **Deploy:** `npm run deploy:prod`.
8. **Custom domain.** In the prod project, Hosting → Add custom domain → `repair.rugbyecohub.org`, then add the DNS records it gives at whoever manages rugbyecohub.org. Check the domain is listed under Authentication → Settings → Authorized domains. Job sheet QR codes use the address the page was opened on, so print from the new domain once it's live.
9. **Check:** sign in at `repair.rugbyecohub.org`, open a real ticket, print it, scan the QR code on a phone, then sync one item and check it appears on that session's Restarters event.

## Local development

You need Node 24 (the functions runtime) and the Firebase CLI. If you also use the CLI with another Google account, run `firebase login:use <rugby eco hub email>` in this folder.

```bash
npm run setup   # first time, or after pulling new dependencies
npm run dev
```

`npm run dev` builds the functions, then runs the three processes below in one terminal, each labelled and coloured (functions, emulators, web). The web app is at http://localhost:5173. Ctrl+C stops all three, and the emulators save their data on the way out. If you'd rather have them in separate terminals:

```bash
# Terminal 1: rebuild functions on save
npm --prefix functions run build:watch

# Terminal 2: emulators (Auth 9099, Functions 5001, Hosting 5002, UI 4000)
firebase emulators:start --only auth,functions,hosting --import=.emulator-data --export-on-exit

# Terminal 3: web app with hot reload on http://localhost:5173
npm --prefix web run dev
```

- Vite proxies `/api` to the Functions emulator, so the function sees the same `/api/...` paths as it does behind Hosting.
- In dev, the web app signs in against the Auth emulator (`web/src/lib/firebase.ts`). The login email is fixed to `repaircaferugby@gmail.com`, so create that user once in the emulator UI at http://127.0.0.1:4000. `--import/--export-on-exit` keeps it between runs (in `.emulator-data/`, gitignored). Restart the emulators after changing `functions/.env.*`.
- The function reads secrets from `functions/.secret.local` under the emulator (gitignored).
- The Hosting emulator uses port 5002 because macOS AirPlay Receiver uses 5000.
- Calls to HubSpot from the emulator go to the real sandbox portal, and calls to Restarters go to live Restarters. Use test tickets and a test event.

### Tests

| Command | What it checks | Needs |
|---|---|---|
| `npm --prefix functions test` | API routes and the HubSpot client, with HubSpot faked using the saved responses in `docs/hubspot_api/` | Nothing |
| `npm --prefix web test` | Form helpers (changed fields, item type suggestion) | Nothing |
| `npm --prefix functions run test:sandbox` | Pipeline, properties and dropdowns exist in the sandbox. Edits `repair_notes` on the test ticket, then puts it back. | `functions/.secret.local` |
| `npm --prefix functions run test:emulator` | Signs in to the Auth emulator and calls the running API end to end, including search. Read-only. | Emulators running |

| `npm --prefix functions run test:restarters` | Creates, updates and deletes one device on the test event. **Live Restarters**, so run it rarely. | `RESTARTERS_TOKEN` |
| `npm --prefix functions run seed:sandbox` | Not a test. Submits 10 example bookings through the real booking form and moves some along. Skips ones that exist. | Sandbox token |

The sandbox and emulator tests use ticket `448850507989`. If it's deleted, set `TEST_TICKET_ID`. Only `test:restarters` calls Restarters. The sandbox test's first-name check needs the HubSpot key to have `crm.objects.contacts.read`.

### Testing the sync

This writes to live Restarters, on the 7 November test event (19168). Remove the device afterwards.

1. Restart the emulators so they load `functions/.env.repair-cafe-dev`.
2. Open a seeded ticket, e.g. Headphones. Set the item type, problem and fix, and spare parts, then set Status to Repaired and save. The save message should say "Synced to Restarters (device …)".
3. Check the device on the event at https://restarters.net/party/view/19168.
4. Edit the problem and fix and save again. It should update the same device, not add one.
5. Try Can't repair with no barrier. It should save to HubSpot and show "Sync failed: Choose a barrier to repair." Pick a barrier, save, and it syncs.
6. Press Remove from Restarters. Check it's gone from the event.

Deploy to dev:

```bash
npm run deploy:dev
```

This builds the web app with the dev Firebase settings (`web/.env.development`) and deploys to `repair-cafe-dev`. It then switches off Cloud Run's own invoker check on the `api` function (see below), which needs `gcloud` signed in (`gcloud auth login --no-launch-browser`). A plain `npm --prefix web run build` uses the prod settings, so don't deploy that to dev. `npm run deploy:prod` does the same for prod.

If the functions deploy fails with "missing permission on the build service account", the project's default compute service account needs the Cloud Build role. New Google Cloud projects no longer give it one automatically. Run this once per project (the number is the project number, shown in the error's link and in Firebase project settings):

```bash
gcloud projects add-iam-policy-binding repair-cafe-dev \
  --member=serviceAccount:752138277359-compute@developer.gserviceaccount.com \
  --role=roles/cloudbuild.builds.builder
```

If the site loads but every API call fails with 401 and the function log says "The request was not authorized to invoke this service", Cloud Run is blocking the call before it reaches the app. Firebase normally makes functions public by granting `allUsers` the invoker role, but the rugbyecohub.org organisation policy only allows its own accounts, so that grant fails. The deploy scripts run this instead, which turns off Cloud Run's check for this one service:

```bash
gcloud run services update api --region=europe-west2 --project=repair-cafe-dev --no-invoker-iam-check
```

This is safe because the app checks every request itself: a valid Firebase sign-in from an account in `ALLOWED_EMAILS`, or 401.

### Layout

```
web/                    Vite React app
  src/pages/TicketList.tsx
  src/pages/TicketPage.tsx
  src/pages/TicketPrint.tsx
  src/lib/api.ts        fetch wrapper that adds the ID token
  src/lib/ticketForm.ts form helpers (tested)
functions/
  src/index.ts          wires secrets and config into the app
  src/app.ts            Express routes, validation, sign-in check
  src/hubspot.ts        HubSpot client
  src/restarters.ts     createDevice, updateDevice, deleteDevice, listEvents (to do)
  test/unit, test/sandbox, test/emulator
firebase.json
.firebaserc             dev and prod aliases
firestore.rules         deny all until needed
```

## Decisions

### Login: one shared account

All volunteers sign in with a single Firebase email/password account, `repaircaferugby@gmail.com`. The sign-in page has the email fixed, so volunteers only type the password, so getting started is easy. Changes are easy to correct if something goes wrong, and the paper forms are a backup. Individual logins (Firebase email link sign-in with an allowlist) are a later step if shared access causes conflicts.

Keep the risk down while it's shared:

- Use a long passphrase of three or four random words, and change it when a volunteer leaves.
- Show only first names and item details in the ticket list. Customer contact details are personal data under UK GDPR.
- Limit Restarters writes in the function to group 116's events and to device ids stored on our tickets.
- Self sign-up is switched off in both Firebase projects (Authentication > Settings > User actions > "Enable create (sign-up)"). Accounts are added by hand in the console.
- The API also only accepts the accounts listed in `ALLOWED_EMAILS` (in `functions/.env.<project id>`, default `repaircaferugby@gmail.com`). If sign-up is ever switched back on by mistake, a stranger could create an account but would get "Invalid sign-in" from every request. To add a volunteer's own login, add the user in the console, add their email to the list, and deploy the functions.
- Problem and fix, and Notes, are shared publicly on Restarters. The form says not to include names.
- App Check (blocking scripted requests) isn't set up. It's an option for later.

### In-person bookings have no date

The in-person booking form has no date field. Where `requested_repair_date` is blank, the app shows the date the ticket was created ("Added Sun 8 Nov 2026") and sorts by it. The open list puts the newest bookings first within each stage.

### Booking date: keep the 1st and 3rd Saturday script

[date-choice-1st-3rd-sat.js](date-choice-1st-3rd-sat.js) runs on the page that embeds the HubSpot form. It hides the `requested_repair_date` field and shows a dropdown of the next six 1st and 3rd Saturdays. Closed dates, such as around Christmas, go in its `dateExceptions` list. Events are regular enough that this is almost always right, and it avoids a separate job to keep the dates in sync with Restarters.

The requested date is only for planning. It lets the host see ahead of an event whether demand is high or specific tools are needed. Keep `dateExceptions` in step with Restarters, otherwise customers can book a cancelled Saturday.

### Restarters sync uses the latest session, and failures are retried

Fixers add items to the session that's running now. The sync uses group 116's latest Restarters event on or before the day the ticket was completed. That's today's session if it's on Restarters, otherwise the most recent one before it. It doesn't use the date the customer booked. A session missing from Restarters, or a date mix-up, doesn't stop the sync. The item lands on the previous session, and a host can move it on Restarters if needed.

Sync only fails if there's no event at all in the previous 6 months, if a required field is missing (category, item type, barrier or next steps), or if Restarters is down. The app still saves every change to HubSpot and marks the ticket's sync status as Error with the reason. The Done tab is marked "N errors" when there are failed syncs, and "Show only errors" lists just those. Each needs opening, since the fix is usually a missing field. Saving it, or Resync now, tries again. Each retried item is matched to the latest event up to the day it was completed, so an item fixed on Saturday and retried on Monday still goes to Saturday's event.

### Outcome: the pipeline stage drives the sync

A closed stage is the outcome, so volunteers only set it once and the HubSpot board shows the real result. The `repair_outcome` property isn't used by the app. Hide it from the ticket record or delete it from the sandbox.

| Stage | Restarters `repair_status` | Sync? |
|---|---|---|
| Repaired | `Fixed` | Yes |
| Can't repair | `End of life`, with `barrier` required | Yes |
| Needs follow-up (open) | `Repairable`, with `next_steps` required | Yes, on the day's event |
| Won't repair | none | Not for now. No repair was attempted. |
| No show | none | No. Nothing was looked at. |

Moving a ticket out of a closed stage, or into No show, after it has synced leaves the Restarters record in place. Use the delete action to remove it.

If an item marked Needs follow-up is later repaired, the same device is updated to Fixed. It stays on the event it was first logged against.

### Search: in the browser, across all three tabs

The search box sits above the tabs and filters all three as you type. It's instant and makes no extra calls to HubSpot, apart from loading completed tickets the first time you search or open Done. Each word must match the start of a word in the item name, the customer's first name or the fixer, or the short reference. Each tab shows its total in brackets, e.g. "Repairs (12)", and while searching how many match, e.g. "Repairs (3 of 12)", so you can see where an item is without switching. The category dropdown only lists categories that open or recently completed tickets use.

Searching the Done tab covers everything completed in the last 90 days (`GET /api/tickets/completed`, `COMPLETED_DAYS` in `functions/src/app.ts`). That's for fixing an outcome set by mistake or adding notes afterwards. Saving a completed ticket at a stage that syncs updates the same Restarters device, because the device id is stored on the ticket.

If someone brings an item back later, it's booked as a new repair. That's fine for the stats, since it's been saved from landfill twice. Email search isn't supported, on purpose, to keep contact details out of the app.

### Check-in: printing the job sheet

Reception prints a job sheet when someone arrives, and that print is the check-in. The app records the first print time in `repair_printed_at` after the print dialog closes (from the Print button or Ctrl/Cmd+P). Cancelling the dialog still counts, because browsers don't say whether the page was actually printed.

The list has three tabs:

- **To print**, for reception. Tickets at the first stage (New) with no print time, in one list with no stage headings. That's people who booked ahead and haven't arrived. Anything still there at the end of the session is a no-show.
- **Repairs**, for fixers. Everything else that's open, apart from Needs follow-up, grouped by stage. Cards say Reprint rather than Print. Each card has a fixer dropdown ("Assign fixer" when there's none, "No fixer" to clear one), so the host can assign items without opening them. Picking a name saves straight away. An item still at New moves to In Progress at the same time. The assignment is added to "Worked on by" like any other.
- **Done**, for items nobody is working on now. One list under "Latest session, Sat 21 Nov (8 of 9 on Restarters)", grouped by stage: Needs follow-up, Repaired, Can't repair and so on. The latest session is group 116's most recent Restarters event up to today, returned with the completed list. Anything completed on or after its date counts as part of it. If Restarters can't be reached, it falls back to the most recent day anything was completed. Needs follow-up items and sync failures are included whatever their date. Items whose sync failed stay in their stage group with a "Sync error" label and the reason. When there are any, the tab says "Done (9) · 3 errors", and a row at the top says "3 errors: these items haven't synced to Restarters" with a "Show only errors" checkbox. Searching covers everything completed in the last 90 days. Won't repair and No show don't sync, so they aren't counted.

On the ticket page, Status and Fixer are the first row of the Repair group, so a fixer picking an item up sets both together, and the outcome sits right above the repair write-up.

A ticket moved past New counts as checked in even if its sheet was never printed, so fixers can't lose it. Each device remembers its last tab in browser storage, so the reception laptop opens on To print and the fixers' tablets on Repairs. This replaced an earlier idea of disabling the Print button after use with a "print again" link.

If the repair cafe goes paperless later, check-in still needs something printed: a small label (e.g. a Dymo label) with the short reference, and perhaps the QR code, to stick on the item. The same rule then applies to the label. Printing it sets `repair_printed_at` and moves the ticket to Repairs, so the tabs don't change. Fixers would write the repair up in the app instead of on the sheet. A label page would be a new print layout alongside the A4 sheet, sized to the label roll.

The booking confirmation email doesn't include the reference. It says to report to reception for a ticket number, so the printed sheet is the first time the visitor sees it. Suggested wording for the email in HubSpot: "When you arrive, please go to reception. We'll print a job sheet for your item and give you its 5-digit ticket number." The reference is the last 5 digits of the HubSpot ticket id, so it's digits, not letters.

### Closing after the session: dated to the session

Volunteers may run out of time and type up outcomes from the paper sheets a day or two later. When a ticket moves from an open stage to a closed one after the latest session's day, the app sets `closed_date` to that session's start time, after HubSpot sets its own. HubSpot's reports and the Done tab then show the item as completed at the session, not on the day it was typed up. A ticket closed on the day of the session keeps its real time, and editing an already-closed ticket doesn't change it. Restarters already gets this right, because the sync uses the latest event on or before the close date.

### Needs follow-up: reopen the same ticket, don't rebook

An item marked Needs follow-up syncs to Restarters as Repairable, with its next step, and moves to the Done tab. It stays there, whatever its date, until someone changes its status. When the person brings it back, find it with search and set it to In Progress. It moves back to Repairs. Its final outcome (Repaired or Can't repair) then updates the same Restarters record, which stays on the event where the item was first seen. If they never come back, set it to Can't repair or Won't repair as appropriate.

Choosing Needs follow-up with next steps "More time needed" shows a "Back on" dropdown of the group's upcoming sessions on Restarters (`GET /api/sessions/upcoming`, looking up to 8 weeks ahead, though Restarters is usually filled in about 4 weeks ahead). The next session is chosen by default, unless the item is already booked for a later one. It's saved to the same ticket's `requested_repair_date`, so the Done tab card says "Back on Sat 5 Dec". "Professional help" and "Do it yourself" mean the item isn't coming back, so there's no dropdown and no date on the card. Only sessions on Restarters are offered, so a cancelled Saturday can't be picked. If none are listed yet, add them on Restarters.

It isn't rebooked as a new ticket, because that would add a second Restarters record for the same item and count it twice. The app treats any open stage that syncs as a follow-up stage, so the rule doesn't depend on the stage's name.

### Short reference

Each ticket shows a short reference, the last five digits of the HubSpot ticket id (e.g. #67747). It's printed large on the job sheet, shown on the list, and searchable. It's easier to say out loud than the 12-digit id, and it stays the same for the life of the ticket.

A position such as "item 3 of 12" wasn't used, because it changes as items are added or completed. Two open tickets could share the same last five digits, but it's unlikely with a session's worth of items, and the item name and first name tell them apart.

### Item type: filled in from the category, asked for only on Misc

Restarters requires `item_type`, a short plain name for the item such as "Laptop" or "Toaster". It's free text and Restarters doesn't calculate anything from it. Its CO2 and waste figures come from the category (and the weight, for Misc). Their suggestions list (`GET /api/v2/items`) holds over 18,000 free-text entries from every group, so it isn't cleaned up centrally.

For most categories, item type would just repeat the category. So when a ticket syncs, the server sets it to the category name without the size ("Laptop medium" becomes "Laptop") and saves that back to the ticket. Volunteers aren't asked.

Misc items are the exception. "Misc" says nothing about what the item was, so the app and the job sheet only ask for item type (and weight) when the category is Misc powered or Misc unpowered. Switching a ticket to Misc clears the old value so the volunteer types a real one. Sync stops with "Add an item type." if a Misc ticket has none.

It's different from the item name (`subject`), which is whatever the customer typed, for example "Dad's old Roberts radio", and isn't sent to Restarters. Customers aren't asked for item type on the booking form.

### Deleting and re-syncing creates a new Restarters record

Restarters gives each device a new id when it's created. If a device is deleted from Restarters and the ticket is synced again, a new record is created with a new id. That's expected, as long as:

- Deleting clears `restarters_device_id` on the ticket. The next sync then creates a fresh record and stores the new id.
- An update always uses the stored id, so re-saving a completed ticket edits the existing record instead of adding a duplicate.
- The new id is saved to the ticket straight after the create. If that HubSpot write fails, the Restarters record exists with nothing pointing to it. Log that case clearly so a host can fix it by hand.
