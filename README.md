# Rugby Eco Hub Repair Cafe

A tool for running the Repair Cafe at Rugby Eco Hub. Customers book items in through a HubSpot form, which creates a ticket. Volunteers work from a web app that lists open tickets, prints a paper form with a QR code for each item, and records the repair. When a repair is complete, the details are sent to [Restarters](https://restarters.net) so they count towards the group's repair stats.

Status: API exploration done. HubSpot ticket properties exist in the sandbox. The app hasn't been built yet. See [Next steps](#next-steps).

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
| Requested date | `requested_repair_date` | none | Existing. May be replaced, see open questions. |
| Image | `repair_item_image` | `images` | Existing. Not synced yet. |
| Category | `restarters_category` | `category` | **New.** Replaces `repair_item_category`. |
| Item type | `repair_item_type` | `item_type` | **New** |
| Model | `repair_item_model` | `model` | **New** |
| Weight (kg) | `repair_item_weight_kg` | `estimate` | **New** |
| Problem and fix | `repair_problem_and_fix` | `problem` | **New** |
| Notes | `repair_notes` | `notes` | **New** |
| Outcome | `repair_outcome` | `repair_status` | **New** |
| Spare parts | `repair_spare_parts` | `spare_parts` | **New** |
| Next steps | `repair_next_steps` | `next_steps` | **New** |
| Barrier | `repair_barrier` | `barrier` | **New** |
| Restarters ids | `restarters_device_id`, `restarters_event_id` | returned `id`, `eventid` | **New** |

The new properties exist in the **sandbox only**. For go-live, run Bruno's "Create ticket properties (new)" against the live portal. Don't run the two "(sandbox)" requests on live, because the live portal already has those properties.

HubSpot can't rename a property's internal name. Mark old properties as legacy by changing the label only, for example "Legacy: Repair Item Category".

## Next steps

1. **Create the booking form in the HubSpot sandbox.** Build it in the HubSpot UI, which is quicker than the Forms API because that needs a full styling definition. Fields:
   - Contact: first name, last name, email, phone.
   - Ticket: `subject` (Repair item name), `content` (Repair item issue), `restarters_category`, `repair_item_brand`, `repair_item_model`, `repair_item_year_made`, plus the booking date (see open question 2).
   - The repair outcome fields (`repair_outcome` onwards) are for volunteers in the app, so leave them off this form.
2. **Create the Firebase projects** `repair-cafe-dev` and `repair-cafe-prod` on the Blaze plan, each with a budget alert.
3. **Store the secrets** in each project: `firebase functions:secrets:set HUBSPOT_TOKEN` and `RESTARTERS_TOKEN`. Use the sandbox key for dev.
4. **Scaffold the app** in this repo:
   ```
   npm create vite@latest web -- --template react-ts
   firebase init hosting functions emulators   # TypeScript, Node 22, public dir web/dist, SPA rewrite
   ```
   Add a rewrite of `/api/**` to the function, then `**` to `/index.html`.
5. **Build the functions:**
   - `GET /api/tickets`: open tickets in the Repair Cafe pipeline, sorted by status.
   - `GET /api/tickets/:id` and `PATCH /api/tickets/:id`, allowing the listed properties only.
   - Sync to Restarters when a ticket moves to complete: create the device if there's no `restarters_device_id`, otherwise update it. Store the returned id on the ticket.
   - `DELETE /api/tickets/:id/restarters`: remove the device and clear the id.
6. **Build the pages:** ticket list, ticket detail and edit form, and a print view (A4 and Dymo label) with a QR code linking to `/tickets/:id`.
7. **Test against the sandbox** using the Firebase emulators, then deploy to dev, then prod.
8. Later: sync item images to Restarters.

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

## Open questions

### 1. Is a single shared login acceptable?

Probably yes for a first version, but the bigger risk isn't Restarters. Anyone with the password can see every open ticket, and tickets hold customers' names, emails and phone numbers. That's personal data under UK GDPR, so a leaked password matters more than a bad Restarters write. You're right that a bad Restarters write can be fixed from the paper copies.

If you go with a shared login:

- Use one Firebase email/password account with a long passphrase of three or four random words. That's easy to say out loud and hard to guess.
- Show only first names and item details in the list. Keep contact details off the volunteer screens unless they're needed.
- Limit Restarters writes in the function to group 116's events and to device ids stored on our tickets, so a misused login can't touch anything else.
- Change the password if a volunteer leaves, and turn on App Check to block scripted requests.

The upgrade path is Firebase **email link sign-in** with an allowlist of volunteer emails. It's barely more work, there are no passwords to share, and every change can be traced to a person. Move to it if there are conflicts or if hosts need extra permissions.

### 2. How do customers choose a date on the booking form?

Use the Restarters event list rather than the script that calculates the 1st and 3rd Saturdays. `GET /api/v2/groups/116/events` already returns the upcoming events (7 November, 21 November and 5 December 2026), needs no token, and reflects cancellations or one-off dates that a calculation would miss. It also gives the event id that the Restarters sync needs.

A HubSpot form can't load its options live. So:

- Add a dropdown ticket property such as `repair_event`. Each option's value is the Restarters event id and its label is the date, for example "Sat 21 Nov 2026".
- A scheduled Cloud Function, run daily, reads upcoming events from Restarters and updates that property's options through the HubSpot properties API.
- The form uses the dropdown in place of `requested_repair_date`. The ticket then holds the event id from the start.

If that's more than you want for the first version, keep the existing date picker and match the date to a Restarters event when the ticket syncs.
