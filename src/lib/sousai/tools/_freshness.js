// Freshness stamps for tool payloads. Round 3 (R3-04): the tool layer no
// longer emits a clock time - the model was quoting the SERVER clock into
// answer prose ("PG live as of 4:01 PM UTC") while the UI freshness chip
// correctly showed the browser-local time. The interface owns the clock;
// the tools own the date.
//
// pgLiveNow() - for tools that read Postgres at request time. The data IS
// current, so no date qualifier is needed - the string is just "PG live".
// pgLiveAsOf(date) - for tools whose data is a bulk-load snapshot
// (directory), the loaded date is meaningful. Renders "PG live · YYYY-MM-DD".
export function pgLiveNow() {
  return "PG live";
}
export function pgLiveAsOf(dateStr) {
  if (!dateStr) return "PG live";
  return `PG live · ${dateStr}`;
}
