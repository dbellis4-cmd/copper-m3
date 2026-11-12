// npm run embed-docs: reads every PDF in public/docs/, splits each page into
// passages, embeds them with Gemini and saves lib/copper/data/passages.json,
// which the app loads into memory when it starts.
// Run it again whenever a PDF changes. `npm run embed-docs -- --dry-run` only
// splits and counts, without calling Gemini.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { callEmbedMany, isAiConfigured } from "@/lib/ai/call";
import { EMBEDDING_MODEL } from "@/lib/ai/models";
import { DOCUMENTS } from "@/lib/copper/documents";
import {
  type EmbeddedPassage,
  type Passage,
  type PassageFile,
  splitPage,
} from "@/lib/copper/passages";

const ROOT = process.cwd();
const OUT = join(ROOT, "lib/copper/data/passages.json");
const dryRun = process.argv.includes("--dry-run");

// Same key the app uses; the value is never printed.
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(".env.local");

async function readPages(file: string): Promise<string[]> {
  const bytes = await readFile(join(ROOT, "public", file));
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

const passages: Passage[] = [];
for (const doc of DOCUMENTS) {
  if (!existsSync(join(ROOT, "public", doc.file))) {
    console.error(`Missing ${doc.file}: add the PDF to public/docs/ first.`);
    process.exit(1);
  }
  const pages = await readPages(doc.file);
  pages.forEach((text, i) => passages.push(...splitPage(doc, i + 1, text)));
}

console.log("Passages per document:");
for (const doc of DOCUMENTS) {
  const mine = passages.filter((p) => p.docId === doc.id);
  const pages = new Set(mine.map((p) => p.page)).size;
  console.log(`  ${doc.title}: ${mine.length} passages from ${pages} pages`);
}
console.log(`  Total: ${passages.length}`);

if (dryRun) {
  console.log("\nDry run: nothing embedded or saved. Sample passages:");
  for (const p of passages.filter((_, i) => i % 15 === 0)) {
    console.log(`\n[${p.id}] ${p.text}`);
  }
  process.exit(0);
}

if (!isAiConfigured()) {
  console.error(
    "Set up AI first: add GOOGLE_GENERATIVE_AI_API_KEY to .env.local.",
  );
  process.exit(1);
}

const { embeddings } = await callEmbedMany(
  { module: 3, feature: "embed-docs" },
  { values: passages.map((p) => p.text), task: "RETRIEVAL_DOCUMENT" },
);

// Six decimal places is far more precision than search needs and keeps the
// file about half the size.
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const embedded: EmbeddedPassage[] = passages.map((p, i) => ({
  ...p,
  embedding: embeddings[i].map(round),
}));

const file: PassageFile = {
  model: EMBEDDING_MODEL.id,
  dimensions: EMBEDDING_MODEL.dimensions,
  createdAt: new Date().toISOString(),
  passages: embedded,
};

// One passage per line, so a change to one PDF shows up as a readable diff.
const { passages: list, ...meta } = file;
const header = JSON.stringify(meta).slice(0, -1);
const body = list.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
await writeFile(OUT, `${header},\n  "passages": [\n${body}\n  ]\n}\n`);
console.log(
  `\nSaved ${embedded.length} passages to lib/copper/data/passages.json`,
);
