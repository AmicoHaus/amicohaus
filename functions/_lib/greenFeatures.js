// Fixed taxonomy of energy/sustainability features, same pattern as adaptations.js and disclosures.js: the
// list lives in code so adding or rewording an item never needs a migration, only which keys a given home
// has checked off is stored.
export const GREEN_FEATURE_ITEMS = [
  { key: 'solar_panels', label: 'Solar panels', note: 'Owned or leased rooftop (or ground-mount) solar electricity generation.' },
  { key: 'battery_storage', label: 'Home battery storage', note: 'A battery system (e.g. Powerwall-style) for stored solar power or backup.' },
  { key: 'ev_charger', label: 'EV charger', note: 'A dedicated electric vehicle charging station installed at the home.' },
  { key: 'high_efficiency_hvac', label: 'High-efficiency HVAC', note: 'A heat pump or other high-SEER heating/cooling system.' },
  { key: 'tankless_water_heater', label: 'Tankless water heater', note: 'On-demand water heating instead of a standing tank.' },
  { key: 'enhanced_insulation', label: 'Enhanced insulation & windows', note: 'Upgraded insulation, double/triple-pane windows, or comparable envelope improvements.' },
  { key: 'energy_efficient_appliances', label: 'Energy-efficient appliances', note: 'ENERGY STAR or similarly rated major appliances throughout.' },
  { key: 'low_flow_fixtures', label: 'Low-flow water fixtures', note: 'Low-flow toilets, showerheads, and faucets to reduce water use.' },
  { key: 'greywater_rainwater', label: 'Greywater / rainwater system', note: 'A system that reuses greywater or collects rainwater for irrigation.' },
  { key: 'drought_tolerant_landscaping', label: 'Drought-tolerant landscaping', note: 'Native or low-water landscaping in place of a traditional lawn.' },
  { key: 'green_certification', label: 'Green building certification', note: 'LEED, ENERGY STAR Certified Home, or a comparable third-party certification.' },
  { key: 'geothermal', label: 'Geothermal heating/cooling', note: 'A geothermal heat pump system.' },
];

export function validGreenFeatureKeys(keys) {
  const known = new Set(GREEN_FEATURE_ITEMS.map(i => i.key));
  return [...new Set((Array.isArray(keys) ? keys : []).filter(k => known.has(k)))];
}
