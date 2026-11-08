import { useContext } from "react";
import { AuthContext } from "./authContext";

// Read the signed-in user anywhere under <AuthProvider>.
export const useAuth = () => useContext(AuthContext);
