import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { checkIn, fixersOf, getCompletedTickets, getMeta, getTickets, updateTicket, type Meta, type Session, type Stage, type Ticket } from "../lib/api";
import { doneView, ukDay } from "../lib/done";
import { formatDate } from "../lib/format";
import { assignChanges, awaitingCheckIn, byQueue, isFollowUp, isPrinted, isReturning, printGroups, queueLabel, rememberedTab, rememberTab, todaysNumber, type ListTab } from "../lib/listTab";
import { useMe } from "../lib/deviceFixer";
import FixerOptions from "./FixerOptions";
import { categoriesInUse, matchesSearch, shortRef } from "../lib/search";
import { bookingLabel, labelFor } from "../lib/ticketForm";

// loadedFor is the reload count the data (or error) came from, so the
// Refresh button can spin until both requests have answered.
type State = { meta?: Meta; tickets?: Ticket[]; failedSyncs?: number; error?: string; loadedFor?: number };
type Completed = { tickets?: Ticket[]; days?: number; session?: Session | null; error?: string; loadedFor?: number };

// "Only mine" on Repairs, remembered on this device.
const MINE_KEY = "repairCafe.onlyMine";
const rememberedMine = () => {
  try {
    return localStorage.getItem(MINE_KEY) === "1";
  } catch {
    return false;
  }
};

