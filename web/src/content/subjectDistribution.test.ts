import { describe, it, expect } from "vitest";
import subjectDistribution from "../../../pipeline/rebaseline/subject_distribution.json";

// LINGO-051: Katsuta + Fable derived a target subject-person distribution for
// the RU core sentences from simulating real dating/cafe/small-talk
// conversation (see LINGO-052's onboarding-explanation task, and the design
// note appended to Ideas/20260827-lingogate-multilang-design.md): real
// spoken Russian is я/ты-heavy with natural мы/они/no-subject/dative-
// experiencer constructions — NOT the generic third-person textbook
// statements ("Это трудный курс.") the pre-051 corpus over-represented.
//
// pipeline/rebaseline/classify_subjects.py (pymorphy3 + rule-based; Python
// only, no JS morphological analyzer exists in this repo — see
// lemmaLinkAudit.test.ts's identical reasoning) is the sole classifier.
// This test asserts the CHECKED-IN classification result
// (pipeline/rebaseline/subject_distribution.json) stays within Katsuta's
// approved ±3-percentage-point tolerance of every target bucket. Like
// lemmaLinkAudit.test.ts, this is a data test against a regenerable fixture,
// not a live pymorphy run — regenerate after any RU core sentence edit:
//
//   cd pipeline/rebaseline && .venv/bin/python3 classify_subjects.py \
//     --json subject_distribution.json
const TARGET_PCT: Record<string, number> = {
  я: 30,
  ты: 18,
  вы: 10,
  он: 5,
  она: 5,
  мы: 8,
  они: 4,
  no_subject: 12,
  mne_type: 8,
};
const TOLERANCE_PCT = 3;

type ClassifiedRow = { id: string; bucket: string };

describe("RU core sentence subject-person distribution (LINGO-051)", () => {
  const rows = subjectDistribution as ClassifiedRow[];
  const total = rows.length;

  it("classified every core sentence (sanity check on the fixture itself)", () => {
    expect(total).toBeGreaterThan(0);
  });

  it("has ZERO sentences outside the 9 target buckets ('other' — textbook-flavored/unclassifiable)", () => {
    // "other" is not a target bucket at all: it's the low-practicality pool
    // LINGO-051 rewrote away from. A regression here means new core content
    // was added without fitting any of the 9 real-conversation categories.
    const other = rows.filter((r) => r.bucket === "other");
    expect(other.map((r) => r.id)).toEqual([]);
  });

  for (const [bucket, target] of Object.entries(TARGET_PCT)) {
    it(`'${bucket}' bucket is within ±${TOLERANCE_PCT}pp of its ${target}% target`, () => {
      const count = rows.filter((r) => r.bucket === bucket).length;
      const pct = (100 * count) / total;
      expect(Math.abs(pct - target)).toBeLessThanOrEqual(TOLERANCE_PCT);
    });
  }

  it("он + она combined (dating-scenario 'talking about a specific person') is within ±3pp of 10%, and roughly gender-balanced", () => {
    const on = rows.filter((r) => r.bucket === "он").length;
    const ona = rows.filter((r) => r.bucket === "она").length;
    const combinedPct = (100 * (on + ona)) / total;
    expect(Math.abs(combinedPct - 10)).toBeLessThanOrEqual(3);
    // "男女半々" (roughly even split) — not exact-50/50, but neither side
    // should dominate the он+она pool outright.
    const larger = Math.max(on, ona);
    const smaller = Math.min(on, ona);
    expect(larger).toBeLessThanOrEqual(smaller * 2);
  });
});
