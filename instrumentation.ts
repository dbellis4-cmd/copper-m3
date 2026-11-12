// Next.js runs register() once when a server starts, before it handles any
// request. Loading the passages here puts them in memory up front, and a
// broken passages file shows up at startup instead of on a customer's
// first question.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getPassageIndex } = await import("@/lib/copper/passage-index");
  const { passages, model } = getPassageIndex();
  console.info(`[passages] loaded ${passages.length} passages (${model})`);
}
