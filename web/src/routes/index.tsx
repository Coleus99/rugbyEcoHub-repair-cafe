import { createBrowserRouter } from "react-router";
import { RequireAuth } from "./authGuard";
import Login from "./Login";
import Layout from "../pages/Layout";
import TicketList from "../pages/TicketList";
import TicketPage from "../pages/TicketPage";
import TicketPrint from "../pages/TicketPrint";

// /login is public. Everything else sits under RequireAuth.
// RequireAuth and Layout have no `path`, so they wrap their children
// without adding anything to the URL. QR codes link to /tickets/:id.
export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      // The print view has no header, so it sits outside Layout.
      { path: "/tickets/:id/print", element: <TicketPrint /> },
      {
        element: <Layout />,
        children: [
          { path: "/", element: <TicketList /> },
          { path: "/tickets/:id", element: <TicketPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <p>Page not found.</p> },
]);
