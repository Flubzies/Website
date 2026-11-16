import { cleanSecret, keyMatches } from "./util.js";

// Bug reports from Aljakun development builds (ZetaCore's BugReportSender).
//
// The game POSTs one gzipped JSON object. Everything in it, and the token that came with it, is treated as
// written by an attacker: the token ships inside every dev build, so it only slows strangers down. The
// report is checked and stored in its own R2 bucket (BUG_REPORTS, never PRIVATE_MEDIA, whose whole
// contents the team page lists and serves), then a plain-text notice is emailed to contact@ through Resend.
//
// Every failure answers the same {"error":"rejected"} with a status code; the reason goes to the Worker
// logs only.
export const BUG_REPORT_PATH = "/api/bug-report";

const MAX_COMPRESSED_BYTES = 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024;
// Above this many reports in a UTC day nothing more is stored; above EMAIL_DAILY_CAP they are stored but not
// emailed, so Resend's 100-a-day quota stays free for replies sent from Gmail.
const STORE_DAILY_CAP = 200;
const EMAIL_DAILY_CAP = 50;

// Fixed here, never taken from the report: the endpoint can only ever email the studio.
const EMAIL_FROM = "Aljakun Bug Reports <bugs@flubzies.dev>";
const EMAIL_TO = "contact@flubzies.dev";
const RESEND_URL = "https://api.resend.com/emails";

