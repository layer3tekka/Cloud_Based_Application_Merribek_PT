// api/gtfs/[mode]/trip-updates.js
// Works on Vercel Node runtime, decodes full GTFS-RT feed, and
// tries BOTH possible header names. On error, it tells you URL, header used, etc.

import gtfs from "gtfs-realtime-bindings";
const { transit_realtime: tr } = gtfs;

export const config = { runtime: "nodejs" }; // NOT "edge", NOT "nodejs20.x"

// Map URL segment to the PTV product segment
const FEED_SEGMENT = { tram: "yarratrams", bus: "bus", train: "metro" };

function getMode(req) {
  const seg =
    req.query?.mode ||
    new URL(req.url, `http://${req.headers.host}`).pathname.split("/")[3];
  const key = String(seg || "").toLowerCase();
  return FEED_SEGMENT[key] ? key : null;
}

async function fetchUpstream(url, key) {
  // Try official header first; if that 401s, try legacy "KeyId"
  const tryOnce = async (headerName) => {
    const resp = await fetch(url, {
      headers: { [headerName]: key, Accept: "*/*" },
      cache: "no-store",
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    return { resp, buf, headerName };
  };

  // Attempt #1
  let attempt = await tryOnce("Ocp-Apim-Subscription-Key");
  if (attempt.resp.status === 401 || attempt.resp.status === 403) {
    // Attempt #2 (fallback)
    attempt = await tryOnce("KeyId");
  }
  return attempt;
}

export default async function handler(req, res) {
  // CORS for your static/localhost testing
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const mode = getMode(req);
  if (!mode) return res.status(400).json({ ok: false, error: "Invalid mode. Use tram|bus|train" });

  const key = process.env.PTV_KEY;
  if (!key) return res.status(500).json({ ok: false, error: "Missing PTV_KEY env var" });

  const url = `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/${FEED_SEGMENT[mode]}/trip-updates`;

  try {
    const { resp, buf, headerName } = await fetchUpstream(url, key);

    if (!resp.ok) {
      const preview = buf.toString("utf8").slice(0, 400);
      return res.status(resp.status).json({
        ok: false,
        mode,
        upstreamStatus: resp.status,
        upstreamCT: resp.headers.get("content-type"),
        url,
        usedHeader: headerName,
        bodyPreview: preview,
        hint:
          resp.status === 401 || resp.status === 403
            ? "401/403 usually means: wrong/missing key or your key isn’t enabled for this product. Verify PTV products for your key, and that the env var is set for this Vercel environment (Preview/Prod) and redeploy."
            : "Non-OK from upstream. Check bodyPreview/content-type.",
      });
    }

    // Try decoding as protobuf
    let msg;
    try {
      msg = tr.FeedMessage.decode(buf);
    } catch (e) {
      // If upstream returned SOAP/XML, decoding will fail; include CT + a short preview
      return res.status(502).json({
        ok: false,
        error: "DECODE_FAILED",
        mode,
        url,
        usedHeader: headerName,
        contentType: resp.headers.get("content-type"),
        byteLength: buf.length,
        bodyPreview: buf.toString("utf8").slice(0, 400),
      });
    }

    const obj = tr.FeedMessage.toObject(msg, { longs: Number, enums: String, defaults: true });
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    return res.status(200).json({
      ok: true,
      mode,
      url,
      usedHeader: headerName,
      entityCount: obj.entity?.length || 0,
      entities: obj.entity || [],
      sample: (obj.entity || []).slice(0, 3),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "FETCH_FAILED", message: err?.message || String(err) });
  }
}
