// api/gtfs/[mode]/echo.js
export default function handler(req, res) {
  // Basic CORS so you can hit this from your map
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Read mode either from the dynamic segment or query
  const mode =
    req.query?.mode ||
    new URL(req.url, `http://${req.headers.host}`).pathname.split("/")[3];

  // Keep headers tiny to avoid leaking secrets in logs
  const headers = {
    "user-agent": req.headers["user-agent"],
    "x-vercel-id": req.headers["x-vercel-id"],
  };

  return res.status(200).json({
    ok: true,
    mode,
    path: req.url,
    query: req.query || {},
    headers,
    timestamp: new Date().toISOString(),
  });
}

