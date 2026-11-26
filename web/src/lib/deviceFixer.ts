import { useSyncExternalStore } from "react";

// Who is using this phone or tablet ("I am…"), so Repairs can show Mine
// and the next ticket opened here can start with their name. Stored in
// this browser only. If storage is blocked (e.g. private browsing) it just
// doesn't remember.
const KEY = "repairCafe.fixer";
const EVENT = "repairCafe:fixer";

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
  window.dispatchEvent(new Event(EVENT));
}

export function clearFixer(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  // Another tab changing it.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};

// The device's fixer, updating everywhere when it changes.
export const useMe = () => useSyncExternalStore(subscribe, rememberedFixer, () => "");
