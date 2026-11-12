import { describe, expect, it } from "vitest";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import { type Citation, splitCitations } from "@/lib/copper/citations";

const citations = (reply: string) =>
  splitCitations(reply).filter((p): p is Citation => typeof p !== "string");

describe("citations in Copper's replies", () => {
  it("turns [Title, p. N] into a link to that page of the PDF", () => {
    const reply =
      "C-47 is a microphone array fault [Copper Home User Guide, p. 9].";
    expect(splitCitations(reply)).toEqual([
      "C-47 is a microphone array fault ",
      {
        label: "[Copper Home User Guide, p. 9]",
        title: "Copper Home User Guide",
        page: 9,
        href: "/docs/copper-home-user-guide.pdf#page=9",
      },
      ".",
    ]);
  });

  it("keeps the text around citations, so nothing in the reply is lost", () => {
    const reply =
      "Tap Change network [Copper Home User Guide, p. 4]. Annual plans get a full refund within 14 days [Copper Plus FAQ, p. 5] [Copper State Labs Terms and Conditions, p. 4].";
    const parts = splitCitations(reply);
    expect(
      parts.map((p) => (typeof p === "string" ? p : p.label)).join(""),
    ).toBe(reply);
    expect(citations(reply).map((c) => c.href)).toEqual([
      "/docs/copper-home-user-guide.pdf#page=4",
      "/docs/copper-plus-faq.pdf#page=5",
      "/docs/copper-terms-and-conditions.pdf#page=4",
    ]);
  });

  it("accepts small variations in how the page is written", () => {
    expect(
      citations(
        "a [copper notes user guide, page 8] b [Copper Plus FAQ, pg. 2]",
      ).map((c) => c.href),
    ).toEqual([
      "/docs/copper-notes-user-guide.pdf#page=8",
      "/docs/copper-plus-faq.pdf#page=2",
    ]);
  });

  it("leaves a citation to a document we don't have as plain text", () => {
    const reply = "Something [Copper Toaster Manual, p. 3].";
    expect(splitCitations(reply)).toEqual([reply]);
  });

  it("leaves a reply without citations unchanged", () => {
    expect(splitCitations("Copper Home is $149.")).toEqual([
      "Copper Home is $149.",
    ]);
    expect(splitCitations("")).toEqual([]);
  });
});

describe("Copper's support instructions", () => {
  it("answers only from search_docs and never guesses", () => {
    expect(COPPER_INSTRUCTIONS).toMatch(/search_docs/);
    expect(COPPER_INSTRUCTIONS).toMatch(/only from the passages/i);
    expect(COPPER_INSTRUCTIONS).toMatch(/never guess/i);
  });

  it("cites every sentence as [Document title, p. N]", () => {
    expect(COPPER_INSTRUCTIONS).toMatch(/every sentence/i);
    expect(COPPER_INSTRUCTIONS).toContain("[Document title, p. N]");
    // The example citation in the instructions must itself be a valid link.
    expect(citations(COPPER_INSTRUCTIONS).length).toBeGreaterThan(0);
  });

  it("gives the exact fallback and points to the Copper Crew", () => {
    expect(COPPER_INSTRUCTIONS).toContain(
      "I couldn't find that in our support docs.",
    );
    expect(COPPER_INSTRUCTIONS).toMatch(/Copper Crew/);
  });
});
