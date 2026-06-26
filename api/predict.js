import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as ort from "onnxruntime-web/wasm";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

const ALLOWED_ORIGINS = [
  "https://godkode.xyz",
  "https://www.godkode.xyz",
  "https://godkode69.github.io",
  "https://fabric.godkode.xyz",
  "http://localhost:3000"
];

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const IMG_SIZE = 224;

let session = null;
let classes = null;

async function loadModel() {
  if (session) return session;
  const modelPath = join(__dirname, "model.onnx");
  const modelBuffer = await readFile(modelPath);
  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ["cpu"],
  });
  return session;
}

async function loadClasses() {
  if (classes) return classes;
  const classesPath = join(__dirname, "classes.json");
  const data = await readFile(classesPath, "utf-8");
  classes = JSON.parse(data);
  return classes;
}

async function preprocessImage(imageBuffer) {
  const raw = await sharp(imageBuffer)
    .resize(IMG_SIZE, IMG_SIZE, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const floatBuffer = new Float32Array(IMG_SIZE * IMG_SIZE * 3);
  for (let i = 0; i < IMG_SIZE * IMG_SIZE * 3; i++) {
    const pixel = raw[i] / 255.0;
    const channel = i % 3;
    floatBuffer[i] = (pixel - MEAN[channel]) / STD[channel];
  }

  const nchwBuffer = new Float32Array(1 * 3 * IMG_SIZE * IMG_SIZE);
  for (let h = 0; h < IMG_SIZE; h++) {
    for (let w = 0; w < IMG_SIZE; w++) {
      for (let c = 0; c < 3; c++) {
        const hwIndex = h * IMG_SIZE + w;
        const chwIndex = c * IMG_SIZE * IMG_SIZE + hwIndex;
        const rgbIndex = hwIndex * 3 + c;
        nchwBuffer[chwIndex] = floatBuffer[rgbIndex];
      }
    }
  }

  return new ort.Tensor("float32", nchwBuffer, [1, 3, IMG_SIZE, IMG_SIZE]);
}

function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExps);
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    const contentType = req.headers["content-type"] || "";
    let imageBuffer;

    if (contentType.includes("application/json")) {
      const json = JSON.parse(body.toString());
      if (!json.image) {
        return res.status(400).json({ error: "Missing 'image' field (base64)" });
      }
      imageBuffer = Buffer.from(json.image, "base64");
    } else if (contentType.includes("multipart/form-data")) {
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) {
        return res.status(400).json({ error: "Invalid multipart form" });
      }
      const parts = body.toString("binary").split("--" + boundary);
      for (const part of parts) {
        if (part.includes("Content-Type: image/")) {
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            const data = part.substring(headerEnd + 4);
            const trimmed = data.replace(/[\r\n-]+$/, "");
            imageBuffer = Buffer.from(trimmed, "binary");
            break;
          }
        }
      }
    } else {
      imageBuffer = body;
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ error: "No image provided" });
    }

    const [session, classNames] = await Promise.all([loadModel(), loadClasses()]);

    const tensor = await preprocessImage(imageBuffer);

    const inputName = session.inputNames[0];
    const results = await session.run({ [inputName]: tensor });
    const outputName = session.outputNames[0];
    const logits = results[outputName].data;

    const probs = softmax(Array.from(logits));

    const indexed = probs.map((prob, idx) => ({ prob, idx }));
    indexed.sort((a, b) => b.prob - a.prob);

    const top5 = indexed.slice(0, 5).map((item) => ({
      class: classNames[item.idx],
      confidence: Math.round(item.prob * 10000) / 100,
    }));

    const predicted = top5[0];

    return res.status(200).json({
      class: predicted.class,
      confidence: predicted.confidence,
      top5,
    });
  } catch (err) {
    console.error("Predict API error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
