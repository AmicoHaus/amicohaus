// Home facts batch, Phase 0 libraries: the Spanish and national-origin checks in homeText.js (English results
// unchanged), homeFacts.js (validator, read-back, lines, the assistance-animal note, the drive link to the home's
// area), pacificTime.js (labels name the zone), homeCosts.js (pets left the costs line; HOA parking kept), and the
// account export (46 statements, your own RSVPs and the open houses you hosted). In-memory SQLite stand-in for D1.
// Usage: node --disable-warning=ExperimentalWarning tools/home-facts-lib-test.mjs <projectRoot>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const mod = async (p) => import(pathToFileURL(`${root}/${p}`).href);
let failed = 0;
let passed = 0;
const check = (label, ok, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };

const ht = await mod('functions/_lib/homeText.js');
const hf = await mod('functions/_lib/homeFacts.js');
const pt = await mod('functions/_lib/pacificTime.js');
const hc = await mod('functions/_lib/homeCosts.js');
const anyProblem = t => !!(ht.steeringProblem(t) || ht.addressProblem(t) || ht.codeProblem(t));

// ---------------- 1. homeText: Spanish + national origin ----------------
for (const t of ['cerca de escuelas', 'Zona segura', 'ideal para familias', 'perfecto para niños', 'a pasos de la iglesia', 'Calle Bonita 123',
  '1234 Calle Serena', 'Av. Bonita #45', 'Avenida de los Reyes 450', 'código del portón 1234', 'clave: 5678', 'comunidad hispana',
  'vecinos que hablan español', 'Spanish-speaking neighbors', 'great for Latino families']) check(`homeText refuses "${t}"`, anyProblem(t));
for (const t of ['Cuarto familiar con chimenea', 'Recámara principal con baño', 'Patio con sombra', 'Seismic safety straps on the water heater',
  'Family room carpet', 'New gate and fence', 'Vía libre al patio', 'Casa en calle tranquila con 2 cocheras', 'Access via the 12 ft side gate',
  'Spanish tile roof, Mission style', 'Latin-inspired courtyard']) check(`homeText passes "${t}"`, !anyProblem(t), JSON.stringify([ht.steeringProblem(t), ht.addressProblem(t), ht.codeProblem(t)]));
check('Spanish address forms: Mexican order, US order, "Av." and "de los"', ht.addressProblem('Calle Bonita 123') && ht.addressProblem('1234 Calle Serena')
  && ht.addressProblem('Av. Bonita #45') && ht.addressProblem('Avenida de los Reyes 450') && ht.addressProblem('1234 Via Lugano'));
// English that uses "via" before a name and a number is not a Spanish address; Spanish street forms still are (review fix).
for (const t of ['Enter via Gate 2', 'come in via Door 3', 'Access via Interstate 805', 'via Highway 94', 'via Route 52', 'via SR 125', 'Parking via Lot B 2',
  'A kinder, gentler yard']) check(`homeText passes English "${t}"`, !anyProblem(t), JSON.stringify([ht.steeringProblem(t), ht.addressProblem(t), ht.codeProblem(t)]));
