// Purely informational context for a trade listing -- why someone's moving. Never fed into the matching
// engine (that still runs on location/type/price/beds/baths alone); this just helps two people recognize a
// good fit in each other at a glance, e.g. a downsizing empty-nester and an upsizing growing family.
export const LIFE_EVENT_ITEMS = [
  { key: 'relocation', label: 'Relocating for work or family' },
  { key: 'upsizing_growing_family', label: 'Growing family, need more space' },
  { key: 'downsizing', label: 'Downsizing, need less space' },
  { key: 'divorce_separation', label: 'Divorce or separation' },
  { key: 'inheritance', label: 'Inherited property' },
  { key: 'investment', label: 'Investment property' },
  { key: 'retirement', label: 'Retirement' },
  { key: 'other', label: 'Other' },
];

export function validLifeEventKeys(keys) {
  const known = new Set(LIFE_EVENT_ITEMS.map(i => i.key));
  return [...new Set((Array.isArray(keys) ? keys : []).filter(k => known.has(k)))];
}
