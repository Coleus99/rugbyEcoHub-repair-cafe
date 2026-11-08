import { createContext } from "react";
import type { User } from "firebase/auth";

export type AuthState = { user: User | null; loading: boolean };

export const AuthContext = createContext<AuthState>({ user: null, loading: true });
