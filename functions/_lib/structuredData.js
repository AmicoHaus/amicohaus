// Schema.org JSON-LD for the public property pages -- helps search engines and other structured-data
// consumers understand the page beyond its plain HTML (Google has no dedicated real-estate rich result, but
// this is still valid, useful vocabulary for Bing and any other structured-data-aware crawler). Deliberately
// never includes the street address -- same privacy rule as the visible page itself, which only ever shows
// city/state to a non-owner; structured data must match what's actually visible, not add hidden fields.
const CONDO_LIKE = new Set(['Condo', 'Penthouse']);

function accommodationType(propertyType) {
  return CONDO_LIKE.has(propertyType) ? 'Apartment' : 'House';
}

export function realEstateListingJsonLd({ url, name, description, image, datePosted, city, state, propertyType, beds, baths, sqft, price }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    url, name,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(datePosted ? { datePosted } : {}),
    about: {
      '@type': accommodationType(propertyType),
      name,
      address: { '@type': 'PostalAddress', addressLocality: city, addressRegion: state, addressCountry: 'US' },
      ...(beds ? { numberOfBedrooms: beds } : {}),
      ...(baths ? { numberOfBathroomsTotal: baths } : {}),
      ...(sqft ? { floorSize: { '@type': 'QuantitativeValue', value: sqft, unitCode: 'FTK' } } : {}),
    },
  };
  if (price) data.offers = { '@type': 'Offer', price, priceCurrency: 'USD', availability: 'https://schema.org/InStock' };
  // JSON.stringify never emits "</script>" by itself (its only escape is within string values), but a title
  // or description containing that literal substring could still close the tag early -- guard it explicitly.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}
