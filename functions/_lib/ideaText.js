// Checks for the few free-text fields in the nuanced-ideas tools, on top of homeText.js (fair housing, address,
// codes; English and Spanish). They keep text about the space and the use: never an investment pitch (one owner, one
// buyer or user: securities), never a place to live (that is housing), never legal claims, never the kind of person.
import { steeringProblem, STEERING_ERROR, addressProblem, ADDRESS_ERROR, codeProblem, CODE_ERROR, foldAccents } from './homeText.js';
import { INVESTMENT_TERMS } from './devProjects.js';
export const INVEST_ERROR = 'Leave out returns, yields, income promises, shares and investors. Describe the space and the use: one owner, one buyer or user.';
export const LIVING_ERROR = "This tool isn't for a place to live. No one may live in the space; a home or room for rent belongs in a rental listing.";
export const LEGAL_WORD_ERROR = 'Leave legal words out (binding, guaranteed, approved, contract, deed). This is an idea in your own words; an attorney writes the real document.';
export const PERSON_ERROR = 'Describe the space and the use, not the kind of person you want.';
const YIELD_RE = /\b(passive income|cash ?flow|yields?|returns?|roi|cap rate|investors?|investment|fractional|royalt(y|ies)|income stream|rent stream|ingreso pasivo|rendimientos?|inversionistas?)\b|\d\s?%/i;
const LIVING_RE = /\b(live|lives|living(?! room)|sleep(s|ing)?|resid(e|es|ence|ing)|dwell(ing)?|tenants?|roommates?|(bed)?room for rent|move in|vivir|dormir|inquilin[oa]s?)\b/i;
const LEGAL_RE = /\b(binding|legally|guarantee[ds]?|approved by (the )?(city|hoa|county)|pre-?approved|easement deed|grant deed|contracts?|escrituras?|contratos?|garantizad[oa])\b/i;
// The kind of person, before OR after the noun: "Looking for a Christian couple", "Women only", "Local residents
// preferred", "Veterans welcome", "Perfect for a family", "No Section 8". "Only weekdays", "Great for a boat" and
// "Next to the family room" pass.
const WHO = '(tenants?|renters?|buyers?|users?|persons?|people|neighbou?rs?|residents?|locals?|couples?|famil(?:y|ies)|adults?|kids?|children|m[ae]n|wom[ae]n|males?|females?|ladies|christians?|seniors?|retirees?|students?|veterans?|speakers?|professionals?|singles)';
const PERSON_RE = new RegExp(`\\b(ideal|perfect|great|good|preferred|prefer|looking for|only|no|must be) (for )?(an? )?(\\w+ )?${WHO}\\b(?! (room|home|house)s?\\b)|\\b${WHO} (only|welcome|preferred|wanted)\\b|\\b(section 8|must be employed|someone from the neighbou?rhood)\\b`, 'i');
// The first problem's message, or null. living: false for an owner's question to their attorney ("can someone live there later?").
export function ideaTextProblem(text, { living = true } = {}) {
  const s = String(text || ''); const f = foldAccents(s);
  if (steeringProblem(s)) return STEERING_ERROR;
  if (addressProblem(s)) return ADDRESS_ERROR;
  if (codeProblem(s)) return CODE_ERROR;
  if (INVESTMENT_TERMS.test(s) || YIELD_RE.test(f)) return INVEST_ERROR;
  if (living && LIVING_RE.test(f)) return LIVING_ERROR;
  if (LEGAL_RE.test(f)) return LEGAL_WORD_ERROR;
  if (PERSON_RE.test(f)) return PERSON_ERROR;
  return null;
}
export function validZip(z) { return /^\d{5}$/.test(String(z || '')); }
// A street NAME only ("La Vida Ct" -> "la vida ct"): folded, lowercased, punctuation dropped, common suffixes shortened.
export const HOUSE_NUMBER_ERROR = 'Leave the house number out: a street name is enough.';
export function hasHouseNumber(s) { return /^\s*\d+\s+[A-Za-z]/.test(String(s || '')); }
export function streetKey(s) {
  return foldAccents(String(s || '')).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\bdrive\b/g, 'dr').replace(/\bcourt\b/g, 'ct').replace(/\broad\b/g, 'rd')
    .replace(/\blane\b/g, 'ln').replace(/\bplace\b/g, 'pl').replace(/\bboulevard\b/g, 'blvd').replace(/\bcircle\b/g, 'cir').replace(/\bterrace\b/g, 'ter');
}
// One line every option, flag and idea carries (Rudy: never say an option is rule-free).
export const HOA_CITY_LINE = "Check your HOA rules and your city's rules first.";
