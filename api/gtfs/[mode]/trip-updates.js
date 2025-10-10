// api/gtfs/[mode]/trip-updates.js
import fetch from "node-fetch";
import * as Gtfs from "gtfs-realtime-bindings";

// ✅ Vercel wants plain "nodejs" here (or omit config entirely)
export const config = { runtime: "nodejs" };

const FEED_SEGMENT = {
  tram: "tram",
  bus: "bus",
  train: "metro", // PTV calls trains "metro"
};

function getMode(req) {
  const seg =
    req.query?.mode ||
    new URL(req.url, `http://${req.headers.host}`).pathname.split("/")[3];
  const key = String(seg || "").toLowerCase();
  return FEED_SEGMENT[key] ? key : null;
}

export default async function handler(req, res) {
  // CORS for your static map
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const mode = getMode(req);
  if (!mode) return res.status(400).json({ ok: false, error: "Invalid mode. Use tram | bus | train" });

  const key = process.env.PTV_KEY; // set in Vercel → Project → Settings → Environment Variables
  if (!key) return res.status(500).json({ ok: false, error: "Missing PTV_KEY env var" });

  const url = `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/${FEED_SEGMENT[mode]}/trip-updates`;

  try {
    const r = await fetch(url, {
      headers: {
        // Your portal shows `KeyId`. (If needed, try Ocp-Apim-Subscription-Key instead.)
        KeyId: key,
        Accept: "*/*",
      },
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({
        ok: false, up: false, status: r.status, body: text.slice(0, 300)
      });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    const msg = Gtfs.FeedMessage.decode(buf);
    const plain = Gtfs.FeedMessage.toObject(msg, { longs: Number, enums: String, defaults: true });

    return res.status(200).json({
      ok: true,
      mode,
      entityCount: plain.entity?.length || 0,
      entities: plain.entity || [],
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Fetch/decode failed", message: err?.message || String(err) });
  }
}
