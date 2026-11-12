// Splits the customer documents into passages: a few sentences each, small
// enough that one passage answers one question. Each passage keeps its
// document title and page number, and its text starts with the title so the
// embedding knows which product it's about ("the warranty" means different
// things in the Copper Home guide and in the Terms).
import type { EmbeddingModelId } from "@/lib/ai/models";

export type Passage = {
  /** Unique id, like "copper-home-user-guide-p3-2" (page 3, second passage). */
  id: string;
  /** The document's id from DOCUMENTS. */
  docId: string;
  /** The document's title, like "Copper Home User Guide". */
  title: string;
  /** Page number in the PDF, starting at 1. */
  page: number;
  /** "<title>: <a few sentences from that page>". This is what's embedded. */
  text: string;
};

export type EmbeddedPassage = Passage & { embedding: number[] };

/** The saved file: lib/copper/data/passages.json. */
export type PassageFile = {
  model: EmbeddingModelId;
  dimensions: number;
  createdAt: string;
  passages: EmbeddedPassage[];
};

/** Sentences per passage, and limits so a passage is never tiny or huge. */
export const SENTENCES_PER_PASSAGE = 3;
const MIN_CHARS = 200;
const MAX_CHARS = 900;
/** A leftover this short at the end of a page joins the passage before it. */
const MIN_LEFTOVER_CHARS = 120;

/**
 * Removes the three lines printed at the top of every page: the running title
 * (or "COPPER STATE LABS" on page 1), the document code with the page number,
 * and the copyright notice.
 */
export function cleanPageLines(pageText: string): string[] {
  const lines = pageText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const body = /^CSL-/.test(lines[1] ?? "") ? lines.slice(2) : lines;
  return body.filter((line) => !line.startsWith("©"));
}

// A line that starts something new even if the line before didn't end a
// sentence: a bullet, a FAQ question or answer, a numbered step or heading,
// or a callout.
const STARTS_NEW = /^(•|Q |A |\d+(\.\d+)*\.? +\S|NOTE |TIP |WARNING |CAUTION )/;
const ENDS_SENTENCE = /[.!?]["”)]?$/;
// A sentence ends at . ! or ? (maybe followed by a quote or bracket) and the
// next one starts with a capital, a digit, a quote, a bracket or a bullet.
const SENTENCE_BREAK = /(?<=[.!?]["”)]?)\s+(?=[A-Z0-9"“(•])/;

/**
 * Turns a page into sentences. PDFs wrap lines mid-sentence, so lines are
 * joined back together first; list items, steps and headings have no full
 * stop, so each of those counts as a sentence of its own.
 */
export function pageSentences(pageText: string): string[] {
  const blocks: string[][] = [];
  for (const line of cleanPageLines(pageText)) {
    const last = blocks.at(-1);
    // A bullet's wrapped lines carry on in lower case; a capital after a
    // bullet is the paragraph after the list.
    const leavesList = last?.[0].startsWith("•") && /^[A-Z]/.test(line);
    const continues =
      last &&
      !ENDS_SENTENCE.test(last.at(-1)!) &&
      !STARTS_NEW.test(line) &&
      !leavesList;
    if (continues) last.push(line);
    else blocks.push([line]);
  }
  return blocks
    .flatMap((block) => block.join(" ").split(SENTENCE_BREAK))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Groups a page's sentences into passages of about SENTENCES_PER_PASSAGE. */
export function groupSentences(sentences: string[]): string[] {
  const groups: string[][] = [];
  let current: string[] = [];
  const length = (group: string[]) => group.join(" ").length;
  for (const sentence of sentences) {
    const full =
      current.length >= SENTENCES_PER_PASSAGE && length(current) >= MIN_CHARS;
    const tooLong =
      current.length > 0 && length([...current, sentence]) > MAX_CHARS;
    if (full || tooLong) {
      groups.push(current);
      current = [];
    }
    current.push(sentence);
  }
  if (current.length > 0) {
    const previous = groups.at(-1);
    if (previous && length(current) < MIN_LEFTOVER_CHARS) {
      previous.push(...current);
    } else {
      groups.push(current);
    }
  }
  return groups.map((group) => group.join(" "));
}

/** Splits one page of a document into passages. */
export function splitPage(
  doc: { id: string; title: string },
  page: number,
  pageText: string,
): Passage[] {
  return groupSentences(pageSentences(pageText)).map((body, i) => ({
    id: `${doc.id}-p${page}-${i + 1}`,
    docId: doc.id,
    title: doc.title,
    page,
    text: `${doc.title}: ${body}`,
  }));
}