for (const t of ['1234 Via Lugano', '123 Camino Real', 'Calle Bonita 123', 'Avenida Juárez 45']) check(`homeText refuses the Spanish address "${t}"`, ht.addressProblem(t));
check('Spanish codes: "código del portón 1234" and "clave: 5678"', ht.codeProblem('código del portón 1234') && ht.codeProblem('clave: 5678'));
check('steeringProblem returns the folded match for Spanish', ht.steeringProblem('perfecto para niños') === 'ninos' && ht.steeringProblem('Zona segura') === 'Zona segura', ht.steeringProblem('perfecto para niños'));
check('foldAccents strips accents only', ht.foldAccents('código Recámara Vía ñ') === 'codigo Recamara Via n' && ht.foldAccents(null) === '');
// English results exactly as at HEAD a2e4e6f (worked out on the v45 homeText.js), for strings the existing suites use.
const ENGLISH = [
  ['Great for kids, near the school', 'kids', false, false], ['Safe neighborhood', 'Safe neighborhood', false, false], ['Great for kids', 'kids', false, false],
  ['The area feels safe', 'area feels safe', false, false], ['Family-friendly street', 'Family-friendly', false, false],
  ['Seismic safety straps on the water heater', null, false, false], ['Integrated fridge panels', null, false, false],
  ['Seismic safety straps on the water heater, a new gate and fence, and a family room with a fireplace.', null, false, false],
  ['New roof at 1218 La Vida Ct', null, true, false], ['1218 La Vida Ct kitchen', null, true, false], ['Corner lot at 1218 La Vida Ct', null, true, false],
  ['Side gate code: 4821', null, false, true], ['The alarm 1234 is by the door', null, false, true], ['Lockbox #5555', null, false, true],
  ['Pool passcode is 9911', null, false, true], ['Breaker 12 runs the garage', null, false, false], ['Four sprinkler zones, timer in the garage.', null, false, false],
  ['Water shutoff by the front hose bib.', null, false, false], ['The back door sticks in winter.', null, false, false], ['Listed by our team', null, false, false],
];
for (const [t, s, a, c] of ENGLISH) {
  const got = [ht.steeringProblem(t), ht.addressProblem(t), ht.codeProblem(t)];
  check(`English unchanged: "${t}"`, got[0] === s && got[1] === a && got[2] === c, JSON.stringify(got));
}
check('existing messages unchanged', ht.STEERING_ERROR === 'Keep it about the home: leave out schools, safety, places of worship and who lives here or nearby (fair housing).'
  && ht.ADDRESS_ERROR === 'Leave the street address out.' && ht.CODE_ERROR === 'Hand codes over in person instead of writing them here.');

// ---------------- 2. validateHomeFacts ----------------
const V = (input, opts = { kind: 'listing' }) => hf.validateHomeFacts(input, opts);
check('empty form -> {}', JSON.stringify(V({}).data) === '{}' && JSON.stringify(V(undefined).data) === '{}' && JSON.stringify(V({ yard: {}, toy: {}, pets: {} }).data) === '{}');
let d = V({ yard: { faces: 'sw', frontFaces: '', size: 'huge', bogus: 1, outdoor: ['none', 'patio', 'patio', 'moat'], shade: ['pergola', 'x'], solar: 'owned', fenced: 'partly', afternoonSun: 'part_shade' }, extra: { a: 1 } }).data;
check('unknown keys and values dropped; "Not sure" never stored', JSON.stringify(d) === JSON.stringify({ yard: { faces: 'sw', outdoor: ['patio'], fenced: 'partly', afternoonSun: 'part_shade', shade: ['pergola'], solar: 'owned' } }), JSON.stringify(d));
check("outdoor ['none'] alone is kept", JSON.stringify(V({ yard: { outdoor: ['none'] } }).data) === '{"yard":{"outdoor":["none"]}}');
check('pets.rental dropped on a listing that is not a rental', !('pets' in V({ pets: { rental: 'none' } }, { kind: 'listing', isRental: false }).data));
check('pets.rental dropped on every other kind', ['pre_listing', 'augmented_home', 'green_home'].every(kind => !('pets' in V({ pets: { rental: 'none' } }, { kind, isRental: true }).data)));
check('pets.rental kept on a rental listing', V({ pets: { rental: 'considered' } }, { kind: 'listing', isRental: true }).data.pets.rental === 'considered');
const planIn = { plan: { builder: 'Lennar', name: 'Plan 3', community: 'Millenia' } };
check('plan kept only on a pre-listing', JSON.stringify(V(planIn, { kind: 'pre_listing' }).data.plan) === JSON.stringify(planIn.plan)
  && ['listing', 'augmented_home', 'green_home'].every(kind => !('plan' in V(planIn, { kind }).data)));
check('plan text is clamped (60/40/60)', V({ plan: { builder: 'b'.repeat(70), name: 'n'.repeat(50) } }, { kind: 'pre_listing' }).data.plan.builder.length === 60
  && V({ plan: { name: 'n'.repeat(50) } }, { kind: 'pre_listing' }).data.plan.name.length === 40);
check('gateIn 10 -> the gate error', V({ toy: { gateIn: 10 } }).error === 'Gate opening should be whole inches from 24 to 480.');
check('gateIn 36.5 and "abc" -> the gate error; "" not given', V({ toy: { gateIn: 36.5 } }).error === 'Gate opening should be whole inches from 24 to 480.'
  && V({ toy: { gateIn: 'abc' } }).error === 'Gate opening should be whole inches from 24 to 480.' && JSON.stringify(V({ toy: { gateIn: '' } }).data) === '{}');
