# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```

## Module 3 starter: Ask Copper

**Summary:** Ask Copper, the Module 2 shopping chatbot, finished: a floating
chat panel that answers prices, totals and stock with four tools and shows
each step. Module 3 teaches it to answer from the customer documents.

| Piece | Where | What it does |
|---|---|---|
| Component | `components/copper/ask-copper.tsx` | The launcher and chat panel, mounted from `app/page.tsx` and opened by the header's `#ask` link. Draws each answer as stations: the tools on offer, thinking, each tool call, then the reply |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper()`: streams the conversation with `callStream`, up to 5 steps, and sends each step back as a live `Progress` |
| Tools | `lib/copper/assistant/tools.ts` | `copperTools`: `get_products`, `get_prices`, `calculate_cost`, `check_availability` |
| Instructions | `lib/copper/assistant/instructions.ts` | `COPPER_INSTRUCTIONS`. Copper says it can't help yet with warranty, setup, troubleshooting or privacy |
| Data | `lib/copper/inventory.ts`, `lib/copper/documents.ts` | Stock from `lib/copper/data/inventory.json`; `DOCUMENTS`: the four customer documents and their PDF paths under `public/docs/`. The PDFs are added in class |
| AI calls | `{ module: 2, feature: "ask-copper" }` | One streamed call per question |

## Module 3: Document passages and embeddings

**Summary:** The four customer PDFs are split into short passages and each
passage is turned into an embedding (a list of numbers that captures its
meaning), so Ask Copper can later find the passages that answer a question.

| Piece | Where | What it does |
|---|---|---|
| PDFs | `public/docs/*.pdf` | The customer documents listed in `DOCUMENTS` |
| Splitter | `lib/copper/passages.ts` | Drops each page's header lines, rejoins wrapped lines, splits into sentences (list items, steps and headings count as one each) and groups about 3 sentences per passage. Every passage keeps its `title` and `page`, and its `text` starts with `"<title>: "` |
| Script | `scripts/embed-docs.mts` (`npm run embed-docs`) | Reads the PDFs with `unpdf`, splits them, embeds every passage and writes the data file. `-- --dry-run` splits and counts without calling Gemini |
| Data | `lib/copper/data/passages.json` | `{ model, dimensions, createdAt, passages: [{ id, docId, title, page, text, embedding }] }`, one passage per line |
| Loader | `lib/copper/passage-index.ts`, `instrumentation.ts` | `getPassageIndex()` returns the passages from memory; `register()` loads them once when the server starts and logs `[passages] loaded N passages` |
| AI calls | `callEmbedMany` in `lib/ai/call.ts`, `{ module: 3, feature: "embed-docs" }` | `gemini-embedding-001` at 768 dimensions, task `RETRIEVAL_DOCUMENT`. Run once per PDF change, not per question: about 7,500 input tokens for all four PDFs, about a tenth of a cent |

| Search | `lib/copper/search.ts` | `searchDocs(query)`: embeds the question (task `RETRIEVAL_QUERY`), compares it with every passage by cosine similarity and returns the 5 closest with `title`, `page`, `link` (`/docs/<file>.pdf#page=N`), `score` and `text` |
| Tool | `search_docs` in `lib/copper/assistant/tools.ts` | Ask Copper's fifth tool. The instructions send setup, troubleshooting, error-code, warranty, refund, subscription, privacy and policy questions to it, and tell Copper to answer only from the passages and name the document and page |
| Tool card | `ToolOutput` in `components/copper/ask-copper.tsx` | Lists the 5 passages: title, page, score, a two-line excerpt and an "Open page N" link |
| AI calls (search) | `{ module: 3, feature: "search-docs" }` | One embedding call per search (a few tokens), plus the usual `ask-copper` call |

**Data flow:** `npm run embed-docs` → PDFs → passages → Gemini embeddings →
`passages.json` (committed) → loaded into memory when the server starts.
At question time: question → Ask Copper → `search_docs` → embed the question
→ 5 closest passages → Copper answers from them, citing document and page.

**Decisions and trade-offs:**
- **A JSON file in memory, not a database.** About 100 passages fit easily in
  memory and searching them takes microseconds. A vector database (such as
  Supabase with pgvector) is worth it at thousands of passages or when
  documents change often.
- **Embeddings are made ahead of time, not when the app starts.** Starting
  stays fast and free, and a deploy doesn't need to call Gemini.
- **768 dimensions instead of 3072.** Google's own guidance is that the
  smaller size loses very little quality; the file is about a quarter of the
  size.
- **The title starts every passage.** "The warranty is 2 years" only makes
  sense if the embedding knows it's from the Copper Home guide.

**Risks and open questions:** if a PDF changes and nobody re-runs
`npm run embed-docs`, answers come from the old text. A passage can split a
FAQ question from its answer when a page break falls between them. Embeddings match
meaning, not exact words, so short codes like "C-47" score only a little
above unrelated passages; adding keyword matching would make code lookups
more reliable.
