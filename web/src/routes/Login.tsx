import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, type Location } from "react-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth } from "../lib/firebase";
import { useAuth } from "../lib/useAuth";

// Turn Firebase error codes into messages volunteers can act on.
function friendlyError(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case "auth/invalid-credential":
      case "auth/invalid-email":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "Email or password is wrong.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a few minutes and try again.";
      case "auth/network-request-failed":
        return "No internet connection. Check the Wi-Fi and try again.";
    }
  }
  return "Couldn't sign in. Please try again.";
}

// One shared login for now (see README Decisions). The email is fixed so
// volunteers only need the password.
const SHARED_EMAIL = "repaircaferugby@gmail.com";

function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Where RequireAuth was sending them before it redirected here.
  const from = (location.state as { from?: Location } | null)?.from;
  const destination = from ? from.pathname + from.search : "/";

  // Already signed in (e.g. pressed Back to /login): skip the form.
  if (!loading && user) return <Navigate to={destination} replace />;

  const handleSignIn = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, SHARED_EMAIL, password);
      // AuthProvider picks up the new user via onAuthStateChanged.
      navigate(destination, { replace: true });
    } catch (err) {
      setError(friendlyError(err));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSignIn} className="login">
      <h2>Sign in</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {/* Read-only, but still sent so password managers can match it. */}
      <input type="email" autoComplete="username" value={SHARED_EMAIL} readOnly aria-label="Email" />
      <input
        type="password"
        placeholder="Password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default Login;
