// pages/api/gtfs/[mode]/trip-updates.js

// Force Node runtime (NOT Edge), so gtfs-realtime-bindings can load
export const config = { runtime: 'nodejs20.x' };

// Use CJS for this package to avoid ESM/Edge headaches
const { transit_realtime: tr } = require('gtfs-realtime-bindings');

export default async function handler(req, res) {
  try {
    // mode: "tram" | "bus" | "train"
    const mode = req.query?.mode;
    if (!mode) return res.status(400).json({ ok: false, error: 'Missing mode' });

    const base = 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1';
    const path =
      mode === 'tram'  ? 'yarratrams/trip-updates' :
      mode === 'bus'   ? 'bus/trip-updates'       :
                         'metro/trip-updates'; // train

    const key = process.env.PTV_KEY;
    if (!key) return res.status(500).json({ ok: false, error: 'Missing PTV_KEY env var' });

    // Vercel Node 18/20 has global fetch
    const upstream = await fetch(`${base}/${path}`, {
      headers: { 'Ocp-Apim-Subscription-Key': key }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: `Upstream ${upstream.status}` });
    }

    const arrBuf = await upstream.arrayBuffer();
    const feed = tr.FeedMessage.decode(Buffer.from(arrBuf));

    const entities = (feed.entity || []).map(e => {
      const tu = e.tripUpdate;

      const stopTimeUpdate = (tu?.stopTimeUpdate || []).map(u => ({
        stopSequence: u.stopSequence ?? null,
        stopId: u.stopId ? String(u.stopId) : null,
        arrival: {
          delay: u.arrival?.delay ?? 0,
          time: Number(u.arrival?.time ?? 0),
          uncertainty: u.arrival?.uncertainty ?? 0
        },
        departure: {
          delay: u.departure?.delay ?? 0,
          time: Number(u.departure?.time ?? 0),
          uncertainty: u.departure?.uncertainty ?? 0
        },
        scheduleRelationship: u.scheduleRelationship ?? 'SCHEDULED'
      }));

      return {
        id: e.id,
        isDeleted: !!e.isDeleted,
        tripUpdate: {
          stopTimeUpdate,
          trip: {
            tripId: tu?.trip?.tripId ?? null,
            startTime: tu?.trip?.startTime ?? null,
            startDate: tu?.trip?.startDate ?? null,
            scheduleRelationship: tu?.trip?.scheduleRelationship ?? 'SCHEDULED',
            routeId: tu?.trip?.routeId ?? null,
            directionId: tu?.trip?.directionId ?? null
          },
          vehicle: tu?.vehicle ?? null,
          timestamp: Number(tu?.timestamp ?? 0),
          delay: tu?.delay ?? 0,
          tripProperties: tu?.tripProperties ?? null
        },
        vehicle: e.vehicle ?? null,
        alert: e.alert ?? null,

        // helper fields the UI might use quickly
        firstStop: (() => {
          const u = stopTimeUpdate[0];
          if (!u) return null;
          return {
            stopId: u.stopId,
            arrivalDelay: u.arrival?.delay ?? 0,
            departureDelay: u.departure?.delay ?? 0
          };
        })()
      };
    });

    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.status(200).json({
      ok: true,
      mode,
      entityCount: entities.length,
      entities,                    // FULL LIST – use this in your map/app
      sample: entities.slice(0, 3) // small sample for your smoke test, if you like
    });
  } catch (err) {
    console.error('trip-updates error:', err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
