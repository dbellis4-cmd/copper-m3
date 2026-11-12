// The embedded passages from the customer documents, held in memory. The file
// is made by `npm run embed-docs` and loaded once, when the server starts
// (see instrumentation.ts), so searching it never touches the disk.
import saved from "@/lib/copper/data/passages.json";
import type { PassageFile } from "@/lib/copper/passages";

const INDEX = saved as PassageFile;

/** Every passage with its embedding, plus which model made them. */
export function getPassageIndex(): PassageFile {
  return INDEX;
}
