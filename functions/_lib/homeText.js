// Shared checks for home text written by owners and admins (fair housing + privacy). Used by Mystery Home highlights,
// Then & Now notes and captions, and the handoff binder (codes only). They keep text about the home; they never judge people.
export const HOME_TEXT_NOTE = 'Describe the home, not who should live there or who lives nearby.';
export const STEERING_ERROR = 'Keep it about the home: leave out schools, safety, places of worship and who lives here or nearby (fair housing).';
// "safe"/"safety" and "integrated" only in their people/area sense: "seismic safety straps", "a gun safe" and
// "integrated appliances" are home facts and pass.
const STEERING_RE = /\b(schools?|school district|church(es)?|synagogues?|mosques?|temples?|safe(st)? (area|neighbou?rhood|street|community|place to (live|raise))|(neighbou?rhood|area|community) (is |feels )?safe|safety of the (area|neighbou?rhood|community)|crime|family[- ]friendly|families|kids|children|nursery|bachelor|singles|adults? only|retirees?|empty[- ]nesters?|demographics?|ethnic|(racially )?integrated (area|neighbou?rhood|community)|exclusive (area|neighbou?rhood)|walking distance to (a |the )?(church|school|temple|mosque|synagogue)|elementary|academy)\b/i;
// Spanish owner text gets the same checks (Spanish pages invite Spanish input). Text is folded first (accents removed,
// so "código" and "codigo" both match); the returned word is the folded form.
export function foldAccents(text) { return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// "cuarto familiar" (family room) and "recamara principal" are home facts and pass. No "kinder": it is English too
// ("a kinder, gentler yard"), and escuelas/guarderias cover the place.
const STEERING_ES_RE = /\b(escuelas?|colegios?|distrito escolar|preparatorias?|academias?|guarderias?|iglesias?|sinagogas?|mezquitas?|templos?|parroquias?|(zona|area|vecindario|barrio|colonia|calle|comunidad) (muy |bien )?segur[oa]|(zona|area|vecindario|barrio|colonia|comunidad) (es|se siente) segur[oa]|segur[oa] para (vivir|criar)|seguridad (del|de la) (zona|area|vecindario|barrio|colonia|comunidad)|crimen(es)?|delincuencia|criminalidad|(ideal|perfect[oa]) para (la |una )?familias?|familias|ninos|ninas|solteros?|solteras?|jubilados?|adultos mayores|solo adultos|tercera edad|demografi(a|co|ca)|etnic[oa]s?|exclusiv[oa] (zona|area|vecindario|barrio)|a pasos de la (iglesia|escuela))\b/i;
// National origin, incl. language, in both languages (fair housing). Home styles pass: "Spanish tile roof",
// "Mission style", "Latin-inspired courtyard".
const ORIGIN_RE = /\b((spanish|english|chinese|tagalog|vietnamese|korean)[- ]speaking|hispanics?|latin[oax]s?|latine|immigrants?|inmigrantes?|hispan[oa]s?|de habla (hispana|inglesa)|hablan? (espanol|ingles)|comunidad (hispana|latina|mexicana|asiatica|filipina))\b/i;
// NO /i flag on purpose: the street NAME words must be Capitalized, so "calle tranquila con 2 cocheras" (a quiet
// street with a 2-car garage) and English "access via the 12 ft side gate" pass; Mexican order ("Calle Bonita 123")
// and US order ("1234 Via Lugano", "123 Camino Real") are both refused. The name-then-number form leaves out "Via" and
// "Camino" (common in English: "Enter via Gate 2", "Access via Interstate 805", "via SR 125"); they're caught only
// number-first.
const ADDRESS_ES_RE = /\b(?:[Cc]alle|[Aa]venida|[Aa]vda\.?|[Aa]v\.|[Pp]aseo|[Cc]allejon|[Pp]rivada|[Cc]ircuito|[Cc]errada|[Cc]alzada|[Bb]ulevar)\s+(?:(?:de|del|la|las|los|el|y)\s+){0,2}(?:[A-Z][A-Za-z'.-]*\s+(?:(?:de|del|la|las|los|el|y)\s+){0,2}){1,4}#?\s*\d{1,6}\b|\b\d{1,6}\s+(?:[Cc]alle|[Aa]venida|[Aa]v\.?|[Cc]amino|[Pp]aseo|[Vv]ia|[Cc]allejon|[Pp]rivada|[Cc]ircuito|[Cc]errada|[Cc]alzada)\s+(?:(?:de|del|la|las|los|el|y)\s+){0,2}[A-Z]/;
const CODE_ES_RE = /\b(codigo|clave|contrasena|candado|alarma|porton|combinacion|nip)\b\W{0,3}(?:del? (?:la |el )?(?:porton|candado|alarma|garaje|cochera)\W{0,3})?(?:es\s+)?[:#=]?\s*\d{3,}/i;
// The matched words (shown back to the writer), or null when the text is about the home. English first (unchanged
// result for English text), then the Spanish and national-origin checks on folded text.
export function steeringProblem(text) { const f = foldAccents(text); const m = STEERING_RE.exec(String(text || '')) || STEERING_ES_RE.exec(f) || ORIGIN_RE.exec(f); return m ? m[0] : null; }
// A street address: a number, one to four words, then a street suffix ("1218 La Vida Ct").
const ADDRESS_RE = /\b\d{1,6}\s+(?:[A-Za-z][A-Za-z'.-]*\s+){1,4}(?:st|street|ave|avenue|rd|road|dr|drive|ct|court|ln|lane|way|blvd|boulevard|pl|place|cir|circle|ter|terrace|loop|pkwy|parkway|trl|trail|hwy|highway)\b/i;
export const ADDRESS_ERROR = 'Leave the street address out.';
export function addressProblem(text) { return ADDRESS_RE.test(String(text || '')) || ADDRESS_ES_RE.test(foldAccents(text)); }
// Gate, alarm, garage or lockbox codes and passwords written into text.
const CODE_LIKE_RE = /\b(code|passcode|password|pin|combo|combination|lockbox|alarm|gate)\b\W{0,3}(?:is\s+)?[:#=]?\s*\d{3,}/i;
export const CODE_ERROR = 'Hand codes over in person instead of writing them here.';
export function codeProblem(text) { return CODE_LIKE_RE.test(String(text || '')) || CODE_ES_RE.test(foldAccents(text)); }
