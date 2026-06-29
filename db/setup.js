import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function setup() {
  console.log("⏳ Connecting to Turso…");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS requests_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      provider    TEXT,
      model       TEXT,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      latency_ms  INTEGER,
      timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Table 'requests_log' is ready.");
  process.exit(0);
}

setup().catch((err) => {
  console.error("❌ Setup failed:", err);
  process.exit(1);
});
