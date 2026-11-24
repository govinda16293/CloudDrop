// CloudDrop file analyser: a Google Cloud Run service.
// The Upload page sends a chosen PDF here before uploading it. The service checks
// the caller's Supabase session, reads the PDF, and returns its page count, word
// count and suggested tags, which the form fills in. Nothing is stored here.

const http = require("node:http");
const pdf = require("pdf-parse/lib/pdf-parse.js");

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
const MAX_BYTES = 25 * 1024 * 1024;

// Common English and filler words that make poor tags.
const STOP = new Set(("a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with you your " +
  "page pages chapter unit figure fig table example examples using used use one two three may also however therefore thus hence etc e g i e will can must shall let given find show note notes").split(" "));

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin || "");
  return allowed ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  } : {};
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function signedInUser(authorization) {
  if (!authorization?.startsWith("Bearer ") || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { authorization, apikey: SUPABASE_KEY } });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.email?.toLowerCase().endsWith("@thapar.edu") ? user : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Most frequent meaningful words and two-word phrases, as tag suggestions.
function suggestTags(text, limit = 6) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word));
  const counts = new Map();
  for (let i = 0; i < words.length; i += 1) {
    counts.set(words[i], (counts.get(words[i]) || 0) + 1);
    if (i + 1 < words.length) {
      const pair = `${words[i]} ${words[i + 1]}`;
      counts.set(pair, (counts.get(pair) || 0) + 1.5);
    }
  }
  const ranked = [...counts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).map(([term]) => term);
  const chosen = [];
  for (const term of ranked) {
    const parts = term.split(" ");
    if (chosen.some((kept) => kept.split(" ").some((word) => parts.includes(word)))) continue;
    chosen.push(term);
    if (chosen.length === limit) break;
  }
  return chosen;
}

// A PDF the parser cannot open (a tiny or hand-made file) still lists its pages
// as "/Type /Page" objects, so count those instead of failing.
function countPages(buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

async function analyse(buffer) {
  let result;
  try {
    result = await pdf(buffer);
  } catch {
    return { pages: Math.max(1, countPages(buffer)), words: 0, suggestedTags: [], subjectCode: null, partial: true };
  }
  const text = result.text || "";
  const words = text.split(/\s+/).filter(Boolean).length;
  const subject = (text.match(/\b[A-Z]{3}\d{3}\b/) || [null])[0];
  return { pages: result.numpages, words, suggestedTags: suggestTags(text), subjectCode: subject };
}

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req.headers.origin);
  if (req.method === "OPTIONS") return send(res, 204, {}, cors);
  if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { ok: true }, cors);
  if (req.method === "GET" && req.url === "/") {
    return send(res, 200, {
      service: "CloudDrop PDF analyser",
      purpose: "Reads a PDF before upload and returns its page count, word count, subject code and suggested tags.",
      endpoints: { "GET /healthz": "health check", "POST /analyze": "PDF body + Supabase session token" },
      app: "https://clouddrop-473512.web.app",
    }, cors);
  }
  if (req.method !== "POST" || req.url !== "/analyze") return send(res, 404, { error: "Not found." }, cors);
  try {
    if (!(await signedInUser(req.headers.authorization))) return send(res, 401, { error: "Sign in with your campus account." }, cors);
    const body = await readBody(req);
    if (body.subarray(0, 5).toString() !== "%PDF-") return send(res, 415, { error: "Only PDF files can be analysed." }, cors);
    return send(res, 200, await analyse(body), cors);
  } catch (error) {
    if (error.status === 413) return send(res, 413, { error: "File is larger than 25 MB." }, cors);
    console.error(error);
    return send(res, 422, { error: "Could not read this PDF." }, cors);
  }
});

if (require.main === module) server.listen(PORT, () => console.log(`analyser listening on ${PORT}`));
module.exports = { server, analyse, suggestTags };
