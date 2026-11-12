// Module 3: finds the passages in the customer documents that best match a
// question. The question is embedded with the same model as the passages,
// then compared with every passage in memory: the closer two embeddings
// point in the same direction, the closer the meanings.
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
  /** How close the passage is to the question, from 0 to 1. */
  score: number;
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

/** The k passages closest to an embedded question, closest first. */
export function rankPassages(
  queryEmbedding: number[],
  passages: EmbeddedPassage[],
  k = TOP_K,
): DocMatch[] {
  return passages
    .map((p) => ({ p, score: cosineSimilarity(queryEmbedding, p.embedding) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map(({ p, score }) => ({
      title: p.title,
      page: p.page,
      link: pageLink(p.docId, p.page),
      score: Math.round(score * 100) / 100,
      text: p.text.slice(p.title.length + 2),
    }));
}

/** search_docs: embeds the question and returns the TOP_K closest passages. */
export async function searchDocs(query: string): Promise<DocSearchResult> {
  const { embeddings } = await callEmbedMany(
    { module: 3, feature: "search-docs" },
    { values: [query], task: "RETRIEVAL_QUERY" },
  );
  return {
    query,
    matches: rankPassages(embeddings[0], getPassageIndex().passages),
  };
}
