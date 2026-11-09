import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getCompletedTickets, getMeta, getTickets, type Meta, type Stage, type Ticket } from "../lib/api";
import { doneView } from "../lib/done";
import { formatDate } from "../lib/format";
import { awaitingPrint, isPrinted, rememberedTab, rememberTab, type ListTab } from "../lib/listTab";
import { categoriesInUse, matchesSearch, shortRef } from "../lib/search";
import { bookingLabel, labelFor } from "../lib/ticketForm";

type State = { meta?: Meta; tickets?: Ticket[]; failedSyncs?: number; error?: string };
type Completed = { tickets?: Ticket[]; days?: number; error?: string };

// Repair tickets in three tabs:
// - To print, for reception: new bookings whose job sheet hasn't been
//   printed, so people who haven't arrived yet.
// - Repairs, for fixers: everything checked in, grouped by stage in board
//   order, newest first.
// - Done: the latest session's completed items and whether each reached
//   Restarters, plus any sync failures. Can widen to the last 90 days to
//   fix a wrong outcome or add notes afterwards.
// The search box above the tabs searches all three. Each tab shows its
// number of results, so you can see where an item is without switching.
export default function TicketList() {
  const [state, setState] = useState<State>({});
  const [reloads, setReloads] = useState(0);
  const [tab, setTab] = useState<ListTab>(rememberedTab);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [showAllDone, setShowAllDone] = useState(false);
  const [completed, setCompleted] = useState<Completed>({});

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

  // Completed tickets are fetched the first time they're needed (opening
  // Done, or searching, which covers all three tabs), and again on Refresh.
  const searching = !!query.trim() || !!category;
  const [wantCompleted, setWantCompleted] = useState(false);
  if ((tab === "done" || searching) && !wantCompleted) setWantCompleted(true);
  useEffect(() => {
    if (!wantCompleted) return;
    let cancelled = false;
    getCompletedTickets().then(
      ({ tickets, days }) => !cancelled && setCompleted({ tickets, days }),
      (err: Error) => !cancelled && setCompleted((c) => ({ ...c, error: err.message })),
    );
    return () => {
      cancelled = true;
    };
  }, [wantCompleted, reloads]);

  const { meta, tickets, failedSyncs, error } = state;
  const refresh = () => {
    setState((s) => ({ ...s, error: undefined }));
    setCompleted((c) => ({ ...c, error: undefined }));
    setReloads((n) => n + 1);
  };
  const chooseTab = (next: ListTab) => {
    setTab(next);
    rememberTab(next);
  };

  const firstStage = meta?.stages[0]?.id;
  const open = tickets ?? [];
  const tabTickets = { toPrint: open.filter((t) => awaitingPrint(t, firstStage)), repairs: open.filter((t) => !awaitingPrint(t, firstStage)), done: completed.tickets ?? [] };

  const categories = categoriesInUse([...open, ...tabTickets.done], meta?.options.restarters_category);
  // Drop a chosen category once no listed ticket uses it (e.g. after Refresh).
  const activeCategory = categories.some((c) => c.value === category) ? category : "";
  const matches = (list: Ticket[]) => list.filter((t) => matchesSearch(t, query, activeCategory));
  const filtering = !!query.trim() || !!activeCategory;
  const toPrint = matches(tabTickets.toPrint);
  const repairs = matches(tabTickets.repairs);
  const done = meta && doneView(matches(tabTickets.done), meta.stages, showAllDone || filtering);
  // While searching, every tab shows how many results it has.
  const doneShown = done ? done.failed.length + done.rest.length : 0;
  // Done's total is what the tab shows when not searching: the latest
  // session (or last 90 days) plus failures.
  const doneAll = meta && doneView(tabTickets.done, meta.stages, showAllDone);
  const doneTotal = completed.tickets && doneAll ? doneAll.failed.length + doneAll.rest.length : undefined;
  // While searching, Done covers the whole 90 days.
  const doneSearchTotal = completed.tickets?.length;

  return (
    <>
      <div className="page-title">
        <h1>Repairs</h1>
        <div className="actions">
          <button type="button" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>

      <div className="search" role="search">
        <input type="search" placeholder="Search all: item, name, fixer or ref" aria-label="Search all repairs" value={query} onChange={(e) => setQuery(e.target.value)} />
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

      <div className="tabs" role="tablist" aria-label="Which repairs">
        <TabButton current={tab} value="toPrint" onSelect={chooseTab} label="To print" total={tickets && tabTickets.toPrint.length} matches={filtering ? toPrint.length : undefined} />
        <TabButton current={tab} value="repairs" onSelect={chooseTab} label="Repairs" total={tickets && tabTickets.repairs.length} matches={filtering ? repairs.length : undefined} />
        <TabButton current={tab} value="done" onSelect={chooseTab} label="Done" total={filtering ? doneSearchTotal : doneTotal} matches={filtering && completed.tickets ? doneShown : undefined} alert={failedSyncs ? `${failedSyncs} failed` : undefined} />
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {!error && !tickets && <p>Loading…</p>}

      {meta && tickets && tab === "toPrint" && (
        <div role="tabpanel" aria-label="To print">
          <p className="muted">Print a job sheet when someone arrives. It then moves to Repairs. Anything left here at the end of the session is a no-show.</p>
          {toPrint.length === 0 && <p>{filtering ? "No bookings to print match." : "Nothing to print."}</p>}
          <StageGroups stages={meta.stages.filter((s) => s.open)} tickets={toPrint} meta={meta} />
        </div>
      )}

      {meta && tickets && tab === "repairs" && (
        <div role="tabpanel" aria-label="Repairs">
          {repairs.length === 0 && <p>{filtering ? "No checked-in repairs match." : "No repairs checked in yet. Job sheets printed from To print show up here."}</p>}
          <StageGroups stages={meta.stages.filter((s) => s.open)} tickets={repairs} meta={meta} />
        </div>
      )}

      {meta && tab === "done" && (
        <div role="tabpanel" aria-label="Done">
          {completed.error && <p role="alert" className="error">{completed.error}</p>}
          {!completed.error && !completed.tickets && <p>Loading…</p>}
          {done && completed.tickets && (
            <>
              <div className="done-summary">
                {done.day && !filtering && (
                  <p>
                    <strong>{formatDate(done.day)}</strong>: {done.synced} of {done.syncable} on Restarters
                  </p>
                )}
                {!filtering && (
                  <label className="checkbox">
                    <input type="checkbox" checked={showAllDone} onChange={(e) => setShowAllDone(e.target.checked)} />
                    Show the last {completed.days ?? 90} days
                  </label>
                )}
              </div>

              {done.failed.length > 0 && (
                <section className="failed-group">
                  <h2>
                    Sync failed <span className="count">{done.failed.length}</span>
                  </h2>
                  <p className="muted">Open each one to see what Restarters needs, fix it and save.</p>
                  <ul className="ticket-list">
                    {done.failed.map((t) => (
                      <TicketCard key={t.id} ticket={t} meta={meta} done />
                    ))}
                  </ul>
                </section>
              )}

              {done.failed.length + done.rest.length === 0 && <p>{filtering ? `Nothing completed in the last ${completed.days ?? 90} days matches.` : "Nothing completed yet."}</p>}
              <StageGroups stages={meta.stages.filter((s) => !s.open)} tickets={done.rest} meta={meta} done />
            </>
          )}
        </div>
      )}
    </>
  );
}

