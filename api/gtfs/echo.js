export default (req, res) => {
  const mode =
    req.query?.mode ||
    new URL(req.url, `http://${req.headers.host}`).pathname.split("/")[3];
  res.status(200).json({ ok: true, mode });
};