check('gateIn "120" is stored as the number 120', V({ toy: { gateIn: '120' } }).data.toy.gateIn === 120);
check('driveway and garage errors exact', V({ toy: { drivewayFt: 301 } }).error === 'Driveway length should be whole feet from 5 to 300.'
  && V({ toy: { garage: 11 } }).error === 'Garage spaces should be a whole number from 0 to 10.');
check('garage 0 + tandem yes -> tandem dropped', JSON.stringify(V({ toy: { garage: 0, tandem: 'yes' } }).data) === '{"toy":{"garage":0}}');
check('no garage + tandem yes -> tandem dropped', JSON.stringify(V({ toy: { tandem: 'yes' } }).data) === '{}');
check('rvSpot kept only when rv is yes', V({ toy: { rv: 'yes', rvSpot: 'pad' } }).data.toy.rvSpot === 'pad' && !('rvSpot' in V({ toy: { rv: 'no', rvSpot: 'pad' } }).data.toy));
check('yard notes clamped to 160', V({ yard: { notes: 'x'.repeat(200) } }).data.yard.notes.length === 160 && hf.NOTE_MAX === 160);

// Fair housing / jury.
const yardErr = notes => V({ yard: { notes } }).error;
const petErr = notes => V({ pets: { notes } }).error;
check('yard notes "Great yard for the kids" -> STEERING_ERROR', yardErr('Great yard for the kids') === ht.STEERING_ERROR);
check('yard notes "Zona segura" -> STEERING_ERROR', yardErr('Zona segura') === ht.STEERING_ERROR);
check('yard notes "Spanish-speaking neighbors" and "comunidad hispana" -> STEERING_ERROR', yardErr('Spanish-speaking neighbors') === ht.STEERING_ERROR && yardErr('comunidad hispana') === ht.STEERING_ERROR);
check('yard notes "1218 La Vida Ct" -> ADDRESS_ERROR', yardErr('1218 La Vida Ct') === ht.ADDRESS_ERROR);
check('yard notes "side gate code 1234" -> CODE_ERROR', yardErr('side gate code 1234') === ht.CODE_ERROR);
check('"Access via the 12 ft side gate" passes all three checks', !yardErr('Access via the 12 ft side gate') && !anyProblem('Access via the 12 ft side gate'));
check('plan text runs the same checks', V({ plan: { community: 'Near the school' } }, { kind: 'pre_listing' }).error === ht.STEERING_ERROR);
for (const t of ['No ESAs', 'no emotional support animals', 'service animals must be registered', 'no se aceptan animales de apoyo'])
  check(`pet notes "${t}" -> PET_ASSIST_ERROR`, petErr(t) === hf.PET_ASSIST_ERROR, petErr(t));
for (const t of ['$500 pet deposit', 'pet rent 50', 'cuota por mascota'])
  check(`pet notes "${t}" -> PET_FEE_ERROR`, petErr(t) === hf.PET_FEE_ERROR, petErr(t));
for (const t of ['One dog under 40 lb, HOA limits pets to two', 'Se aceptan esas mascotas pequeñas'])
  check(`pet notes "${t}" pass`, !petErr(t) && V({ pets: { notes: t } }).data.pets.notes === t, petErr(t));
check('pet notes also run steering/address/code', petErr('Great for families') === ht.STEERING_ERROR && petErr('Dogs ok at 1218 La Vida Ct') === ht.ADDRESS_ERROR);
check('error strings exact', hf.PET_ASSIST_ERROR === 'Leave assistance animals out: the site adds the fair-housing note about them itself.'
  && hf.PET_FEE_ERROR === 'Leave pet fees, deposits and pet rent out; those belong in the lease.');

// ---------------- 3. homeFactsFromRow / hasHomeFacts ----------------
check('fromRow: bad JSON -> {}, missing -> {}, never throws', JSON.stringify(hf.homeFactsFromRow({ home_facts_json: '{oops' })) === '{}'
  && JSON.stringify(hf.homeFactsFromRow({})) === '{}' && JSON.stringify(hf.homeFactsFromRow(null)) === '{}' && JSON.stringify(hf.homeFactsFromRow({ home_facts_json: 'null' })) === '{}');
