// The fixer last saved on this phone or tablet, so the next ticket opened
// here can start with their name. Stored in this browser only. If storage
// is blocked (e.g. private browsing) it just doesn't remember.
const KEY = "repairCafe.fixer";

export function rememberedFixer(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberFixer(name: string): void {
  try {
    if (name) localStorage.setItem(KEY, name);
  } catch {
    // ignore
  }
}
