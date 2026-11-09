import {describe, expect, it} from "vitest";
import {isAllowed, parseEmails} from "../../src/access";

describe("access", () => {
  const allowed = parseEmails(" RepairCafeRugby@gmail.com , b@example.com,");

  it("reads a comma-separated list, ignoring case and blanks", () => {
    expect(allowed).toEqual(["repaircaferugby@gmail.com", "b@example.com"]);
  });

  it("only lets listed accounts in", () => {
    expect(isAllowed(allowed, "repaircaferugby@gmail.com")).toBe(true);
    expect(isAllowed(allowed, "B@example.com")).toBe(true);
    expect(isAllowed(allowed, "someone@example.com")).toBe(false);
    expect(isAllowed(allowed, undefined)).toBe(false);
  });
});
