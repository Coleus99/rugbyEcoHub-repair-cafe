import { Link, useParams } from "react-router";

// Placeholder. Will load and edit /api/tickets/:id.
export default function TicketPage() {
  const { id } = useParams();

  return (
    <>
      <h1>Ticket {id}</h1>
      <Link to={`/tickets/${id}/print`}>Print</Link>
    </>
  );
}
