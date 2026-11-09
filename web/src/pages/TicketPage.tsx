import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { getMeta, getTicket, removeFromRestarters, syncTicket, updateTicket, type Meta, type Option, type SyncResult, type Ticket } from "../lib/api";
import { bookingLabel, changedProperties, itemTypeFromCategory, labelFor, needsWeight, outcomeFields, toDraft, type Draft } from "../lib/ticketForm";
import { shortRef } from "../lib/search";
import { rememberedFixer, rememberFixer } from "../lib/deviceFixer";

// Matches EDITABLE_PROPERTIES in functions/src/app.ts.
const FORM_PROPERTIES = ["hs_pipeline_stage", "subject", "content", "restarters_category", "repair_item_type", "repair_item_brand", "repair_item_model", "repair_item_year_made", "repair_item_weight_kg", "repair_problem_and_fix", "repair_spare_parts", "repair_next_steps", "repair_barrier", "repair_notes", "repair_fixer"];

type State = { meta?: Meta; ticket?: Ticket; error?: string };

// Loads the ticket, then hands it to the form. The key resets the form
// when you move to a different ticket.
export default function TicketPage() {
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
  if (error)
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  if (!meta || !ticket || ticket.id !== id) return <p>Loading…</p>;
  return <TicketForm key={ticket.id} initial={ticket} meta={meta} />;
}

type Status = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

