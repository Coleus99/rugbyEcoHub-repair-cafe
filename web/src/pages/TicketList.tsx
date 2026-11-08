import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getMeta, getTickets, retryFailedSyncs, type Meta, type Ticket } from "../lib/api";
import { categoriesInUse, matchesSearch, shortRef } from "../lib/search";
import { bookingLabel, labelFor } from "../lib/ticketForm";

type State = { meta?: Meta; tickets?: Ticket[]; failedSyncs?: number; error?: string };

// Open repair tickets, grouped by stage in board order, newest first.
// The search box filters this list as you type.
export default function TicketList() {
  const [state, setState] = useState<State>({});
  const [reloads, setReloads] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [retryMessage, setRetryMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMeta(), getTickets()]).then(
      ([meta, { tickets, failedSyncs }]) => !cancelled && setState({ meta, tickets, failedSyncs }),
      (err: Error) => !cancelled && setState((s) => ({ ...s, error: err.message })),
    );
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  const { meta, tickets, failedSyncs, error } = state;
  const refresh = () => {
    setState((s) => ({ ...s, error: undefined }));
    setReloads((n) => n + 1);
  };

  // Failed syncs can be on closed tickets that aren't in this list, so the
  // server finds and retries all of them.
  const retry = async () => {
    setRetryMessage("Retrying…");
    try {
      const { retried, synced } = await retryFailedSyncs();
      setRetryMessage(`Synced ${synced} of ${retried}. Open any that still fail to see why.`);
      refresh();
    } catch (err) {
      setRetryMessage((err as Error).message);
    }
  };

  const categories = categoriesInUse(tickets ?? [], meta?.options.restarters_category);
  // Drop a chosen category once no open ticket uses it (e.g. after Refresh).
  const activeCategory = categories.some((c) => c.value === category) ? category : "";
  const shown = tickets?.filter((t) => matchesSearch(t, query, activeCategory));
  const filtering = !!query.trim() || !!activeCategory;

  return (
    <>
      <div className="page-title">
        <h1>Open repairs</h1>
        <div className="actions">
          {!!failedSyncs && (
            <button type="button" onClick={retry}>
              Resync {failedSyncs} failed
            </button>
          )}
          <button type="button" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
      {retryMessage && <p role="status">{retryMessage}</p>}

      <div className="search" role="search">
        <input
          type="search"
          placeholder="Item, name, fixer or ref"
          aria-label="Search open repairs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Category" value={activeCategory} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any category</option>
          {categories.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCategory("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {!error && !tickets && <p>Loading…</p>}

      {meta && shown && (
        <>
          {tickets!.length === 0 && <p>No open repairs.</p>}
          {filtering && shown.length === 0 && <p>No open repairs match.</p>}
          {meta.stages
            .filter((stage) => stage.open)
            .map((stage) => {
              const inStage = shown.filter((t) => t.properties.hs_pipeline_stage === stage.id);
              if (inStage.length === 0) return null;
              return (
                <section key={stage.id}>
                  <h2>
                    {stage.label} <span className="count">{inStage.length}</span>
                  </h2>
                  <ul className="ticket-list">
                    {inStage.map((t) => (
                      <TicketCard key={t.id} ticket={t} meta={meta} />
                    ))}
                  </ul>
                </section>
              );
            })}
        </>
      )}
    </>
  );
}

function TicketCard({ ticket, meta }: { ticket: Ticket; meta: Meta }) {
  const p = ticket.properties;
  const makeModel = [p.repair_item_brand, p.repair_item_model].filter(Boolean).join(" ");
  const category = labelFor(meta.options.restarters_category, p.restarters_category);
  const details = [ticket.firstName, category, p.repair_fixer && `Fixer ${p.repair_fixer}`, bookingLabel(p)].filter(Boolean);

  return (
    <li className="ticket-card">
      <Link to={`/tickets/${ticket.id}`} className="ticket-main">
        <span className="ref">#{shortRef(ticket.id)}</span> <strong>{p.subject || "(no name)"}</strong>
        {makeModel && <span> · {makeModel}</span>}
        {p.restarters_sync_status === "Error" && <span className="badge error"> Sync failed</span>}
        <div className="muted">{details.join(" · ")}</div>
        {p.content && <div className="issue">{p.content}</div>}
      </Link>
      <Link to={`/tickets/${ticket.id}/print`} className="ticket-print">
        Print
      </Link>
    </li>
  );
}
