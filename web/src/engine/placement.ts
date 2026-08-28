// Adaptive placement test (LINGO-016). Design ref:
// ai-org/Ideas/20260827-lingogate-multilang-design.md §3.1 (confirmed design).
// Replaces the old "judge all 1000 band1 words" linear triage with a short
// (10–40 question) adaptive test that estimates roughly how many of the
// course's 3000 frequency-ranked words the learner already knows, then writes
// that estimate out as assumed known/unknown for the words never actually
// asked — instead of forcing the learner to swipe through all 3000.
//
// Model: word knowledge is modelled as a 2-parameter logistic curve over
// log-rank — P(known | rank) = sigmoid(-(ln(rank) - ln(theta)) * slope) — so
// theta (in rank units) is the point where the learner is 50/50 to know a
// word, which doubles as "approximately how many of the most-frequent words
// they know" (the mastered-word estimate shown in the UI).
//
// Fitting is a small deterministic grid search (coarse grid + one local
// refinement pass) rather than a numeric optimizer library — with at most 40
// (rank, known) data points this converges to the same answer a gradient
// method would, and staying grid-based keeps every result exactly
// reproducible from the same input, which is what makes this file testable
// without a random seed. The only "randomness" anywhere in the placement flow
// is which nearby word breaks a tie when a target rank is already used
// (deterministic nearest-neighbour walk, see selectWordsForRanks) — there is
// no Math.random() / RNG in this module at all.

export interface PlacementResponse {
  lemma: string;
  rank: number;
  known: boolean;
}

export interface RankedWord {
  lemma: string;
  rank: number;
}

export const BLOCK_SIZE = 10;
/** Task Contract's explicit cap ("ソフト上限40問") — takes precedence over the
 * design doc's looser "10〜50問" framing per the arrival instructions (Task
 * Contract is the source of truth). 4 blocks of 10. */
export const MAX_QUESTIONS = 40;
export const MAX_BLOCKS = MAX_QUESTIONS / BLOCK_SIZE;

/** Block 1 (screening): 0 or 1 known out of 10 → judged a complete beginner,
 * test ends immediately (§3.1 step 1, "既知0〜1語 → 完全初心者と判定して即終了"). */
export const BEGINNER_MAX_KNOWN_IN_BLOCK1 = 1;

const DEFAULT_MAX_RANK = 3000;

// --- Super-function-word exclusion (LINGO-018, Katsuta feedback 2026-08-28) --
//
// "a", "the", "be" showed up as placement-test items during his first EN
// look — swiping on them wastes a question, since virtually every learner
// "knows" them regardless of actual level (near-zero diagnostic signal).
// Excluded from the placement CANDIDATE POOL only (never from regular
// sentence-based study, and never from the fitting/sampling *math* below,
// which is unchanged — see placementCandidates()):
//
//  - prepositions / conjunctions / pronouns / particles, always, within the
//    top SUPER_FUNCTION_WORD_MAX_RANK ranks. Safe as a blanket POS rule:
//    these categories are near-universally maximally-frequent function words
//    with no real "do I know this" signal at the very top of any frequency
//    list, in every course (RU's "и"/"в"/"я" behave identically to EN's
//    "and"/"of"/"it").
//  - a small explicit lemma denylist for articles and copula/auxiliary/modal
//    verbs, deliberately NOT a blanket POS rule: our POS taxonomy has no
//    "aux" tag (English "be"/"will"/"can" are tagged pos="verb", same as
//    genuinely diagnostic content verbs like "know"/"get"/"think" — a
//    blanket verb exclusion would wrongly drop those). Determiners have the
//    same problem from the other direction: EN "the"/"a" are empty articles,
//    but RU's rank-42..50 determiners ("мой"/"свой"/"наш"...) are meaningful
//    possessives a learner may genuinely not know, so pos="det" is NOT
//    blanket-excluded either. RU's "быть" (copula, rank 6) gets the same
//    treatment as EN's "be" — same grammatical role, same "同じ基準をRUにも
//    適用" instruction.
export const SUPER_FUNCTION_WORD_MAX_RANK = 50;

const ALWAYS_EXCLUDED_POS = new Set(["prep", "conj", "pron", "part"]);