function TicketForm({ initial, meta }: { initial: Ticket; meta: Meta }) {
  const [ticket, setTicket] = useState(initial);
  // The fixer last saved on this device, if they're still in the list.
  // It's filled in on a ticket with no fixer once someone edits another
  // field, not on open, so just viewing or printing a ticket changes nothing.
  const [prefilledFixer] = useState(() => {
    const name = rememberedFixer();
    const known = meta.options.repair_fixer?.some((o) => o.value === name);
    return !initial.properties.repair_fixer && known ? name : "";
  });
  // Once they've used the Fixer dropdown themselves (even to clear it),
  // stop filling it in.
  const [fixerTouched, setFixerTouched] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial.properties, FORM_PROPERTIES));
  const withFixer = (d: Draft): Draft => (prefilledFixer && !fixerTouched && !d.repair_fixer ? { ...d, repair_fixer: prefilledFixer } : d);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const changes = changedProperties(ticket.properties, draft);
  const dirty = Object.keys(changes).length > 0;
  const p = ticket.properties;

  const set = (name: string, value: string) => {
    if (name === "repair_fixer") setFixerTouched(true);
    setDraft((d) => (name === "repair_fixer" ? { ...d, [name]: value } : withFixer({ ...d, [name]: value })));
    setStatus({ kind: "idle" });
  };

  // Next steps and barrier only apply to some outcomes. Changing the status
  // clears whichever no longer applies, so a Repaired item doesn't keep an
  // old barrier.
  const statusOf = (stageId: string) => meta.stages.find((s) => s.id === stageId)?.restartersStatus;
  const show = outcomeFields(statusOf(draft.hs_pipeline_stage));
  const setStage = (stageId: string) => {
    const next = outcomeFields(statusOf(stageId));
    setDraft((d) =>
      withFixer({
        ...d,
        hs_pipeline_stage: stageId,
        repair_next_steps: next.nextSteps ? d.repair_next_steps : "",
        repair_barrier: next.barrier ? d.repair_barrier : "",
      }),
    );
    setStatus({ kind: "idle" });
  };

  // Restarters needs an item type. For most categories it's the category
  // name without the size, filled in here (and again by the server when it
  // syncs). Misc items need one typed in, so switching to Misc clears it.
  const setCategory = (value: string) => {
    const options = meta.options.restarters_category;
    setDraft((d) =>
      withFixer({
        ...d,
        restarters_category: value,
        // Weight is only asked for on Misc items, so drop it otherwise.
        repair_item_weight_kg: needsWeight(value) ? d.repair_item_weight_kg : "",
        repair_item_type: !needsWeight(value) ? itemTypeFromCategory(labelFor(options, value)) : needsWeight(d.restarters_category) ? d.repair_item_type : "",
      }),
    );
    setStatus({ kind: "idle" });
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!dirty) return;
    setStatus({ kind: "saving" });
    try {
      const { ticket: saved, sync } = await updateTicket(ticket.id, changes);
      setTicket(saved);
      setDraft(toDraft(saved.properties, FORM_PROPERTIES));
      rememberFixer(saved.properties.repair_fixer ?? "");
      setStatus({ kind: "saved", message: syncMessage(sync) });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const text = (name: string, label: string, props: Partial<InputProps> = {}) => (
    <Field label={label} hint={props.hint}>
      <input type={props.type ?? "text"} step={props.step} inputMode={props.type === "number" ? "decimal" : undefined} value={draft[name]} onChange={(e) => set(name, e.target.value)} required={props.required} />
    </Field>
  );
  const area = (name: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <textarea rows={3} value={draft[name]} onChange={(e) => set(name, e.target.value)} />
    </Field>
  );
  const select = (name: string, label: string, options: Option[], hint?: string) => (
    <Field label={label} hint={hint}>
      <Select value={draft[name]} options={options} onChange={(v) => set(name, v)} />
    </Field>
  );

  return (
    <>
      <form onSubmit={save} className="ticket-form">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">← Open repairs</Link>
          <span aria-current="page">#{shortRef(ticket.id)}</span>
        </nav>
        <div className="page-title">
          <h1>{p.subject || "Ticket"}</h1>
          <Link to={`/tickets/${ticket.id}/print`}>{p.repair_printed_at ? "Reprint" : "Print"}</Link>
        </div>
        <p className="muted">
          {ticket.firstName && `${ticket.firstName} · `}
          Ref #{shortRef(ticket.id)}
          {bookingLabel(p) && ` · ${bookingLabel(p)}`}
        </p>

        <div className="row">
          <Field label="Status">
            <Select value={draft.hs_pipeline_stage} options={meta.stages.map((s) => ({ label: s.label, value: s.id }))} onChange={setStage} required />
          </Field>
          <Field label="Fixer" hint={[prefilledFixer && draft.repair_fixer === prefilledFixer && !p.repair_fixer && "Filled in from this device", p.repair_fixers && `Worked on by ${p.repair_fixers}`].filter(Boolean).join(". ") || undefined}>
            <Select value={draft.repair_fixer} options={meta.options.repair_fixer ?? []} onChange={(v) => set("repair_fixer", v)} />
          </Field>
        </div>

        <fieldset className="group-item">
          <legend>Item</legend>
          {text("subject", "Item name", { required: true })}
          {area("content", "Issue")}
          <Field label="Category">
            <Select value={draft.restarters_category} options={meta.options.restarters_category ?? []} onChange={setCategory} />
          </Field>
          {needsWeight(draft.restarters_category) && text("repair_item_type", "Item type", { hint: "A short plain name, e.g. Sewing machine. Restarters needs this for Misc items." })}
          <div className="row">
            {text("repair_item_brand", "Brand")}
            {text("repair_item_model", "Model")}
          </div>
          <div className="row">
            {text("repair_item_year_made", "Year made", { type: "number", hint: "Rough guess is fine" })}
            {needsWeight(draft.restarters_category) && text("repair_item_weight_kg", "Weight (kg)", { type: "number", step: "0.1", hint: "A rough guess is fine, no need to weigh it." })}
          </div>
        </fieldset>

        <fieldset className="group-repair">
          <legend>Repair</legend>
          {area("repair_problem_and_fix", "Problem and fix", "What was wrong and what you did. Shared publicly on Restarters, so don't include names.")}
          {select("repair_spare_parts", "Spare parts", meta.options.repair_spare_parts ?? [])}
          {show.nextSteps && select("repair_next_steps", "Next steps", meta.options.repair_next_steps ?? [])}
          {show.barrier && select("repair_barrier", "Barrier to repair", meta.options.repair_barrier ?? [])}
          {area("repair_notes", "Notes", "Also shared publicly on Restarters. No names or contact details.")}
        </fieldset>

        <RestartersPanel ticket={ticket} meta={meta} onChange={setTicket} disabled={dirty} />

        <div className="save-bar">
          <button type="submit" disabled={!dirty || status.kind === "saving"}>
            {status.kind === "saving" ? "Saving…" : "Save"}
          </button>
          {status.kind === "saved" && <span role="status">Saved to HubSpot{status.message && `. ${status.message}`}</span>}
          {status.kind === "error" && (
            <span role="alert" className="error">
              {status.message}
            </span>
          )}
          {status.kind === "idle" && dirty && <span className="muted">Unsaved changes</span>}
        </div>
      </form>
    </>
  );
}

