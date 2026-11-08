import { Link } from "react-router";

// Placeholder. Will load open tickets from /api/tickets.
export default function TicketList() {
  return (
    <>
      <h1>Tickets</h1>
      <ul>
        <li>
          <Link to="/tickets/1">Example ticket 1</Link>
        </li>
      </ul>
    </>
  );
}
