/**
 * GET /api/commands
 *
 * Returns all non-disabled, non-owner commands grouped by category.
 * Mirrors the shape expected by commands.md on the frontend.
 */
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;
let cached =
  global._mongoose || (global._mongoose = { conn: null, promise: null });

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGO_URI, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// ── Inline schema (same as command.model.js — avoids cross-file import issues
//    in serverless environments where models may already be registered) ──────
const argSchema = new mongoose.Schema(
  { name: String, description: String, required: Boolean },
  { _id: false },
);

const commandSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  alias: [String],
  desc: String,
  usage: String,
  category: String,
  argsRequired: Boolean,
  args: [argSchema],
  userPerms: [String],
  botPerms: [String],
  disabled: Boolean,
  owner: Boolean,
  admin: Boolean,
  cooldown: Number,
  updatedAt: Date,
});

const Command =
  mongoose.models.cmd || mongoose.model("cmd", commandSchema);

// ── CORS helper (reuse same origins as stats) ───────────────────────────────
const ALLOWED_ORIGINS = [
  "https://godkode.xyz",
  "https://www.godkode.xyz",
  "https://fabric.godkode.xyz",
  "http://localhost:5173",
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    await connectDB();

    // Never expose owner-only or disabled commands publicly
    const commands = await Command.find(
      { disabled: false, owner: false },
      { _id: 0, __v: 0 }, // strip mongo internals
    )
      .sort({ category: 1, name: 1 })
      .lean();

    // Shape each doc into the frontend-expected format
    const shaped = commands.map((cmd) => ({
      name: cmd.name,
      alias: cmd.alias ?? [],
      description: cmd.desc ?? "",
      usage: cmd.usage ?? "",
      category: cmd.category ?? "Uncategorised",
      args: cmd.argsRequired ?? false,
      argsList: cmd.args ?? [],
      permissions: cmd.userPerms ?? [],
      botPerms: cmd.botPerms ?? [],
      cooldown: cmd.cooldown ? Math.round(cmd.cooldown / 1000) : 0, // convert ms → s
      admin: cmd.admin ?? false,
      updatedAt: cmd.updatedAt,
    }));

    return res.status(200).json(shaped);
  } catch (err) {
    console.error("Commands API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