const ARTICLE_AND_COPULA_LEMMAS = new Set([
  // EN articles
  "a",
  "the",
  // EN copula / auxiliary / modal verbs (pos="verb" in our taxonomy)
  "be",
  "do",
  "have",
  "will",
  "would",
  "can",
  "could",
  "should",
  "must",
  "shall",
  "might",
  // RU copula — same functional role as EN "be".
  "быть",
]);

export interface CandidateWord {
  lemma: string;
  pos: string;
  rank: number | null;
}

/** True for a word that carries ~zero diagnostic value as an isolated
 * placement-test item — see the module doc comment above for the exact rule
 * and its reasoning. */
export function isSuperFunctionWord(word: CandidateWord): boolean {
  const rank = word.rank ?? Number.MAX_SAFE_INTEGER;
  if (rank > SUPER_FUNCTION_WORD_MAX_RANK) return false;
  if (ALWAYS_EXCLUDED_POS.has(word.pos)) return true;
  return ARTICLE_AND_COPULA_LEMMAS.has(word.lemma.toLowerCase());
}

/**
 * The placement test's candidate pool: every ranked word minus super-function
 * words. This is the ONLY place they're filtered — fitPlacement's fitting
 * math and the block-ranks math below are completely unchanged; they simply
 * never see these lemmas because they're absent from the RankedWord[] pool
 * passed in (by callers such as state/placement.ts, which builds this from
 * the full course word list). The *full*, unfiltered word list is still used
 * separately for finalizePlacement's known/unknown write-out, so "the"/"be"/
 * "a" still end up correctly auto-classified (typically assumed-known) even
 * though they were never directly asked.
 */
export function placementCandidates(words: CandidateWord[]): RankedWord[] {
  return words
    .filter((w): w is CandidateWord & { rank: number } => w.rank != null && !isSuperFunctionWord(w))
    .map((w) => ({ lemma: w.lemma, rank: w.rank }))
    .sort((a, b) => a.rank - b.rank);
}
const EPS = 1e-6;
const Z_95 = 1.96;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** P(known) at log-rank x, given the curve's midpoint mu (=ln(theta)) and
 * steepness k. Higher rank (rarer word) → lower probability. */
function pKnownAt(x: number, mu: number, k: number): number {
  return sigmoid(-(x - mu) * k);
}

function logLikelihood(data: { x: number; y: number }[], mu: number, k: number): number {
  let ll = 0;
  for (const { x, y } of data) {
    const p = clamp(pKnownAt(x, mu, k), EPS, 1 - EPS);
    ll += y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  return ll;
}

function linspace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lo + (i / (n - 1)) * (hi - lo));
  return out;
}

// Steepness candidates in log-rank units, geometric-ish spacing — wide enough
// to cover both a sharp "knows everything below X, nothing above" learner and
// a gradual falloff.
const K_GRID = [0.4, 0.6, 0.9, 1.3, 1.9, 2.8, 4.2, 6.3, 9.5];

function bestFit(
  data: { x: number; y: number }[],
  muCandidates: number[],
  kCandidates: number[],
): { mu: number; k: number; ll: number } {
  let best = { mu: muCandidates[0], k: kCandidates[0], ll: -Infinity };
  for (const mu of muCandidates) {
    for (const k of kCandidates) {
      const ll = logLikelihood(data, mu, k);
      if (ll > best.ll) best = { mu, k, ll };
    }
  }
  return best;
}

export interface PlacementFit {
  /** Estimated rank threshold — also the mastered-word-count estimate. */
  theta: number;
  /** Logistic steepness (log-rank units). */
  slope: number;
  /** Approx 95% CI lower bound on theta, in rank units. */
  ciLowRank: number;
  /** Approx 95% CI upper bound on theta, in rank units. */
  ciHighRank: number;
  /** (ciHighRank - ciLowRank) / 2 — the "±帯" width used both for the UI's
   * error display and as the extrapolation band in finalizePlacement. */
  ciHalfWidthWords: number;
  /** True when every response so far was the same (all known or all
   * unknown) — the fit is pinned against a grid boundary rather than a real
   * crossing point, so it's much less trustworthy than usual. */
  degenerate: boolean;
}

