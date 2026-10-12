// sc-chase guard predicate.
//
// Pure decision for the "fully-entered -> skip" chase guard. Lives in
// its own file so the route test can import it without pulling in
// next/server (the route itself does, which Node's test runner cannot
// resolve). See the inline guard in route.js.

export function isWeekFullyEntered(comp) {
  const missing = (comp && comp.missingDates) || [];
  return missing.length === 0;
}
