// Shared freshness stamp for tool payloads. Emits the human form
// "PG live as of {h:mm AM} {short-zone}" so the model never has a raw ISO
// to echo. The complementary system-prompt line asks the model to state
// freshness only as "PG live" - but even if it echoes the payload verbatim
// the output remains human-readable.
//
// On Vercel the runtime timezone is UTC so this renders "6:41 AM UTC" in
// production; locally it renders the machine's zone. Either shape is
// preferable to the raw ISO the pre-PR-A tools emitted.
export function pgLiveNow() {
  const d = new Date();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `PG live as of ${time}`;
}
