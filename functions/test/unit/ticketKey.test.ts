import {describe, expect, it} from "vitest";
import {keyAllows, signTicketKey, verifyTicketKey} from "../../src/ticketKey";

const SECRET = "test-secret";
const NOW = Date.parse("2026-11-21T10:00:00Z");

describe("ticket keys", () => {
  it("accepts its own key before it expires", () => {
    const key = signTicketKey(SECRET, "123", NOW + 1000);
    expect(verifyTicketKey(SECRET, key, NOW))
      .toEqual({ok: true, ticketId: "123"});
  });

  it("rejects an expired key", () => {
    const key = signTicketKey(SECRET, "123", NOW - 1);
    expect(verifyTicketKey(SECRET, key, NOW))
      .toEqual({ok: false, reason: "expired"});
  });

  it("rejects a key edited to another ticket or a later expiry", () => {
    const [, expires, sig] = signTicketKey(SECRET, "123", NOW + 1000)
      .split(".");
    expect(verifyTicketKey(SECRET, `456.${expires}.${sig}`, NOW).ok)
      .toBe(false);
    expect(verifyTicketKey(SECRET, `123.${NOW + 9e9}.${sig}`, NOW).ok)
      .toBe(false);
  });

  it("rejects a key signed with another secret, or rubbish", () => {
    const key = signTicketKey("other", "123", NOW + 1000);
    expect(verifyTicketKey(SECRET, key, NOW).ok).toBe(false);
    expect(verifyTicketKey(SECRET, "nonsense", NOW).ok).toBe(false);
    expect(verifyTicketKey("", signTicketKey("", "1", NOW + 1), NOW).ok)
      .toBe(false);
  });

  it("only opens its own ticket", () => {
    expect(keyAllows("123", "GET", "/api/tickets/123")).toBe(true);
    expect(keyAllows("123", "PATCH", "/api/tickets/123")).toBe(true);
    expect(keyAllows("123", "POST", "/api/tickets/123/sync")).toBe(true);
    expect(keyAllows("123", "GET", "/api/meta")).toBe(true);
    expect(keyAllows("123", "GET", "/api/tickets/456")).toBe(false);
    expect(keyAllows("123", "GET", "/api/tickets")).toBe(false);
    expect(keyAllows("123", "DELETE", "/api/tickets/123/restarters"))
      .toBe(false);
    expect(keyAllows("123", "POST", "/api/tickets/123/key")).toBe(false);
    expect(keyAllows("123", "POST", "/api/tickets/123/printed")).toBe(false);
  });
});
