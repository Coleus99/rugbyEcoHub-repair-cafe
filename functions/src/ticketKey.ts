// Ticket keys: the QR code on a job sheet carries one, so a fixer who scans
// it can open and update that one ticket without signing in. A key is
// "<ticket id>.<expiry ms>.<signature>", signed with QR_SIGNING_KEY, and
// works for a few hours after the sheet is printed.
import {createHmac, timingSafeEqual} from "node:crypto";

export const TICKET_KEY_HOURS = 3;

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export const signTicketKey = (secret: string, id: string, expires: number) =>
  `${id}.${expires}.${sign(secret, `${id}.${expires}`)}`;

export type KeyCheck =
  | {ok: true; ticketId: string}
  | {ok: false; reason: "invalid" | "expired"};

export const verifyTicketKey = (
  secret: string,
  key: string,
  now: number,
): KeyCheck => {
  const [id, expires, signature, ...rest] = key.split(".");
  if (!id || !expires || !signature || rest.length || !secret) {
    return {ok: false, reason: "invalid"};
  }
  const expected = Buffer.from(sign(secret, `${id}.${expires}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return {ok: false, reason: "invalid"};
  }
  if (Number(expires) < now) return {ok: false, reason: "expired"};
  return {ok: true, ticketId: id};
};

// What a ticket key may do: read the form's options, and read, save and
// resync its own ticket. Not the list, other tickets, printing or removing
// the item from Restarters.
export const keyAllows = (ticketId: string, method: string, path: string) => {
  if (method === "GET" && (path === "/api/meta" ||
    path === "/api/sessions/upcoming")) return true;
  const own = `/api/tickets/${ticketId}`;
  if (path === own) return method === "GET" || method === "PATCH";
  return path === `${own}/sync` && method === "POST";
};
