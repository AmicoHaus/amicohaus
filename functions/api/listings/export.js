import { getSessionUser } from '../../_lib/auth.js';
import { unauthorized } from '../../_lib/util.js';
import { computeBrokerStats } from '../../_lib/brokerStats.js';

function csvField(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const COLUMNS = ['ID', 'Title', 'Client Name', 'Property Type', 'City', 'State', 'Status', 'Views', 'Matches'];

export async function onRequestGet(context) {
  const user = await getSessionUser(context);
  if (!user) return unauthorized();

  const { listings } = await computeBrokerStats(context.env.DB, user.id);

  const rows = [COLUMNS.join(',')];
  for (const l of listings) {
    rows.push([l.id, l.title || l.propertyType, l.clientName, l.propertyType, l.city, l.state, l.status, l.views, l.matches]
      .map(csvField).join(','));
  }

  return new Response(rows.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="amicohaus-listings.csv"',
    },
  });
}
