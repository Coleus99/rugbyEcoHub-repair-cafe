import type { Fixer } from "../lib/api";

// <option>s for a fixer dropdown: people signed up on Restarters for the
// session first, then everyone else in HubSpot's list.
export default function FixerOptions({ fixers }: { fixers: Fixer[] }) {
  const signedUp = fixers.filter((f) => f.signedUp);
  const others = fixers.filter((f) => !f.signedUp);
  const options = (list: Fixer[]) =>
    list.map((f) => (
      <option key={f.value} value={f.value}>
        {f.label}
      </option>
    ));
  if (signedUp.length === 0) return <>{options(others)}</>;
  return (
    <>
      <optgroup label="Signed up on Restarters">{options(signedUp)}</optgroup>
      {others.length > 0 && <optgroup label="Others">{options(others)}</optgroup>}
    </>
  );
}