// "Needs follow-up", "Repaired", or "Can't repair"
function quotedList(items: string[]): string {
  const quoted = items.map((i) => `"${i}"`);
  if (quoted.length < 2) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted.at(-1)}`;
}

function syncMessage(sync: SyncResult): string {
  if (sync.status === "Synced") return `Synced to Restarters (device ${sync.deviceId})`;
  if (sync.status === "Error") return `Restarters sync failed: ${sync.error}`;
  return "";
}

// Restarters status for this ticket, with Resync and Remove. Disabled while
// there are unsaved edits, so it never syncs stale details.
function RestartersPanel({ ticket, meta, onChange, disabled }: { ticket: Ticket; meta: Meta; onChange: (t: Ticket) => void; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const p = ticket.properties;
  const deviceId = p.restarters_device_id;
  const syncing = meta.stages.filter((s) => s.restartersStatus).map((s) => s.label);

  const run = async (action: () => Promise<Ticket>, done: string) => {
    setBusy(true);
    setMessage("");
    try {
      onChange(await action());
      setMessage(done);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resync = () =>
    run(async () => {
      const { ticket: t, sync } = await syncTicket(ticket.id);
      if (sync.status === "Skipped") throw new Error("This status doesn't sync to Restarters.");
      return t;
    }, "");

  const remove = () => {
    if (!confirm("Delete this item from Restarters? The HubSpot ticket stays.")) return;
    run(() => removeFromRestarters(ticket.id), "Removed from Restarters.");
  };

  return (
    <fieldset>
      <legend>Restarters</legend>
      <p>
        {p.restarters_sync_status === "Synced" && `Synced as device ${deviceId} on event ${p.restarters_event_id}.`}
        {p.restarters_sync_status === "Error" && <span className="error">Sync failed: {p.restarters_sync_error}</span>}
        {!p.restarters_sync_status && "Not yet synced."}
        {p.restarters_sync_status === "Not synced" && "Removed from Restarters. Resync to add it again."}
        {p.restarters_sync_status !== "Synced" && syncing.length > 0 && <span className="muted"> Saving with status {quotedList(syncing)} sends it to Restarters.</span>}
      </p>
      <div className="actions">
        <button type="button" onClick={resync} disabled={busy || disabled}>
          {busy ? "Working…" : "Resync now"}
        </button>
        {deviceId && (
          <button type="button" onClick={remove} disabled={busy || disabled}>
            Remove from Restarters
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}

type InputProps = { type: string; step: string; required: boolean; hint: string };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function Select(props: { value: string; options: Option[]; onChange: (value: string) => void; required?: boolean }) {
  const known = props.options.some((o) => o.value === props.value);
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)} required={props.required}>
      <option value="">Choose…</option>
      {/* Keep a value HubSpot has that's no longer an option, so it isn't lost on save. */}
      {props.value && !known && <option value={props.value}>{props.value}</option>}
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
