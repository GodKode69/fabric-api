import mongoose from "mongoose";
import { createServer } from "http";

// ─── Config ────────────────────────────────────────────────────────────────
const IS_LOCAL = process.env.NODE_ENV !== "production" && !process.env.VERCEL;
const PORT     = process.env.PORT || 3000;

// Log MONGODB_URI on startup (masked after the password for safety)
const RAW_URI = process.env.MONGODB_URI;
if (RAW_URI) {
  const masked = RAW_URI.replace(/:([^@]+)@/, ":<hidden>@");
  console.log("[config] MONGODB_URI:", masked);
} else {
  console.error("[config] MONGODB_URI is UNDEFINED — check your .env or Vercel env vars");
}

// ─── DB connection (cached for serverless reuse) ────────────────────────────
let cached = global._mongoose || (global._mongoose = { conn: null, promise: null });

async function connectDB() {
  if (cached.conn) {
    console.log("[db] using cached connection");
    return cached.conn;
  }

  if (!RAW_URI) throw new Error("MONGODB_URI is not defined");

  console.log("[db] connecting to MongoDB...");
  if (!cached.promise) {
    cached.promise = mongoose.connect(RAW_URI, { bufferCommands: false });
  }

  cached.conn = await cached.promise;
  console.log("[db] connected successfully, readyState:", mongoose.connection.readyState);
  return cached.conn;
}

// ─── Schema ────────────────────────────────────────────────────────────────
const statsSchema = new mongoose.Schema({
  guilds:    Number,
  users:     Number,
  ping:      Number,
  commands:  Number,
  uptime:    Number,
  updatedAt: Date,
});

const Stats = mongoose.models.Stats || mongoose.model("Stats", statsSchema);

// ─── Handler ───────────────────────────────────────────────────────────────
export async function handler(req, res) {
  const allowedOrigins = [
    "https://godkode.xyz",
    "https://www.godkode.xyz",
    "https://fabric.godkode.xyz",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*"); // open during debug
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.writeHead ? res.writeHead(200) && res.end() : res.status(200).end();
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  console.log(`[request] ${req.method} ${req.url}`);

  try {
    await connectDB();

    console.log("[query] fetching stats from DB...");
    const stats = await Stats.findOne({}).lean();
    console.log("[query] result:", stats ? "found" : "null");

    if (!stats) {
      return sendJson(res, 404, { error: "No stats found — bot hasn't written to DB yet" });
    }

    const uptimeSeconds = Math.floor(stats.uptime ?? 0);
    const days    = Math.floor(uptimeSeconds / 86400);
    const hours   = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    return sendJson(res, 200, {
      guilds:   stats.guilds,
      users:    stats.users,
      ping:     stats.ping,
      commands: stats.commands,
      uptime: {
        raw:       stats.uptime,
        days, hours, minutes, seconds,
        formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`,
      },
      updatedAt: stats.updatedAt,
    });
  } catch (err) {
    console.error("[error]", err.message);
    console.error(err.stack);
    return sendJson(res, 500, { error: err.message }); // expose message locally
  }
}

// ─── Vercel export ─────────────────────────────────────────────────────────
export default handler;

// ─── Local dev server ──────────────────────────────────────────────────────
if (IS_LOCAL) {
  createServer((req, res) => {
    res.setHeader = (k, v) => { res.setHeader(k, v); };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data, null, 2));
    };
    res.end = res.end.bind(res);

    handler(req, res);
  }).listen(PORT, () => {
    console.log(`[local] server running at http://localhost:${PORT}/stats`);
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function sendJson(res, code, data) {
  // works for both Vercel (express-like) and raw http.ServerResponse
  if (typeof res.status === "function") {
    return res.status(code).json(data);
  }
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data, null, 2));
}