import { randomUUID } from "crypto";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

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

const ALLOWED_ORIGINS = [
  "https://godkode.xyz",
  "https://www.godkode.xyz",
  "https://godkode69.github.io",
  "https://fabric.godkode.xyz",
  "http://localhost:3000",
  "http://localhost:5173",
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sanitizeString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function sanitizeNumber(value, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(next, 0), 100);
}

function getRoutePath(req) {
  const url = new URL(req.url, "https://api.godkode.xyz");
  return url.searchParams.get("path") || "";
}

function shapeReview(review) {
  return {
    id: review._id,
    alias: review.alias,
    authorId: review.authorId,
    body: review.body,
    replyTo: review.replyTo ?? null,
    x: review.x,
    y: review.y,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

async function getReviews(res) {
  const reviews = await Review.find({})
    .sort({ createdAt: 1 })
    .limit(150)
    .lean();

  return res.status(200).json({
    reviews: reviews.map(shapeReview),
  });
}

async function createReview(req, res) {
  const alias = sanitizeString(req.body?.alias, 24);
  const authorId = sanitizeString(req.body?.authorId, 120);
  const body = sanitizeString(req.body?.body, 180);
  const replyTo = sanitizeString(req.body?.replyTo, 120) || null;
  const id = sanitizeString(req.body?.id, 120) || randomUUID();

  if (!alias || !authorId || !body) {
    return res.status(400).json({ error: "alias, authorId, and body are required" });
  }

  const review = await Review.create({
    _id: id,
    alias,
    authorId,
    body,
    replyTo,
    x: sanitizeNumber(req.body?.x, 50),
    y: sanitizeNumber(req.body?.y, 50),
  });

  return res.status(201).json({ review: shapeReview(review) });
}

async function updateAlias(req, res) {
  const alias = sanitizeString(req.body?.alias, 24);
  const authorId = sanitizeString(req.body?.authorId, 120);

  if (!alias || !authorId) {
    return res.status(400).json({ error: "alias and authorId are required" });
  }

  await Review.updateMany({ authorId }, { $set: { alias } });
  return res.status(200).json({ ok: true });
}

async function updateReview(req, res, id) {
  const authorId = sanitizeString(req.body?.authorId, 120);

  if (!id || !authorId) {
    return res.status(400).json({ error: "review id and authorId are required" });
  }

  const review = await Review.findOneAndUpdate(
    { _id: id, authorId },
    {
      $set: {
        x: sanitizeNumber(req.body?.x, 50),
        y: sanitizeNumber(req.body?.y, 50),
      },
    },
    { new: true },
  );

  if (!review) {
    return res.status(404).json({ error: "Review not found" });
  }

  return res.status(200).json({ review: shapeReview(review) });
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    await connectDB();

    const path = getRoutePath(req);

    if (req.method === "GET" && !path) return getReviews(res);
    if (req.method === "POST" && !path) return createReview(req, res);
    if (req.method === "PATCH" && path === "alias") return updateAlias(req, res);
    if (req.method === "PATCH") return updateReview(req, res, path);

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Reviews API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
