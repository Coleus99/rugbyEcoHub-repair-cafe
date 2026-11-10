import { Link, Outlet } from "react-router";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../lib/useAuth";
import logoUrl from "../assets/EcoHubRepairCafeUpdated.webp";

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
            <span>{user.email}</span>
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
