// Attestation-sentence builder.
//
// attestation_text is stored verbatim on academy_attestations and
// printed on the certificate. What this returns is what the person
// legally attested to. Two definitions of a legal sentence will
// drift, so both call sites in AcademyFocus.js (SignBlock preview
// and SignFooter submit) route through here.
//
// Approved wording:
//   With a module split:
//     I, {name}, have read and understood {module title}, from the
//     {document title}, version {version}, and I will hold this
//     standard at my sites.
//   Without a module split (single-part document, moduleTitle empty):
//     I, {name}, have read and understood {document title}, version
//     {version}, and I will hold this standard at my sites.
//
// Module title derives from obligation.source_section via
// partShortTitle - same derivation the room and certificate use.

export function buildAttestationSentence({ displayName, moduleTitle, documentTitle, version }) {
  const name = String(displayName || "").trim();
  const doc = String(documentTitle || "").trim() || "this document";
  const mod = String(moduleTitle || "").trim();
  const ver = String(version || "").trim() || "?";
  if (mod && mod !== doc) {
    return `I, ${name}, have read and understood ${mod}, from the ${doc}, version ${ver}, and I will hold this standard at my sites.`;
  }
  return `I, ${name}, have read and understood ${doc}, version ${ver}, and I will hold this standard at my sites.`;
}
