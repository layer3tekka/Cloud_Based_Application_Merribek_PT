// api/gtfs/[mode]/trip-updates.js
const MODE_TO_SEGMENT = {
  tram:  'tram',
  bus:   'bus',
  train: 'metro' // PTV calls metro for trains
};

export default async function handler(req, res) {
  try {
    // CORS for your static site
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const { mode } = req.query;
    const seg = MODE_TO_SEGMENT[mode];
    if (!seg) return res.status(400).json({ error: `Invalid mode "${mode}"` });

    const KEY = process.env.OPEN_DATA_KEY;
    if (!KEY) return res.status(500).json({ error: 'Missing OPEN_DATA_KEY env var' });

    const url =
      `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/${seg}/trip-updates?format=json`;

    const r = await fetch(url, { headers: { accept: '*/*', KeyId: KEY }, cache: 'no-store' });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'PTV upstream error', status: r.status, body });
    }

    const data = await r.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', message: String(err?.message || err) });
  }
}
