// Optional context for a home: a property reason for the move, in the owner's words picked from a short list. Never
// fed into the matching engine (that still runs on location/type/price/beds/baths alone). Shown only to the owner and
// to their matches, never on public pages, home cards or flyers (Rudy 11.04), and always by label, never by key.
// The labels describe the home or the move, never who lives there: no family status, marital status or age
// (fair housing).
export const LIFE_EVENT_ITEMS = [
  { key: 'more_space', label: 'Need more space' },
  { key: 'less_space', label: 'Need less space' },
  { key: 'relocation', label: 'Relocating' },
  { key: 'estate', label: 'Estate / inherited' },
  { key: 'investment', label: 'Investment' },
  { key: 'life_change', label: 'Life change' },
  { key: 'other', label: 'Other' },
];

// Keys saved before the relabel, and the reason each one now reads as. Old rows keep their stored keys until the
// owner saves again (validLifeEventKeys rewrites them), so every reader looks labels up in LIFE_EVENT_LABELS.
export const LIFE_EVENT_LEGACY_KEYS = {
  upsizing_growing_family: 'more_space',
  downsizing: 'less_space',
  divorce_separation: 'life_change',
  inheritance: 'estate',
  retirement: 'life_change',
};

// key -> label for every key that may be stored, old or new.
export const LIFE_EVENT_LABELS = {
  ...Object.fromEntries(LIFE_EVENT_ITEMS.map(i => [i.key, i.label])),
  ...Object.fromEntries(Object.entries(LIFE_EVENT_LEGACY_KEYS).map(([oldKey, newKey]) => [oldKey, LIFE_EVENT_ITEMS.find(i => i.key === newKey).label])),
};

// The label for a stored key, or null for anything unknown (a raw key is never printed).
export function lifeEventLabel(key) {
  return Object.hasOwn(LIFE_EVENT_LABELS, key) ? LIFE_EVENT_LABELS[key] : null;
}

// What gets saved: known keys only, old keys moved to their new key, no duplicates.
export function validLifeEventKeys(keys) {
  const known = new Set(LIFE_EVENT_ITEMS.map(i => i.key));
  const mapped = (Array.isArray(keys) ? keys : []).map(k => LIFE_EVENT_LEGACY_KEYS[k] || k);
  return [...new Set(mapped.filter(k => known.has(k)))];
}
