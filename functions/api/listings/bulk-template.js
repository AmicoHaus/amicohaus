import { getSessionUser } from '../../_lib/auth.js';
import { unauthorized } from '../../_lib/util.js';

const HEADERS = [
  'Client Name', 'City', 'State', 'Neighborhood', 'Property Type', 'Estimated Value', 'Beds', 'Baths', 'Sqft',
  'Is Rental', 'Rent Amount', 'Min Lease Months',
  'Desired Locations', 'Desired Type', 'Price Min', 'Price Max', 'Min Beds', 'Min Baths', 'Must Haves',
];
const EXAMPLE_TRADE = [
  'Jane Smith', 'San Diego', 'CA', 'Hillcrest', 'Single Family Home', '950000', '4', '3', '2200',
  '', '', '',
  'Coronado, CA; Anywhere in San Diego', 'Condo', '700000', '1100000', '2', '2', 'ocean view, garage',
];
const EXAMPLE_RENTAL = [
  'John Doe', 'Aspen', 'CO', 'Downtown', 'Penthouse', '4200000', '5', '5', '5800',
  'Yes', '18000', '24',
  '', '', '', '', '', '', '',
];
const NOTE = [
  '# Property Type and Desired Type must exactly match one of:',
  '# Single Family Home, Condo, Townhouse, Penthouse, Ranch / Land, Multi-Family, Investment Property, or Any (Desired Type only)',
  '# Client Name, Neighborhood, Sqft, and Must Haves are optional — leave blank if not applicable.',
  '# Is Rental: put Yes to list this row as a rental instead of a trade. For a rental row, fill in Rent Amount',
  '# (and optionally Min Lease Months, defaults to 12) and leave every Desired/Price/Min column blank — a',
  '# rental has nothing it wants back, so those are ignored for that row.',
];

function csvRow(cells) {
  return cells.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',');
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const csv = [...NOTE, csvRow(HEADERS), csvRow(EXAMPLE_TRADE), csvRow(EXAMPLE_RENTAL)].join('\n') + '\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="amicohaus-listings-template.csv"',
    },
  });
}
