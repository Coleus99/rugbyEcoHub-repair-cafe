// End-to-end check of the API running in the Firebase emulators, talking
// to the HubSpot sandbox. Signs in to the Auth emulator as a test user,
// then calls the function like the web app does. Read-only.
//
// Start the emulators first (npm run build:watch, then
// firebase emulators:start), then run: npm run test:emulator
import {beforeAll, describe, expect, it} from "vitest";
import {TEST_TICKET_ID} from "../env";

const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const API = "http://127.0.0.1:5001/repair-cafe-dev/europe-west2/api/api";
const USER = {email: "emulator-test@example.com", password: "test-password"};

let idToken = "";

// Sign up the test user, or sign in if it already exists.
const signIn = async () => {
  const body = JSON.stringify({...USER, returnSecureToken: true});
  const headers = {"Content-Type": "application/json"};
  for (const action of ["signUp", "signInWithPassword"]) {
    const res = await fetch(`${AUTH}/accounts:${action}?key=emulator`, {
      method: "POST", headers, body,
    }).catch(() => {
      throw new Error("Auth emulator isn't running on 127.0.0.1:9099");
    });
    if (res.ok) return ((await res.json()) as {idToken: string}).idToken;
  }
  throw new Error("Couldn't sign in to the Auth emulator");
};

const api = (path: string, token = idToken) =>
  fetch(API + path, {headers: {Authorization: `Bearer ${token}`}});

beforeAll(async () => {
  idToken = await signIn();
});

describe("API in the emulator", () => {
  it("rejects requests that aren't signed in", async () => {
    const res = await fetch(API + "/tickets");
    expect(res.status).toBe(401);
  });

  it("returns stages and dropdown options", async () => {
    const res = await api("/meta");
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.stages.length).toBeGreaterThan(0);
    expect(meta.options.restarters_category.length).toBeGreaterThan(0);
  });

  it("lists open tickets", async () => {
    const res = await api("/tickets");
    expect(res.status).toBe(200);
    const {tickets} = await res.json();
    expect(Array.isArray(tickets)).toBe(true);
  });

  it("reads the test ticket", async () => {
    const res = await api(`/tickets/${TEST_TICKET_ID}`);
    expect(res.status).toBe(200);
    const {ticket} = await res.json();
    expect(ticket.id).toBe(TEST_TICKET_ID);
  });

  it("includes first names in the open list", async () => {
    // Seeded by npm run seed:sandbox: Margaret's kettle.
    const {tickets} = await (await api("/tickets")).json();
    expect(tickets.map((t: {firstName: string}) => t.firstName))
      .toContain("Margaret");
  });

  it("lists recently completed tickets", async () => {
    const res = await api("/tickets/completed");
    expect(res.status).toBe(200);
    const {tickets} = await res.json();
    expect(Array.isArray(tickets)).toBe(true);
  });

  it("404s for a ticket that doesn't exist", async () => {
    const res = await api("/tickets/1");
    expect(res.status).toBe(404);
  });
});
