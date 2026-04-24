// Extractive summarization: rank sentences by TF-IDF relevance to the query,
// keep the best ones until a token budget is hit, then re-order by original
// position so the output reads naturally. No dependencies, ~20ms for 10KB input.

const STOPWORDS = new Set((
  "a an the and or but if then else for of to in on at by with from as is are was " +
  "were be been being have has had do does did will would could should may might " +
  "can this that these those it its i you he she we they them his her their our " +
  "your my me us what which who whom whose when where why how not no yes so"
).split(/\s+/));

export function distill(text, query, { maxTokens = 500 } = {}) {
  if (!text || !text.trim()) return "";
  const sentences = splitSentences(text);
  if (sentences.length === 0) return "";
  if (sentences.length <= 3) return sentences.join(" ");

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return sentences.slice(0, budgetCount(sentences, maxTokens)).join(" ");
  }

  // Build IDF over sentences-as-documents.
  const tokenized = sentences.map(tokenize);
  const df = new Map();
  for (const toks of tokenized) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = tokenized.length;
  const idf = t => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;

  // Score each sentence by summed IDF of overlap with query terms, with a
  // mild penalty for very short sentences and a small boost for early position.
  const qSet = new Set(queryTerms);
  const scored = tokenized.map((toks, i) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const q of qSet) if (tf.has(q)) score += idf(q) * (1 + Math.log(tf.get(q)));
    const lengthPenalty = toks.length < 5 ? 0.4 : 1.0;
    const positionBoost = 1 + Math.max(0, (20 - i)) / 100; // tiny boost to first ~20 sentences
    return { i, score: score * lengthPenalty * positionBoost, len: sentences[i].length };
  });

  // Greedy pick highest-scoring sentences until the token budget is hit.
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  let used = 0;
  for (const s of scored) {
    if (s.score <= 0 && picked.length >= 3) break;
    const cost = Math.ceil(s.len / 4);
    if (used + cost > maxTokens && picked.length >= 2) continue;
    picked.push(s.i);
    used += cost;
    if (used >= maxTokens) break;
  }

  // Fallback: if query had no overlap at all, keep the first N sentences.
  if (picked.length === 0) {
    return sentences.slice(0, budgetCount(sentences, maxTokens)).join(" ");
  }

  // Restore original order for readability.
  picked.sort((a, b) => a - b);
  return picked.map(i => sentences[i]).join(" ");
}

function splitSentences(text) {
  // Normalize whitespace, then split on sentence boundaries while being
  // lenient about common abbreviations (Mr., Dr., U.S., e.g., i.e.).
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const abbrevGuarded = cleaned
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K|No)\./gi, "$1<DOT>");
  const parts = abbrevGuarded.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/);
  return parts.map(p => p.replace(/<DOT>/g, ".").trim()).filter(p => p.length > 0);
}

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u0600-\u06ff\u0400-\u04ff\s'-]/g, " ")
    .split(/\s+/)
    .filter(t => t && t.length > 1 && !STOPWORDS.has(t));
}

function budgetCount(sentences, maxTokens) {
  let used = 0, n = 0;
  for (const s of sentences) {
    used += Math.ceil(s.length / 4);
    n++;
    if (used >= maxTokens) break;
  }
  return n;
}
