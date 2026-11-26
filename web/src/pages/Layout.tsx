import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../lib/useAuth";
import logoUrl from "../assets/EcoHubRepairCafeUpdated.webp";
import { fixersOf, getMeta, META_EVENT, type Fixer } from "../lib/api";
import { clearFixer, rememberFixer, useMe } from "../lib/deviceFixer";
import FixerOptions from "./FixerOptions";

// Header shared by the signed-in pages.
export default function Layout() {
  const { user } = useAuth();

  return (
    <>
      <header>
        <Link to="/">
          <img src={logoUrl} className="logo" alt="Repair Cafe logo" />
        </Link>
        {user ? (
          <div className="currentUserWrapper">
            <MePicker />
            {/* RequireAuth notices the sign-out and redirects to /login. */}
            <button type="button" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
        ) : (
          // Opened from a job sheet's QR code: this one ticket only.
          <div className="currentUserWrapper">
            <span className="muted">Opened from QR code</span>
            <Link to="/login">Sign in</Link>
          </div>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

// "I am…": who is using this phone, from today's Restarters sign-ups and
// HubSpot's Fixer list. Remembered on this device. Repairs uses it for
// Only mine and Take it, and the ticket form fills it in as the fixer.
function MePicker() {
  const me = useMe();
  const [fixers, setFixers] = useState<Fixer[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getMeta().then(
        (meta) => !cancelled && setFixers(fixersOf(meta)),
        () => undefined, // the page shows its own error
      );
    load();
    window.addEventListener(META_EVENT, load); // Refresh on the list
    return () => {
      cancelled = true;
      window.removeEventListener(META_EVENT, load);
    };
  }, []);
  const known = fixers.some((f) => f.value === me);
  return (
    <label className="me-picker">
      <span>I am</span>
      <select value={me} onChange={(e) => (e.target.value ? rememberFixer(e.target.value) : clearFixer())}>
        <option value="">Choose…</option>
        {me && !known && <option value={me}>{me}</option>}
        <FixerOptions fixers={fixers} />
      </select>
    </label>
  );
}