/**
 * Fit theta/slope to the responses collected so far via a coarse grid search
 * + one local refinement pass, then approximate theta's 95% CI from the
 * logistic model's Fisher information at the fitted slope (a standard
 * large-sample normal approximation — cheap, deterministic, and precise
 * enough to drive the ±150-word convergence read and the next block's
 * sampling window with this little data).
 */
export function fitPlacement(
  responses: PlacementResponse[],
  maxRank: number = DEFAULT_MAX_RANK,
): PlacementFit {
  const minX = Math.log(1);
  const maxX = Math.log(Math.max(2, maxRank));

  if (responses.length === 0) {
    const mu = (minX + maxX) / 2;
    return {
      theta: Math.exp(mu),
      slope: 1,
      ciLowRank: 1,
      ciHighRank: maxRank,
      ciHalfWidthWords: (maxRank - 1) / 2,
      degenerate: true,
    };
  }

  const data = responses.map((r) => ({ x: Math.log(Math.max(1, r.rank)), y: r.known ? 1 : 0 }));

  // 1. Coarse grid search over mu (61 points spanning the whole rank range) × slope.
  const coarseMu = linspace(minX, maxX, 61);
  let best = bestFit(data, coarseMu, K_GRID);

  // 2. Local refinement: a finer grid around the coarse winner (±1 coarse step
  // for mu, immediate neighbours for k) — a deterministic coordinate-descent
  // step, not a numeric optimizer.
  const coarseStep = (maxX - minX) / 60;
  const fineMu = linspace(
    Math.max(minX, best.mu - coarseStep),
    Math.min(maxX, best.mu + coarseStep),
    41,
  );
  const kIdx = K_GRID.indexOf(best.k);
  const kLo = K_GRID[Math.max(0, kIdx - 1)];
  const kHi = K_GRID[Math.min(K_GRID.length - 1, kIdx + 1)];
  const fineK = linspace(kLo, kHi, 9);
  best = bestFit(data, fineMu, fineK);

  // Fisher information for mu at the fitted k (holding k fixed): I(mu) =
  // sum(k^2 * p*(1-p)); se(mu) = 1/sqrt(I(mu)).
  let info = 0;
  for (const { x } of data) {
    const p = clamp(pKnownAt(x, best.mu, best.k), EPS, 1 - EPS);
    info += best.k * best.k * p * (1 - p);
  }
  const seMu = info > 0 ? 1 / Math.sqrt(info) : maxX - minX; // degenerate -> full-range uncertainty
  const muLow = clamp(best.mu - Z_95 * seMu, minX, maxX);
  const muHigh = clamp(best.mu + Z_95 * seMu, minX, maxX);
  const ciLowRank = clamp(Math.exp(muLow), 1, maxRank);
  const ciHighRank = clamp(Math.exp(muHigh), 1, maxRank);

  const degenerate = data.every((d) => d.y === data[0].y);

  return {
    theta: clamp(Math.exp(best.mu), 1, maxRank),
    slope: best.k,
    ciLowRank,
    ciHighRank,
    ciHalfWidthWords: (ciHighRank - ciLowRank) / 2,
    degenerate,
  };
}

/** Mastered-word-count estimate shown in the UI ("約N語マスター相当"). */
export function estimatedMasteredCount(fit: PlacementFit): number {
  return Math.round(fit.theta);
}

/** Block 1's starting rank (LINGO-018): the super-function-word exclusion
 * already keeps rank <1..50> items out of the candidate pool, so starting
 * block 1's log-spaced sampling at rank 1 would waste several of its 10
 * points on a region where most words are filtered out anyway (they'd just
 * collapse onto the handful of surviving low-rank content words). Starting
 * at 50 spreads block 1 across ranks that are actually eligible to be asked. */
export const BLOCK1_MIN_RANK = SUPER_FUNCTION_WORD_MAX_RANK;

/** Block 1's fixed screening set: 10 words at log-equal rank intervals from
 * BLOCK1_MIN_RANK to maxRank (§3.1 step 1, range adjusted per LINGO-018).
 * Deterministic — no RNG. */