d = hf.homeFactsFromRow({ home_facts_json: JSON.stringify({ yard: { faces: 'q', size: 'large' }, toy: { gateIn: 5, garage: 2, tandem: 'yes' }, pets: { rental: 'some', notes: 'Cats ok' }, plan: { name: 'Plan 3' }, junk: 1 }) });
check('fromRow: re-runs the shape rules (bad values dropped, no error)', JSON.stringify(d) === JSON.stringify({ yard: { size: 'large' }, toy: { garage: 2, tandem: 'yes' }, pets: { rental: 'some', notes: 'Cats ok' }, plan: { name: 'Plan 3' } }), JSON.stringify(d));
check('hasHomeFacts', !hf.hasHomeFacts({}) && !hf.hasHomeFacts(null) && !hf.hasHomeFacts({ yard: {} }) && hf.hasHomeFacts({ toy: { garage: 0 } }));

// ---------------- 4. homeFactsLines ----------------
const noHoa = { melloRoosAnnual: null, hoaMonthly: null, hoaDetails: { includes: [], rentals: '', pets: '', parking: '', specialAssessment: '' } };
const hoaWith = (x) => ({ ...noHoa, hoaMonthly: 200, hoaDetails: { ...noHoa.hoaDetails, ...x } });
const full = { yard: { faces: 'sw', frontFaces: 'ne', outdoor: ['backyard', 'patio'], size: 'medium', fenced: 'yes', afternoonSun: 'mostly_sun', shade: ['covered_patio', 'shade_trees'], solar: 'leased', notes: 'Lemon tree' },
  toy: { rv: 'yes', rvSpot: 'side_yard', sideAccess: 'yes', gateIn: 120, drivewayFt: 40, garage: 2, tandem: 'yes', workshop: 'no', ev240: 'yes' },
  pets: { rental: 'considered', notes: 'One dog ok' } };
let g = hf.homeFactsLines(full, hoaWith({ pets: 'allowed', parking: 'limited' }), { isRental: true, longNote: true });
check('yard lines exact', JSON.stringify(g.yard) === JSON.stringify(['Backyard faces southwest', 'Front faces northeast', 'Outdoor space: backyard, patio', 'Yard size: medium', 'Fenced: yes',
  'Afternoon in the backyard: mostly sun', 'Shade: covered patio, shade trees', 'Solar panels: leased', "Owner's notes: Lemon tree"]), JSON.stringify(g.yard));
check('toy lines exact', JSON.stringify(g.toy) === JSON.stringify(['RV or boat parking: yes (side yard)', 'Side or back yard vehicle access: yes', 'Gate opening about 120 in. (owner measured)',
  'Driveway about 40 ft long (owner measured)', 'Garage: 2 spaces, tandem', 'Workshop space: no', '240V or EV outlet at the parking: yes', 'HOA RV/boat parking: limited (see HOA rules)']), JSON.stringify(g.toy));
check('pets lines exact (rental, long note last)', JSON.stringify(g.pets) === JSON.stringify(['HOA pets: allowed', 'Renters: pets considered', "Owner's pet notes: One dog ok", hf.ASSISTANCE_ANIMAL_LINE_LONG]), JSON.stringify(g.pets));
g = hf.homeFactsLines({}, hoaWith({ pets: 'limited' }));
check("HOA limited alone -> ['HOA pets: limited (see HOA rules)', ASSISTANCE_ANIMAL_LINE]", JSON.stringify(g.pets) === JSON.stringify(['HOA pets: limited (see HOA rules)', hf.ASSISTANCE_ANIMAL_LINE]), JSON.stringify(g.pets));
g = hf.homeFactsLines({ pets: { rental: 'none' } }, noHoa, { isRental: true });
check("rental none -> 'Renters: no pets' then the note", JSON.stringify(g.pets) === JSON.stringify(['Renters: no pets', hf.ASSISTANCE_ANIMAL_LINE]), JSON.stringify(g.pets));
g = hf.homeFactsLines({ pets: { rental: 'none' } }, noHoa, { isRental: false });
check('not a rental with a stored rental value -> no "Renters:" line (and no lone note)', g.pets.length === 0, JSON.stringify(g.pets));
check('nothing entered -> three empty blocks', JSON.stringify(hf.homeFactsLines({}, noHoa)) === '{"yard":[],"toy":[],"pets":[]}' && JSON.stringify(hf.homeFactsLines(null, null)) === '{"yard":[],"toy":[],"pets":[]}');
check("garage 0 -> 'Garage: none'; 1 -> '1 space'; rv no", JSON.stringify(hf.homeFactsLines({ toy: { garage: 0, rv: 'no' } }, noHoa).toy) === JSON.stringify(['RV or boat parking: no', 'Garage: none'])
  && hf.homeFactsLines({ toy: { garage: 1 } }, noHoa).toy[0] === 'Garage: 1 space');
