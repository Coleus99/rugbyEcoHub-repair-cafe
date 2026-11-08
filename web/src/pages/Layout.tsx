import { Link, Outlet } from "react-router";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../lib/useAuth";

// Header shared by the signed-in pages.
export default function Layout() {
  const { user } = useAuth();

  return (
    <>
      <header>
        <Link to="/">Repair Cafe</Link>
        <span>{user?.email}</span>
        {/* RequireAuth notices the sign-out and redirects to /login. */}
        <button type="button" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
