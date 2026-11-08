import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { getMeta, getTicket, type Meta, type Option, type Ticket } from "../lib/api";
import { labelFor, needsWeight } from "../lib/ticketForm";
import { shortRef } from "../lib/search";
import { formatDate } from "../lib/format";

type State = { meta?: Meta; ticket?: Ticket; error?: string };

// Stages that aren't an outcome a fixer would tick on paper.
const NOT_OUTCOMES = /^(new|in progress|no show)$/i;

// A4 job sheet. Booking details at the top, then space for the fixer to
// write the repair up by hand. The QR code opens the ticket in the app so
// it can be typed in afterwards.
export default function TicketPrint() {
  const { id = "" } = useParams();
  const [state, setState] = useState<State>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMeta(), getTicket(id)]).then(
      ([meta, ticket]) => !cancelled && setState({ meta, ticket }),
      (err: Error) => !cancelled && setState({ error: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const { meta, ticket, error } = state;
  if (error) return <p role="alert" className="error">{error}</p>;
  if (!meta || !ticket) return <p>Loading…</p>;

  const p = ticket.properties;
  const url = `${window.location.origin}/tickets/${ticket.id}`;
  const outcomes = meta.stages
    .filter((s) => !NOT_OUTCOMES.test(s.label))
    .map((s) => ({ label: s.label, value: s.id }));

  return (
    <div className="print-page">
      <div className="print-controls">
        <Link to={`/tickets/${ticket.id}`}>Back to ticket</Link>
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <header className="print-header">
        <div>
          <div className="muted">Rugby Eco Hub Repair Cafe · Ticket {ticket.id}</div>
          <div className="print-ref">Ref #{shortRef(ticket.id)}</div>
          <h1>{p.subject || "Repair item"}</h1>
          <dl className="print-details">
            <Detail label="Name" value={ticket.firstName} />
            <Detail
              label={p.requested_repair_date ? "Booked for" : "Added"}
              value={formatDate(p.requested_repair_date || p.createdate)}
            />
            <Detail label="Category" value={labelFor(meta.options.restarters_category, p.restarters_category)} />
            <Detail label="Make / model" value={[p.repair_item_brand, p.repair_item_model].filter(Boolean).join(" ")} />
            <Detail label="Year made" value={p.repair_item_year_made} />
            <Detail label="Worked on by" value={p.repair_fixers} />
            <Detail label="Issue" value={p.content} wide />
          </dl>
        </div>
        <figure className="qr">
          <QRCodeSVG value={url} size={112} marginSize={1} />
          <figcaption>Scan to update</figcaption>
        </figure>
      </header>

      <section className="print-repair">
        <h2>Repair</h2>
        <div className="write-row">
          <WriteIn label="Item type" value={p.repair_item_type} />
          {needsWeight(p.restarters_category) && <WriteIn label="Rough weight (kg)" value={p.repair_item_weight_kg} />}
        </div>

        <Ticks title="Fixer" options={meta.options.repair_fixer} value={p.repair_fixer} />

        <h3>Problem and fix</h3>
        <div className="write-box tall">{p.repair_problem_and_fix}</div>

        <Ticks title="Outcome" options={outcomes} value={p.hs_pipeline_stage} />
        <Ticks title="Spare parts" options={meta.options.repair_spare_parts} value={p.repair_spare_parts} />
        <Ticks title="Next steps (if it needs follow-up)" options={meta.options.repair_next_steps} value={p.repair_next_steps} />
        <Ticks title="Barrier (if it can't be repaired)" options={meta.options.repair_barrier} value={p.repair_barrier} />

        <h3>Notes</h3>
        <div className="write-box">{p.repair_notes}</div>
      </section>
    </div>
  );
}

function Detail({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "wide" : undefined}>
      <dt>{label}</dt>
      <dd>{value || "–"}</dd>
    </div>
  );
}

function WriteIn({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="write-in">
      <span>{label}</span>
      <span className="line">{value}</span>
    </div>
  );
}

// Empty boxes to mark by hand. Pre-marked if the ticket already has a value.
function Ticks({ title, options = [], value }: { title: string; options?: Option[]; value: string | null }) {
  return (
    <div className="ticks">
      <h3>{title}</h3>
      <ul>
        {options.map((o) => (
          <li key={o.value}>
            <span className="box" aria-hidden="true">
              {o.value === value && (
                // A cross corner to corner. Drawn as SVG because browsers skip
                // CSS backgrounds when printing.
                <svg viewBox="0 0 10 10">
                  <path d="M1 1 9 9M9 1 1 9" />
                </svg>
              )}
            </span>
            {o.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
