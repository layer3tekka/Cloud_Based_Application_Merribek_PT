// Minimal Node runtime API route for Vercel (Node 18+)
import { transit_realtime as tr } from 'gtfs-realtime-bindings';

// Use your VIC Open Data KeyId from Vercel env
const KEY = process.env.OPEN_DATA_KEY;

// Allowed modes for the dynamic param
const MODE_MAP = { tram: 'tram', bus: 'bus', train: 'metro' }; // API uses 'metro' for train

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { mode } = req.query;
    const kind = MODE_MAP[mode];
    if (!kind) return res.status(400).json({ error: "mode must be 'tram' | 'bus' | 'train'" });

    if (!KEY) {
      return res.status(500).json({ error: 'OPEN_DATA_KEY not set on server' });
    }

    const url = `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/${kind}/trip-updates`;
    const r = await fetch(url, { headers: { 'KeyId': KEY, 'accept': '*/*' } });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Upstream error', status: r.status, body: text });
    }

    const buf = Buffer.from(await r.arrayBuffer());

    // Parse protobuf -> object (optional). If you prefer raw bytes, return buf directly.
    let feed = {};
    try {
      feed = tr.FeedMessage.decode(buf);
      // Make it JSON serialisable
      feed = tr.FeedMessage.toObject(feed, { longs: String, enums: String, defaults: true });
    } catch {
      // If parsing fails, just return the raw protobuf
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.status(200).send(buf);
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(feed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server crashed', message: String(err && err.message || err) });
  }
}