export function block1TargetRanks(
  maxRank: number = DEFAULT_MAX_RANK,
  n: number = BLOCK_SIZE,
  minRank: number = BLOCK1_MIN_RANK,
): number[] {
  const lo = clamp(minRank, 1, maxRank);
  const minX = Math.log(lo);
  const maxX = Math.log(Math.max(lo + 1, maxRank));
  const ranks = new Set<number>();
  for (const x of linspace(minX, maxX, n)) {
    ranks.add(clamp(Math.round(Math.exp(x)), 1, maxRank));
  }
  return [...ranks].sort((a, b) => a - b);
}

/** 0 or 1 known in block 1 → complete beginner, stop immediately (§3.1 step 1). */
export function isBeginnerAfterBlock1(block1Responses: PlacementResponse[]): boolean {
  const known = block1Responses.filter((r) => r.known).length;
  return known <= BEGINNER_MAX_KNOWN_IN_BLOCK1;
}

export interface AdaptiveRankOptions {
  maxRank?: number;
  n?: number;
  /** Sampling window half-width floor/ceiling, in rank units — keeps a very
   * confident fit from asking 10 near-duplicate ranks, and a very uncertain
   * one from spraying across the whole 3000-word range in one block. */
  minWindowWords?: number;
  maxWindowWords?: number;
}

/**
 * Next block's target ranks, log-spaced within a window centred on the
 * current theta estimate and sized to the fit's uncertainty (§3.1 step 2:
 * "推定が粗いうちは広く、絞れてきたら狭く"). This also generically covers the
 * design's "9〜10 known in block 1" upper-bound-confirmation branch: a
 * lopsidedly-known block pushes theta (and its CI) toward the top of the
 * range, so the window naturally lands near the list ceiling without a
 * separate code path — see placement.test.ts for a pinned regression of that
 * behaviour.
 */
export function adaptiveTargetRanks(fit: PlacementFit, opts: AdaptiveRankOptions = {}): number[] {
  const maxRank = opts.maxRank ?? DEFAULT_MAX_RANK;
  const n = opts.n ?? BLOCK_SIZE;
  const minW = opts.minWindowWords ?? 60;
  const maxW = opts.maxWindowWords ?? 1200;
  const halfWidth = clamp(fit.ciHalfWidthWords, minW, maxW);

  let low = clamp(fit.theta - halfWidth, 1, maxRank);
  let high = clamp(fit.theta + halfWidth, 1, maxRank);
  if (high - low < 1) {
    low = Math.max(1, low - 1);
    high = Math.min(maxRank, high + 1);
  }

  const minX = Math.log(low);
  const maxX = Math.log(high);
  const ranks = new Set<number>();
  for (const x of linspace(minX, maxX, n)) {
    ranks.add(clamp(Math.round(Math.exp(x)), 1, maxRank));
  }
  return [...ranks].sort((a, b) => a - b);
}

/** Pick the nearest not-yet-used word to each target rank, walking outward
 * from the binary-search insertion point until an available one is found.
 * Deterministic; ties (equal distance on both sides) favour the lower rank. */
function nearestAvailable(
  words: RankedWord[],
  target: number,
  exclude: ReadonlySet<string>,
  usedThisCall: ReadonlySet<string>,
): RankedWord | null {
  if (words.length === 0) return null;
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].rank < target) lo = mid + 1;
    else hi = mid;
  }
  let left = lo - 1;
  let right = lo;
  const available = (w: RankedWord) => !exclude.has(w.lemma) && !usedThisCall.has(w.lemma);
  while (left >= 0 || right < words.length) {
    const leftDist = left >= 0 ? Math.abs(words[left].rank - target) : Infinity;
    const rightDist = right < words.length ? Math.abs(words[right].rank - target) : Infinity;
    if (leftDist <= rightDist) {
      const w = words[left];
      if (w && available(w)) return w;
      left--;
    } else {
      const w = words[right];
      if (w && available(w)) return w;
      right++;
    }
  }
  return null;
}

/** Resolve a block's target ranks to real (not-yet-asked) course words.
 * `wordsByRank` must be sorted ascending by rank. May return fewer than
 * `targetRanks.length` entries if the course word list is exhausted. */
