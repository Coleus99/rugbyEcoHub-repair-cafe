import { useParams } from "react-router";

// Placeholder. Will be the A4 form and Dymo label with a QR code.
export default function TicketPrint() {
  const { id } = useParams();

  return <h1>Print ticket {id}</h1>;
}
