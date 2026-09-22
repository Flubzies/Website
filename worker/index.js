const GITHUB_REPO = "Flubzies/ZetaCore";
const API_PATH = "/api/dev-history";
const CACHE_TTL_SECONDS = 300;
const COMMIT_LIMIT = 25;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === API_PATH) {
      return handleDevHistory(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleDevHistory(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(url_no_query(request), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  if (!env.ZC_GITHUB_TOKEN) {
    return jsonResponse({ error: "not_configured" }, 503);
  }

  const token = env.ZC_GITHUB_TOKEN.trim();

  let upstream;
  try {
    upstream = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=50`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "flubzies-website",
          Accept: "application/vnd.github+json",
        },
      }
    );
  } catch (err) {
    return jsonResponse(
      { error: "upstream_unreachable", message: String(err), tokenLen: token.length },
      502
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text();
    const upstreamHeaders = Object.fromEntries(upstream.headers.entries());
    return jsonResponse(
      {
        error: "upstream_error",
        status: upstream.status,
        detail,
        tokenLen: token.length,
        rawTokenLen: env.ZC_GITHUB_TOKEN.length,
        upstreamHeaders,
      },
      502
    );
  }

  const data = await upstream.json();

  const commits = data
    .filter((c) => c.parents && c.parents.length < 2)
    .slice(0, COMMIT_LIMIT)
    .map((c) => ({
      sha: c.sha.slice(0, 8),
      message: (c.commit.message || "").split("\n")[0],
      date: c.commit.author.date,
    }));

  const response = jsonResponse(
    { commits, generated: new Date().toISOString() },
    200,
    CACHE_TTL_SECONDS
  );

  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function url_no_query(request) {
  const url = new URL(request.url);
  url.search = "";
  return url.toString();
}

function jsonResponse(body, status, cacheSeconds) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (cacheSeconds) {
    headers["cache-control"] = `public, max-age=${cacheSeconds}`;
  }
  return new Response(JSON.stringify(body), { status, headers });
}
