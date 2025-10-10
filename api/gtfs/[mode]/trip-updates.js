// ESM-friendly import for a CommonJS module:
import gtfs from "gtfs-realtime-bindings";
const { transit_realtime: tr } = gtfs;

export const config = { runtime: "nodejs" };

// map url segment to PTV segment
const FEED_SEGMENT = { tram: "tram", bus: "bus", train: "metro" };

function getMode(req) {
  const seg =
    req.query?.mode ||
    new URL(req.url, `http://${req.headers.host}`).pathname.split("/")[3];
  const key = String(seg || "").toLowerCase();
  return FEED_SEGMENT[key] ? key : null;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const mode = getMode(req);
  if (!mode) return res.status(400).json({ ok: false, error: "Invalid mode. Use tram|bus|train" });

  const key = process.env.PTV_KEY;
  if (!key) return res.status(500).json({ ok: false, error: "Missing PTV_KEY env var" });

  // Use your working header name. If 401/403 occurs, try "Ocp-Apim-Subscription-Key"
  const headerName = process.env.PTV_HEADER || "KeyId";

  const url = `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/${FEED_SEGMENT[mode]}/trip-updates`;

  try {
    const resp = await fetch(url, { headers: { [headerName]: key, Accept: "*/*" } });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return res.status(resp.status).json({
        ok: false,
        upstreamStatus: resp.status,
        upstreamCT: resp.headers.get("content-type"),
        bodyPreview: text.slice(0, 400),
        hint: "If 401/403, set env PTV_HEADER=Ocp-Apim-Subscription-Key and redeploy."
      });
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    let msg;
    try {
      msg = tr.FeedMessage.decode(buf);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: "DECODE_FAILED",
        message: e?.message || String(e),
        contentType: resp.headers.get("content-type"),
        byteLength: buf.length
      });
    }

    const obj = tr.FeedMessage.toObject(msg, { longs: Number, enums: String, defaults: true });
    return res.status(200).json({
      ok: true,
      mode,
      entityCount: obj.entity?.length || 0,
      sample: (obj.entity || []).slice(0, 3)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "FETCH_FAILED", message: err?.message || String(err) });
  }
}
