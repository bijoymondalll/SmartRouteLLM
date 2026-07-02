import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  try {
    const result = await db.execute("SELECT * FROM requests_log ORDER BY id DESC LIMIT 20");
    return res.status(200).json({ success: true, logs: result.rows });
  } catch (error) {
    console.error("Failed to fetch logs from Turso:", error);
    return res.status(500).json({ success: false, error: "Database query failed." });
  }
}