// Repair tickets in three tabs:
// - Check in, for reception: bookings that haven't been checked in, so
//   people who haven't arrived yet. Check in gives them today's next queue
//   number for the whiteboard. Printing a job sheet is optional and checks
//   them in too.
// - Repairs, for fixers: everything checked in, grouped by stage in board
//   order, today's queue in number order. Fixers can show only their own
//   items, or take an unassigned one.
// - Done: the latest session's completed items, plus sync errors and
//   finished-with follow-ups (Professional help, Do it yourself) from any
//   day, and whether each reached Restarters.
//   Searching it covers the last 90 days, to fix a wrong outcome or add
//   notes afterwards.
// The search box above the tabs searches all three. Each tab shows its
// number of results, so you can see where an item is without switching.
export default function TicketList() {
  const [state, setState] = useState<State>({});
  const [reloads, setReloads] = useState(0);
  const [tab, setTab] = useState<ListTab>(rememberedTab);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [completed, setCompleted] = useState<Completed>({});
  const [onlyFailed, setOnlyFailed] = useState(false);
  // Bookings ticked on To print, to print their job sheets in one go.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const [notice, setNotice] = useState("");
  const [checkingIn, setCheckingIn] = useState("");
  const [onlyMine, setOnlyMine] = useState(rememberedMine);
  const me = useMe();
  const today = ukDay(new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMeta(reloads > 0), getTickets()]).then(
      ([meta, { tickets, failedSyncs }]) => !cancelled && setState({ meta, tickets, failedSyncs, loadedFor: reloads }),
      (err: Error) => !cancelled && setState((s) => ({ ...s, error: err.message, loadedFor: reloads })),
    );
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  // Completed tickets load on open and on Refresh, separately so the open
  // list doesn't wait. The category filter needs them straight away.
  useEffect(() => {
    let cancelled = false;
    getCompletedTickets().then(
      ({ tickets, days, session }) => !cancelled && setCompleted({ tickets, days, session, loadedFor: reloads }),
      (err: Error) => !cancelled && setCompleted((c) => ({ ...c, error: err.message, loadedFor: reloads })),
    );
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  const { meta, tickets, failedSyncs, error } = state;
  const refreshing = state.loadedFor !== reloads || completed.loadedFor !== reloads;
  const refresh = () => {
    setState((s) => ({ ...s, error: undefined }));
    setCompleted((c) => ({ ...c, error: undefined }));
    setReloads((n) => n + 1);
  };
  // Swap in a ticket saved from the list (assigning a fixer).
  const replaceTicket = (saved: Ticket) => setState((s) => ({ ...s, tickets: s.tickets?.map((t) => (t.id === saved.id ? saved : t)) }));
  const chooseTab = (next: ListTab) => {
    setTab(next);
    rememberTab(next);
  };

  const firstStage = meta?.stages[0]?.id;
  const open = tickets ?? [];
  // Needs follow-up items are finished with for now, so they're on Done.
  const groups = printGroups(open, meta?.stages ?? [], today);
  const tabTickets = {
    toPrint: [...groups.today, ...groups.upcoming],
    // Needs follow-up items aren't being worked on: returning ones wait on
    // To print, the rest (Professional help, Do it yourself) are on Done.
    repairs: open.filter((t) => !awaitingCheckIn(t, firstStage) && !isFollowUp(t, meta?.stages ?? [])),
    finishedFollowUps: open.filter((t) => isFollowUp(t, meta?.stages ?? []) && !isReturning(t, meta?.stages ?? [])),
    done: completed.tickets ?? [],
  };

  const categories = categoriesInUse([...open, ...tabTickets.done], meta?.options.restarters_category);
  // Drop a chosen category once no listed ticket uses it (e.g. after Refresh).
  const activeCategory = categories.some((c) => c.value === category) ? category : "";
  const matches = (list: Ticket[]) => list.filter((t) => matchesSearch(t, query, activeCategory));
  const filtering = !!query.trim() || !!activeCategory;
  const toPrint = matches(tabTickets.toPrint);
  const printToday = matches(groups.today);
  const printUpcoming = matches(groups.upcoming);
  // Only count ticks on bookings still listed (and matching the search), so
  // a sheet printed elsewhere or a search that hides it isn't printed again.
  const chosen = toPrint.filter((t) => selected.has(t.id));
  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const allRepairs = matches(tabTickets.repairs);
  const mine = allRepairs.filter((t) => me && t.properties.repair_fixer === me);
  const showMine = onlyMine && !!me;
  const repairs = showMine ? mine : allRepairs;
  const chooseMine = (on: boolean) => {
    setOnlyMine(on);
    try {
      localStorage.setItem(MINE_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  };

  // Check in one or more bookings, one at a time. Each moves to Repairs
  // with its queue number, which the notice repeats for the whiteboard.
  const checkInTickets = async (list: Ticket[]) => {
    setNotice("");
    const numbers: string[] = [];
    let problem = "";
    try {
      for (const [i, t] of list.entries()) {
        setCheckingIn(list.length > 1 ? `Checking in ${i + 1} of ${list.length}…` : t.id);
        const saved = await checkIn(t.id);
        replaceTicket(saved);
        numbers.push(`${saved.properties.repair_queue_number ?? "?"} ${saved.properties.subject ?? ""}`.trim());
      }
    } catch (err) {
      problem = `Couldn't check in: ${(err as Error).message}`;
    } finally {
      setCheckingIn("");
      setSelected(new Set());
      const done = numbers.length === 0 ? "" : numbers.length === 1 ? `Checked in as number ${numbers[0]}. Write it on the board.` : `Checked in: ${numbers.join(", ")}. Write them on the board.`;
      setNotice([done, problem].filter(Boolean).join(" "));
    }
  };
  // Searching Done covers every day in the last 90, not just the session.
  const done = meta && doneView(matches(tabTickets.done), matches(tabTickets.finishedFollowUps), meta.stages, { sessionDay: completed.session?.date, allDays: filtering, onlyFailed });
  // While searching, every tab shows how many results it has.
  const doneAll = meta && doneView(tabTickets.done, tabTickets.finishedFollowUps, meta.stages, { sessionDay: completed.session?.date, allDays: filtering });
  const doneTotal = completed.tickets && doneAll ? doneAll.items.length : undefined;

  return (
    <>
      <div className="page-title">
        <h1>Repairs</h1>
        <div className="actions">
          <button type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing}>
            {refreshing && <span className="spinner" aria-hidden="true" />}
            {refreshing ? "Refreshing…" : "Refresh"}
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
        <TabButton current={tab} value="toPrint" onSelect={chooseTab} label="Check in" total={tickets && tabTickets.toPrint.length} matches={filtering ? toPrint.length : undefined} />
        <TabButton current={tab} value="repairs" onSelect={chooseTab} label="Repairs" total={tickets && tabTickets.repairs.length} matches={filtering || showMine ? repairs.length : undefined} />
        <TabButton current={tab} value="done" onSelect={chooseTab} label="Done" total={doneTotal} matches={filtering && done && completed.tickets ? done.items.length : undefined} alert={failedSyncs ? `${failedSyncs} ${failedSyncs === 1 ? "error" : "errors"}` : undefined} />
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {!error && !tickets && <p>Loading…</p>}
      {notice && (
        <p role="status" className="notice">
          {notice}{" "}
          <button type="button" className="link" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </p>
      )}

      {meta && tickets && tab === "toPrint" && (
        <div role="tabpanel" aria-label="Check in">
          <p className="muted">Check people in when they arrive. Each gets the next number for the whiteboard and moves to Repairs. Printing a job sheet is optional. Anything left under Today at the end of the session is a no-show.</p>
          {toPrint.length === 0 && <p>{filtering ? "No bookings to check in match." : "Nobody waiting to check in."}</p>}
          {toPrint.length > 0 && (
            <div className="print-selected">
              <button type="button" className="primary" disabled={chosen.length === 0 || !!checkingIn} onClick={() => checkInTickets(chosen)}>
                {checkingIn && chosen.length > 1 ? checkingIn : `Check in selected${chosen.length > 0 ? ` (${chosen.length})` : ""}`}
              </button>
              <button type="button" disabled={chosen.length === 0 || !!checkingIn} onClick={() => navigate(`/print?ids=${chosen.map((t) => t.id).join(",")}`)}>
                Print selected{chosen.length > 0 && ` (${chosen.length})`}
              </button>
              {chosen.length > 0 && (
                <button type="button" onClick={() => setSelected(new Set())}>
                  Clear selection
                </button>
              )}
            </div>
          )}
          <PrintGroup title="Today" tickets={printToday} meta={meta} selected={selected} onToggle={toggle} today={today} checkingIn={checkingIn} onCheckIn={(t) => checkInTickets([t])} />
          <PrintGroup title="Upcoming sessions" tickets={printUpcoming} meta={meta} selected={selected} onToggle={toggle} today={today} checkingIn={checkingIn} onCheckIn={(t) => checkInTickets([t])} />
        </div>
      )}

      {meta && tickets && tab === "repairs" && (
        <div role="tabpanel" aria-label="Repairs">
          <div className="mine-row">
            <label className="checkbox">
              <input type="checkbox" checked={showMine} disabled={!me} onChange={(e) => chooseMine(e.target.checked)} />
              Only mine{me && ` (${mine.length})`}
            </label>
            {!me && <span className="muted">Choose who you are at the top to see your items and take new ones.</span>}
          </div>
          {repairs.length === 0 && <p>{showMine ? "Nothing assigned to you. Untick Only mine to take an item." : filtering ? "No checked-in repairs match." : "No repairs checked in yet. People checked in on the Check in tab show up here."}</p>}
          <StageGroups stages={meta.stages.filter((s) => s.open)} tickets={repairs} meta={meta} onAssign={replaceTicket} today={today} me={me} />
        </div>
      )}

      {meta && tab === "done" && (
        <div role="tabpanel" aria-label="Done">
          {completed.error && <p role="alert" className="error">{completed.error}</p>}
          {!completed.error && !completed.tickets && <p>Loading…</p>}
          {done && completed.tickets && (
            <>
              <h2 className="group-title">
                {filtering ? `Search results, last ${completed.days ?? 90} days` : done.day ? `Latest session, ${formatDate(done.day)}` : "Done"}
                {!filtering && done.syncable > 0 && <span className="count"> ({done.synced} of {done.syncable} on Restarters)</span>}
              </h2>

              {done.failed > 0 && (
                <div className="failed-row">
                  <p>
                    <strong className="error">
                      {done.failed} {done.failed === 1 ? "error" : "errors"}
                    </strong>
                    : {done.failed === 1 ? "this item hasn't" : "these items haven't"} synced to Restarters. Open each one to see why, fix it and save.
                  </p>
                  <label className="checkbox">
                    <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
                    Show only errors
                  </label>
                </div>
              )}

              {done.items.length === 0 && <p>{filtering ? "Nothing done matches." : "Nothing done yet."}</p>}
              {/* Needs follow-up and sync failures are included whatever
                  their date, until they're reopened, closed or fixed. */}
              <DoneGroups items={done.items} meta={meta} today={today} />
            </>
          )}
        </div>
      )}
    </>
  );
}

// "Repairs (12)", or "Repairs (3 of 12)" while searching. Done can add
// "· 1 error" (a sync to Restarters that failed).
function TabButton({ current, value, onSelect, label, total, matches, alert }: { current: ListTab; value: ListTab; onSelect: (tab: ListTab) => void; label: string; total?: number; matches?: number; alert?: string }) {
  const count = total === undefined ? "" : matches === undefined ? `(${total})` : `(${matches} of ${total})`;
  return (
    <button type="button" role="tab" aria-selected={current === value} className="tab" onClick={() => onSelect(value)}>
      {label} {count && <span className="count">{count}</span>}
      {alert && <span className="error tab-alert"> · {alert}</span>}
    </button>
  );
}

// A To print group. Printing (or reprinting a returning item) checks it in
// and moves it to Repairs.
// Each card has a tick box for printing several at once, and the heading
// has one to tick the whole group.
function PrintGroup({ title, tickets, meta, selected, onToggle, today, checkingIn, onCheckIn }: { title: string; tickets: Ticket[]; meta: Meta; selected: Set<string>; onToggle: (ids: string[], on: boolean) => void; today: string; checkingIn: string; onCheckIn: (t: Ticket) => void }) {
  if (tickets.length === 0) return null;
  const ids = tickets.map((t) => t.id);
  const ticked = ids.filter((id) => selected.has(id)).length;
  return (
    <section>
      <h2 className="print-group-title">
        <input
          type="checkbox"
          aria-label={`Select all in ${title}`}
          checked={ticked === ids.length}
          ref={(el) => {
            if (el) el.indeterminate = ticked > 0 && ticked < ids.length;
          }}
          onChange={(e) => onToggle(ids, e.target.checked)}
        />
        {title} <span className="count">({tickets.length})</span>
      </h2>
      <ul className="ticket-list">
        {tickets.map((t) => (
          <TicketCard key={t.id} ticket={t} meta={meta} today={today} selected={selected.has(t.id)} onSelect={(on) => onToggle([t.id], on)} checkIn={{ busy: checkingIn === t.id, disabled: !!checkingIn, run: () => onCheckIn(t) }} />
        ))}
      </ul>
    </section>
  );
}

// Done: Repaired first, then everything else under "Not repaired", one
// subheading per stage in board order, so the stages still match HubSpot.
function DoneGroups({ items, meta, today }: { items: Ticket[]; meta: Meta; today: string }) {
  const doneStages = meta.stages.filter((s) => !s.open || s.restartersStatus);
  const repaired = doneStages.filter((s) => s.restartersStatus === "Fixed");
  const notRepaired = doneStages.filter((s) => s.restartersStatus !== "Fixed");
  const count = notRepaired.reduce((n, s) => n + items.filter((t) => t.properties.hs_pipeline_stage === s.id).length, 0);
  return (
    <>
      <StageGroups stages={repaired} tickets={items} meta={meta} today={today} done />
      {count > 0 && (
        <section className="not-repaired">
          <h2>
            Not repaired <span className="count">{count}</span>
          </h2>
          <StageGroups stages={notRepaired} tickets={items} meta={meta} today={today} done sub />
        </section>
      )}
    </>
  );
}

// One section per stage that has tickets, in board order. Open stages
// list today's queue first, in number order.
function StageGroups({ stages, tickets, meta, done, onAssign, sub, today, me }: { stages: Stage[]; tickets: Ticket[]; meta: Meta; done?: boolean; onAssign?: (t: Ticket) => void; sub?: boolean; today: string; me?: string }) {
  const Heading = sub ? "h3" : "h2";
  // On Done, the only follow-ups are ones handed on (Professional help,
  // Do it yourself), so say so.
  const label = (stage: Stage) => (done && stage.open && stage.restartersStatus ? `${stage.label} (outside the repair cafe)` : stage.label);
  return stages.map((stage) => {
    const filtered = tickets.filter((t) => t.properties.hs_pipeline_stage === stage.id);
    const inStage = done ? filtered : byQueue(filtered, today);
    if (inStage.length === 0) return null;
    return (
      <section key={stage.id}>
        <Heading>
          {label(stage)} <span className="count">{inStage.length}</span>
        </Heading>
        <ul className="ticket-list">
          {inStage.map((t) => (
            <TicketCard key={t.id} ticket={t} meta={meta} today={today} done={done} onAssign={onAssign} me={me} />
          ))}
        </ul>
      </section>
    );
  });
}

// On the Done tab, cards say where each item is on Restarters instead of
// offering a print.
// On Repairs (onAssign set), cards have a fixer dropdown next to Reprint,
// and Take it when this device's fixer is known and nobody has it.
// On Check in (onSelect set), cards have a tick box on the left and a
// Check in button, with Print as the optional second choice.
// Checked-in items show their queue number first.
type CheckInAction = { busy: boolean; disabled: boolean; run: () => void };
function TicketCard({ ticket, meta, done, onAssign, selected, onSelect, today, checkIn, me }: { ticket: Ticket; meta: Meta; done?: boolean; onAssign?: (t: Ticket) => void; selected?: boolean; onSelect?: (on: boolean) => void; today: string; checkIn?: CheckInAction; me?: string }) {
  const p = ticket.properties;
  const makeModel = [p.repair_item_brand, p.repair_item_model].filter(Boolean).join(" ");
  const category = labelFor(meta.options.restarters_category, p.restarters_category);
  // Completed tickets show when they were completed rather than booked.
  // Returning items show the session they're due back at, or TBC.
  const returning = isReturning(ticket, meta.stages);
  const when = p.closed_date ? `Completed ${formatDate(p.closed_date)}` : returning ? `Back on ${p.requested_repair_date ? formatDate(p.requested_repair_date) : "TBC"}` : bookingLabel(p);
  // Needs follow-up items also say what's next, e.g. "Professional help".
  const nextStep = p.closed_date === null && labelFor(meta.options.repair_next_steps, p.repair_next_steps);
  const details = [ticket.firstName, category, !onAssign && p.repair_fixer && `Fixer ${p.repair_fixer}`, nextStep && `Next: ${nextStep}`, when].filter(Boolean);
  const syncs = !!meta.stages.find((s) => s.id === p.hs_pipeline_stage)?.restartersStatus;
  // A returning item on Check in still has last session's number. Hide it.
  const queue = checkIn ? "" : queueLabel(ticket, today);
  const queueToday = !!todaysNumber(ticket, today);

  return (
    <li className={selected ? "ticket-card selected" : "ticket-card"}>
      {onSelect && (
        <label className="ticket-select">
          <input type="checkbox" checked={!!selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${p.subject || "item"} #${shortRef(ticket.id)} to print`} />
        </label>
      )}
      <Link to={`/tickets/${ticket.id}`} className="ticket-main">
        {queue && <span className={queueToday ? "queue-no" : "queue-no old"} aria-label={`Queue number ${queue}`}>{queue}</span>}
        <span className="ref">#{shortRef(ticket.id)}</span> <strong>{p.subject || "(no name)"}</strong>
        {makeModel && <span> · {makeModel}</span>}
        {p.restarters_sync_status === "Error" && <span className="badge error"> Sync error</span>}
        {returning && <span className="badge"> Returning</span>}
        <div className="muted">{details.join(" · ")}</div>
        {done && p.restarters_sync_status === "Error" && <div className="error">{p.restarters_sync_error}</div>}
        {!done && p.content && <div className="issue">{p.content}</div>}
      </Link>
      {done ? (
        <span className="ticket-sync">{p.restarters_sync_status === "Synced" ? "On Restarters" : syncs && p.restarters_sync_status !== "Error" ? "Not synced" : ""}</span>
      ) : (
        <div className="ticket-actions">
          {checkIn && (
            <button type="button" className="primary" onClick={checkIn.run} disabled={checkIn.disabled} aria-busy={checkIn.busy}>
              {checkIn.busy && <span className="spinner" aria-hidden="true" />}
              {checkIn.busy ? "Checking in…" : "Check in"}
            </button>
          )}
          {onAssign && <AssignFixer ticket={ticket} meta={meta} onSaved={onAssign} me={me} />}
          <Link to={`/tickets/${ticket.id}/print`} className={checkIn || isPrinted(ticket) ? "ticket-print reprint" : "ticket-print"}>
            {isPrinted(ticket) ? "Reprint" : checkIn ? "Print sheet" : "Print"}
          </Link>
        </div>
      )}
    </li>
  );
}

// Quick fixer assignment for the host, or Take it for a fixer. Saves as
// soon as a name is picked. A new item moves to In Progress at the same
// time, and choosing Unassigned moves an In Progress item back to New.
function AssignFixer({ ticket, meta, onSaved, me }: { ticket: Ticket; meta: Meta; onSaved: (t: Ticket) => void; me?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fixer = ticket.properties.repair_fixer ?? "";

  const assign = async (name: string) => {
    setBusy(true);
    setError("");
    try {
      const { ticket: saved } = await updateTicket(ticket.id, assignChanges(ticket, name, meta.stages));
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {me && !fixer && (
        <button type="button" className="primary" disabled={busy} onClick={() => assign(me)}>
          {busy ? "Taking…" : "Take it"}
        </button>
      )}
      <select aria-label={`Fixer for ${ticket.properties.subject ?? "item"}`} className="assign-fixer" value={fixer} disabled={busy} onChange={(e) => assign(e.target.value)}>
        <option value="">{fixer ? "Unassigned" : "Assign fixer"}</option>
        {/* Keep a name that's no longer listed, so it still shows. */}
        {fixer && !fixersOf(meta).some((f) => f.value === fixer) && <option value={fixer}>{fixer}</option>}
        <FixerOptions fixers={fixersOf(meta)} />
      </select>
      {error && <span role="alert" className="error assign-error">{error}</span>}
    </>
  );
}
