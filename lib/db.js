const axios = require("axios");
const config = require("./config");

const TURSO_HEADERS = {
  Authorization: `Bearer ${config.TURSO_TOKEN}`,
  "Content-Type": "application/json",
};

async function query(sql, args = []) {
  try {
    const res = await axios.post(
      `${config.TURSO_URL}/v2/pipeline`,
      {
        requests: [
          { type: "execute", stmt: { sql, args: args.map(v => ({ type: typeof v === "number" ? "integer" : "text", value: String(v) })) } },
          { type: "close" },
        ],
      },
      { headers: TURSO_HEADERS, timeout: 15000 }
    );
    return res.data?.results?.[0]?.response?.result || null;
  } catch (err) {
    console.error("[DB] Query error:", err.response?.data || err.message);
    return null;
  }
}

// ─── PROGRESS ─────────────────────────────────────────────

async function getProgress() {
  const result = await query("SELECT surah, ayah, reciter FROM progress WHERE id = 1");
  if (result?.rows?.[0]) {
    const row = result.rows[0];
    return {
      surah: parseInt(row[0]?.value || 1),
      ayah: parseInt(row[1]?.value || 1),
      reciter: row[2]?.value || "ar.alafasy",
    };
  }
  return { surah: 1, ayah: 1, reciter: "ar.alafasy" };
}

async function saveProgress(surah, ayah, reciter) {
  await query(
    "UPDATE progress SET surah = ?, ayah = ?, reciter = ? WHERE id = 1",
    [surah, ayah, reciter]
  );
}

// ─── POSTS ────────────────────────────────────────────────

async function savePost(type, surah, ayahStart, ayahEnd) {
  await query(
    "INSERT INTO posts (type, surah, ayah_start, ayah_end, created_at) VALUES (?, ?, ?, ?, ?)",
    [type, surah, ayahStart, ayahEnd, new Date().toISOString()]
  );
}

async function getRecentPosts(limit = 10) {
  const result = await query(
    `SELECT type, surah, ayah_start, ayah_end, created_at FROM posts ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  return result?.rows || [];
}

// ─── RUNS ─────────────────────────────────────────────────

async function saveRun(status, logs) {
  await query(
    "INSERT INTO runs (status, logs, created_at) VALUES (?, ?, ?)",
    [status, JSON.stringify(logs), new Date().toISOString()]
  );
}

async function getRecentRuns(limit = 5) {
  const result = await query(
    `SELECT status, logs, created_at FROM runs ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  return result?.rows || [];
}

module.exports = { getProgress, saveProgress, savePost, getRecentPosts, saveRun, getRecentRuns };
