// @vitest-environment node
import { MockEmbeddingModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import { TOOL_LABELS } from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";
import { getPassageIndex } from "@/lib/copper/passage-index";
import {
  cosineSimilarity,
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

  it("returns the 5 closest passages, closest first, with title, page and link", () => {
    const matches = rankPassages(errorCodes.embedding, passages);
    expect(matches).toHaveLength(TOP_K);
    expect(TOP_K).toBe(5);
    expect(matches[0]).toMatchObject({
      title: "Copper Home User Guide",
      page: errorCodes.page,
      link: `/docs/copper-home-user-guide.pdf#page=${errorCodes.page}`,
      score: 1,
    });
    expect(matches[0].text).toContain("C-47");
    expect(matches[0].text.startsWith("Copper Home User Guide")).toBe(false);
    const scores = matches.map((m) => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
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