// Short fields: name -> [max length, pattern the whole value must match]. A value that fails is dropped.
const TEXT_FIELDS = {
  version: [32, /^\d+\.\d+\.\d+$/],
  build: [16, /^(development|editor)$/],
  platform: [64, /^[A-Za-z0-9 _.-]+$/],
  unity: [32, /^[A-Za-z0-9 _.-]+$/],
  os: [128, null],
  gpu: [128, null],
  context: [120, /^[A-Za-z0-9 _:/,.()#-]+$/],
  steamName: [64, null],
  steamId: [17, /^\d{17}$/],
};
const MESSAGE_MAX = 2000;

// Attached files: report field -> object name in R2. Names are chosen here, never by the upload.
const FILE_FIELDS = {
  dump: "dump.json",
  playerLog: "player.log.txt",
  runSave: "run-save.json",
  progressSave: "progress-save.json",
  coreLog: "core-game.log.txt",
  aiLog: "ai-decisions.log.txt",
};

// Every stored object is served (if it ever is) as plain text: an upload can't make itself HTML.
const STORED_CONTENT_TYPE = "text/plain; charset=utf-8";

// The screenshot arrives as base64 and is kept only if it decodes to a JPEG (it starts FF D8 FF); then, and
// only then, it is stored as image/jpeg. Anything else is dropped.
const SCREENSHOT_NAME = "screenshot.jpg";
const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;

export async function handleBugReport(request, env, ctx) {
  if (request.method !== "POST") {
    return rejected(405, "method " + request.method, { allow: "POST" });
  }

  if (!env.BUG_REPORTS || !env.BUG_REPORT_TOKEN || !env.BUG_REPORT_LIMITER) {
    console.error("bug-report: not configured (BUG_REPORTS, BUG_REPORT_TOKEN or BUG_REPORT_LIMITER missing)");
    return rejected(503);
  }

  if (request.headers.get("x-report-encoding") !== "gzip") {
    return rejected(400, "missing X-Report-Encoding: gzip");
  }

  // Before the body is read, so a request without the token costs next to nothing.
  if (!(await keyMatches(request.headers.get("x-report-token"), env.BUG_REPORT_TOKEN))) {
    return rejected(401, "bad token");
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env.BUG_REPORT_LIMITER.limit({ key: ip });
  if (!success) {
    return rejected(429, "rate limited");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_COMPRESSED_BYTES) {
    return rejected(413, "declared length " + declaredLength);
  }

  if (!request.body) {
    return rejected(400, "empty body");
  }

  const compressed = await readCapped(request.body, MAX_COMPRESSED_BYTES);
  if (compressed === null) {
    return rejected(413, "compressed body over cap");
  }

  let json;
  try {
    const decompressed = await readCapped(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")),
      MAX_DECOMPRESSED_BYTES
    );
    if (decompressed === null) {
      return rejected(413, "decompressed body over cap");
    }
    json = new TextDecoder("utf-8", { fatal: true }).decode(decompressed);
  } catch (err) {
    return rejected(400, "bad gzip or utf-8: " + String(err));
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return rejected(400, "bad json");
  }

  const report = pickReport(parsed);
  if (!report) {
    return rejected(400, "not an object");
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const todayCount = await countReports(env.BUG_REPORTS, day);
  if (todayCount >= STORE_DAILY_CAP) {
    return rejected(429, "daily store cap reached");
  }

  const uuid = crypto.randomUUID();
  const id = uuid.slice(0, 8);
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const prefix = `reports/${day}/${time}-${uuid}/`;

  const stored = [];
  const meta = { id, received: now.toISOString(), ...report.fields, message: report.message, files: [] };
  for (const [field, name] of Object.entries(FILE_FIELDS)) {
    if (report.files[field] === undefined) continue;
    await env.BUG_REPORTS.put(prefix + name, report.files[field], {
      httpMetadata: { contentType: STORED_CONTENT_TYPE },
    });
    stored.push(name);
  }
  if (report.screenshot) {
    await env.BUG_REPORTS.put(prefix + SCREENSHOT_NAME, report.screenshot, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    stored.push(SCREENSHOT_NAME);
  }
  meta.files = stored;
  await env.BUG_REPORTS.put(prefix + "report.json", JSON.stringify(meta, null, 2), {
    httpMetadata: { contentType: STORED_CONTENT_TYPE },
  });

  if (todayCount < EMAIL_DAILY_CAP) {
    ctx.waitUntil(sendEmail(env, id, prefix, meta));
  } else {
    console.log("bug-report: stored without email (daily email cap)", prefix);
  }

  return json200({ ok: true, id });
}

// Only the known fields, own properties only, each checked; anything else in the upload is ignored.
function pickReport(parsed) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const fields = {};
  for (const [name, [maxLength, pattern]] of Object.entries(TEXT_FIELDS)) {
    const value = ownString(parsed, name);
    if (value === undefined) continue;
    const clean = stripControl(value, false).trim();
    if (!clean || clean.length > maxLength) continue;
    if (pattern && !pattern.test(clean)) continue;
    fields[name] = clean;
  }

  const rawMessage = ownString(parsed, "message");
  const message = rawMessage === undefined ? "" : stripControl(rawMessage, true).trim().slice(0, MESSAGE_MAX);

  const files = {};
  for (const field of Object.keys(FILE_FIELDS)) {
    const value = ownString(parsed, field);
    if (value !== undefined && value.length > 0) files[field] = value;
  }

  return { fields, message, files, screenshot: decodeJpeg(ownString(parsed, "screenshot")) };
}

// The JPEG's bytes, or null when the field is missing, isn't strict base64, is too big or isn't a JPEG.
function decodeJpeg(base64) {
  if (!base64 || base64.length > Math.ceil(SCREENSHOT_MAX_BYTES / 3) * 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;

  let binary;
  try {
    binary = atob(base64);
  } catch (err) {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isJpeg) {
    console.error("bug-report: screenshot dropped (not a JPEG)");
    return null;
  }
  return bytes;
}

function ownString(object, name) {
  if (!Object.prototype.hasOwnProperty.call(object, name)) return undefined;
  const value = object[name];
  return typeof value === "string" ? value : undefined;
}

// Drops control characters (and, outside the message, line breaks and tabs too), so a field can't fake
// extra lines in the email or the stored metadata.
function stripControl(text, keepLines) {
  return keepLines
    ? text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, "")
    : text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}

async function countReports(bucket, day) {
  // Each report is one "folder" under the day, so the delimited prefixes count reports, not files.
  const listing = await bucket.list({ prefix: `reports/${day}/`, delimiter: "/", limit: 1000 });
  return listing.delimitedPrefixes.length;
}

async function readCapped(stream, maxBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sendEmail(env, id, prefix, meta) {
  const context = meta.context || "unknown";
  const version = meta.version ? "v" + meta.version : "unknown version";
  const subject = `Bug report ${id} · ${version} · ${context}`;

  const lines = [
    meta.message ? meta.message : "(no message)",
    "",
    "----",
    `Version: ${meta.version || "unknown"} (${meta.build || "unknown build"})`,
    `Platform: ${meta.platform || "unknown"} · ${meta.os || "unknown OS"}`,
    `GPU: ${meta.gpu || "unknown"}`,
    `Where: ${context}`,
    `From: ${meta.steamName ? `${meta.steamName}${meta.steamId ? ` (${meta.steamId})` : ""}` : "not shared"}`,
    `Files: ${meta.files.length ? meta.files.join(", ") : "none"}`,
    "",
    `R2: flubzies-bug-reports/${prefix}`,
  ];

  const email = { from: EMAIL_FROM, to: [EMAIL_TO], subject, text: lines.join("\n") };

  if (env.BUG_REPORT_DRY_RUN === "1") {
    console.log("bug-report: dry run, email not sent", JSON.stringify(email));
    return;
  }

  if (!env.RESEND_API_KEY) {
    console.error("bug-report: RESEND_API_KEY missing, report stored without email", prefix);
    return;
  }

  // A paste that didn't land (Ctrl+V at a hidden prompt can store a lone control character) fails at Resend as a
  // bare 400; say so plainly instead. Only the key's length is logged, never the key.
  const apiKey = cleanSecret(env.RESEND_API_KEY);
  if (!/^re_[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
    console.error("bug-report: RESEND_API_KEY doesn't look like a Resend key (length " + apiKey.length +
      "); set it again. Report stored without email", prefix);
    return;
  }

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `bug-report-${id}`,
      },
      body: JSON.stringify(email),
    });
    if (!response.ok) {
      // A 429 here is Resend's quota; the report is already stored either way. Resend's reply names the
      // problem (never the key), so it goes to the log as it is.
      console.error("bug-report: Resend error", response.status, (await response.text()).slice(0, 500), prefix);    } else {
      console.log("bug-report: emailed", prefix);
    }
  } catch (err) {
    console.error("bug-report: Resend unreachable", String(err), prefix);
  }
}

function rejected(status, reason, extraHeaders) {
  if (reason) console.error("bug-report: rejected", status, reason);
  return new Response(JSON.stringify({ error: "rejected" }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

function json200(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
