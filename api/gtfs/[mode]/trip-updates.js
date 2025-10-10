// api/gtfs/[mode]/trip-updates.js
import fetch from "node-fetch";
import * as Gtfs from "gtfs-realtime-bindings";

// Force Node runtime (NOT edge) so Buffer/protobuf works
export const config = { runtime: "nodejs20.x" };

// Map our URL segment -> PTV feed segment
const FEED_SEGMENT = {
  tram: "tram",
  bus: "bus",
  train: "metro", // PTV calls trains "metro"
};

function getMode(req) {
  // Accept /api/gtfs/<mode>/trip-updates and ?mode=<mode>
  const seg =
    req.query?.mode ||
    new URL(req.url, `http://${req.headers.host}`).pathname.split("/")[3];
  const key = String(seg || "").toLowerCase();
  return FEED_SEGMENT[key] ? key : null;
}

export default async function handler(req, res) {
  // CORS (so the static map can call this)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const mode = getMode(req);
  if (!mode) {
    return res.status(400).json({ ok: false, error: "Invalid mode. Use tram | bus | train" });
  }

  const feedSegment = FEED_SEGMENT[mode];
  const key = process.env.PTV_KEY; // <-- set this in Vercel Project Settings → Environment Variables

  if (!key) {
    return res.status(500).json({ ok: false, error: "Missing PTV_KEY environment variable" });
  }

  const url = `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/${feedSegment}/trip-updates`;

  try {
    const r = await fetch(url, {
      headers: {
        // PTV examples show `KeyId:`. Some docs also allow Ocp-Apim-Subscription-Key.
        KeyId: key,
        Accept: "*/*",
      },
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res
        .status(r.status)
        .json({ ok: false, up: false, status: r.status, body: text.slice(0, 300) });
    }

    // Decode GTFS-RT (Protocol Buffers) into plain JSON
    const buf = Buffer.from(await r.arrayBuffer());
    const msg = Gtfs.FeedMessage.decode(buf);
    const plain = Gtfs.FeedMessage.toObject(msg, {
      longs: Number,
      enums: String,
      defaults: true,
    });

    // Return a compact payload (you can return `plain` directly if you want everything)
    return res.status(200).json({
      ok: true,
      mode,
      entityCount: plain.entity?.length || 0,
      entities: plain.entity || [],
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Fetch/decode failed",
      message: err?.message || String(err),
    });
  }
}
