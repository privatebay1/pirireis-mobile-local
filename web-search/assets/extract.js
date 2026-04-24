// Fetch a URL and return clean article text. Two strategies:
//  1. Jina Reader (r.jina.ai) — returns clean markdown, no CORS issues, no HTML to parse.
//  2. Direct fetch + DOMParser readability-lite — fallback when Jina fails or rate-limits.
//
// A failure returns { text: "", failed: true, reason }. The skill orchestrator keeps
// going with the sources that succeeded.

export async function extract(url, { timeoutMs = 10000 } = {}) {
  try {
    const text = await withTimeout(viaJinaReader(url), timeoutMs, "jina-reader");
    if (text && text.trim().length > 200) return { text, failed: false };
  } catch (_) { /* fall through */ }

  try {
    const text = await withTimeout(viaDirectFetch(url), timeoutMs, "direct-fetch");
    return { text: text || "", failed: !text, reason: text ? null : "empty" };
  } catch (e) {
    return { text: "", failed: true, reason: String(e?.message || e) };
  }
}

async function viaJinaReader(url) {
  const res = await fetch("https://r.jina.ai/" + url, {
    headers: { "Accept": "text/plain", "X-Return-Format": "markdown" },
  });
  if (!res.ok) throw new Error(`jina-reader ${res.status}`);
  const md = await res.text();
  return stripReaderBoilerplate(md);
}

// Jina Reader prepends a few metadata lines (Title:, URL Source:, Published Time:,
// Markdown Content:). Strip those and then clean markdown artifacts that would
// otherwise pollute the distiller (images, link URLs, heading markers).
function stripReaderBoilerplate(md) {
  const marker = /\n\s*Markdown Content:\s*\n/i;
  const m = md.match(marker);
  const body = m ? md.slice(m.index + m[0].length) : md;
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")             // images
    .replace(/\[\s*\]\s*\(?[^)]*\)?/g, "")            // empty-text links like []() or []
    .replace(/\[([^\]]+)\]\(https?:[^)]+\)/g, "$1")   // keep link text, drop URL
    .replace(/\((?:https?:[^)]{10,})\)/g, "")         // stray bare URLs in parens
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")               // heading markers
    .replace(/^\s*>\s?/gm, "")                        // blockquote markers
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function viaDirectFetch(url) {
  const res = await fetch(url, {
    headers: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (compatible; GemmaWebSearch/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`direct-fetch ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html") && !ct.includes("xml")) throw new Error("non-html response");
  const html = await res.text();
  return readabilityLite(html);
}

// Minimal readability: pick the DOM subtree with the densest paragraph text.
// ~100 lines, no deps. Not as good as Mozilla Readability but solid for news/blogs.
export function readabilityLite(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return "";

  // Remove obviously non-content nodes.
  const junk = doc.querySelectorAll(
    "script, style, noscript, nav, header, footer, aside, form, iframe, svg, " +
    "[role=navigation], [role=banner], [role=contentinfo], " +
    ".nav, .menu, .sidebar, .footer, .header, .ads, .advert, .cookie, .newsletter"
  );
  junk.forEach(n => n.remove());

  // Score every block candidate by text density.
  const candidates = Array.from(doc.querySelectorAll("article, main, section, div"));
  let best = null;
  let bestScore = 0;
  for (const node of candidates) {
    const text = (node.textContent || "").trim();
    if (text.length < 250) continue;
    const paragraphs = node.querySelectorAll("p").length;
    if (paragraphs < 2) continue;
    const commasPerP = text.split(",").length / Math.max(paragraphs, 1);
    const linkDensity = linkRatio(node);
    if (linkDensity > 0.35) continue;
    const score = text.length * (1 - linkDensity) + paragraphs * 100 + commasPerP * 20;
    if (score > bestScore) { bestScore = score; best = node; }
  }

  const root = best || doc.body;
  if (!root) return "";

  // Convert the winning subtree to plain text with paragraph breaks.
  const parts = [];
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const t = (child.textContent || "").trim();
        if (t) parts.push(t);
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (tag === "p" || tag === "li" || tag === "h1" || tag === "h2" || tag === "h3") {
          const t = (child.textContent || "").trim();
          if (t) parts.push(t);
          parts.push("\n");
        } else {
          walk(child);
        }
      }
    }
  };
  walk(root);
  return parts.join(" ").replace(/\s*\n\s*/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function linkRatio(node) {
  const total = (node.textContent || "").length || 1;
  let linked = 0;
  for (const a of node.querySelectorAll("a")) {
    linked += (a.textContent || "").length;
  }
  return linked / total;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
