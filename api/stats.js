import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;

let cached = global._mongoose || (global._mongoose = { conn: null, promise: null });

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGO_URI, {
      bufferCommands: false,
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

const statsSchema = new mongoose.Schema({
  guilds: Number,
  users: Number,
  ping: Number,
  commands: Number,
  uptime: Number,
  updatedAt: Date,
});

const Stats = mongoose.models.Stats || mongoose.model("Stats", statsSchema);

export default async function handler(req, res) {
  const allowedOrigins = [
    "https://godkode.xyz",
    "https://www.godkode.xyz",
    "https://fabric.godkode.xyz",
    "http://localhost:5173",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await connectDB();

    const stats = await Stats.findOne({}).lean();

    if (!stats) {
      return res.status(404).json({ error: "No stats found" });
    }

    // Format uptime into human-readable
    const uptimeSeconds = Math.floor(stats.uptime);
    const days    = Math.floor(uptimeSeconds / 86400);
    const hours   = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    return res.status(200).json({
      guilds:    stats.guilds,
      users:     stats.users,
      ping:      stats.ping,
      commands:  stats.commands,
      categories: stats.categories,
      uptime: {
        raw:     stats.uptime,
        days,
        hours,
        minutes,
        seconds,
        formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`,
      },
      updatedAt: stats.updatedAt,
    });
  } catch (err) {
    console.error("Stats API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}