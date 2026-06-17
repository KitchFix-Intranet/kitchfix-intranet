// ════════════════════════════════════════════════════════════════════════════
// /playbook/d/[docId] · Project OPD · Full-page reader
// ════════════════════════════════════════════════════════════════════════════
//
// Wide reading surface for a single doc - the right place to actually read
// (vs the slide-over which is the quick preview).
//
// Middleware (src/middleware.js) gates auth at the edge already. The doc
// detail API enforces the page gate (owner-only v1) + per-doc access tier
// via opdAcl; an unauthorized viewer gets a 404 from the API and this client
// renders the not-found state. Same auth model as the slide-over.
// ════════════════════════════════════════════════════════════════════════════

import DocumentFullPageClient from "./DocumentFullPageClient";

export const metadata = {
  title: "Document · The Playbook · KitchFix",
  description: "Full-page reading surface for an operational document.",
};

export default async function DocumentFullPage({ params, searchParams }) {
  const { docId } = await params;
  const sp = await searchParams;
  const lang = sp?.lang === "es" ? "es" : "en";
  return <DocumentFullPageClient docId={docId} initialLang={lang} />;
}
