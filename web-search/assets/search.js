// Pluggable search providers. Each adapter returns an array of
// { url, title, snippet, rank } objects. The secret string selects the
// provider; empty secret falls back to Jina (no key needed).

export async function search(query, { secret, topN = 3, timeoutMs = 8000 } = {}) {
  const provider = pickProvider(secret);
  const hits = await withTimeout(provider.fn(query, provider.config), timeoutMs, "search");
  return hits.slice(0, topN).map((h, i) => ({ ...h, rank: i + 1 }));
}

function pickProvider(secret) {
  const s = (secret || "").trim();
  if (!s) return { fn: ddgViaJinaReader, config: {} };

  if (s.startsWith("jina=")) {
    return { fn: jinaSearch, config: { apiKey: s.slice("jina=".length).trim() } };
  }
  if (s.startsWith("brave=")) {
    return { fn: brave, config: { apiKey: s.slice("brave=".length).trim() } };
  }
  if (s.startsWith("google=")) {
    const m = s.match(/^google=([^|]+)\|cx=(.+)$/);
    if (!m) throw new Error("google secret must look like: google=<KEY>|cx=<CX>");
    return { fn: googleCse, config: { apiKey: m[1].trim(), cx: m[2].trim() } };
  }
  if (s.startsWith("serpapi=")) {
    return { fn: serpapi, config: { apiKey: s.slice("serpapi=".length).trim() } };
  }
  if (s.startsWith("bing=")) {
    return { fn: bing, config: { apiKey: s.slice("bing=".length).trim() } };
  }
  throw new Error("unrecognized secret format; see require-secret-description in SKILL.md");
}

// ---------------- Default: DuckDuckGo HTML proxied through Jina Reader (no key) ----------------
// DDG blocks direct browser fetches, but Jina Reader (r.jina.ai) will fetch it for us
// and return a clean markdown rendering that's easy to parse. Both endpoints are keyless.
async function ddgViaJinaReader(query) {
  const target = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const res = await fetch("https://r.jina.ai/" + target, { headers: { "Accept": "text/plain" } });
  if (!res.ok) throw new Error(`DDG-via-Jina failed: ${res.status}`);
  return parseDdgMarkdown(await res.text());
}

// Jina-rendered DDG HTML has a result per `## [title](ddg-redirect-url)` heading.
// The redirect URL encodes the real destination in its `uddg` query parameter.
// A short paragraph after each heading is the snippet.
function parseDdgMarkdown(md) {
  const hits = [];
  const headingRe = /^##\s+\[([^\]]+)\]\(([^)]+)\)\s*$/gm;
  const seen = new Set();
  let m;
  while ((m = headingRe.exec(md)) !== null) {
    const title = m[1].trim();
    const redirect = m[2].trim();
    const url = decodeDdgRedirect(redirect);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const after = md.slice(m.index + m[0].length, m.index + m[0].length + 2000);
    const snippet = extractFirstSnippet(after);
    hits.push({ url, title, snippet });
  }
  return hits;
}

function decodeDdgRedirect(redirect) {
  try {
    const u = new URL(redirect, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (/^https?:\/\//i.test(redirect)) return redirect;
  } catch (_) { /* fall through */ }
  return null;
}

function extractFirstSnippet(after) {
  // Look for a bracketed paragraph of descriptive text — DDG's snippet sits inside
  // the clickable description link: `[ ...snippet... ](<redirect-url>)`.
  const linkText = after.match(/\[([^\]]{60,})\]\(https?:\/\/duckduckgo\.com\/l\//);
  if (linkText) return collapseMdWhitespace(linkText[1]);
  const plain = after.split(/\n\s*\n/).map(s => s.trim()).find(s => s.length > 60 && !s.startsWith("!["));
  return plain ? collapseMdWhitespace(plain) : "";
}

function collapseMdWhitespace(s) {
  return s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

// ---------------- Jina Search (authenticated, better quality) ----------------
async function jinaSearch(query, { apiKey }) {
  const url = "https://s.jina.ai/" + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Authorization": "Bearer " + apiKey,
      "X-Respond-With": "no-content",
    },
  });
  if (res.status === 401 || res.status === 403) throw new Error("Jina auth failed");
  if (!res.ok) throw new Error(`Jina search failed: ${res.status}`);
  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .filter(d => d && d.url)
    .map(d => ({ url: d.url, title: d.title || "", snippet: d.description || d.content || "" }));
}

// ---------------- Brave Search API ----------------
async function brave(query, { apiKey }) {
  const url = "https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(query) + "&count=10";
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "X-Subscription-Token": apiKey },
  });
  if (res.status === 401 || res.status === 403) throw new Error("Brave auth failed");
  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
  const json = await res.json();
  const web = (json.web && json.web.results) || [];
  return web.map(r => ({ url: r.url, title: r.title || "", snippet: r.description || "" }));
}

// ---------------- Google Custom Search JSON API ----------------
async function googleCse(query, { apiKey, cx }) {
  const url = "https://www.googleapis.com/customsearch/v1?key=" + encodeURIComponent(apiKey)
    + "&cx=" + encodeURIComponent(cx) + "&q=" + encodeURIComponent(query) + "&num=10";
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new Error("Google CSE auth failed");
  if (!res.ok) throw new Error(`Google CSE search failed: ${res.status}`);
  const json = await res.json();
  const items = json.items || [];
  return items.map(it => ({ url: it.link, title: it.title || "", snippet: it.snippet || "" }));
}

// ---------------- SerpAPI ----------------
async function serpapi(query, { apiKey }) {
  const url = "https://serpapi.com/search.json?engine=google&q=" + encodeURIComponent(query)
    + "&num=10&api_key=" + encodeURIComponent(apiKey);
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new Error("SerpAPI auth failed");
  if (!res.ok) throw new Error(`SerpAPI search failed: ${res.status}`);
  const json = await res.json();
  const organic = json.organic_results || [];
  return organic.map(r => ({ url: r.link, title: r.title || "", snippet: r.snippet || "" }));
}

// ---------------- Bing Web Search API ----------------
async function bing(query, { apiKey }) {
  const url = "https://api.bing.microsoft.com/v7.0/search?q=" + encodeURIComponent(query) + "&count=10";
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (res.status === 401 || res.status === 403) throw new Error("Bing auth failed");
  if (!res.ok) throw new Error(`Bing search failed: ${res.status}`);
  const json = await res.json();
  const web = (json.webPages && json.webPages.value) || [];
  return web.map(r => ({ url: r.url, title: r.name || "", snippet: r.snippet || "" }));
}

// ---------------- helpers ----------------
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
