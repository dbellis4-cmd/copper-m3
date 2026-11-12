// Module 3: finds the passages in the customer documents that best match a
// question, with hybrid search: two rankings merged into one.
// 1. Meaning: the question is embedded with the same model as the passages
//    and compared with every passage in memory. The closer two embeddings
//    point in the same direction, the closer the meanings.
// 2. Keywords: passages that contain the question's actual words, with rare
//    words ("C-47") counting far more than common ones ("Copper"). This is
//    BM25, the classic search-engine formula. It catches exact codes and
//    names that embeddings blur together.
// The two are merged with reciprocal rank fusion: a passage near the top of
// either list rises, and one near the top of both rises most.
import { callEmbedMany } from "@/lib/ai/call";
import { DOCUMENTS } from "@/lib/copper/documents";
import { getPassageIndex } from "@/lib/copper/passage-index";
import type { EmbeddedPassage } from "@/lib/copper/passages";

/** How many passages search_docs returns. */
export const TOP_K = 5;

export type DocMatch = {
  title: string;
  page: number;
  /** Opens the PDF at that page, like /docs/copper-plus-faq.pdf#page=3. */
  link: string;
  /** How close the passage's meaning is to the question, from 0 to 1. */
  score: number;
  /** The question's words found in the passage, like ["c-47"]. */
  keywords: string[];
  /** The passage itself, without the title in front. */
  text: string;
};

export type DocSearchResult = { query: string; matches: DocMatch[] };

/**
 * Cosine similarity: 1 when two embeddings point the same way (same
 * meaning), near 0 when they're unrelated.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/** The link that opens a passage's PDF at its page. */
export function pageLink(docId: string, page: number): string {
  const doc = DOCUMENTS.find((d) => d.id === docId);
  return `${doc?.file ?? `/docs/${docId}.pdf`}#page=${page}`;
}

// Words too common to say anything about which passage is the right one.
const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from how i if in is it its my of on or so that the this to what when where which who why will with you your".split(
    " ",
  ),
);

/**
 * Splits text into lowercase search words, keeping codes and hyphenated
 * words whole ("C-47" → "c-47", "Wi-Fi" → "wi-fi") and dropping a plural
 * "s" so "refunds" matches "refund" (but not from "plus", "this" or "access").
 */
export function keywordsOf(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  return words
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && /[^sui]s$/.test(w) ? w.slice(0, -1) : w));
}

type KeywordIndex = {
  /** How many times each word appears in each passage. */
  counts: Map<string, number>[];
  /** How many passages contain each word. */
  passagesWith: Map<string, number>;
  averageLength: number;
};

const indexes = new WeakMap<EmbeddedPassage[], KeywordIndex>();

/** Counts every passage's words once, then reuses the counts. */
function keywordIndex(passages: EmbeddedPassage[]): KeywordIndex {
  const cached = indexes.get(passages);
  if (cached) return cached;
  const passagesWith = new Map<string, number>();
  let totalLength = 0;
  const counts = passages.map((p) => {
    const words = keywordsOf(p.text);
    totalLength += words.length;
    const count = new Map<string, number>();
    for (const w of words) count.set(w, (count.get(w) ?? 0) + 1);
    for (const w of count.keys())
      passagesWith.set(w, (passagesWith.get(w) ?? 0) + 1);
    return count;
  });
  const index = {
    counts,
    passagesWith,
    averageLength: totalLength / Math.max(passages.length, 1),
  };
  indexes.set(passages, index);
  return index;
}

/**
 * BM25 keyword scores, one per passage (0 when no question word appears).
 * A word scores more when it's rare across passages and appears often in a
 * short passage.
 */
export function keywordScores(
  query: string,
  passages: EmbeddedPassage[],
): number[] {
  const { counts, passagesWith, averageLength } = keywordIndex(passages);
  const words = [...new Set(keywordsOf(query))];
  const n = passages.length;
  const k1 = 1.2;
  const b = 0.75;
  return counts.map((count) => {
    let length = 0;
    for (const c of count.values()) length += c;
    let score = 0;
    for (const w of words) {
      const tf = count.get(w);
      if (!tf) continue;
      const df = passagesWith.get(w)!;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score +=
        (idf * tf * (k1 + 1)) /
        (tf + k1 * (1 - b + (b * length) / averageLength));
    }
    return score;
  });
}

/**
 * Words in more than this share of passages (like "copper") barely move the
 * ranking, so they aren't listed as matched words in the tool card.
 */
const COMMON_WORD_SHARE = 1 / 3;

/** Reciprocal rank fusion's damping: 60 is the usual choice. */
const RRF_K = 60;

/** The 1-based rank of each item when sorted by score, highest first. */
function ranks(scores: number[]): number[] {
  const order = scores
    .map((score, i) => ({ score, i }))
    .sort((x, y) => y.score - x.score);
  const rank = new Array<number>(scores.length);
  order.forEach(({ i }, position) => (rank[i] = position + 1));
  return rank;
}

/**
 * The k passages that best match a question, best first: the meaning ranking
 * and the keyword ranking merged with reciprocal rank fusion.
 */
export function rankPassages(
  question: { query: string; embedding: number[] },
  passages: EmbeddedPassage[],
  k = TOP_K,
): DocMatch[] {
  const meaning = passages.map((p) =>
    cosineSimilarity(question.embedding, p.embedding),
  );
  const keyword = keywordScores(question.query, passages);
  const meaningRank = ranks(meaning);
  const keywordRank = ranks(keyword);
  const { passagesWith } = keywordIndex(passages);
  const queryWords = [...new Set(keywordsOf(question.query))].filter(
    (w) => (passagesWith.get(w) ?? 0) <= passages.length * COMMON_WORD_SHARE,
  );
  return passages
    .map((p, i) => ({
      p,
      i,
      fused:
        1 / (RRF_K + meaningRank[i]) +
        (keyword[i] > 0 ? 1 / (RRF_K + keywordRank[i]) : 0),
    }))
    .sort((x, y) => y.fused - x.fused)
    .slice(0, k)
    .map(({ p, i }) => {
      const words = new Set(keywordsOf(p.text));
      return {
        title: p.title,
        page: p.page,
        link: pageLink(p.docId, p.page),
        score: Math.round(meaning[i] * 100) / 100,
        keywords: queryWords.filter((w) => words.has(w)),
        text: p.text.slice(p.title.length + 2),
      };
    });
}

/** search_docs: embeds the question and returns the TOP_K best passages. */
export async function searchDocs(query: string): Promise<DocSearchResult> {
  const { embeddings } = await callEmbedMany(
    { module: 3, feature: "search-docs" },
    { values: [query], task: "RETRIEVAL_QUERY" },
  );
  return {
    query,
    matches: rankPassages(
      { query, embedding: embeddings[0] },
      getPassageIndex().passages,
    ),
  };
}
