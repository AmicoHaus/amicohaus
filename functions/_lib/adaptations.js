// Fixed taxonomy of home adaptations for disability access, same pattern as
// disclosures.js: the list lives in code so adding or rewording an item never
// needs a migration, only which keys a given home has checked off is stored.
// Deliberately broad — mobility, vision, hearing, cognitive/sensory, height
// and stature, respiratory/chemical sensitivity, safety, and caregiving —
// since "disability" covers far more than wheelchair access alone.
export const ADAPTATION_ITEMS = [
  // Mobility
  { key: 'zero_step_entry', label: 'Zero-step or ramped entry', note: 'No steps at the main entrance — a ramp or level approach instead.' },
  { key: 'wide_doorways_hallways', label: 'Widened doorways & hallways', note: 'Clearances built for a wheelchair, walker, or scooter to pass through comfortably.' },
  { key: 'wheelchair_turning_clearance', label: 'Wheelchair turning clearance', note: 'Rooms and bathrooms with enough open floor space for a wheelchair to turn around.' },
  { key: 'roll_in_shower', label: 'Roll-in / curbless shower', note: 'No curb to cross, often with a fold-down seat and handheld showerhead.' },
  { key: 'accessible_bathtub', label: 'Accessible / walk-in bathtub', note: 'A low-threshold or walk-in tub instead of a standard high-sided tub.' },
  { key: 'raised_toilet_or_bidet', label: 'Raised toilet or bidet seat', note: 'A comfort-height toilet or bidet attachment for easier transfers and hygiene.' },
  { key: 'grab_bars_handrails', label: 'Grab bars & handrails', note: 'Reinforced grab bars in bathrooms and handrails along steps or ramps.' },
  { key: 'stair_lift_or_elevator', label: 'Stair lift or elevator', note: 'An installed lift or elevator connecting multiple floors.' },
  { key: 'porch_or_platform_lift', label: 'Porch lift / vertical platform lift', note: 'A lift bridging a porch, deck, or short level change outside the home.' },
  { key: 'accessible_parking', label: 'Accessible parking', note: 'A dedicated accessible parking spot or a wide, level path from parking to the entry.' },
  { key: 'main_floor_primary_suite', label: 'Main-floor primary suite / single-story living', note: 'A full bedroom and bathroom on the entry level — no stairs required to live day to day.' },
  { key: 'automatic_door_openers', label: 'Automatic / power door openers', note: 'Push-button or sensor-activated doors at the entry or interior rooms.' },
  { key: 'lever_door_handles', label: 'Lever-style door & faucet handles', note: 'Lever handles instead of round knobs — easier to operate with limited grip or dexterity.' },
  // Height & reach (short stature, dwarfism, wheelchair users, and others)
  { key: 'adjustable_height_counters', label: 'Height-adjustable counters & cabinets', note: 'Kitchen counters, sinks, and cabinets set or adjustable to a reachable height.' },
  { key: 'lowered_switches_outlets', label: 'Lowered light switches & outlets', note: 'Switches, thermostats, and outlets mounted at a reachable height.' },
  { key: 'lowered_closets_storage', label: 'Lowered closet rods & storage', note: 'Closet rods, shelving, and cabinetry brought down to a reachable height.' },
  // Vision
  { key: 'visual_impairment_features', label: 'Visual-impairment features', note: 'High-contrast or tactile markings, braille labeling, and similar features.' },
  { key: 'enhanced_lighting', label: 'Enhanced, glare-free lighting', note: 'Brighter, evenly-distributed, low-glare lighting throughout the home.' },
  // Hearing
  { key: 'hearing_impairment_features', label: 'Hearing-impairment features', note: 'Visual/vibrating alerts for doorbells, smoke alarms, and phones; induction loop systems.' },
  // Cognitive, developmental & sensory (autism, dementia, intellectual disabilities, sensory processing)
  { key: 'sensory_friendly_design', label: 'Sensory-friendly design', note: 'Reduced noise, soundproofing, and adjustable or non-flickering lighting to limit sensory overload.' },
  { key: 'cognitive_safety_features', label: 'Cognitive / memory-support safety features', note: 'Secured exits, door and window alarms, or similar features that support safe wandering prevention.' },
  // Respiratory & chemical sensitivity
  { key: 'air_filtration_allergy_friendly', label: 'Air filtration & allergy-friendly materials', note: 'HEPA or similar filtration, low-VOC finishes, and materials chosen to reduce allergens and irritants.' },
  // Technology & safety
  { key: 'smart_home_assistive_tech', label: 'Smart-home / voice-controlled assistive tech', note: 'Voice- or app-controlled lighting, locks, thermostats, and blinds for limited mobility or dexterity.' },
  { key: 'emergency_alert_system', label: 'Built-in emergency alert system', note: 'A wired medical alert, panic button, or monitored emergency response system already in place.' },
  // Caregiving & support
  { key: 'caregiver_or_in_law_suite', label: 'Caregiver suite / in-law quarters', note: 'A separate living space for a live-in caregiver, aide, or family member.' },
  { key: 'service_animal_friendly', label: 'Service-animal-friendly features', note: 'Durable, easy-clean flooring and secure, accessible yard access for a service animal.' },
];

export function validAdaptationKeys(keys) {
  const known = new Set(ADAPTATION_ITEMS.map(i => i.key));
  return [...new Set((Array.isArray(keys) ? keys : []).filter(k => known.has(k)))];
}
