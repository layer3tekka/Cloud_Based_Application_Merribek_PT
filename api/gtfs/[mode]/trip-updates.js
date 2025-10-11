// pages/api/gtfs/[mode]/trip-updates.js
export const config = { runtime: 'nodejs' }; // force Node (not Edge)

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function send(res, code, body) {
  cors(res);
  res.status(code).json(body);
}

async function loadProto() {
  // ESM-friendly dynamic import
  const mod = await import('gtfs-realtime-bindings');
  // CJS default interop safety:
  return mod.transit_realtime || mod.default?.transit_realtime;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const debug = req.query.debug === '1';
  const mode = req.query?.mode;
  if (!mode || !['tram', 'bus', 'train'].includes(mode)) {
    return send(res, 400, { ok: false, error: 'Missing/invalid `mode` (tram|bus|train)' });
  }

  const base =
    'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1';
  const path =
    mode === 'tram'  ? 'yarratrams/trip-updates' :
    mode === 'bus'   ? 'bus/trip-updates'       :
                       'metro/trip-updates'; // train

  const key = process.env.PTV_KEY;
  if (!key) return send(res, 500, { ok: false, error: 'Missing PTV_KEY env var' });

  const url = `${base}/${path}`;

  try {
    // fetch with timeout
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 15000);
    const r = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
      signal: ac.signal
    });
    clearTimeout(tid);

    if (!r.ok) {
      const upstreamBody = (await r.text().catch(() => '')).slice(0, 500);
      return send(res, r.status, { ok: false, error: `Upstream ${r.status}`, upstreamBody });
    }

    const tr = await loadProto(); // protobuf schema
    if (!tr) return send(res, 500, { ok: false, error: 'gtfs-realtime-bindings unavailable' });

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

    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

    if (debug) {
      return send(res, 200, {
        ok: true,
        mode,
        entityCount: entities.length,
        url,
        sampleIds: entities.slice(0, 5).map((x) => x.id),
      });
    }

    return send(res, 200, { ok: true, mode, entityCount: entities.length, entities });
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
