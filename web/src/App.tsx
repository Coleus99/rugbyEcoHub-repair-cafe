import { RouterProvider } from "react-router/dom";
import "./App.css";
import { AuthProvider } from "./lib/auth";
import { router } from "./routes";

function App() {
  // AuthProvider sits outside the router so every route can read the user.
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

export default App;