check("HOA parking allowed -> 'HOA RV/boat parking: allowed'", hf.homeFactsLines({}, hoaWith({ parking: 'allowed' })).toy[0] === 'HOA RV/boat parking: allowed');
const FIXTURES = [[full, hoaWith({ pets: 'allowed', parking: 'limited' }), { isRental: true, longNote: true }], [full, noHoa, {}], [{ pets: { notes: 'Cats ok' } }, noHoa, {}],
  [{}, hoaWith({ pets: 'limited' }), {}], [{ toy: { gateIn: 30, drivewayFt: 6 } }, noHoa, {}], [{ pets: { rental: 'some' } }, hoaWith({ pets: 'allowed' }), { isRental: true }]];
let lastOk = true, wordsOk = true, measuredOk = true;
for (const [f, c, o] of FIXTURES) {
  const x = hf.homeFactsLines(f, c, o);
  if (x.pets.length && x.pets.at(-1) !== (o.longNote ? hf.ASSISTANCE_ANIMAL_LINE_LONG : hf.ASSISTANCE_ANIMAL_LINE)) lastOk = false;
  for (const l of [...x.yard, ...x.toy, ...x.pets]) {
    if (/verified|checked|certif|guarantee|score|rating|best|ideal|perfect/i.test(l)) wordsOk = false;
    if (/^(Gate opening|Driveway) /.test(l) && !l.endsWith('(owner measured)')) measuredOk = false;
  }
}
check('every fixture: a pets block always ends with the assistance-animal note', lastOk);
check('no line says verified/checked/certified/guarantee/score/rating/best/ideal/perfect', wordsOk);
check('gate and driveway lines end with "(owner measured)"', measuredOk);
for (const [n, line] of [['short', hf.ASSISTANCE_ANIMAL_LINE], ['long', hf.ASSISTANCE_ANIMAL_LINE_LONG], ['form help', hf.PET_FORM_HELP]])
  check(`assistance ${n} line: no "rules don't apply", "generally" or "FHEO"`, !/rules don't apply|generally|FHEO/i.test(line));
check('the long line cites Gov. Code 12927 and 12955 and 2 CCR 12185', /12927/.test(hf.ASSISTANCE_ANIMAL_LINE_LONG) && /12955/.test(hf.ASSISTANCE_ANIMAL_LINE_LONG) && /12185/.test(hf.ASSISTANCE_ANIMAL_LINE_LONG));
check('headings say "(from the owner)"', [hf.YARD_HEADING, hf.TOY_HEADING, hf.PETS_HEADING].every(h => h.endsWith('(from the owner)')));
check('HOME_KINDS re-exported from homeCosts', hf.HOME_KINDS === hc.HOME_KINDS);

// ---------------- 5. homeCosts: pets moved, HOA parking ----------------
const costs = hc.validateHomeCosts({ hoaMonthly: 250, hoaDetails: { pets: 'limited', parking: 'allowed', rentals: 'allowed' } }).data;
check('validateHomeCosts keeps HOA parking (allowed/limited only)', costs.hoaDetails.parking === 'allowed' && hc.validateHomeCosts({ hoaMonthly: 1, hoaDetails: { parking: 'banned' } }).data.hoaDetails.parking === ''
  && JSON.stringify(hc.HOA_PARKING_RULES) === '["allowed","limited"]');
check('no HOA -> parking ""', hc.validateHomeCosts({ hoaMonthly: 0, hoaDetails: { parking: 'allowed' } }).data.hoaDetails.parking === '');
check('homeCostsFromRow reads parking', hc.homeCostsFromRow({ hoa_details_json: '{"parking":"limited"}' }).hoaDetails.parking === 'limited' && hc.homeCostsFromRow({}).hoaDetails.parking === '');
check('homeCostsLines never contains "Pets"', !hc.homeCostsLines(costs).some(l => /pets/i.test(l)) && hc.homeCostsLines(costs).includes('Renting out: allowed'), JSON.stringify(hc.homeCostsLines(costs)));
check('HOA_PET_RULES unchanged', JSON.stringify(hc.HOA_PET_RULES) === '["allowed","limited"]');

// ---------------- 6. Commute ----------------
const area = hf.driveArea({ address: '1218 La Vida Ct', neighborhood: 'EastLake', city: 'Chula Vista', state: 'CA', zip: '91915' });
check("driveArea -> 'EastLake, Chula Vista, CA 91915'", area === 'EastLake, Chula Vista, CA 91915', area);
check('driveArea without zip or neighborhood', hf.driveArea({ address: '1 Main St', city: 'Bonita', state: 'CA' }) === 'Bonita, CA' && hf.driveArea({ neighborhood: 'Bonita', city: 'Bonita', state: 'CA' }) === 'Bonita, CA');
const href = hf.planDriveHref(area);
check('planDriveHref: Google Maps directions to the area, no address, no origin', href.startsWith('https://www.google.com/maps/dir/?api=1&destination=') && !href.includes('1218') && !href.includes('origin=') && href.endsWith('&travelmode=driving'), href);
check('planDriveHref with an origin', hf.planDriveHref(area, 'San Diego, CA').endsWith('&travelmode=driving&origin=San%20Diego%2C%20CA'));
check('drive label + caption exact', hf.PLAN_DRIVE_LABEL === 'Plan your drive' && hf.PLAN_DRIVE_CAPTION === "Opens Google Maps, which works out the drive time; Amico Haus doesn't. It goes to the home's area, not its address.");

// ---------------- 7. Pacific time ----------------
check('pacificWhenLabel (PST)', pt.pacificWhenLabel('2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z') === 'Sat, Nov 14, 1:00 PM – 4:00 PM Pacific time', pt.pacificWhenLabel('2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z'));
check('pacificWhenLabel (PDT, DST day 2026-11-01)', pt.pacificWhenLabel('2026-10-31T18:00:00.000Z', '2026-10-31T21:00:00.000Z') === 'Sat, Oct 31, 11:00 AM – 2:00 PM Pacific time'
  && pt.pacificWhenLabel('2026-11-01T20:00:00.000Z', '2026-11-01T22:30:00.000Z') === 'Sun, Nov 1, 12:00 PM – 2:30 PM Pacific time', pt.pacificWhenLabel('2026-11-01T20:00:00.000Z', '2026-11-01T22:30:00.000Z'));
check("pacificDayKey('2026-11-15T06:30:00.000Z') === '2026-11-14'", pt.pacificDayKey('2026-11-15T06:30:00.000Z') === '2026-11-14');
check('pacificDayLabel', pt.pacificDayLabel('2026-11-15T06:30:00.000Z') === 'Sat, Nov 14' && !/ /.test(pt.pacificWhenLabel('2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z')));

// ---------------- 8. Account export ----------------
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${root}/schema.sql`, 'utf8'));
const batchSizes = [];
let statements = 0;
const DB = {
  prepare(sql) {
    statements++;
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      batchResult: async () => (/^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : stmt.run()),
    };
    return stmt;
  },
  batch: async (stmts) => { batchSizes.push(stmts.length); const out = []; for (const st of stmts) out.push(await st.batchResult()); return out; },
};
const env = { DB };
const call = async (handler, who) => {
  const request = new Request('https://amicohaus.com/api/account/export', { headers: who ? { Cookie: `ah_session=t${who}` } : {} });
  const res = await handler({ request, env, params: {}, waitUntil() {} });
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
for (const id of [1, 2]) {
  run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', id, `u${id}@example.test`, `User ${id}`);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", `t${id}`, id);
}
run("UPDATE users SET ui_lang = 'es' WHERE id = 1");
// Person 1 hosts a listing open house (shared) and a GreenHome one; person 2 hosts a listing and an AugmentedHome open house.
run("INSERT INTO listings (id, user_id, city, state, property_type, estimated_value, price_tier, home_facts_json) VALUES (10, 1, 'Chula Vista', 'CA', 'House', 800000, '600k-1m', '{\"toy\":{\"rv\":\"yes\"}}')");
run("INSERT INTO listings (id, user_id, city, state, property_type, estimated_value, price_tier) VALUES (20, 2, 'Bonita', 'CA', 'House', 900000, '600k-1m')");
run("INSERT INTO augmented_homes (id, user_id, city, state, property_type, asking_price) VALUES (30, 2, 'Bonita', 'CA', 'House', 700000)");
run("INSERT INTO green_homes (id, user_id, city, state, property_type, asking_price) VALUES (40, 1, 'Chula Vista', 'CA', 'House', 650000)");
run("INSERT INTO open_houses (id, listing_id, starts_at, ends_at, note, share_address_with_rsvps) VALUES (100, 10, '2026-11-14T21:00:00.000Z', '2026-11-15T00:00:00.000Z', 'Come by', 1)");
run("INSERT INTO open_houses (id, listing_id, starts_at, ends_at) VALUES (200, 20, '2026-11-15T21:00:00.000Z', '2026-11-15T23:00:00.000Z')");
run("INSERT INTO augmented_home_open_houses (id, augmented_home_id, starts_at, ends_at) VALUES (300, 30, '2026-11-16T21:00:00.000Z', '2026-11-16T23:00:00.000Z')");
run("INSERT INTO green_home_open_houses (id, green_home_id, starts_at, ends_at) VALUES (400, 40, '2026-11-17T21:00:00.000Z', '2026-11-17T23:00:00.000Z')");
run("INSERT INTO green_home_open_houses (id, green_home_id, starts_at, ends_at) VALUES (401, 40, '2026-11-18T21:00:00.000Z', '2026-11-18T23:00:00.000Z')");
// Person 1 RSVPs to person 2's listing and AugmentedHome open houses, and to their own GreenHome one; person 2 RSVPs to person 1's listing one.
run('INSERT INTO open_house_rsvps (open_house_id, user_id) VALUES (200, 1)');
run('INSERT INTO augmented_home_open_house_rsvps (open_house_id, user_id) VALUES (300, 1)');
run('INSERT INTO green_home_open_house_rsvps (open_house_id, user_id) VALUES (401, 1)');
run('INSERT INTO open_house_rsvps (open_house_id, user_id) VALUES (100, 2)');

const exportApi = await mod('functions/api/account/export.js');
statements = 0;
let r = await call(exportApi.onRequestGet, 1);
const ex = JSON.parse(r.text);
check('export: 200, private no-store', r.status === 200 && r.headers.get('Cache-Control') === 'private, no-store');
check('export: 46 statements in one batch (+1 session lookup)', batchSizes.length === 1 && batchSizes[0] === 46 && statements === 47, `${JSON.stringify(batchSizes)} / ${statements}`);
const rsvps = ex.openHouses.filter(x => x.kind.startsWith('rsvp_'));
check('export: your RSVPs on all three kinds of home', JSON.stringify(rsvps.map(x => [x.kind, x.home_id, x.open_house_id]).sort()) === JSON.stringify([['rsvp_augmented_home', 30, 300], ['rsvp_green_home', 40, 401], ['rsvp_listing', 20, 200]]), JSON.stringify(rsvps));
check("export: never another person's RSVP (person 2's RSVP to your open house stays out)", !rsvps.some(x => x.open_house_id === 100) && !r.text.includes('User 2'));
const hosted = ex.openHouses.filter(x => x.kind === 'hosted');
const h = hosted.length === 1 ? JSON.parse(hosted[0].details_json) : {};
check('export: one hosted row with your open houses and the address-sharing choice', hosted.length === 1 && h.listings.length === 1 && h.listings[0].id === 100 && h.listings[0].share_address_with_rsvps === 1
  && h.listings[0].note === 'Come by' && h.augmented_homes.length === 0 && h.green_homes.map(x => x.id).sort().join() === '400,401' && h.green_homes.every(x => x.share_address_with_rsvps === 0), JSON.stringify(h));
check('export: account.uiLang', ex.account.uiLang === 'es');
check('export: home_facts_json rides along on listings', ex.listings[0].home_facts_json === '{"toy":{"rv":"yes"}}');
check('export: existing keys still there', ['showingRequests', 'brokerPreviews', 'brokerPreviewRsvps', 'blocks', 'reportsFiled', 'alerts', 'ownerTools', 'pastClientReviewsWritten'].every(k => k in ex));
r = await call(exportApi.onRequestGet, 2);
const ex2 = JSON.parse(r.text);
check("export (person 2): their RSVP to person 1's open house, uiLang defaults to en", JSON.stringify(ex2.openHouses.filter(x => x.kind.startsWith('rsvp_')).map(x => x.open_house_id)) === '[100]' && ex2.account.uiLang === 'en');
check('export: signed out 401', (await call(exportApi.onRequestGet, null)).status === 401);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
