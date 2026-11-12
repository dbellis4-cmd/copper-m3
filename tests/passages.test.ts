// @vitest-environment node
import { MockEmbeddingModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiNotConfiguredError, callEmbedMany } from "@/lib/ai/call";
import { EMBEDDING_MODEL } from "@/lib/ai/models";
import { embeddingCostUsd } from "@/lib/ai/pricing";
import { DOCUMENTS } from "@/lib/copper/documents";
import { getPassageIndex } from "@/lib/copper/passage-index";
import {
  cleanPageLines,
  groupSentences,
  pageSentences,
  SENTENCES_PER_PASSAGE,
  splitPage,
} from "@/lib/copper/passages";

// Google hands back whatever mock embedding model the test sets.
let model: MockEmbeddingModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => ({ embedding: () => model }),
}));

// A page as it comes out of the PDF: three header lines, then wrapped text.
const PAGE = [
  "Copper Home User Guide Set up Copper Home",
  "CSL-UG-0101-EN Rev. C 3",
  "© 2026 Copper State Labs, Inc. · Fictional company and documents, for educational use only.",
  "2.1 Before you start",
  "• The Copper app on an iPhone or Android phone",
  "• Your home Wi-Fi name and password",
  "Plug in Copper Home. After a few seconds the light ring flashes blue: it's in",
  "setup mode. Open the Copper app and tap Add Device. Choose Copper Home and",
  "follow the prompts. Pick your Wi-Fi network and enter the password.",
].join("\n");

const DOC = { id: "copper-home-user-guide", title: "Copper Home User Guide" };

describe("splitting a page into passages", () => {
  it("drops the running title, document code and copyright lines", () => {
    const lines = cleanPageLines(PAGE);
    expect(lines[0]).toBe("2.1 Before you start");
    expect(lines.join(" ")).not.toMatch(/CSL-UG|©|Set up Copper Home$/);
  });

  it("joins wrapped lines and keeps list items as their own sentences", () => {
    const sentences = pageSentences(PAGE);
    expect(sentences).toContain(
      "After a few seconds the light ring flashes blue: it's in setup mode.",
    );
    expect(sentences).toContain("• Your home Wi-Fi name and password");
    expect(sentences[0]).toBe("2.1 Before you start");
  });

  it("groups a few sentences into each passage", () => {
    const sentences = Array.from(
      { length: 9 },
      (_, i) =>
        `Sentence ${i + 1} is long enough to count as a real sentence about Copper Home setup.`,
    );
    const passages = groupSentences(sentences);
    expect(passages).toHaveLength(9 / SENTENCES_PER_PASSAGE);
    expect(passages[0]).toMatch(/^Sentence 1 .* Sentence 3 /);
  });

  it("folds a short leftover into the passage before it", () => {
    const long =
      "This sentence is long enough to fill out a passage on its own when there are three. ";
    const passages = groupSentences([long, long, long, "Short end."]);
    expect(passages).toHaveLength(1);
    expect(passages[0]).toMatch(/Short end\.$/);
  });

  it("starts each passage with the title and keeps the page number", () => {
    const passages = splitPage(DOC, 3, PAGE);
    expect(passages.length).toBeGreaterThan(0);
    passages.forEach((p, i) => {
      expect(p.text.startsWith("Copper Home User Guide: ")).toBe(true);
      expect(p.page).toBe(3);
      expect(p.title).toBe(DOC.title);
      expect(p.id).toBe(`copper-home-user-guide-p3-${i + 1}`);
    });
  });
});

describe("the saved passages (lib/copper/data/passages.json)", () => {
  const index = getPassageIndex();

  it("was made with the embedding model at its set size", () => {
    expect(index.model).toBe(EMBEDDING_MODEL.id);
    expect(index.dimensions).toBe(EMBEDDING_MODEL.dimensions);
    for (const p of index.passages) {
      expect(p.embedding).toHaveLength(EMBEDDING_MODEL.dimensions);
    }
  });

  it("covers every customer document, each passage with its title and page", () => {
    for (const doc of DOCUMENTS) {
      const mine = index.passages.filter((p) => p.docId === doc.id);
      expect(mine.length, doc.id).toBeGreaterThan(0);
      for (const p of mine) {
        expect(p.title).toBe(doc.title);
        expect(p.text.startsWith(`${doc.title}: `)).toBe(true);
        expect(p.page).toBeGreaterThanOrEqual(1);
      }
    }
    const ids = index.passages.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("callEmbedMany", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
    model = new MockEmbeddingModelV4({
      // Like Google: the whole batch in one request.
      maxEmbeddingsPerCall: 100,
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => [0.1, 0.2, 0.3]),
        usage: { tokens: 400 },
        warnings: [],
      }),
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns one embedding per text and logs the call with its cost", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { embeddings } = await callEmbedMany(
      { module: 3, feature: "embed-docs" },
      { values: ["a", "b"], task: "RETRIEVAL_DOCUMENT" },
    );
    expect(embeddings).toHaveLength(2);

    const sent = model.doEmbedCalls[0].providerOptions?.google;
    expect(sent).toMatchObject({
      outputDimensionality: EMBEDDING_MODEL.dimensions,
      taskType: "RETRIEVAL_DOCUMENT",
    });

    const rows = info.mock.calls
      .filter(([tag]) => tag === "[ai_calls]")
      .map(([, row]) => JSON.parse(row as string));
    expect(rows).toEqual([
      expect.objectContaining({
        module: 3,
        feature: "embed-docs",
        model: EMBEDDING_MODEL.id,
        input_tokens: 400,
        output_tokens: 0,
        cost_usd: embeddingCostUsd(400),
        ok: true,
      }),
    ]);
  });

  it("refuses to run without a key", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    await expect(
      callEmbedMany(
        { module: 3, feature: "embed-docs" },
        { values: ["a"], task: "RETRIEVAL_QUERY" },
      ),
    ).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});
