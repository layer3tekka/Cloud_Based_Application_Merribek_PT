// pages/api/gtfs/[mode]/trip-updates.js
export const config = { runtime: 'nodejs' }; // important: Node, not Edge

// Use CJS require to avoid ESM bundling issues with this package on Vercel
let tr;
try {
  ({ transit_realtime: tr } = require('gtfs-realtime-bindings'));
} catch (e) {
  console.error('Require gtfs-realtime-bindings failed:', e);
  // Keep going – we’ll report this in the response if debug=1
}

function bad(res, code, msg, extra = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(code).json({ ok: false, error: msg, ...extra });
}

export default async function handler(req, res) {
  // CORS (simple)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  const debug = req.query.debug === '1';

  try {
    const mode = req.query?.mode;
    if (!mode) return bad(res, 400, 'Missing `mode` (tram|bus|train)');

    const base = 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1';
    const path =
      mode === 'tram'  ? 'yarratrams/trip-updates' :
      mode === 'bus'   ? 'bus/trip-updates'       :
                         'metro/trip-updates'; // train

    const key = process.env.PTV_KEY;
    if (!key) {
      console.error('Missing PTV_KEY env var');
      return bad(res, 500, 'Missing PTV_KEY env var', { code: 'NO_ENV' });
    }

    // fetch with a timeout to avoid hanging
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    const url = `${base}/${path}`;

    const r = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
      signal: ac.signal,
    }).catch((err) => {
      console.error('Upstream fetch threw:', err);
      throw err;
    });
    clearTimeout(t);

    if (!r.ok) {
      const text = await r.text().catch(() => '(no body)');
      console.error('Upstream non-OK', r.status, text);
      return bad(res, r.status, `Upstream ${r.status}`, { upstreamBody: text.slice(0, 300) });
    }

    if (!tr) {
      // If require failed, surface it here explicitly
      return bad(res, 500, 'gtfs-realtime-bindings not available', { code: 'NO_PROTOBUF' });
    }

    // Decode GTFS-RT protobuf
    const buf = Buffer.from(await r.arrayBuffer());
    const feed = tr.FeedMessage.decode(buf);

    const entities = (feed.entity || []).map((e) => {
      const tu = e.tripUpdate;

      const stopTimeUpdate = (tu?.stopTimeUpdate || []).map((u) => ({
        stopSequence: u.stopSequence ?? null,
        stopId: u.stopId ? String(u.stopId) : null,
        arrival: {
          delay: u.arrival?.delay ?? 0,
          time: Number(u.arrival?.time ?? 0),
          uncertainty: u.arrival?.uncertainty ?? 0,
        },
        departure: {
          delay: u.departure?.delay ?? 0,
          time: Number(u.departure?.time ?? 0),
          uncertainty: u.departure?.uncertainty ?? 0,
        },
        scheduleRelationship: u.scheduleRelationship ?? 'SCHEDULED',
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
            directionId: tu?.trip?.directionId ?? null,
          },
          vehicle: tu?.vehicle ?? null,
          timestamp: Number(tu?.timestamp ?? 0),
          delay: tu?.delay ?? 0,
          tripProperties: tu?.tripProperties ?? null,
        },
        vehicle: e.vehicle ?? null,
        alert: e.alert ?? null,
        firstStop: (() => {
          const u = stopTimeUpdate[0];
          if (!u) return null;
          return {
            stopId: u.stopId,
            arrivalDelay: u.arrival?.delay ?? 0,
            departureDelay: u.departure?.delay ?? 0,
          };
        })(),
      };
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

    // Optional debug payload (never crashes the function)
    if (debug) {
      return res.status(200).json({
        ok: true,
        mode,
        entityCount: entities.length,
        note: 'debug=1 included – to disable, remove the query param',
        hasProto: !!tr,
        envHasKey: !!key,
        url,
        sampleIds: entities.slice(0, 5).map((x) => x.id),
      });
    }

    res.status(200).json({
      ok: true,
      mode,
      entityCount: entities.length,
      entities,
    });
  } catch (err) {
    console.error('trip-updates fatal:', err);
    return bad(res, 500, String(err?.message || err));
  }
}
