// A homeowner's checklist of common California pre-listing seller disclosures. Informational only — the same
// footing as every other preference field on a pre-listing, not legal advice and not a complete list for every
// property (a pre-1978 home, an HOA, a well, a septic system, etc. each add their own). Fixed item list lives
// in code, not the database, so adding or rewording an item never needs a migration — only which keys a given
// pre-listing has checked off is stored.
export const DISCLOSURE_ITEMS = [
  { key: 'tds', label: 'Transfer Disclosure Statement (TDS)', note: "The seller's own statement of the property's condition and known defects — required on almost every residential sale in California." },
  { key: 'nhd', label: 'Natural Hazard Disclosure (NHD) report', note: 'Whether the property sits in a flood, fire, earthquake fault, or other state-mapped hazard zone. Usually ordered through a disclosure company, not filled out by hand.' },
  { key: 'spq', label: 'Seller Property Questionnaire (SPQ)', note: "A more detailed companion to the TDS — permits, neighborhood issues, past repairs." },
  { key: 'lead_paint', label: 'Lead-based paint disclosure', note: 'Federally required for any home built before 1978, regardless of state.' },
  { key: 'smoke_co', label: 'Smoke & carbon monoxide detector compliance', note: 'California requires working detectors in the right locations before a sale closes.' },
  { key: 'water_heater', label: 'Water heater bracing statement', note: 'A signed statement that the water heater is braced/strapped against earthquake movement, as state law requires.' },
  { key: 'hoa_docs', label: 'HOA documents (if applicable)', note: 'CC&Rs, bylaws, financials, and any pending special assessments, if the property belongs to a homeowners association.' },
  { key: 'megan_law', label: "Megan's Law database disclosure", note: 'A standard notice directing buyers to the state database — required language, not something to look up yourself.' },
];

export function validDisclosureKeys(keys) {
  const known = new Set(DISCLOSURE_ITEMS.map(i => i.key));
  return [...new Set((Array.isArray(keys) ? keys : []).filter(k => known.has(k)))];
}