export function selectWordsForRanks(
  wordsByRank: RankedWord[],
  targetRanks: number[],
  excludeLemmas: ReadonlySet<string>,
): RankedWord[] {
  const chosen: RankedWord[] = [];
  const usedThisCall = new Set<string>();
  for (const target of targetRanks) {
    const word = nearestAvailable(wordsByRank, target, excludeLemmas, usedThisCall);
    if (word) {
      chosen.push(word);
      usedThisCall.add(word.lemma);
    }
  }
  return chosen;
}

export const SEED_STABILITY_MIN_DAYS = 30;
export const SEED_STABILITY_MAX_DAYS = 120;

/**
 * Deterministic 30–120 day spread for assumed-known placement words, keyed by
 * frequency rank so a high-vocabulary learner's few-thousand assumed-known
 * words don't all come due for review on the same day (§3.1 step 6: "頻度順に
 * 30〜120日へ分散"). The most frequent (lowest-rank, most confidently known)
 * words get the longest interval; words closer to the uncertainty boundary
 * (rank near `maxRank`, i.e. near theta's lower CI edge) get the shortest
 * one, so the least-certain assumptions self-correct soonest.
 */
export function dispersedSeedStabilityDays(rank: number, minRank: number, maxRank: number): number {
  if (maxRank <= minRank) return SEED_STABILITY_MAX_DAYS;
  const t = clamp((rank - minRank) / (maxRank - minRank), 0, 1);
  return SEED_STABILITY_MAX_DAYS - t * (SEED_STABILITY_MAX_DAYS - SEED_STABILITY_MIN_DAYS);
}

export interface PlacementWriteout {
  /** Lemmas actually swiped known/unknown during the test — ground truth. */
  judgedKnown: string[];
  judgedUnknown: string[];
  /** Never-asked lemmas extrapolated from the fit: below the band → assumed
   * known, above it → assumed unknown. Words inside the band are left out of
   * both lists entirely (§3.1 step 4: "境界帯はunsetのまま残す"). */
  assumedKnown: string[];
  assumedUnknown: string[];
  bandLowRank: number;
  bandHighRank: number;
  /** 30–120d dispersed FSRS seed stability for each assumedKnown lemma. */
  seedStabilityDaysByLemma: Map<string, number>;
}

/**
 * Partition every course word into judged (ground truth from the swipes) or
 * assumed known/unknown/left-unset, using the fit's CI as the "θ±帯" band
 * (§3.1 step 4). `allWords` should be the full course word list (all bands),
 * sorted ascending by rank; unsorted input still works but is not required to.
 */
export function finalizePlacement(
  fit: PlacementFit,
  responses: PlacementResponse[],
  allWords: RankedWord[],
): PlacementWriteout {
  // Last response for a lemma wins; block sampling never re-asks a lemma
  // within one run, so in practice there is at most one response per lemma.
  const judgedByLemma = new Map<string, boolean>();
  for (const r of responses) judgedByLemma.set(r.lemma, r.known);

  const bandLowRank = fit.ciLowRank;
  const bandHighRank = fit.ciHighRank;

  const judgedKnown: string[] = [];
  const judgedUnknown: string[] = [];
  for (const [lemma, known] of judgedByLemma) (known ? judgedKnown : judgedUnknown).push(lemma);

  const assumedKnown: string[] = [];
  const assumedUnknown: string[] = [];
  const seedStabilityDaysByLemma = new Map<string, number>();

  for (const w of allWords) {
    if (judgedByLemma.has(w.lemma)) continue;
    if (w.rank < bandLowRank) {
      assumedKnown.push(w.lemma);
      seedStabilityDaysByLemma.set(w.lemma, dispersedSeedStabilityDays(w.rank, 1, bandLowRank));
    } else if (w.rank > bandHighRank) {
      assumedUnknown.push(w.lemma);
    }
    // else: inside the band -> left unset, resolved later by normal learning.
  }

  return {
    judgedKnown,
    judgedUnknown,
    assumedKnown,
    assumedUnknown,
    bandLowRank,
    bandHighRank,
    seedStabilityDaysByLemma,
  };
}
