import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildDeck } from "../../scripts/build-content.mjs";
import lemmaLinkExceptions from "../../../pipeline/rebaseline/lemma_link_exceptions.json";

// LINGO-049: Katsuta reported that word-breakdown cards like "to spend time"
// (проводить время) / "to make money" (зарабатывать деньги) showed NO verb
// explanation at all on the card back — because the imported/lessons sentence
// never linked the verb's lemma into its `lemmas` array in the first place,
// so it never made it into `wordIds`, so the breakdown UI had nothing to
// render for it. Requirement: every content word a learner can actually SEE
// in the RU text must be reachable from the card's breakdown.
//
// pymorphy3 (Python-only — no JS morphological analyzer exists for Russian
// in this repo, and this repo has no @types/node / node:fs usage in src/ —
// see build.test.ts's own convention of reading pipeline data only through
// buildDeck(), never raw fs) is the only tool that can identify "this token
// is a verb/noun/adjective" from raw RU text, so the actual audit lives in
// pipeline/rebaseline/audit_lemma_links.py, walking every RU sentence source
// (core T/B, old handwritten band1, imported notes, imported lessons) and
// reporting any content-word token pymorphy identifies whose lemma is absent
// from that sentence's declared `lemmas` (and therefore from `wordIds`, via
// build-content.mjs's exact-string lemma->id lookup).
//
// This test asserts the CHECKED-IN result of that audit (a plain JSON file,
// imported like any other JSON asset — resolveJsonModule is already on in
// tsconfig.json) contains nothing beyond the two documented, permanent
// exceptions. It is a data test, not a live pymorphy run — Vitest has no
// Python interpreter — so it can only catch a *newly introduced* unlinked
// verb/noun/adj if someone remembers to regenerate the fixture. That's an
// accepted gap (documented here rather than silently missing): this repo's
// convention (see build.test.ts) is "hardcoded assertions against real
// pipeline data, updated deliberately," and this follows the same shape.
//
// Regenerate after any RU sentence/word data change:
//   cd pipeline/rebaseline && .venv/bin/python3 audit_lemma_links.py \
//     --json lemma_link_exceptions.json
//
// Exceptions whitelist (why these 2 — and ONLY these 2 — are acceptable):
//   - "Франции" (genitive of the country "Франция") is misparsed by pymorphy
//     as a rare NOUN "франций" (the chemical element francium). This is a
//     proper-noun homograph false positive, not a real content-word gap —
//     consistent with this project's existing policy (LINGO-020) of
//     excluding proper nouns from the frequency vocabulary rather than
//     registering nonsense entries like a fake "франций" word.
//   - "Роналдо" (the footballer's name) is misparsed by pymorphy as a rare
//     ADJF "роналдый" (a spurious possessive-adjective reading of the
//     surname). Same proper-noun-homograph class as above.
// Both are permanent, structural pymorphy dictionary quirks (not fixable by
// relinking — there is no correct "роналдый"/"франций" word to link to),
// re-verified after every regeneration of the fixture.
const KNOWN_EXCEPTIONS = [
  { sentence_id: "n0105", lemma: "франций", pos_class: "noun" },
  { sentence_id: "L0023", lemma: "роналдый", pos_class: "adj" },
];

type AuditIssue = {
  file: string;
  sentence_id: string;
  ru: string;
  kind: string;
  pos_class: string;
  lemma: string;
  surface: string;
  in_word_table: boolean;
};

describe("RU verb/noun/adj lemma-link audit (LINGO-049)", () => {
  const fixture = lemmaLinkExceptions as AuditIssue[];

  it("has NO unlinked verb tokens at all (Katsuta's exact bug class)", () => {
    // Verbs are the priority: every verb pymorphy identifies in RU sentence
    // text must have its lemma in that sentence's `lemmas` (and therefore in
    // wordIds) with zero exceptions — unlike noun/adj, no proper-noun-style
    // false positive currently exists for verbs.
    const verbIssues = fixture.filter((r) => r.pos_class === "verb");
    expect(verbIssues).toEqual([]);
  });

  it("has no noun/adj link gaps beyond the documented proper-noun exceptions", () => {
    const otherIssues = fixture.filter((r) => r.pos_class !== "verb");
    const simplified = otherIssues
      .map((r) => ({ sentence_id: r.sentence_id, lemma: r.lemma, pos_class: r.pos_class }))
      .sort((a, b) => a.sentence_id.localeCompare(b.sentence_id));
    const expected = [...KNOWN_EXCEPTIONS].sort((a, b) =>
      a.sentence_id.localeCompare(b.sentence_id),
    );
    expect(simplified).toEqual(expected);
  });

  it("Katsuta's exact reported examples (L0059 зарабатывать деньги, L0084 проводить время) are fixed", () => {
    const deck = buildDeck();
    const wordById = new Map(deck.words.map((w: any) => [w.id, w.lemma]));
    const l0059 = deck.sentences.find((s: any) => s.id === "L0059");
    const l0084 = deck.sentences.find((s: any) => s.id === "L0084");
    expect(l0059).toBeTruthy();
    expect(l0084).toBeTruthy();
    const l0059Lemmas = l0059.wordIds.map((id: number) => wordById.get(id));
    const l0084Lemmas = l0084.wordIds.map((id: number) => wordById.get(id));
    expect(l0059Lemmas).toContain("зарабатывать");
    expect(l0084Lemmas).toContain("проводить");
  });
});
