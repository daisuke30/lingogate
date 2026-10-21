import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM build script, no type declarations.
import { buildWordChunk } from "../../scripts/build-explain.mjs";
import ruDeck from "../content/deck.ru.json";
import { collectMissingPairLemmas, oppositeAspect, resolveAspectPair } from "./explainPair";
import type { WordDict } from "./explain";

const entry = (lemma: string) =>
  ({
    lemma,
    pos: "verb",
    forms: null,
    aspectUsage: null,
    etymology: "",
    related: [],
    collocations: [],
    commonMistakes: "",
  }) as WordDict[string];

const dict: WordDict = { сказать: entry("сказать"), говорить: entry("говорить") };

describe("oppositeAspect", () => {
  it("pairs the two aspects", () => {
    expect(oppositeAspect("pf")).toBe("impf");
    expect(oppositeAspect("impf")).toBe("pf");
  });

  it("refuses to guess for a biaspectual or unknown verb", () => {
    // Labelling a real word with a wrong aspect is worse than labelling none.
    expect(oppositeAspect("both")).toBeNull();
    expect(oppositeAspect(null)).toBeNull();
    expect(oppositeAspect(undefined)).toBeNull();
  });
});

describe("resolveAspectPair", () => {
  const verb = (over = {}) => ({
    pos: "verb",
    aspect: "pf",
    aspectPair: "говорить",
    pairKind: "pair" as const,
    ...over,
  });

  it("resolves the partner's full entry from the same chunk", () => {
    const pair = resolveAspectPair(verb(), dict);
    expect(pair).toMatchObject({ lemma: "говорить", aspect: "impf", depth: "full" });
    expect(pair?.entry?.lemma).toBe("говорить");
  });

  it("falls back to a brief reference when the partner is not in the dictionary", () => {
    const pair = resolveAspectPair(verb({ aspectPair: "поговаривать" }), dict);
    expect(pair).toMatchObject({ lemma: "поговаривать", depth: "brief", entry: null });
  });

  it("carries the deck gloss when one is available for the partner", () => {
    const pair = resolveAspectPair(verb(), dict, (l) => (l === "говорить" ? "to speak / 話す" : null));
    expect(pair?.gloss).toBe("to speak / 話す");
  });

  it("shows nothing for a verb with no partner", () => {
    expect(resolveAspectPair(verb({ aspectPair: null }), dict)).toBeNull();
  });

  it("shows nothing for a non-verb", () => {
    expect(resolveAspectPair(verb({ pos: "noun" }), dict)).toBeNull();
  });

  it("refuses pairKind 'none' — that verb is nearby, not a partner", () => {
    // LINGO-025 uses "none" for e.g. быть/побыть. Presenting it as "the pair"
    // would teach a relationship Russian does not have.
    expect(resolveAspectPair(verb({ pairKind: "none" }), dict)).toBeNull();
  });

  it("still shows a 'related' verb, which IS a real relationship", () => {
    expect(resolveAspectPair(verb({ pairKind: "related" }), dict)?.lemma).toBe("говорить");
  });

  it("works with no dictionary at all (course without explanations)", () => {
    expect(resolveAspectPair(verb(), null)).toMatchObject({ depth: "brief", entry: null });
  });
});

// The data-completion backlog. This is reported, not enforced: a partner
// outside the 3000-word dictionary is a known gap, not a bug, and the sheet
// degrades to a one-line reference. The number is pinned so that generating
// those entries — or regressing — shows up here instead of going unnoticed.
describe("aspect partners missing from the dictionary (data backlog)", () => {
  const deck = ruDeck as unknown as {
    words: {
      lemma: string;
      pos: string;
      aspect?: string | null;
      aspectPair?: string | null;
      pairKind?: "pair" | "related" | "none" | null;
    }[];
  };

  it("reports how many partner lemmas have no entry", () => {
    const dictJa = buildWordChunk("ja") as WordDict;
    const verbs = deck.words.filter((w) => w.pos === "verb" && w.aspectPair);
    const missing = collectMissingPairLemmas(verbs, dictJa);

    const paired = verbs.filter((v) => dictJa[v.lemma] && resolveAspectPair(v, dictJa)).length;
    const resolvable = paired - missing.length;

    // Printed so `npm test` itself is the report — no separate tool to run.
    console.log(
      `[explain] aspect partners: ${resolvable}/${paired} resolvable, ` +
        `${missing.length} distinct lemmas missing from the dictionary.\n` +
        `[explain] missing: ${missing.join(", ")}`,
    );

    expect(missing.length).toBeGreaterThan(0); // the gap is real today
    expect(missing.length).toBeLessThan(paired); // but most partners DO resolve
    expect(missing).toEqual([...missing].sort()); // stable, diffable ordering
    expect(new Set(missing).size).toBe(missing.length); // de-duplicated
  });

  it("never lists a lemma that is actually present", () => {
    const dictJa = buildWordChunk("ja") as WordDict;
    const verbs = deck.words.filter((w) => w.pos === "verb" && w.aspectPair);
    for (const lemma of collectMissingPairLemmas(verbs, dictJa)) {
      expect(dictJa[lemma], `${lemma} is in the dictionary but was reported missing`).toBeUndefined();
    }
  });
});
