// @vitest-environment node
import { MockEmbeddingModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import { TOOL_LABELS } from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";
import { getPassageIndex } from "@/lib/copper/passage-index";
import {
  cosineSimilarity,
  keywordScores,
  keywordsOf,
  pageLink,
  rankPassages,
  searchDocs,
  TOP_K,
} from "@/lib/copper/search";

// Google hands back whatever mock embedding model the test sets.
let model: MockEmbeddingModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => ({ embedding: () => model }),
}));

const { passages } = getPassageIndex();
const errorCodes = passages.find(
  (p) => p.docId === "copper-home-user-guide" && p.text.includes("C-47"),
)!;

/** A fake Gemini that "embeds" every question as the given passage. */
function embedsAs(embedding: number[]) {
  return new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => embedding),
      usage: { tokens: 5 },
      warnings: [],
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ranking passages", () => {
  it("scores the same direction 1 and unrelated directions 0", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("links to the PDF at the passage's page", () => {
    expect(pageLink("copper-plus-faq", 3)).toBe(
      "/docs/copper-plus-faq.pdf#page=3",
    );
  });

  it("returns the 5 best passages, best first, with title, page and link", () => {
    // With no keyword in the question, the order is by meaning alone.
    const matches = rankPassages(
      { query: "what now", embedding: errorCodes.embedding },
      passages,
    );
    expect(matches).toHaveLength(TOP_K);
    expect(TOP_K).toBe(5);
    expect(matches[0]).toMatchObject({
      title: "Copper Home User Guide",
      page: errorCodes.page,
      link: `/docs/copper-home-user-guide.pdf#page=${errorCodes.page}`,
      score: 1,
      keywords: [],
    });
    expect(matches[0].text).toContain("C-47");
    expect(matches[0].text.startsWith("Copper Home User Guide")).toBe(false);
    const scores = matches.map((m) => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe("keyword search", () => {
  it("keeps codes and hyphenated words whole and drops filler words", () => {
    expect(keywordsOf("How do I reset the Wi-Fi? Error C-47!")).toEqual([
      "reset",
      "wi-fi",
      "error",
      "c-47",
    ]);
    expect(keywordsOf("refunds plus access")).toEqual([
      "refund",
      "plus",
      "access",
    ]);
  });

  it("doesn't list words found in most passages as matches", () => {
    const matches = rankPassages(
      { query: "reset Wi-Fi Copper Home", embedding: errorCodes.embedding },
      passages,
    );
    for (const m of matches) {
      expect(m.keywords).not.toContain("copper");
      expect(m.keywords).not.toContain("home");
    }
    expect(matches.some((m) => m.keywords.includes("wi-fi"))).toBe(true);
  });

  it("scores only passages that contain the words, rare words highest", () => {
    const scores = keywordScores("C-47", passages);
    const withCode = passages.filter((p) => p.text.includes("C-47"));
    passages.forEach((p, i) =>
      expect(scores[i] > 0, p.id).toBe(withCode.includes(p)),
    );
  });

  it("finds an exact code even when the meaning search points elsewhere", () => {
    // Pretend Gemini embedded the question exactly like an unrelated Terms
    // passage: by meaning alone, the C-47 passage wouldn't make the top 5.
    const unrelated = passages.find(
      (p) => p.docId === "copper-terms-and-conditions",
    )!;
    const byMeaningOnly = rankPassages(
      { query: "what now", embedding: unrelated.embedding },
      passages,
    );
    expect(byMeaningOnly.some((m) => m.text.includes("C-47"))).toBe(false);

    // Only the C-47 passage contains the code, so it comes first...
    const code = rankPassages(
      { query: "C-47", embedding: unrelated.embedding },
      passages,
    );
    expect(code[0].text).toContain("C-47");
    expect(code[0].keywords).toEqual(["c-47"]);

    // ...and stays in the top 5 when the question has other words too.
    const sentence = rankPassages(
      { query: "error C-47", embedding: unrelated.embedding },
      passages,
    );
    expect(sentence.some((m) => m.keywords.includes("c-47"))).toBe(true);
  });
});

describe("searchDocs", () => {
  it("embeds the question as a query and logs it as module 3, search-docs", async () => {
    model = embedsAs(errorCodes.embedding);
    const result = await searchDocs("C-47");
    expect(result.query).toBe("C-47");
    expect(result.matches[0].text).toContain("C-47");
    expect(model.doEmbedCalls[0].values).toEqual(["C-47"]);
    expect(model.doEmbedCalls[0].providerOptions?.google).toMatchObject({
      taskType: "RETRIEVAL_QUERY",
    });
    const rows = vi
      .mocked(console.info)
      .mock.calls.filter(([tag]) => tag === "[ai_calls]")
      .map(([, row]) => JSON.parse(row as string));
    expect(rows[0]).toMatchObject({
      module: 3,
      feature: "search-docs",
      ok: true,
    });
  });
});

describe("Ask Copper's search_docs tool", () => {
  it("is one of Copper's tools, with a label for the chat panel", async () => {
    expect(copperTools.search_docs.description).toMatch(/warranty/i);
    expect(TOOL_LABELS.search_docs).toBeDefined();
    model = embedsAs(errorCodes.embedding);
    // The call details the AI SDK normally passes in; this tool ignores them.
    const details = { toolCallId: "1", messages: [] } as unknown as Parameters<
      NonNullable<typeof copperTools.search_docs.execute>
    >[1];
    const output = await copperTools.search_docs.execute!(
      { query: "C-47" },
      details,
    );
    expect(output).toMatchObject({ query: "C-47" });
  });

  it("is what the instructions send setup, warranty and policy questions to", () => {
    expect(COPPER_INSTRUCTIONS).toMatch(/search_docs/);
    expect(COPPER_INSTRUCTIONS).toMatch(/setup/);
    expect(COPPER_INSTRUCTIONS).toMatch(/warranty/);
    expect(COPPER_INSTRUCTIONS).toMatch(/page/);
    expect(COPPER_INSTRUCTIONS).not.toMatch(/can't help with that yet/);
  });
});
