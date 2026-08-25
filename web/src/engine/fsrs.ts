// FSRS-4.5 scheduler — a faithful TypeScript port of the Swift QuizEngine
// implementation (ios/QuizEngine/Sources/QuizEngine/FSRS/FSRS.swift). The Swift
// known-value tests (ios/QuizEngine/Tests/QuizEngineTests/FSRSTests.swift) are
// mirrored 1:1 in fsrs.test.ts, so this file must stay numerically identical.
//
// Formula set (FSRS-4.5):
//   R(t,S)   = (1 + FACTOR · t/S)^DECAY                          (forgetting curve)
//   I(S)     = (S / FACTOR) · (requestRetention^(1/DECAY) − 1)   (next interval)
//   S₀(g)    = w[g-1]                                            (initial stability)
//   D₀(g)    = w[4] − e^(w[5]·(g-1)) + 1                         (initial difficulty)
//   D'       = w[7]·D₀(Easy) + (1−w[7])·(D − w[6]·(g-3))         (difficulty, mean reversion)
//   S_recall = S·(1 + e^(w[8])·(11−D)·S^(−w[9])·(e^((1−R)·w[10])−1)·hard·easy)
//   S_forget = w[11]·D^(−w[12])·((S+1)^w[13] − 1)·e^((1−R)·w[14])
// with DECAY = −0.5 and FACTOR = 19/81 (so at retention 0.9, I(S) == S).
//
// Time is carried as epoch milliseconds (number) everywhere, mirroring how the
// Swift version passes an explicit `now` — no hidden clock, fully deterministic.

export enum Rating {
  Again = 1,
  Hard = 2,
  Good = 3,
  Easy = 4,
}

export const ALL_RATINGS: Rating[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

const DAY_MS = 86_400_000;

export interface FSRSParameters {
  /** 17 weights w[0]…w[16]. */
  w: number[];
  requestRetention: number;
  maximumInterval: number;
  minimumStability: number;
}

/** Default FSRS-4.5 weights — identical vector to FSRSParameters.defaultV45. */
export const DEFAULT_PARAMS: FSRSParameters = {
  w: [
    0.4197, 1.1869, 3.0412, 15.2441, 7.1434, 0.6477, 1.0007, 0.0674, 1.6597,
    0.1712, 1.1178, 2.0225, 0.0904, 0.3025, 2.1214, 0.2498, 2.9466,
  ],
  requestRetention: 0.9,
  maximumInterval: 36500,
  minimumStability: 0.1,
};

/** A learner's scheduling state for one (sentence, direction). null fields = a
 * never-reviewed (new) card. `due`/`lastReview` are epoch milliseconds. */
export interface ReviewState {
  sentenceId: string;
  direction: string;
  stability: number | null;
  difficulty: number | null;
  due: number | null;
  reps: number;
  lapses: number;
  lastReview: number | null;
  state: CardState;
}

export function newReviewState(sentenceId: string, direction = "en2ru"): ReviewState {
  return {
    sentenceId,
    direction,
    stability: null,
    difficulty: null,
    due: null,
    reps: 0,
    lapses: 0,
    lastReview: null,
    state: CardState.New,
  };
}

export class FSRS {
  readonly params: FSRSParameters;
  static readonly decay = -0.5;
  static readonly factor = 19.0 / 81.0;

  constructor(params: FSRSParameters = DEFAULT_PARAMS) {
    if (params.w.length !== 17) throw new Error("FSRS-4.5 requires exactly 17 weights");
    this.params = params;
  }

  // MARK: building blocks (exposed for tests)

  forgettingCurve(elapsedDays: number, stability: number): number {
    return Math.pow(1.0 + FSRS.factor * elapsedDays / stability, FSRS.decay);
  }

  interval(stability: number): number {
    const raw =
      (stability / FSRS.factor) *
      (Math.pow(this.params.requestRetention, 1.0 / FSRS.decay) - 1.0);
    return Math.min(Math.max(raw, this.params.minimumStability), this.params.maximumInterval);
  }

  initialStability(g: Rating): number {
    return Math.max(this.params.w[g - 1], this.params.minimumStability);
  }

  initialDifficulty(g: Rating): number {
    return this.clampDifficulty(this.params.w[4] - Math.exp(this.params.w[5] * (g - 1)) + 1.0);
  }

  nextDifficulty(d: number, g: Rating): number {
    const deltaApplied = d - this.params.w[6] * (g - 3);
    const reverted =
      this.params.w[7] * this.initialDifficulty(Rating.Easy) +
      (1.0 - this.params.w[7]) * deltaApplied;
    return this.clampDifficulty(reverted);
  }

  nextRecallStability(d: number, s: number, r: number, g: Rating): number {
    const hardPenalty = g === Rating.Hard ? this.params.w[15] : 1.0;
    const easyBonus = g === Rating.Easy ? this.params.w[16] : 1.0;
    const increase =
      Math.exp(this.params.w[8]) *
      (11.0 - d) *
      Math.pow(s, -this.params.w[9]) *
      (Math.exp((1.0 - r) * this.params.w[10]) - 1.0) *
      hardPenalty *
      easyBonus;
    return Math.max(s * (1.0 + increase), this.params.minimumStability);
  }

  nextForgetStability(d: number, s: number, r: number): number {
    const sf =
      this.params.w[11] *
      Math.pow(d, -this.params.w[12]) *
      (Math.pow(s + 1.0, this.params.w[13]) - 1.0) *
      Math.exp((1.0 - r) * this.params.w[14]);
    return Math.max(sf, this.params.minimumStability);
  }

  private clampDifficulty(d: number): number {
    return Math.min(Math.max(d, 1.0), 10.0);
  }

  // MARK: review

  /** Retrievability of `card` at `now` (1.0 if never reviewed). */
  retrievability(card: ReviewState, now: number): number {
    if (card.stability == null || card.lastReview == null) return 1.0;
    const elapsed = Math.max(0, now - card.lastReview) / DAY_MS;
    return this.forgettingCurve(elapsed, card.stability);
  }

  /** Apply a review at `now` and return the updated (new) state. Pure. */
  review(card: ReviewState, rating: Rating, now: number): ReviewState {
    const next: ReviewState = { ...card };

    if (card.state === CardState.New || card.stability == null || card.difficulty == null) {
      next.stability = this.initialStability(rating);
      next.difficulty = this.initialDifficulty(rating);
      if (rating === Rating.Again) {
        next.state = CardState.Learning;
      } else {
        next.state = CardState.Review;
        next.reps += 1;
      }
    } else {
      const s = card.stability;
      const d = card.difficulty;
      const r = this.retrievability(card, now);
      if (rating === Rating.Again) {
        next.stability = this.nextForgetStability(d, s, r);
        next.difficulty = this.nextDifficulty(d, rating);
        next.lapses += 1;
        next.state = CardState.Relearning;
      } else {
        next.stability = this.nextRecallStability(d, s, r, rating);
        next.difficulty = this.nextDifficulty(d, rating);
        next.reps += 1;
        next.state = CardState.Review;
      }
    }

    const s = Math.max(next.stability!, this.params.minimumStability);
    next.stability = s;
    const ivlDays = this.interval(s);
    next.lastReview = now;
    next.due = now + ivlDays * DAY_MS;
    return next;
  }
}
