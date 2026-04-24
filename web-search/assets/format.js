// Compose a Gemma-ready markdown block. Enforces a total token budget by
// trimming per-source bodies proportionally if the sum overflows.

export function formatContext(query, sources, { totalBudget = 2000 } = {}) {
  const header = `# Web search: "${escapeQuotes(query)}"`;
  const footer = `---\nAnswer the user's question using only the sources above. Cite as [S1], [S2], [S3]. If sources disagree, say so briefly.`;

  const blocks = sources.map(s => {
    if (!s.text || !s.text.trim()) {
      return `## [S${s.rank}] ${titleOf(s)} — ${s.url}\n> (fetch failed, skip this source)`;
    }
    return `## [S${s.rank}] ${titleOf(s)} — ${s.url}\n${quote(s.text)}`;
  });

  let out = [header, "", ...interleave(blocks, ""), "", footer].join("\n");
  const budget = Math.max(500, totalBudget);

  if (estTokens(out) <= budget) return out;

  // Over budget: shrink each source's body proportionally until we fit.
  const overhead = estTokens([header, "", footer, ""].join("\n") + blocks.map(headerOnly).join("\n"));
  const perSourceBudget = Math.max(80, Math.floor((budget - overhead) / Math.max(sources.length, 1)));

  const trimmed = sources.map(s => {
    if (!s.text || !s.text.trim()) {
      return `## [S${s.rank}] ${titleOf(s)} — ${s.url}\n> (fetch failed, skip this source)`;
    }
    const shrunk = truncateToTokens(s.text, perSourceBudget);
    return `## [S${s.rank}] ${titleOf(s)} — ${s.url}\n${quote(shrunk)}`;
  });

  return [header, "", ...interleave(trimmed, ""), "", footer].join("\n");
}

function titleOf(s) { return (s.title && s.title.trim()) || s.url; }
function escapeQuotes(s) { return (s || "").replace(/"/g, '\\"'); }
function quote(text) {
  return text.split(/\n+/).map(line => "> " + line.trim()).filter(l => l !== "> ").join("\n");
}
function estTokens(text) { return Math.ceil((text || "").length / 4); }
function truncateToTokens(text, tokens) {
  const maxChars = tokens * 4;
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak + 1) : cut) + " …";
}
function headerOnly(block) { return block.split("\n")[0]; }
function interleave(arr, sep) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    out.push(arr[i]);
    if (i < arr.length - 1) out.push(sep);
  }
  return out;
}
