import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../lib/useAuth";

// Layout route that only renders its children when signed in.
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Firebase hasn't checked for a saved session yet. Don't redirect,
  // or every page refresh would flash the login page.
  if (loading) return <p>Loading…</p>;

  // Send them to login, remembering where they were going
  // (e.g. a ticket they scanned a QR code for).
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  return <Outlet />;
}
