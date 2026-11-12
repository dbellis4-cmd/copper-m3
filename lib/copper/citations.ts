// Copper cites its support answers like [Copper Home User Guide, p. 9]. This
// finds those citations in a reply so the chat panel can turn each one into a
// link that opens the PDF at that page. The link is built here from the
// document list, never written by the model, so it can't point somewhere
// made up. A citation naming a document we don't have stays plain text.
import { DOCUMENTS } from "@/lib/copper/documents";

export type Citation = {
  /** Exactly as Copper wrote it, brackets included. */
  label: string;
  title: string;
  page: number;
  /** Opens the PDF at that page, like /docs/copper-home-user-guide.pdf#page=9. */
  href: string;
};

/** Plain text and citations, in the order they appear in the reply. */
export type ReplyPart = string | Citation;

// [Title, p. 9], also accepting "page 9" and "pg. 9".
const CITATION = /\[([^[\]]+?),\s*(?:p\.|pg\.|page)\s*(\d+)\]/gi;

/** Finds a document by its title, ignoring capitals and extra spaces. */
function documentTitled(title: string) {
  const wanted = title.replace(/\s+/g, " ").trim().toLowerCase();
  return DOCUMENTS.find((d) => d.title.toLowerCase() === wanted);
}

/** Splits a reply into plain text and linkable citations. */
export function splitCitations(reply: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let last = 0;
  for (const match of reply.matchAll(CITATION)) {
    const doc = documentTitled(match[1]);
    if (!doc) continue;
    const page = Number(match[2]);
    if (match.index > last) parts.push(reply.slice(last, match.index));
    parts.push({
      label: match[0],
      title: doc.title,
      page,
      href: `${doc.file}#page=${page}`,
    });
    last = match.index + match[0].length;
  }
  if (last < reply.length) parts.push(reply.slice(last));
  return parts;
}
