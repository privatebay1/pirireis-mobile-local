---
name: web-search
description: Search the web and read the top 3 result pages to answer questions about current events, prices, recent releases, and anything outside the model's training data.
metadata:
  require-secret: false
  require-secret-description: Optional. Leave blank for free default (DuckDuckGo via Jina Reader, no API key). Otherwise paste ONE line, for example jina=KEY, brave=KEY, google=KEY|cx=CX, serpapi=KEY, or bing=KEY.
  homepage: https://github.com/privatebay1/pirireis-mobile-local
---

# Web Search

Search the web and read the top 3 results for questions that need up-to-date or out-of-training-data information.

## When to use

Call this skill when the user asks about something that needs **current, factual, or post-cutoff** information:

- News, current events, sports scores, stock prices
- Product releases, version numbers, specs, prices
- "What is X?" where X was released after your training cutoff
- Anything where a stale answer would be wrong or misleading

Do NOT call this skill for casual conversation, opinion questions, coding/math the model can solve directly, or questions the user explicitly says are hypothetical.

## Instructions

Call the `run_js` tool with the following exact parameters:

- script name: `index.html`
- data: a JSON string with the following field
  - **query**: Required. A focused 3–10 word search query you crafted from the user's message (see rules below).

DO NOT use any other tool. DO NOT call `run_intent`.

## Crafting the query (important)

Do NOT forward the user's message verbatim. Rewrite it into a focused 3–10 word search query before calling the tool.

- Keep proper nouns, product names, version numbers, and dates exactly as the user wrote them.
- If the question is time-sensitive ("latest", "recent", "now", "yesterday", "this year"), include the current year.
- Drop pleasantries, filler, and meta-talk ("hey", "I was wondering", "can you tell me").
- Prefer noun phrases over full sentences, but do NOT reduce to a bare keyword list — modern search engines rank better on natural phrases.
- If the user asks multiple things, pick the single most important one for this call. You can call the skill again for the others.

### Examples

- User: "Hey, I was wondering what the latest iPhone is and how much it costs" → query: `iPhone 2026 latest model price`
- User: "who won the champions league final yesterday" → query: `Champions League final 2026 winner`
- User: "explain the new React 20 server components" → query: `React 20 server components changes`
- User: "tell me about the Gemma 4 release" → query: `Gemma 4 release announcement 2026`

## After the tool returns

You will receive `{ "result": "<short text block>" }` listing up to 3 sources as `[S1] title: excerpt`, ending with an instruction line.

- Reply with a short, direct answer — **1–2 sentences** — based ONLY on the sources.
- Cite inline as [S1], [S2], [S3].
- Do not restate the question or add disclaimers.
- If all sources failed, tell the user the search did not return usable results and suggest they rephrase.

## Error handling

If the tool returns `{ "error": "<message>" }`:

- If the error mentions "missing query", re-invoke with a proper query.
- If the error mentions "rate limit" or "auth", tell the user the search provider is unavailable and they may need to update the skill's secret.
- For any other error, apologize briefly and answer from your own knowledge if possible, noting it may be out of date.
