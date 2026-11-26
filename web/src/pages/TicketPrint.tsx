import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { checkIn, getMeta, getTicket, getTicketKey, type Meta, type Option, type Ticket } from "../lib/api";
import { labelFor, needsWeight } from "../lib/ticketForm";
import { isReturning, todaysNumber } from "../lib/listTab";
import { ukDay } from "../lib/done";
import { keyExpiresAt } from "../lib/ticketKey";
import { shortRef } from "../lib/search";
import { formatDate, formatDateTime } from "../lib/format";

type Sheet = { ticket: Ticket; qrKey: string | null };
type State = { meta?: Meta; sheets?: Sheet[]; error?: string; printError?: string; checkedIn?: number };

// Stages that aren't an outcome a fixer would tick on paper.
const NOT_OUTCOMES = /^(new|in progress|no show)$/i;

// A4 job sheets, one per page. /tickets/:id/print prints one, and
// /print?ids=1,2,3 prints the ones ticked on the list's To print tab.
// Booking details at the top, then space for the fixer to write the repair
// up by hand. The QR code opens the ticket in the app so it can be typed
// in afterwards.
//
// Printing checks each visitor in (see checkIn in lib/api.ts): today's queue
// number, and the move from Check in to Repairs. A returning (More time
// needed) item goes back to New with no fixer. The Print button checks in
// first, so the number is on the sheet. Ctrl/Cmd+P skips that, so
// afterprint (fired when the print dialog closes) checks in anything left.
export default function TicketPrint() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const idList = id ?? search.get("ids") ?? "";
  const [state, setState] = useState<State>({});

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(idList.split(",").map((i) => i.trim()).filter(Boolean))];
    if (ids.length === 0) return;
    // The QR key is optional: without one, the code just links to the page.
    const sheet = (ticketId: string) => Promise.all([getTicket(ticketId), getTicketKey(ticketId).catch(() => null)]).then(([ticket, qrKey]) => ({ ticket, qrKey }));
    Promise.all([getMeta(), Promise.all(ids.map(sheet))]).then(
      ([meta, sheets]) => !cancelled && setState({ meta, sheets }),
      (err: Error) => !cancelled && setState({ error: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [idList]);

  const { meta, sheets } = state;
  // The latest sheets, for the afterprint handler to read when it runs.
  const sheetsRef = useRef(sheets);
  useEffect(() => {
    sheetsRef.current = sheets;
  }, [sheets]);
  const [busy, setBusy] = useState(false);
  // Sheets that printing changes: never printed, or a returning item.
  const toCheckIn = !meta || !sheets ? [] : sheets.filter((s) => !s.ticket.properties.repair_printed_at || isReturning(s.ticket, meta.stages));
  const pending = toCheckIn.map((s) => s.ticket.id).join(",");

  // One at a time, to stay well inside HubSpot's rate limit. Returns
  // whether they all worked.
  const checkInAll = async (ids: string[], when: "before" | "after") => {
    const stages = meta?.stages ?? [];
    const failed: string[] = [];
    let returned = 0;
    for (const ticketId of ids) {
      const current = sheetsRef.current?.find((s) => s.ticket.id === ticketId)?.ticket;
      if (!current) continue;
      try {
        if (isReturning(current, stages)) returned++;
        const ticket = await checkIn(ticketId, true);
        setState((s) => ({ ...s, sheets: s.sheets?.map((x) => (x.ticket.id === ticketId ? { ...x, ticket } : x)) }));
      } catch (err) {
        failed.push(`#${shortRef(ticketId)}: ${(err as Error).message}`);
      }
    }
    const lead = when === "before" ? "Couldn't check" : "Printed, but couldn't check";
    setState((s) => ({
      ...s,
      checkedIn: returned || s.checkedIn,
      printError: failed.length ? `${lead} ${failed.length === 1 ? "this one" : "these"} in. ${failed.join(". ")}` : undefined,
    }));
    return failed.length === 0;
  };
  const checkInRef = useRef(checkInAll);
  useEffect(() => {
    checkInRef.current = checkInAll;
  });

  useEffect(() => {
    if (!pending) return;
    const onAfterPrint = () => checkInRef.current(pending.split(","), "after");
    window.addEventListener("afterprint", onAfterPrint, { once: true });
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, [pending]);

  // Check in first so the sheets show their numbers, then print. If a
  // check-in fails, print anyway: paper still works without a number.
  const print = async () => {
    if (pending) {
      setBusy(true);
      await checkInAll(pending.split(","), "before");
      setBusy(false);
      // Let React draw the numbers before the print snapshot.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    window.print();
  };

  const { printError, checkedIn } = state;
  const error = idList.trim() ? state.error : "No job sheets chosen. Go back and tick some on Check in.";
  if (error) return <p role="alert" className="error">{error}</p>;
  if (!meta || !sheets) return <p>Loading…</p>;

  const single = sheets.length === 1 ? sheets[0].ticket : undefined;
  const allPrinted = sheets.every((s) => s.ticket.properties.repair_printed_at);
  const outcomes = meta.stages
    .filter((s) => !NOT_OUTCOMES.test(s.label))
    .map((s) => ({ label: s.label, value: s.id }));

  return (
    <div className="print-page">
      <div className="print-controls">
        <span>
          <Link to="/">Back to list</Link>
          {single && (
            <>
              {" "}
              · <Link to={`/tickets/${single.id}`}>Ticket</Link>
            </>
          )}
        </span>
        {checkedIn ? (
          <span role="status">{checkedIn === 1 ? "Checked back in. It's" : `${checkedIn} checked back in. They're`} on Repairs, ready to assign a fixer.</span>
        ) : single ? (
          allPrinted && <span role="status">Printed {formatDateTime(single.properties.repair_printed_at)}</span>
        ) : (
          <span role="status">{sheets.length} job sheets</span>
        )}
        <button type="button" onClick={print} disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Checking in…" : allPrinted ? "Reprint" : single ? "Print" : `Print ${sheets.length}`}
        </button>
      </div>
      {printError && <p role="alert" className="error print-controls">{printError}</p>}

      {sheets.map(({ ticket, qrKey }) => (
        <JobSheet key={ticket.id} ticket={ticket} qrKey={qrKey} meta={meta} outcomes={outcomes} queue={todaysNumber(ticket, ukDay(new Date().toISOString()))} />
      ))}
    </div>
  );
}

function JobSheet({ ticket, qrKey, meta, outcomes, queue }: { ticket: Ticket; qrKey: string | null; meta: Meta; outcomes: Option[]; queue: string | null }) {
  const p = ticket.properties;
  // With a key, scanning opens this ticket without signing in for 4 hours (long enough to print before a session starts).
  const url = `${window.location.origin}/tickets/${ticket.id}${qrKey ? `?key=${encodeURIComponent(qrKey)}` : ""}`;

  return (
    <article className="job-sheet">
      <header className="print-header">
        <div>
          <div className="muted">Rugby Eco Hub Repair Cafe · Ticket {ticket.id}</div>
          <div className="print-ref">
            {queue && <span className="print-queue">No. {queue}</span>}
            Ref #{shortRef(ticket.id)}
          </div>
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
          <figcaption>{qrKey ? `Scan to update. No sign-in needed until ${keyExpiresAt(qrKey)}` : "Scan to update"}</figcaption>
        </figure>
      </header>

      <section className="print-repair">
        <h2>Repair</h2>
        {/* Only Misc items need these. Other categories fill them in themselves. */}
        {needsWeight(p.restarters_category) && (
          <div className="write-row">
            <WriteIn label="Item type" value={p.repair_item_type} />
            <WriteIn label="Rough weight (kg)" value={p.repair_item_weight_kg} />
          </div>
        )}

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
    </article>
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
