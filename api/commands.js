import mongoose from "mongoose";

const mongoUri = process.env.MONGO_URI;
let cached =
  global._mongoose || (global._mongoose = { conn: null, promise: null });

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(mongoUri, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

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

const allowedOrigins = [
  "https://godkode.xyz",
  "https://www.godkode.xyz",
  "https://godkode69.github.io",
  "https://fabric.godkode.xyz",
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    await connectDB();

    const commands = await Command.find(
      { disabled: false, owner: false },
      { _id: 0, __v: 0 },
    )
      .sort({ category: 1, name: 1 })
      .lean();

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
      cooldown: cmd.cooldown ? Math.round(cmd.cooldown / 1000) : 0,
      admin: cmd.admin ?? false,
      updatedAt: cmd.updatedAt,
    }));

    return res.status(200).json(shaped);
  } catch (err) {
    console.error("Commands API error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
