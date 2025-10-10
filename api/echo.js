// api/gtfs/echo.js
export const config = { runtime: "nodejs" };

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const envOK = Boolean(process.env.PTV_KEY);
  res.status(200).json({
    ok: true,
    env: { PTV_KEY: envOK ? "present" : "missing" },
    url: req.url,
  });
}


