// /api/gtfs/[mode]/trip-updates.js
import fetch from "node-fetch";
import { transit_realtime as tr } from "gtfs-realtime-bindings";

const MODE_ENDPOINTS = {
  tram:  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/tram/trip-updates",
  bus:   "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/bus/trip-updates",
  metro: "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro/trip-updates" // trains
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { mode } = req.query;
  const key = process.env.VIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "VIC_API_KEY not set in Vercel env" });
  }

  const url = MODE_ENDPOINTS[mode];
  if (!url) {
    return res.status(400).json({ error: "Invalid mode. Use tram | bus | metro" });
  }

  try {
    const r = await fetch(url, { headers: { KeyId: key } });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(r.status).json({ error: "Upstream error", detail: txt });
    }
    const buf = Buffer.from(await r.arrayBuffer());

    // Decode protobuf -> JSON
    const feed = tr.FeedMessage.decode(buf);
    const json = tr.FeedMessage.toObject(feed, { defaults: true });

    // Small, client-friendly shape (optional)
    const entities = (json.entity || []).map(e => {
      const tu = e.tripUpdate || {};
      const firstStop = (tu.stopTimeUpdate && tu.stopTimeUpdate[0]) || null;

      return {
        id: e.id,
        trip: {
          trip_id: tu.trip?.tripId || null,
          route_id: tu.trip?.routeId || null,
          start_time: tu.trip?.startTime || null,
          start_date: tu.trip?.startDate || null
        },
        firstStop: firstStop ? {
          stopId: firstStop.stopId || null,
          arrivalDelay: firstStop.arrival?.delay ?? null,
          departureDelay: firstStop.departure?.delay ?? null
        } : null
      };
    });

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ mode, entities, source: "ptv-gtfs-realtime" });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Failed to fetch/parse feed" });
  }
}
