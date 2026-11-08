import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import { AuthContext, type AuthState } from "./authContext";

// The only place the signed-in user is set. Login and sign-out just call
// Firebase. This listener then updates every component that uses useAuth().
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    // Fires once on load (restored session or null), then on every sign-in/out.
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setState({ user, loading: false });
    });
    return unsubscribe; // stop listening if the provider unmounts
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
