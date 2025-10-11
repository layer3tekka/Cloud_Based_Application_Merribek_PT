// api/gtfs/[mode]/trip-updates.js
import fetch from 'node-fetch';
import pkg from 'gtfs-realtime-bindings';
const { transit_realtime: tr } = pkg;

export default async function handler(req, res) {
  try {
    const mode =
      req.query?.mode ||
      new URL(req.url, `http://${req.headers.host}`).pathname.split("/")[3];

    const base = 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1';
    const path = mode === 'tram'  ? 'yarratrams/trip-updates'
               : mode === 'bus'   ? 'bus/trip-updates'
               :                    'metro/trip-updates'; // train

    const key = process.env.PTV_KEY;
    if (!key) return res.status(500).json({ ok:false, error:'Missing PTV_KEY env var' });

    const r = await fetch(`${base}/${path}`, {
      headers: { 'Ocp-Apim-Subscription-Key': key }
    });
    if (!r.ok) return res.status(r.status).json({ ok:false, error:`Upstream ${r.status}` });

    const buf = await r.arrayBuffer();
    const feed = tr.FeedMessage.decode(new Uint8Array(buf));
    const entities = (feed.entity || []).map(e => {
      // make a small, JSON-friendly object the client can use without ProtoBufs
      const tu = e.tripUpdate;
      const stopTimeUpdate = (tu?.stopTimeUpdate || []).map(u => ({
        stopSequence: u.stopSequence,
        stopId: u.stopId?.toString(),
        arrival: {
          delay: u.arrival?.delay ?? 0,
          time:  Number(u.arrival?.time ?? 0),
          uncertainty: u.arrival?.uncertainty ?? 0
        },
        departure: {
          delay: u.departure?.delay ?? 0,
          time:  Number(u.departure?.time ?? 0),
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
            tripId: tu?.trip?.tripId,
            startTime: tu?.trip?.startTime,
            startDate: tu?.trip?.startDate,
            scheduleRelationship: tu?.trip?.scheduleRelationship ?? 'SCHEDULED',
            routeId: tu?.trip?.routeId,
            directionId: tu?.trip?.directionId ?? null
          },
          vehicle: tu?.vehicle ?? null,
          timestamp: Number(tu?.timestamp ?? 0),
          delay: tu?.delay ?? 0,
          tripProperties: tu?.tripProperties ?? null
        },
        vehicle: e.vehicle ?? null,
        alert: e.alert ?? null
      };
    });

    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.status(200).json({
      ok: true,
      mode,
      entityCount: entities.length,
      entities,                      // <- full list for the app
      sample: entities.slice(0, 3)   // <- short sample for your smoke-test page
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
}
