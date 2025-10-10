// Node 18+ (ESM) – Vercel Serverless Function
import { transit_realtime as tr } from 'gtfs-realtime-bindings';

// Map your UI modes to Vic Open Data endpoints
// NOTE: Vic trains are under 'metro' in the API paths
const SOURCE = {
  tram:  'tram',
  bus:   'bus',
  train: 'metro'
};

export default async function handler(req, res) {
  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  try {
    const modeParam = (req.query.mode || '').toLowerCase();
    const sourceMode = SOURCE[modeParam];
    if (!sourceMode) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(400).json({ error: `invalid mode '${modeParam}' (use tram|bus|train)` });
    }

    const key = process.env.OPEN_DATA_KEY;
    if (!key) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: 'OPEN_DATA_KEY is not set' });
    }

    // Build upstream URL
    const upstream = `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/${sourceMode}/trip-updates`;

    // Fetch protobuf
    const r = await fetch(upstream, { headers: { 'KeyId': key } });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(r.status).json({ error: `Vic API ${r.status}`, body: text });
    }

    const ab = await r.arrayBuffer();
    const feed = tr.FeedMessage.decode(new Uint8Array(ab));
    // Convert to plain JSON (friendly for the map)
    const obj = tr.FeedMessage.toObject(feed, {
      longs: String,
      enums: String
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(obj);
  } catch (err) {
    console.error(err);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: 'server error', detail: String(err?.message || err) });
  }
}
