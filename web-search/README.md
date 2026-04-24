# web-search — a Google AI Edge Gallery skill for Gemma 4

A lightweight Agent Skill that gives Gemma 4 (or any on-device LLM that supports Gallery's `run_js` tool) real-time web access. Given a user question, the skill searches the web, reads the top 3 results deeply, and returns a compact, citation-ready markdown block that Gemma uses to answer.

- **Zero API key by default** — uses Jina Search + Reader (free, rate-limited) out of the box.
- **Pluggable providers** — drop in Brave, Google Custom Search, SerpAPI, or Bing by pasting a single secret.
- **Small** — ~30 KB total, no CDN at runtime, no bundler, pure browser JS.
- **Cross-platform** — the same skill works in the iOS and Android Gallery apps.
- **Lightweight model friendly** — extractive TF-IDF distillation on the skill side means Gemma 4 E4B only has to synthesize, not parse.

---

## Install in Google AI Edge Gallery (iPhone or Android)

1. Host the `web-search/` folder at a public URL. The easiest option: push it to a public GitHub repo and use the raw URL of the folder, or enable GitHub Pages and use the `web-search/` path.
2. Open **Google AI Edge Gallery** → **Skills** → **Load from URL**.
3. Paste the URL of the folder (the one that contains `SKILL.md`).
4. (Optional) Paste a secret to upgrade the search backend:

   | Backend | Secret format |
   |---|---|
   | DuckDuckGo via Jina Reader (default, no key) | *(leave blank)* |
   | Jina Search (authenticated, better quality) | `jina=<JINA_API_KEY>` |
   | Brave Search | `brave=<BRAVE_API_KEY>` |
   | Google Custom Search | `google=<API_KEY>\|cx=<CX>` |
   | SerpAPI | `serpapi=<SERPAPI_KEY>` |
   | Bing Web Search | `bing=<BING_API_KEY>` |

5. Load Gemma 4 E4B in Gallery and ask something time-sensitive, e.g. *"What did Apple announce at WWDC this year?"*. Gemma will call the skill, get a 3-source markdown block, and answer with `[S1] [S2] [S3]` citations.

---

## How it works

```
user question
    │
    ▼
Gemma rewrites to 3–10 word query (see SKILL.md)
    │   run_js(index.html, { "query": "…" })
    ▼
┌───────────────────────────────────────────────┐
│  scripts/index.html   ← skill entry point     │
│    → assets/search.js  (top 3 URLs)           │
│    → assets/extract.js (Jina Reader ×3 in ∥) │
│    → assets/distill.js (TF-IDF summarize)     │
│    → assets/format.js  (compose markdown)     │
└───────────────────────────────────────────────┘
    │
    ▼
{ "result": "# Web search: …\n## [S1] …\n…" }
    │
    ▼
Gemma writes the final 2–4 sentence answer with citations
```

### File layout

| File | Purpose |
|---|---|
| `SKILL.md` | Manifest + prose instructions Gemma reads. Defines the `run_js` contract and the query-rewriting rules. |
| `scripts/index.html` | Skill entry point. Defines `window.ai_edge_gallery_get_result(data, secret)` that Gallery calls. |
| `assets/search.js` | Provider adapters (Jina, Brave, Google CSE, SerpAPI, Bing). |
| `assets/extract.js` | Jina Reader (primary) + DOMParser readability-lite (fallback). |
| `assets/distill.js` | TF-IDF extractive summarizer, pure JS, no deps. |
| `assets/format.js` | Token-budgeted markdown block emitter. |
| `assets/styles.css` | Minimal result card styling. |
| `tests/test.html` | Desktop harness for iterating without the phone. |

---

## Local development

The skill is just static files, so any static server works:

```bash
cd web-search
python3 -m http.server 8000
# then open http://localhost:8000/tests/test.html
```

Enter a query and click **Run skill**. The page calls the same modules Gallery does and prints the exact markdown block Gemma would receive, plus stage timings.

No build step, no package manager, no Node.

---

## Tuning

All knobs live in `scripts/index.html`:

- `topN` — number of sources (default 3).
- `timeoutMs` on search and extract — hard caps so the skill never hangs the chat.
- `maxTokens` per-source — how much each distilled excerpt gets.
- `totalBudget` — hard ceiling on the whole markdown block (default 2000 tokens, leaving ~30k of Gemma 4's 32k context free).

Raise `topN` to 5 and `maxTokens` to 700 for meatier answers if you're running a larger Gemma variant or doing research-style queries.

---

## Limits & known tradeoffs

- **Jina Reader is rate-limited** without an API key. Heavy use will hit throttles; that's when a `brave=` or `google=` secret pays for itself.
- **Paywalled pages** often return login walls even via Jina. The skill notes the failure and Gemma is instructed to ignore `(fetch failed)` sources.
- **Extractive summarization** picks sentences from the source text; it does not paraphrase. If a source buries the answer in a figure or table, the distilled block may miss it. Gemma's final synthesis still usually recovers.
- **CORS.** All supported providers and Jina Reader are CORS-friendly. If you add a new provider, test CORS from a browser first.

---

## License

MIT — see `LICENSE`.
