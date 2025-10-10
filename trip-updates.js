import crypto from "node:crypto";
import { transit_realtime as tr } from "gtfs-realtime-bindings";

const PTV_BASE = "https://timetableapi.ptv.v3";
const MODE_MAP = { train: 0, tram: 1, bus: 2 };

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function signPath(path, key) {
  // HMAC-SHA1 of the URL path (including ?devid=...)
  return crypto.createHmac("sha1", key).update(path).digest("hex");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { mode } = req.query;
    const routeType = MODE_MAP[mode?.toLowerCase()];
    if (routeType === undefined) {
      return res.status(400).json({ error: "mode must be train|tram|bus" });
    }

    const DEV_ID = process.env.PTV_DEVID;
    const HMAC_KEY = process.env.PTV_HMAC_KEY;
    if (!DEV_ID || !HMAC_KEY) {
      return res.status(500).json({ error: "Server is missing PTV credentials" });
    }

    // Build path with devid FIRST, then sign it
    const path = `/gtfs/trip_updates?route_types=${routeType}&devid=${DEV_ID}`;
    const signature = signPath(path, HMAC_KEY);
    const url = `${PTV_BASE}${path}&signature=${signature}`;

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: "PTV fetch failed", details: text });
    }

    // Decode protobuf -> JSON
    const buf = new Uint8Array(await r.arrayBuffer());
    const feed = tr.FeedMessage.decode(buf);
    const json = tr.FeedMessage.toObject(feed, { longs: String, enums: String });

    // Your front-end expects { entities: [...] } shape
    return res.status(200).json({ entities: json.entity || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Proxy error", details: String(err) });
  }
}
