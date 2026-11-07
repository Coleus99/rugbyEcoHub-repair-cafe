# Restarters API notes

Our working notes on the Restarters API (https://restarters.net), written while building the Repair Cafe tool. Requests live in the Bruno collection at `api/restarters/`.

## Files in this folder

| File | What it is |
|---|---|
| `api-docs.json` | The published OpenAPI 3 spec (v2.0.0). Accurate for the `/api/v2` routes. |
| `routes-api.php` | Copy of `routes/api.php` from the Restarters GitHub repo, kept as reference. Shows every route, including legacy ones the spec leaves out. |
| `getItemsResponse.json` | Saved response from `GET /api/v2/items`. Source of the category table below. |
| `createDeviceResponse.json`, `getDeviceResponse.json`, `updateDeviceResponse.json`, `deleteDeviceResponse.json` | Real responses from the device endpoints, 7 November 2026 |

## How the routes map to URLs

Laravel puts every route in `routes-api.php` under `/api`. So `Route::prefix('v2')` plus `/devices` becomes `https://restarters.net/api/v2/devices`.

We compared the two sources. The 33 routes inside the `v2` group match the spec exactly. The differences are:

- **Legacy routes outside `v2`** are missing from the spec (listed below). Most are used by the Restarters web client, Zapier or partner networks. Avoid them unless v2 has no equivalent.
- **Auth is stricter than the spec says.** The spec's intro says no authorisation is needed and the API is read-only. That is out of date. Write endpoints take a user API token.
- **Where auth is checked differs.** Some write routes (`POST /groups`, `POST /events`, `PATCH /events/{id}`, `POST /devices`, `PATCH /devices/{id}`, `DELETE /devices/{id}`, alerts) have no `auth:api` middleware in the routes file. The token is checked inside the controller instead, so a missing token may return a validation error rather than a 401.

## Authentication

Send the user's API token as the `api_token` query parameter. Find it on your Restarters profile. Our Bruno collection reads it from `RESTARTERS_TOKEN` in `api/.env`.

Routes behind `auth:api` use Laravel's API guard. If it's the standard token guard, it also accepts `Authorization: Bearer <token>`, but the query parameter is what the spec documents, so we use that.

A token can only change data its user has rights to. Creating devices needs a **host** account on the event's group (confirmed 7 November 2026). A volunteer account is not enough.

## v2 endpoints

Auth column: **none** = public read, **token** = `api_token` needed.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v2/groups/summary` | none | `archived`, `includeNextEvent`, `includeCounts`, `ids` |
| GET | `/api/v2/groups/names` | none | `includeArchived`. Use to find a group id. |
| GET | `/api/v2/groups/tags` | none | |
| GET | `/api/v2/groups/{id}` | none | |
| GET | `/api/v2/groups/{id}/events` | none | `start`, `end` |
| GET | `/api/v2/groups/{id}/volunteers` | none | |
| POST | `/api/v2/groups` | token | |
| PATCH | `/api/v2/groups/{id}` | token | |
| PATCH | `/api/v2/groups/{id}/volunteers/{iduser}` | token | `host` |
| DELETE | `/api/v2/groups/{id}/volunteers/{iduser}` | token | |
| GET | `/api/v2/events/{id}` | none | |
| POST | `/api/v2/events` | token | |
| PATCH | `/api/v2/events/{id}` | token | |
| GET | `/api/v2/devices/{id}` | none | |
| POST | `/api/v2/devices` | token | See "Creating a device" |
| PATCH | `/api/v2/devices/{id}` | token | Same fields as create |
| DELETE | `/api/v2/devices/{id}` | token | |
| GET | `/api/v2/items` | none | Suggested item types with their category ids |
| GET | `/api/v2/networks` | none | |
| GET | `/api/v2/networks/{id}` | none | |
| GET | `/api/v2/networks/{id}/groups` | none | `includeNextEvent`, `includeDetails`, `includeStats`, `includeArchived`, `updated_start`, `updated_end`, `group_tag` |
| GET | `/api/v2/networks/{id}/events` | none | `start`, `end`, `updated_start`, `updated_end`, `includeDetails`, `group_tag` |
| GET | `/api/v2/networks/{id}/tags` | none | `network_only` |
| GET | `/api/v2/networks/{id}/stats` | none | `group_tag` |
| POST | `/api/v2/networks/{id}/tags` | token | Network coordinator or admin |
| PUT | `/api/v2/networks/{id}/tags/{tagId}` | token | Network coordinator or admin |
| DELETE | `/api/v2/networks/{id}/tags/{tagId}` | token | Network coordinator or admin |
| GET | `/api/v2/moderate/groups` | token | Admin or network coordinator |
| GET | `/api/v2/moderate/events` | token | Admin or network coordinator |
| GET | `/api/v2/alerts` | none | |
| PUT | `/api/v2/alerts` | token | Site-wide banner alerts. Role not documented. |
| PATCH | `/api/v2/alerts/{id}` | token | Role not documented |
| GET | `/api/v2/repairs` | token | Admin only. Open Repair Data Standard export. Returns 503 until the server's ORDS config is set. |

## Legacy routes (not in the spec)

| Method | Path | Auth | Used by |
|---|---|---|---|
| GET | `/api/homepage_data` | none | Restarters site (DeviceController) |
| GET | `/api/party/{id}/stats` | none | therestartproject.org |
| GET | `/api/group/{id}/stats` | none | therestartproject.org |
| GET | `/api/outbound/info/{type}/{id}/{format?}` | none | Share plugins |
| GET | `/api/devices/{page}/{size}` | none | Vue client. Paged device list. |
| GET | `/api/users/{id}/notifications` | none | Notification count |
| GET | `/api/talk/topics/{tag?}` | none | Discourse topics |
| GET | `/api/timezones` | none | |
| GET | `/api/users/me` | token | |
| GET | `/api/users` | token | |
| GET | `/api/users/changes` | token | Zapier |
| GET | `/api/networks/{network}/stats` | token | Repair Together |
| GET | `/api/groups` | token | |
| GET | `/api/groups/changes` | token | Zapier |
| GET | `/api/groups/network` | token | Repair Together |
| GET | `/api/events/network/{date_from?}/{date_to?}` | token | Repair Together |
| GET | `/api/events/{id}/volunteers` | token | |
| PUT | `/api/events/{id}/volunteers` | token | Adds a volunteer to an event |
| GET | `/api/usersgroups/changes` | token | Zapier |
| DELETE | `/api/usersgroups/{id}` | token | Vue client. Leave a group. |

## Creating a device

`POST /api/v2/devices?api_token=...` with a `multipart/form-data` body.

| Field | Required | Values |
|---|---|---|
| `eventid` | Yes in practice | Id of an event in a group the token's user hosts |
| `category` | Yes | Category id from the table below |
| `item_type` | Yes | Free text, ideally a `type` from `/api/v2/items` (e.g. `Laptop`) |
| `brand` | No | |
| `model` | No | |
| `age` | No | Years, 0 to 500. Decimals allowed. An approximate age is fine. 0 means unknown. |
| `estimate` | No | Weight in kg. Mainly for Misc categories. |
| `problem` | No | The problem **and** the fix. There is no separate repair details field. |
| `notes` | No | Repair difficulties, owner's view of the problem |
| `repair_status` | No | `Fixed`, `Repairable`, `End of life` |
| `next_steps` | Only if Repairable | `More time needed`, `Professional help`, `Do it yourself` |
| `spare_parts` | See note | `No` (no spare parts required), `Manufacturer` (parts from manufacturer), `Third party` (parts from third party). The spec says Repairable only, but it's accepted on Fixed items too (tested). |
| `barrier` | Only if End of life | `Spare parts not available`, `Spare parts too expensive`, `No way to open the product`, `Repair information not available`, `Lack of equipment` |

The spec says the response is `{ "data": <Device> }`. **It isn't.** The live API returns:

```json
{
  "id": 253142,
  "device": { "id": 253142, "category": { "id": 16, "name": "Laptop medium", "powered": 1 }, "...": "..." },
  "stats": { "co2_total": 132.66, "fixed_devices": 1, "...": "..." }
}
```

- Read the new id from the top-level `id`. We store it on the HubSpot ticket so the device can be edited later.
- `category` comes back as an object, but is sent as a plain id.
- `stats` are the event's updated totals.
- `images` is always present, empty until images are uploaded (not supported by us yet).

## Editing and deleting a device

`PATCH /api/v2/devices/{id}?api_token=...` takes the same fields as create.

- `eventid` is required on update as well, although the spec doesn't list it. Field names are case-sensitive, so `eventId` fails.

- Send the body as `application/x-www-form-urlencoded` or JSON, **not** multipart. PHP doesn't parse multipart bodies on PATCH, so those fields are silently dropped. The spec says multipart, so it's wrong about this too.
- It's not documented whether fields you leave out are kept or cleared. Our app sends the full form every time, which avoids the question.

`DELETE /api/v2/devices/{id}?api_token=...` removes the device and takes it out of the event's stats.

Both need the same host account that can create.

### Response shapes (tested)

The device endpoints don't agree with each other or with the spec.

| Call | Returns | Notes |
|---|---|---|
| `POST /devices` | `{ id, device, stats }` | `id` is a number |
| `GET /devices/{id}` | `{ data }` | Matches the spec. Leaves out `spare_parts`. |
| `PATCH /devices/{id}` | `{ id, device, stats }` | `id` is a **string**. `device` includes `spare_parts`. |
| `DELETE /devices/{id}` | `{ id, stats }` | `id` is a string. `stats` are the event totals after removal. |

Treat `id` as `Number(id)` in code. To read `spare_parts` back, use the PATCH response, or keep HubSpot as the record of it.

Common mistakes:

- `category: 1`. Category ids start at 6. Use the table below.
- Missing `item_type`. It's required.
- Sending `repair_details`. The field doesn't exist, so put the fix in `problem`.

## Categories

Taken from `GET /api/v2/items` on 7 November 2026. Re-run "Get items" in Bruno to refresh. "Powered" tells you whether the item is electrical. Laptop size is by screen. We treat 15.6" as medium, but this hasn't been checked with Restarters.

| id | Category | Powered |
|---|---|---|
| 6 | Games console | Yes |
| 7 | Watch/clock | Yes |
| 8 | Sewing machine | Yes |
| 9 | Iron | Yes |
| 10 | Coffee maker | Yes |
| 11 | Desktop computer | Yes |
| 12 | Flat screen 15-17" | Yes |
| 13 | Flat screen 19-20" | Yes |
| 14 | Flat screen 22-24" | Yes |
| 15 | Laptop large | Yes |
| 16 | Laptop medium | Yes |
| 17 | Laptop small | Yes |
| 18 | Paper shredder | Yes |
| 19 | PC accessory | Yes |
| 20 | Printer/scanner | Yes |
| 21 | Digital compact camera | Yes |
| 22 | DSLR/video camera | Yes |
| 23 | Handheld entertainment device | Yes |
| 24 | Headphones | Yes |
| 25 | Mobile | Yes |
| 26 | Tablet | Yes |
| 27 | Flat screen 26-30" | Yes |
| 28 | Flat screen 32-37" | Yes |
| 29 | Hi-Fi integrated | Yes |
| 30 | Hi-Fi separates | Yes |
| 31 | Musical instrument | Yes |
| 32 | Portable radio | Yes |
| 33 | Projector | Yes |
| 34 | TV and gaming-related accessories | Yes |
| 35 | Aircon/dehumidifier | Yes |
| 36 | Decorative or safety lights | Yes |
| 37 | Fan | Yes |
| 38 | Hair & beauty item | Yes |
| 39 | Kettle | Yes |
| 40 | Lamp | Yes |
| 41 | Power tool | Yes |
| 42 | Small kitchen item | Yes |
| 43 | Toaster | Yes |
| 44 | Toy | Yes |
| 45 | Vacuum | Yes |
| 46 | Misc | Yes |
| 47 | Furniture | No |
| 48 | Bicycle | No |
| 49 | Clothing/textile | No |
| 50 | Misc | No |
| 51 | Hand tool | No |
| 52 | Jewellery | No |