// "Repairs (12)", or "Repairs (3 of 12)" while searching. Done can add
// "· 1 failed".
function TabButton({ current, value, onSelect, label, total, matches, alert }: { current: ListTab; value: ListTab; onSelect: (tab: ListTab) => void; label: string; total?: number; matches?: number; alert?: string }) {
  const count = total === undefined ? "" : matches === undefined ? `(${total})` : `(${matches} of ${total})`;
  return (
    <button type="button" role="tab" aria-selected={current === value} className="tab" onClick={() => onSelect(value)}>
      {label} {count && <span className="count">{count}</span>}
      {alert && <span className="error tab-alert"> · {alert}</span>}
    </button>
  );
}

// One section per stage that has tickets, in board order.
function StageGroups({ stages, tickets, meta, done }: { stages: Stage[]; tickets: Ticket[]; meta: Meta; done?: boolean }) {
  return stages.map((stage) => {
    const inStage = tickets.filter((t) => t.properties.hs_pipeline_stage === stage.id);
    if (inStage.length === 0) return null;
    return (
      <section key={stage.id}>
        <h2>
          {stage.label} <span className="count">{inStage.length}</span>
        </h2>
        <ul className="ticket-list">
          {inStage.map((t) => (
            <TicketCard key={t.id} ticket={t} meta={meta} done={done} />
          ))}
        </ul>
      </section>
    );
  });
}

// On the Done tab, cards say where each item is on Restarters instead of
// offering a print.
function TicketCard({ ticket, meta, done }: { ticket: Ticket; meta: Meta; done?: boolean }) {
  const p = ticket.properties;
  const makeModel = [p.repair_item_brand, p.repair_item_model].filter(Boolean).join(" ");
  const category = labelFor(meta.options.restarters_category, p.restarters_category);
  // Completed tickets show when they were completed rather than booked.
  const when = p.closed_date ? `Completed ${formatDate(p.closed_date)}` : bookingLabel(p);
  const details = [ticket.firstName, category, p.repair_fixer && `Fixer ${p.repair_fixer}`, when].filter(Boolean);
  const syncs = !!meta.stages.find((s) => s.id === p.hs_pipeline_stage)?.restartersStatus;

  return (
    <li className="ticket-card">
      <Link to={`/tickets/${ticket.id}`} className="ticket-main">
        <span className="ref">#{shortRef(ticket.id)}</span> <strong>{p.subject || "(no name)"}</strong>
        {makeModel && <span> · {makeModel}</span>}
        {p.restarters_sync_status === "Error" && <span className="badge error"> Sync failed</span>}
        <div className="muted">{details.join(" · ")}</div>
        {done && p.restarters_sync_status === "Error" && <div className="error">{p.restarters_sync_error}</div>}
        {!done && p.content && <div className="issue">{p.content}</div>}
      </Link>
      {done ? (
        <span className="ticket-sync">{p.restarters_sync_status === "Synced" ? "On Restarters" : syncs && p.restarters_sync_status !== "Error" ? "Not synced" : ""}</span>
      ) : (
        <Link to={`/tickets/${ticket.id}/print`} className={isPrinted(ticket) ? "ticket-print reprint" : "ticket-print"}>
          {isPrinted(ticket) ? "Reprint" : "Print"}
        </Link>
      )}
    </li>
  );
}
