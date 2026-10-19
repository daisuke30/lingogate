// LINGO-057 follow-up — human labels for the dictionary's inflection tables.
//
// The LINGO-056 data stores grammatical slots as terse keys (`nom`, `1sg`,
// `past`...). Those are fine as data but wrong on screen: the card back has
// used numbered Russian case names since LINGO-033 ("1格・主格" / "case 1
// (nominative)" / "именительный (1-й)"), and a learner who met that convention
// there should not have to learn a second, abbreviated one inside the
// explanation sheet.
//
// The mapping lives here, as pure functions returning i18n KEYS rather than
// strings, so the sheet stays translatable and the "did we miss an
// abbreviation?" question is answerable by a test rather than by reading the
// rendered page.

/** Russian case abbreviation → the pedagogical case number used app-wide. */
export const CASE_NUMBER_BY_ABBR: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  nom: 1,
  gen: 2,
  dat: 3,
  acc: 4,
  instr: 5,
  prep: 6,
};

/** Verb aspect, as the deck records it. */
export type Aspect = "pf" | "impf" | "both" | null;

/**
 * i18n key for a group heading inside a forms table (`past`, `nonpast`,
 * `imperative`, `sg`), or null if the group is unknown.
 *
 * `nonpast` is the one that depends on the verb (Katsuta's question,
 * 2026-10-19): the schema packs present and future into one slot because
 * Russian conjugates them identically, but the learner never meets a form that
 * is "non-past" — an imperfective verb's я делаю is the PRESENT, and a
 * perfective я сделаю is the FUTURE. Printing the schema's internal name made
 * the table describe the data model instead of the language. With the aspect
 * known we can name what the learner is actually looking at; only a genuinely
 * biaspectual verb (or an unknown aspect) falls back to the neutral wording.
 */
export function formGroupLabelKey(group: string, aspect: Aspect = null): string | null {
  if (group === "nonpast") {
    if (aspect === "impf") return "explain.forms.present";
    if (aspect === "pf") return "explain.forms.future";
    return "explain.forms.nonpast";
  }
  switch (group) {
    case "past":
    case "imperative":
    case "sg":
      return `explain.forms.${group}`;
    default:
      return null;
  }
}

/**
 * The one-line note under a perfective verb's conjugation table. Russian
 * perfectives have no present tense at all — the "present-looking" conjugation
 * IS the future — and that is a thing learners reliably get wrong rather than
 * a subtlety. Null for every other aspect, where there is nothing surprising
 * to say.
 */
export function aspectFormsNoteKey(aspect: Aspect): string | null {
  return aspect === "pf" ? "explain.forms.pfNote" : null;
}

/**
 * i18n key for one cell's label within `group` — the case name for a noun's
 * declension, the person/number for a verb, the gender for an adjective.
 *
 * `group` matters: "pl" means "plural" under `imperative` but "they" under
 * `nonpast`, and bare `m/f/n/pl` on an adjective are genders rather than
 * past-tense agreement. Resolving without the group is how those collapse
 * into one wrong label.
 */
export function formCellLabelKey(group: string, cell: string): string | null {
  if (group === "sg") {
    const n = CASE_NUMBER_BY_ABBR[cell];
    return n ? `case.${n}` : null;
  }
  if (group === "nonpast") {
    return /^[123](sg|pl)$/.test(cell) ? `explain.person.${cell}` : null;
  }
  if (group === "past" || group === "") {
    // past: gender/number agreement. "" is the flat adjective row, which uses
    // the same four labels.
    return ["m", "f", "n", "pl"].includes(cell) ? `explain.gender.${cell}` : null;
  }
  if (group === "imperative") {
    return ["sg", "pl"].includes(cell) ? `explain.number.${cell}` : null;
  }
  return null;
}

/** Every (group, cell) pair the shipped dictionary actually uses. Kept beside
 * the mapping so a test can assert the two have not drifted apart. */
export const KNOWN_FORM_SLOTS: { group: string; cells: string[] }[] = [
  { group: "", cells: ["m", "f", "n", "pl"] },
  { group: "past", cells: ["m", "f", "n", "pl"] },
  { group: "nonpast", cells: ["1sg", "2sg", "3sg", "1pl", "2pl", "3pl"] },
  { group: "imperative", cells: ["sg", "pl"] },
  { group: "sg", cells: ["nom", "gen", "dat", "acc", "instr", "prep"] },
];
