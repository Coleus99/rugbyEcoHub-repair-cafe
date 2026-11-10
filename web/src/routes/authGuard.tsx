import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../lib/useAuth";
import { setActiveKey, storeTicketKey, ticketKeyFor } from "../lib/ticketKey";

// Layout route that only renders its children when signed in.
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Firebase hasn't checked for a saved session yet. Don't redirect,
  // or every page refresh would flash the login page.
  if (loading) return <p>Loading…</p>;

  // A QR code link (/tickets/123?key=...) opens that one ticket without
  // signing in. Keep the key for this tab, then drop it from the address.
  const urlKey = new URLSearchParams(location.search).get("key");
  const ticketId = location.pathname.match(/^\/tickets\/(\d+)$/)?.[1];
  if (urlKey && ticketId) {
    if (!user) storeTicketKey(urlKey);
    return <Navigate to={location.pathname} replace />;
  }
  const key = !user && ticketId ? ticketKeyFor(ticketId) : undefined;
  setActiveKey(key);
  if (key) return <Outlet />;

  // Send them to login, remembering where they were going
  // (e.g. a ticket whose QR code has expired).
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  return <Outlet />;
}
