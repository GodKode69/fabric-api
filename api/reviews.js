import { randomUUID } from "crypto";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;

let cached =
  global._mongoose || (global._mongoose = { conn: null, promise: null });

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!MONGO_URI) throw new Error("Missing MONGO_URI");

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGO_URI, { bufferCommands: false });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

const reviewSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    alias: { type: String, required: true, trim: true, maxlength: 24 },
    authorId: { type: String, required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 180 },
    replyTo: { type: String, default: null },
    x: { type: Number, required: true, min: 0, max: 100 },
    y: { type: Number, required: true, min: 0, max: 100 },
  },
  {
    timestamps: true,
    _id: false,
  },
);

const Review =
  mongoose.models.PortfolioReview ||
  mongoose.model("PortfolioReview", reviewSchema, "portfolio_reviews");

/* ── CORS ──────────────────────────────────────────────────────────────────── */

const ALLOWED_ORIGINS = [
  "https://godkode.xyz",
  "https://www.godkode.xyz",
  "https://godkode69.github.io",
  "https://fabric.godkode.xyz",
  "http://localhost:3000",
  "http://localhost:5173",
];

const PATCH_ALLOWED_ORIGINS = [
  "https://godkode.xyz",
  "https://www.godkode.xyz",
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With",
  );
}

/* ── Rate limiter (in-memory, per IP) ──────────────────────────────────────── */

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function getRateLimitKey(ip, method) {
  return `${ip}:${method}`;
}

function isRateLimited(ip, method) {
  const key = getRateLimitKey(ip, method);
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

/* ── Input sanitization ─────────────────────────────────────────────────────── */

function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

function stripSpecialChars(str) {
  return str
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_CHARS = /^[a-zA-Z0-9\-_ ]+$/;

function sanitizeString(value, maxLength) {
  if (typeof value !== "string") return "";
  const cleaned = stripHtmlTags(value);
  return stripSpecialChars(cleaned).slice(0, maxLength);
}

function sanitizeAlias(value) {
  if (typeof value !== "string") return "";
  const cleaned = stripHtmlTags(value);
  const trimmed = stripSpecialChars(cleaned).slice(0, 24);
  if (!ALIAS_CHARS.test(trimmed)) return "";
  return trimmed;
}

function sanitizeNumber(value, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(next, 0), 100);
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function getRoutePath(req) {
  const url = new URL(req.url, "https://api.godkode.xyz");
  return url.searchParams.get("path") || "";
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function shapeReview(review) {
  return {
    id: review._id,
    alias: review.alias,
    body: review.body,
    replyTo: review.replyTo ?? null,
    x: review.x,
    y: review.y,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

/* ── Handlers ───────────────────────────────────────────────────────────────── */

async function getReviews(res) {
  const reviews = await Review.find({})
    .sort({ createdAt: 1 })
    .limit(150)
    .lean();

  return res.status(200).json({
    reviews: reviews.map(shapeReview),
  });
}

async function createReview(req, res, ip) {
  if (isRateLimited(ip, "POST")) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const alias = sanitizeAlias(req.body?.alias);
  const authorId = sanitizeString(req.body?.authorId, 30);
  const body = sanitizeString(req.body?.body, 180);
  const replyTo = sanitizeString(req.body?.replyTo, 30) || null;

  if (!alias || !authorId || !body) {
    return res
      .status(400)
      .json({ error: "alias, authorId, and body are required" });
  }

  const review = await Review.create({
    _id: randomUUID(),
    alias,
    authorId,
    body,
    replyTo,
    x: sanitizeNumber(req.body?.x, 50),
    y: sanitizeNumber(req.body?.y, 50),
  });

  return res.status(201).json({ review: shapeReview(review) });
}

async function updateReview(req, res, id, ip) {
  if (isRateLimited(ip, "PATCH")) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const origin = req.headers.origin;
  if (!PATCH_ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const authorId = sanitizeString(req.body?.authorId, 30);

  if (!id || !authorId) {
    return res
      .status(400)
      .json({ error: "review id and authorId are required" });
  }

  const update = {};
  if (req.body?.body !== undefined) update.body = sanitizeString(req.body.body, 180);
  if (req.body?.x !== undefined) update.x = sanitizeNumber(req.body.x, 50);
  if (req.body?.y !== undefined) update.y = sanitizeNumber(req.body.y, 50);

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  const review = await Review.findOneAndUpdate(
    { _id: id, authorId },
    { $set: update },
    { new: true },
  );

  if (!review) {
    return res.status(404).json({ error: "Review not found" });
  }

  return res.status(200).json({ review: shapeReview(review) });
}

/* ── Main handler ───────────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    await connectDB();

    const path = getRoutePath(req);
    const ip = getClientIp(req);

    if (req.method === "GET" && !path) return getReviews(res);
    if (req.method === "POST" && !path) return createReview(req, res, ip);
    if (req.method === "PATCH" && path) return updateReview(req, res, path, ip);

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Reviews API error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
