// Server-side mirror of client.js's PROPERTY_ART data — needed here because
// functions/listing/[id].js server-renders HTML and can't call browser-side
// client.js (which touches `document`, fetch, service workers, etc.). Keep
// this array in sync with client.js's PROPERTY_ART if the photo pool changes.
const PROPERTY_ART = {"Single Family Home":["/img/property/single-family-home-1.jpg","/img/property/single-family-home-2.jpg","/img/property/single-family-home-3.jpg","/img/property/single-family-home-4.jpg","/img/property/single-family-home-5.jpg","/img/property/single-family-home-6.jpg","/img/property/single-family-home-7.jpg","/img/property/single-family-home-8.jpg"],"Condo":["/img/property/condo-1.jpg","/img/property/condo-3.jpg","/img/property/condo-4.jpg","/img/property/condo-5.jpg","/img/property/condo-6.jpg","/img/property/condo-7.jpg","/img/property/condo-8.jpg"],"Townhouse":["/img/property/townhouse-1.jpg","/img/property/townhouse-2.jpg","/img/property/townhouse-3.jpg","/img/property/townhouse-4.jpg","/img/property/townhouse-5.jpg","/img/property/townhouse-6.jpg","/img/property/townhouse-7.jpg","/img/property/townhouse-8.jpg"],"Penthouse":["/img/property/penthouse-1.jpg","/img/property/penthouse-2.jpg","/img/property/penthouse-3.jpg","/img/property/penthouse-4.jpg","/img/property/penthouse-5.jpg","/img/property/penthouse-6.jpg","/img/property/penthouse-7.jpg","/img/property/penthouse-8.jpg"],"Ranch / Land":["/img/property/ranch-land-1.jpg","/img/property/ranch-land-2.jpg","/img/property/ranch-land-3.jpg","/img/property/ranch-land-4.jpg","/img/property/ranch-land-5.jpg","/img/property/ranch-land-6.jpg","/img/property/ranch-land-7.jpg","/img/property/ranch-land-8.jpg"],"Multi-Family":["/img/property/multi-family-1.jpg","/img/property/multi-family-2.jpg","/img/property/multi-family-3.jpg","/img/property/multi-family-4.jpg","/img/property/multi-family-5.jpg","/img/property/multi-family-6.jpg","/img/property/multi-family-7.jpg","/img/property/multi-family-8.jpg"],"Investment Property":["/img/property/investment-property-1.jpg","/img/property/investment-property-2.jpg","/img/property/investment-property-3.jpg","/img/property/investment-property-4.jpg","/img/property/investment-property-5.jpg","/img/property/investment-property-6.jpg","/img/property/investment-property-7.jpg","/img/property/investment-property-8.jpg"]};

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  return h;
}

export function propertyArtUrl(propertyType, seed) {
  const pool = PROPERTY_ART[propertyType] || PROPERTY_ART['Single Family Home'];
  const idx = seed !== undefined ? hashSeed(seed) % pool.length : 0;
  return pool[idx];
}
