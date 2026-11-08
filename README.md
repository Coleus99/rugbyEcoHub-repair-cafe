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
| Item type | `repair_item_type` | `item_type` (required) | **New.** Set by volunteers in the app, not on the booking form. |
| Model | `repair_item_model` | `model` | **New** |
| Weight (kg) | `repair_item_weight_kg` | `estimate` | **New** |
| Problem and fix | `repair_problem_and_fix` | `problem` | **New** |
| Notes | `repair_notes` | `notes` | **New** |
| Outcome | `repair_outcome` | `repair_status` | **New** |
| Spare parts | `repair_spare_parts` | `spare_parts` | **New** |
| Next steps | `repair_next_steps` | `next_steps` | **New** |
| Barrier | `repair_barrier` | `barrier` | **New** |
| Restarters ids | `restarters_device_id`, `restarters_event_id` | returned `id`, `eventid` | **New** |
| Sync status | `restarters_sync_status`, `restarters_sync_error` | none | **To add.** Status options: Not synced, Synced, Error. |

The new properties exist in the **sandbox only**. For go-live, run Bruno's "Create ticket properties (new)" against the live portal. Don't run the two "(sandbox)" requests on live, because the live portal already has those properties.

HubSpot can't rename a property's internal name. Mark old properties as legacy by changing the label only, for example "Legacy: Repair Item Category".

## Next steps

1. ~~Create the booking form in the HubSpot sandbox.~~ Done 8 November 2026, built in the HubSpot UI. `repair_item_type` was left off because customers wouldn't know what to put. The app fills it in (see [Decisions](#decisions)).
2. ~~Create the Firebase projects.~~ Done. `repair-cafe-dev` is on Blaze with `HUBSPOT_TOKEN` (sandbox key) and `RESTARTERS_TOKEN` stored as secrets. `repair-cafe-prod` exists with its web app registered. It stays on the free plan with no secrets until the proof of concept is approved.
3. ~~Scaffold the app.~~ Done. `web/` is Vite `react-ts`. `functions/` is TypeScript with one Express function, `api`, in `europe-west2`, which checks the Firebase ID token on every `/api` route. `firebase.json` rewrites `/api/**` to it.
4. **Finish local config:** copy `web/.env.example` to `web/.env.development` and fill in the dev web app config. Create a test user in the Auth emulator.
5. **Build the functions:**
   - `GET /api/tickets`: open tickets in the Repair Cafe pipeline, sorted by status.
   - `GET /api/tickets/:id` and `PATCH /api/tickets/:id`, allowing the listed properties only.
   - Always save the ticket to HubSpot first. The Restarters sync runs after that, and a sync failure never blocks or undoes the HubSpot save.
   - Sync to Restarters when a ticket moves to complete: create the device if there's no `restarters_device_id`, otherwise update it. Store the returned id on the ticket straight away.
   - Find the event id by looking up today's Restarters event for group 116. Fixers add items to the current session, so the requested date isn't used. Save it to `restarters_event_id`.
   - Record the result on the ticket: `restarters_sync_status` = Synced, or Error with the reason in `restarters_sync_error` (for example "No Restarters event on 21 Nov 2026").
   - `POST /api/sync`: retry every ticket with status Error. Run it from a "Resync" button in the app once the host has fixed the cause. For tickets that never had an event id, use the event on the date the ticket was completed (HubSpot sets `closed_date` when a ticket moves to a closed stage), not the date of the retry.
   - `DELETE /api/tickets/:id/restarters`: remove the device and clear the id.
6. **Build the pages:** ticket list, ticket detail and edit form, and a print view (A4 and Dymo label) with a QR code linking to `/tickets/:id`.
7. **Test against the sandbox** using the Firebase emulators, then deploy to dev, then prod.
8. **Go live:** upgrade `repair-cafe-prod` to Blaze, store the live HubSpot key and the Restarters token as its secrets, add `web/.env.production`, create the live ticket properties, then `firebase deploy --project prod`.
9. Later: sync item images to Restarters. Move to individual logins if the shared one causes problems.

## Local development

You need Node 24 (the functions runtime) and the Firebase CLI. If you also use the CLI with another Google account, run `firebase login:use <rugby eco hub email>` in this folder.

