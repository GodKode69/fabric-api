import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error("Missing MONGO_URI environment variable");
}

/**
 * Cached connection (safe for Vercel serverless)
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

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

/**
 * Schema + Model
 */
const statsSchema = new mongoose.Schema({
  guilds: Number,
  users: Number,
  ping: Number,
  commands: Number,
  uptime: Number,
  updatedAt: Date,
});

// prevent model overwrite on hot reload / serverless reuse
const Stats =
  mongoose.models.Stats || mongoose.model("Stats", statsSchema);

/**
 * Vercel Serverless Handler
 */
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method Not Allowed",
      });
    }

    await connectDB();

    const stats = await Stats.findOne().lean();

    return res.status(200).json({
      success: true,
      stats: stats || null,
    });
  } catch (err) {
    console.error("Stats API Error:", err);

    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
}