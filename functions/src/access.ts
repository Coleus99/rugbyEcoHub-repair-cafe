// Who may use the API. Only these Firebase accounts get in, even if
// self sign-up is ever switched back on by mistake in the console.
// The list is config (ALLOWED_EMAILS), so adding volunteer accounts later
// means adding their email there, not changing code.

// "a@x.com, B@y.com" -> ["a@x.com", "b@y.com"]
export const parseEmails = (text: string) =>
  text.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isAllowed = (allowed: string[], email: string | undefined) =>
  !!email && allowed.includes(email.toLowerCase());

// The emulator tests sign up their own throwaway user.
export const EMULATOR_TEST_EMAIL = "emulator-test@example.com";
