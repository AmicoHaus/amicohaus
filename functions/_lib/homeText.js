// Shared checks for home text written by owners and admins (fair housing + privacy). Used by Mystery Home highlights,
// Then & Now notes and captions, and the handoff binder (codes only). They keep text about the home; they never judge people.
export const HOME_TEXT_NOTE = 'Describe the home, not who should live there or who lives nearby.';
export const STEERING_ERROR = 'Keep it about the home: leave out schools, safety, places of worship and who lives here or nearby (fair housing).';
// "safe"/"safety" and "integrated" only in their people/area sense: "seismic safety straps", "a gun safe" and
// "integrated appliances" are home facts and pass.
const STEERING_RE = /\b(schools?|school district|church(es)?|synagogues?|mosques?|temples?|safe(st)? (area|neighbou?rhood|street|community|place to (live|raise))|(neighbou?rhood|area|community) (is |feels )?safe|safety of the (area|neighbou?rhood|community)|crime|family[- ]friendly|families|kids|children|nursery|bachelor|singles|adults? only|retirees?|empty[- ]nesters?|demographics?|ethnic|(racially )?integrated (area|neighbou?rhood|community)|exclusive (area|neighbou?rhood)|walking distance to (a |the )?(church|school|temple|mosque|synagogue)|elementary|academy)\b/i;
// The matched words (shown back to the writer), or null when the text is about the home.
export function steeringProblem(text) { const m = STEERING_RE.exec(String(text || '')); return m ? m[0] : null; }
// A street address: a number, one to four words, then a street suffix ("1218 La Vida Ct").
const ADDRESS_RE = /\b\d{1,6}\s+(?:[A-Za-z][A-Za-z'.-]*\s+){1,4}(?:st|street|ave|avenue|rd|road|dr|drive|ct|court|ln|lane|way|blvd|boulevard|pl|place|cir|circle|ter|terrace|loop|pkwy|parkway|trl|trail|hwy|highway)\b/i;
export const ADDRESS_ERROR = 'Leave the street address out.';
export function addressProblem(text) { return ADDRESS_RE.test(String(text || '')); }
// Gate, alarm, garage or lockbox codes and passwords written into text.
const CODE_LIKE_RE = /\b(code|passcode|password|pin|combo|combination|lockbox|alarm|gate)\b\W{0,3}(?:is\s+)?[:#=]?\s*\d{3,}/i;
export const CODE_ERROR = 'Hand codes over in person instead of writing them here.';
export function codeProblem(text) { return CODE_LIKE_RE.test(String(text || '')); }