```bash
npm --prefix web install && npm --prefix functions install

# Terminal 1: rebuild functions on save
npm --prefix functions run build:watch

# Terminal 2: emulators (Auth 9099, Functions 5001, Hosting 5002, UI 4000)
firebase emulators:start --only auth,functions,hosting

# Terminal 3: web app with hot reload on http://localhost:5173
npm --prefix web run dev
```

- Vite proxies `/api` to the Functions emulator, so the function sees the same `/api/...` paths as it does behind Hosting.
- In dev, the web app signs in against the Auth emulator (`web/src/lib/firebase.ts`). Create a test user in the emulator UI at http://127.0.0.1:4000.
- The function reads secrets from `functions/.secret.local` under the emulator (gitignored).
- The Hosting emulator uses port 5002 because macOS AirPlay Receiver uses 5000.
- Calls to HubSpot from the emulator go to the real sandbox portal, and calls to Restarters go to live Restarters. Use test tickets and a test event.

Deploy to dev:

```bash
npm --prefix web run build && firebase deploy --project dev
```

### Suggested layout

```
web/                    Vite React app
  src/pages/TicketList.tsx
  src/pages/TicketPage.tsx
  src/pages/TicketPrint.tsx
  src/lib/api.ts        fetch wrapper that adds the ID token
functions/
  src/index.ts          HTTP routes
  src/hubspot.ts        getTickets, getTicket, updateTicket
  src/restarters.ts     createDevice, updateDevice, deleteDevice, listEvents
  src/auth.ts           verify ID token
firebase.json
.firebaserc             dev and prod aliases
firestore.rules         deny all until needed
```

## Decisions

### Login: one shared account

All volunteers sign in with a single Firebase email/password account, so getting started is easy. Changes are easy to correct if something goes wrong, and the paper forms are a backup. Individual logins (Firebase email link sign-in with an allowlist) are a later step if shared access causes conflicts.

Keep the risk down while it's shared:

- Use a long passphrase of three or four random words, and change it when a volunteer leaves.
- Show only first names and item details in the ticket list. Customer contact details are personal data under UK GDPR.
- Limit Restarters writes in the function to group 116's events and to device ids stored on our tickets.
- Turn on App Check to block scripted requests.

### Booking date: keep the 1st and 3rd Saturday script

[date-choice-1st-3rd-sat.js](date-choice-1st-3rd-sat.js) runs on the page that embeds the HubSpot form. It hides the `requested_repair_date` field and shows a dropdown of the next six 1st and 3rd Saturdays. Closed dates, such as around Christmas, go in its `dateExceptions` list. Events are regular enough that this is almost always right, and it avoids a separate job to keep the dates in sync with Restarters.

The requested date is only for planning. It lets the host see ahead of an event whether demand is high or specific tools are needed. Keep `dateExceptions` in step with Restarters, otherwise customers can book a cancelled Saturday.

### Restarters sync uses the current session, and failures are retried

Fixers add items to the session that's running now, so the sync uses the Restarters event for today, whatever date the customer booked.

If there's no Restarters event for today, the host has to add or correct it on Restarters. Until then, sync fails for that session. The app still saves every change to the HubSpot ticket and marks the ticket's sync status as Error. Once Restarters is fixed, the host presses Resync to send the failed items. Each failed item is matched to the event on the day it was completed, so an item fixed on Saturday and retried on Monday still goes to Saturday's event.

A ticket can also fail for other reasons, such as a missing category or a Restarters outage. These are handled the same way, with the reason shown on the ticket.

### Item type: set in the app, not by customers

Restarters requires `item_type`, a short name for the item such as "Laptop" or "Toaster". It's what Restarters uses for its repair statistics, so it needs to be generic. It's different from the ticket name, which is whatever the customer typed, for example "Dad's old Roberts radio".

Customers weren't sure what to put, so it's left off the booking form. In the app, pre-fill it from the category name ("Laptop medium" becomes "Laptop") and let the volunteer correct it. A suggestions list can come from `GET /api/v2/items`.

### Deleting and re-syncing creates a new Restarters record

Restarters gives each device a new id when it's created. If a device is deleted from Restarters and the ticket is synced again, a new record is created with a new id. That's expected, as long as:

- Deleting clears `restarters_device_id` on the ticket. The next sync then creates a fresh record and stores the new id.
- An update always uses the stored id, so re-saving a completed ticket edits the existing record instead of adding a duplicate.
- The new id is saved to the ticket straight after the create. If that HubSpot write fails, the Restarters record exists with nothing pointing to it. Log that case clearly so a host can fix it by hand.
