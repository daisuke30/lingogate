# QuizEngine (LINGO-004)

UI- and platform-independent core for LingoGate: the **FSRS spaced-repetition
scheduler**, the **gate-session question builder** (due-first + new-card fill,
wrong-answer re-queue, 4-choice distractor generation), **band promotion**
logic, and a **thin SQLite3 wrapper** over the LINGO-001 content DB
(`lingogate.db`).

Design reference: `ai-org/Ideas/20260703-quiz-gate-app-design.md` §5.

## Why a separate SwiftPM package

- **Zero non-system dependencies.** Only `Foundation` + the system `SQLite3`
  module. No GRDB, no SPM fetch, so the iOS app build needs no network.
- **Builds for macOS and iOS.** It must never import a Screen Time / SwiftUI
  framework, so the whole engine runs under `swift test` on macOS (fast, no
  simulator) and ports cleanly to Android later (design §3).
- Wired into the iOS app as a local package via `ios/project.yml`
  (`packages: QuizEngine` + a `package: QuizEngine` dependency on the `LingoGate`
  target). The three Screen Time extensions do **not** link it.

## Layout

```
Sources/QuizEngine/
  Models/Models.swift          Deck, Word, Sentence, ReviewState, CardState, StudyDirection
  FSRS/FSRS.swift              FSRS-4.5 scheduler (pure; explicit `now`) + Rating/RatingMapper
  SQLite/SQLite.swift          Database / Statement — thin SQLite3 C wrapper
  SQLite/DBOpen.swift          bundle → writable-copy helper (reused by LINGO-005)
  Content/ContentStore.swift   all SQL: reads Deck/Word/Sentence, reads+writes ReviewState/GateSession
  Content/SQLDate.swift        Date <-> SQLite text
  Quiz/RNG.swift               SeededRNG (SplitMix64) — reproducible sessions
  Quiz/Question.swift          Question + QuestionType (sentenceChoice | cloze)
  Quiz/QuestionBuilder.swift   distractor generation + lemma-overlap heuristic
  Quiz/GateSession.swift       GateSessionBuilder / GateSessionRunner / GateController
  Promotion/BandPromotion.swift  coverage 90% × retention 80% gate
```

## Test

```bash
cd ios/QuizEngine
swift test          # 37 tests, macOS — no Xcode/simulator needed
```

The integration test runs against a fixture **copy** of `lingogate.db`
(`Tests/QuizEngineTests/Resources/`); the pipeline's DB is never modified. Refresh
the fixture after a content rebuild with:

```bash
cp ../../pipeline/lingogate.db Tests/QuizEngineTests/Resources/lingogate.db
```

## FSRS parameters

`FSRSParameters.defaultV45` holds the 17-weight FSRS-4.5 default vector, kept as
injectable data so a personally-optimised vector can be swapped in later without
code changes. Formula set (forgetting curve, interval, initial/next stability &
difficulty, mean-reversion) is documented inline in `FSRS/FSRS.swift`. With the
default `requestRetention = 0.9` and `DECAY = -0.5`, the next interval equals the
card's stability.

## Entry point for the UI (LINGO-005)

```swift
let db = try DBOpen.openWritable(bundledAt: Bundle.main.url(forResource: "lingogate", withExtension: "db")!)
let store = ContentStore(db: db)
let deck = try store.deck(code: "RU-from-EN")!
let builder = GateSessionBuilder(store: store,
                                 builder: QuestionBuilder(store: store, deckId: deck.id))
var rng = SeededRNG(seed: UInt64(Date().timeIntervalSince1970))
let plan = try builder.build(deckId: deck.id, band: 1, now: Date(), rng: &rng)
let controller = try GateController(store: store, plan: plan, fsrs: FSRS(),
                                    appBundleID: blockedApp, now: Date())
// drive controller.runner.submit(choiceIndex:now:) per answer;
// call controller.finish(now:unlocked:true) when the gate opens.
```
