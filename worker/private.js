import PAGE_TEMPLATE from "./aljakun-private.html";

// Link-only page for sharing unreleased Aljakun media with the team.
// The page and its files only resolve with the secret ALJAKUN_PRIVATE_KEY in the
// path (/aljakun-private/<key>), and the files live in the private R2 bucket
// bound as PRIVATE_MEDIA, so nothing here is visible from the public repo.
// A wrong or missing key falls through to the normal site 404.
export const PRIVATE_PREFIX = "/aljakun-private";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

export async function handlePrivate(request, env, url) {
  const [, , key, section, ...rest] = url.pathname.split("/");

  if (!env.PRIVATE_MEDIA || !(await keyMatches(key, env.ALJAKUN_PRIVATE_KEY))) {
    return env.ASSETS.fetch(request);
  }

  const base = `${PRIVATE_PREFIX}/${key}`;

  if (section === undefined || (section === "" && rest.length === 0)) {
    return renderPage(env, base);
  }

  if (section === "media" && rest.length > 0) {
    const name = rest.map(decodeURIComponent).join("/");
    return serveMedia(request, env, name, url.searchParams.has("download"));
  }

  return env.ASSETS.fetch(request);
}

async function keyMatches(given, expected) {
  if (!given || !expected) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected.trim());
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

async function renderPage(env, base) {
  const objects = [];
  let cursor;
  do {
    const listing = await env.PRIVATE_MEDIA.list({ cursor, include: ["httpMetadata"] });
    objects.push(...listing.objects);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  objects.sort((a, b) => b.uploaded - a.uploaded);

  const items = objects.length
    ? objects.map((obj) => renderItem(obj, base)).join("\n\n")
    : `      <section class="devlog-section">
        <hr class="devlog-divider">
        <p class="private-empty">Nothing here yet, check back soon.</p>
      </section>`;

  return new Response(PAGE_TEMPLATE.replace("{{ITEMS}}", items), {
    headers: { ...PRIVATE_HEADERS, "content-type": "text/html; charset=utf-8" },
  });
}

function renderItem(obj, base) {
  const src = `${base}/media/${obj.key.split("/").map(encodeURIComponent).join("/")}`;
  const type = obj.httpMetadata?.contentType || "";
  const ext = obj.key.includes(".") ? obj.key.split(".").pop().toUpperCase() : "File";
  const uploaded = obj.uploaded.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  let preview = "";
  if (type.startsWith("video/")) {
    preview = `\n        <video class="private-media" src="${escapeHtml(src)}" autoplay loop muted playsinline controls></video>`;
  } else if (type.startsWith("image/")) {
    preview = `\n        <img class="private-media" src="${escapeHtml(src)}" alt="${escapeHtml(titleFromKey(obj.key))}">`;
  }

  return `      <section class="devlog-section">
        <hr class="devlog-divider">
        <div class="build-download">
          <div>
            <h2 class="private-title">${escapeHtml(titleFromKey(obj.key))}</h2>
            <p>${escapeHtml(ext)} &middot; ${formatSize(obj.size)} &middot; Uploaded ${uploaded}</p>
          </div>
          <a class="btn btn-primary build-download-btn" href="${escapeHtml(src)}?download" download>
            Download
            <svg class="build-download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </a>
        </div>${preview}
      </section>`;
}

// "aljakun-trailer_v2.mp4" -> "Aljakun Trailer V2"
function titleFromKey(key) {
  return key
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function serveMedia(request, env, name, download) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  let object;
  try {
    object =
      request.method === "HEAD"
        ? await env.PRIVATE_MEDIA.head(name)
        : await env.PRIVATE_MEDIA.get(name, { range: request.headers, onlyIf: request.headers });
  } catch (err) {
    // R2 rejects ranges past the end of the object.
    return new Response(null, { status: 416, headers: PRIVATE_HEADERS });
  }

  if (object === null) {
    return env.ASSETS.fetch(request);
  }

  const headers = new Headers(PRIVATE_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (download) {
    const filename = name.split("/").pop();
    headers.set(
      "content-disposition",
      `attachment; filename="${filename.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
  }

  if (request.method === "HEAD") {
    headers.set("content-length", object.size);
    return new Response(null, { headers });
  }

  // onlyIf preconditions failed: the object comes back without a body.
  if (!("body" in object)) {
    const notModified = request.headers.has("if-none-match") || request.headers.has("if-modified-since");
    return new Response(null, { status: notModified ? 304 : 412, headers });
  }

  if (request.headers.has("range") && object.range) {
    const { offset, length } = resolveRange(object.range, object.size);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }

  return new Response(object.body, { headers });
}

function resolveRange(range, size) {
  if (range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  return { offset, length: range.length ?? size - offset };
}
