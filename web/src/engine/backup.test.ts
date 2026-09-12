import { describe, it, expect } from "vitest";
import {
  BACKUP_SCHEMA_VERSION,
  buildBackupFile,
  chooseBackupPet,
  mergeBackups,
  mergeGateSessions,
  mergeReviewStates,
  mergeWordKnowledge,
  newGateSessions,
  validateBackupFile,
} from "./backup";
import type {
  BackupCourseData,
  BackupFile,
  BackupGateSession,
  BackupPet,
  BackupSettings,
} from "./backup";
import { CardState, newReviewState } from "./fsrs";
import type { ReviewState } from "./fsrs";
import type { WordKnowledge } from "./calibration";

const NOW = 1_800_000_000_000;

function wk(lemma: string, status: WordKnowledge["status"], updatedAt: number): WordKnowledge {
  return { lemma, status, updatedAt, source: "calibration" };
}

function rs(sentenceId: string, lastReview: number | null, stability = 10): ReviewState {
  return {
    ...newReviewState(sentenceId),
    lastReview,
    stability,
    difficulty: 5,
    due: (lastReview ?? 0) + 86_400_000,
    reps: 1,
    lapses: 0,
    state: CardState.Review,
  };
}

function session(startedAt: number, over: Partial<BackupGateSession> = {}): BackupGateSession {
  return {
    courseId: "ru",
    appKey: "tiktok",
    startedAt,
    endedAt: startedAt + 60_000,
    questions: 10,
    correct: 8,
    durationMs: 60_000,
    unlocked: true,
    ...over,
  };
}

const emptySettings: BackupSettings = {
  appLang: "ja",
  activeCourse: "ru",
  frontLangByCourse: {},
  unlockMinutes: 10,
  quizMode: "flashcard",
  ttsEnabled: true,
  ttsRate: 1.0,
  onboardingSeen: false,
  placementDoneByCourse: {},
};

function emptyCourse(): BackupCourseData {
  return { wordKnowledge: [], reviewStates: [], gateSessions: [] };
}

// --- buildBackupFile ---------------------------------------------------------

describe("buildBackupFile", () => {
  it("stamps the current schema version and given now/appVersion, deterministically", () => {
    const file = buildBackupFile({}, emptySettings, NOW, "abc123");
    expect(file.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(file.exportedAt).toBe(NOW);
    expect(file.appVersion).toBe("abc123");
    expect(buildBackupFile({}, emptySettings, NOW, "abc123")).toEqual(file);
  });
});

// --- validateBackupFile: version mismatch -----------------------------------

describe("validateBackupFile — schema version handling", () => {
  it("accepts the current schema version", () => {
    const file = buildBackupFile({}, emptySettings, NOW, "v1");
    const result = validateBackupFile(JSON.parse(JSON.stringify(file)));
    expect(result.ok).toBe(true);
    expect(result.file?.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
  });

  it("rejects a backup from a NEWER (future) app version", () => {
    const result = validateBackupFile({
      schemaVersion: BACKUP_SCHEMA_VERSION + 1,
      courses: {},
      settings: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unsupported-schema-version");
  });

  it("rejects a missing or non-numeric schemaVersion", () => {
    expect(validateBackupFile({ courses: {}, settings: {} }).error).toBe("missing-schema-version");
    expect(validateBackupFile({ schemaVersion: "1", courses: {} }).error).toBe(
      "missing-schema-version",
    );
    expect(validateBackupFile({ schemaVersion: 0 }).error).toBe("missing-schema-version");
  });

  it("rejects non-object input entirely (invalid JSON shape)", () => {
    expect(validateBackupFile(null).error).toBe("invalid-json");
    expect(validateBackupFile("a string").error).toBe("invalid-json");
    expect(validateBackupFile([1, 2, 3]).error).toBe("invalid-json");
    expect(validateBackupFile(42).error).toBe("invalid-json");
  });
});

// --- validateBackupFile: partial data ---------------------------------------

describe("validateBackupFile — partial/incomplete data degrades gracefully", () => {
  it("fills a missing top-level courses/settings with empty defaults instead of failing", () => {
    const result = validateBackupFile({ schemaVersion: 1 });
    expect(result.ok).toBe(true);
    expect(result.file?.courses).toEqual({});
    expect(result.file?.settings).toMatchObject({ appLang: "ja", activeCourse: "ru" });
  });

  it("fills a course missing one or more arrays with empty arrays, keeping the ones present", () => {
    const result = validateBackupFile({
      schemaVersion: 1,
      courses: { ru: { wordKnowledge: [wk("дом", "known", NOW)] } }, // reviewStates/gateSessions absent
    });
    expect(result.ok).toBe(true);
    expect(result.file?.courses.ru).toEqual({
      wordKnowledge: [wk("дом", "known", NOW)],
      reviewStates: [],
      gateSessions: [],
    });
  });

  it("fills individual missing settings fields with defaults, keeping present ones", () => {
    const result = validateBackupFile({
      schemaVersion: 1,
      settings: { unlockMinutes: 30 }, // everything else absent
    });
    expect(result.ok).toBe(true);
    expect(result.file?.settings.unlockMinutes).toBe(30);
    expect(result.file?.settings.appLang).toBe("ja"); // default
    expect(result.file?.settings.ttsEnabled).toBe(true); // default
  });

  it("tolerates a garbage (non-object) course entry without throwing", () => {
    const result = validateBackupFile({ schemaVersion: 1, courses: { ru: "not an object" } });
    expect(result.ok).toBe(true);
    expect(result.file?.courses.ru).toEqual(emptyCourse());
  });
});

// --- mergeWordKnowledge: conflicts -------------------------------------------

describe("mergeWordKnowledge (conflict resolution: newer updatedAt wins)", () => {
  it("keeps the newer row when both sides judged the same lemma differently", () => {
    const existing = [wk("дом", "unknown", 100)];
    const incoming = [wk("дом", "known", 200)];
    expect(mergeWordKnowledge(existing, incoming)).toEqual([wk("дом", "known", 200)]);
  });

  it("keeps the existing (newer) row when the incoming one is older", () => {
    const existing = [wk("дом", "known", 200)];
    const incoming = [wk("дом", "unknown", 100)];
    expect(mergeWordKnowledge(existing, incoming)).toEqual([wk("дом", "known", 200)]);
  });

  it("an exact-tie updatedAt favours the incoming (imported) row", () => {
    const existing = [wk("дом", "unknown", 100)];
    const incoming = [wk("дом", "known", 100)];
    expect(mergeWordKnowledge(existing, incoming)).toEqual([wk("дом", "known", 100)]);
  });

  it("unions lemmas present on only one side", () => {
    const existing = [wk("дом", "known", 100)];
    const incoming = [wk("рука", "known", 100)];
    const merged = mergeWordKnowledge(existing, incoming);
    expect(merged.map((r) => r.lemma).sort()).toEqual(["дом", "рука"]);
  });
});

// --- mergeReviewStates: conflicts --------------------------------------------

describe("mergeReviewStates (conflict resolution: newer lastReview wins)", () => {
  it("keeps the newer-lastReview state per sentenceId", () => {
    const existing = [rs("T1", 100, 5)];
    const incoming = [rs("T1", 200, 20)];
    const merged = mergeReviewStates(existing, incoming);
    expect(merged).toEqual([rs("T1", 200, 20)]);
  });

  it("a real reviewed state always beats a never-reviewed (lastReview=null) one", () => {
    const neverReviewed = { ...rs("T1", null), state: CardState.New, stability: null, lastReview: null };
    const reviewed = rs("T1", 50);
    expect(mergeReviewStates([neverReviewed], [reviewed])).toEqual([reviewed]);
    expect(mergeReviewStates([reviewed], [neverReviewed])).toEqual([reviewed]);
  });

  it("unions sentenceIds present on only one side", () => {
    const merged = mergeReviewStates([rs("T1", 100)], [rs("T2", 100)]);
    expect(merged.map((r) => r.sentenceId).sort()).toEqual(["T1", "T2"]);
  });
});

// --- gate session dedupe/merge -----------------------------------------------

describe("newGateSessions / mergeGateSessions (identity-based union, not value comparison)", () => {
  it("identifies a session already present (same courseId+startedAt+appKey) as not new", () => {
    const existing = [session(1000)];
    const incoming = [session(1000)]; // identical identity
    expect(newGateSessions(existing, incoming)).toEqual([]);
    expect(mergeGateSessions(existing, incoming)).toEqual(existing);
  });

  it("treats a different startedAt as a genuinely new session", () => {
    const existing = [session(1000)];
    const incoming = [session(2000)];
    expect(newGateSessions(existing, incoming)).toEqual([session(2000)]);
    expect(mergeGateSessions(existing, incoming)).toEqual([session(1000), session(2000)]);
  });

  it("treats the same startedAt but a different appKey as a distinct session", () => {
    const existing = [session(1000, { appKey: "tiktok" })];
    const incoming = [session(1000, { appKey: "youtube" })];
    expect(newGateSessions(existing, incoming)).toEqual([session(1000, { appKey: "youtube" })]);
  });
});

// --- top-level mergeBackups ---------------------------------------------------

describe("mergeBackups", () => {
  it("merge mode: per-course merges data but leaves settingsToApply null (never touches current device's prefs)", () => {
    const current = {
      courses: { ru: { wordKnowledge: [wk("дом", "unknown", 100)], reviewStates: [], gateSessions: [] } },
      settings: emptySettings,
    };
    const incomingFile: BackupFile = buildBackupFile(
      { ru: { wordKnowledge: [wk("дом", "known", 200)], reviewStates: [], gateSessions: [] } },
      { ...emptySettings, unlockMinutes: 999 }, // should NOT leak into the result
      NOW,
      "v1",
    );
    const result = mergeBackups(current, incomingFile, false);
    expect(result.settingsToApply).toBeNull();
    expect(result.courses.ru.wordKnowledge).toEqual([wk("дом", "known", 200)]);
  });

  it("merge mode: a course only present in the backup is added wholesale", () => {
    const current = { courses: {}, settings: emptySettings };
    const incomingFile = buildBackupFile(
      { en: { wordKnowledge: [wk("dog", "known", 100)], reviewStates: [], gateSessions: [] } },
      emptySettings,
      NOW,
      "v1",
    );
    const result = mergeBackups(current, incomingFile, false);
    expect(result.courses.en.wordKnowledge).toEqual([wk("dog", "known", 100)]);
  });

  it("replace-all mode: the backup wins entirely, including settings", () => {
    const current = {
      courses: { ru: { wordKnowledge: [wk("дом", "known", 999)], reviewStates: [], gateSessions: [] } },
      settings: emptySettings,
    };
    const incomingFile = buildBackupFile(
      { en: { wordKnowledge: [wk("dog", "known", 1)], reviewStates: [], gateSessions: [] } },
      { ...emptySettings, unlockMinutes: 5 },
      NOW,
      "v1",
    );
    const result = mergeBackups(current, incomingFile, true);
    expect(result.courses).toEqual(incomingFile.courses); // ru is gone entirely — not merged
    expect(result.settingsToApply).toEqual(incomingFile.settings);
  });
});

// --- pet in backups (LINGO-048) ---------------------------------------------
// The pet was the one piece of real progress a backup did not protect: a
// Safari eviction wiped weeks of feeding with no way back. These pin the two
// things that must never break — old files still import, and restoring a
// backup never costs the learner a pet.

function petOf(generation: number, reach = 0, name?: string): BackupPet {
  return {
    state: { generation, speciesId: "mochi", bornAt: reach, lastFedAt: reach, poopAccruedAt: reach },
    collection: [{ speciesId: "mochi", generation, reachedAt: reach }],
    namesByGeneration: name ? { [String(generation)]: name } : {},
  };
}

describe("backup schema v2: pet", () => {
  it("round-trips a pet through build + validate", () => {
    const pet = petOf(3, 1_700_000_000_000, "モチモ");
    const file = buildBackupFile({}, emptySettings, 123, "test", pet);
    expect(file.schemaVersion).toBe(2);
    const res = validateBackupFile(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(true);
    expect(res.file?.pet?.state).toMatchObject({ generation: 3 });
    expect(res.file?.pet?.collection).toHaveLength(1);
    expect(res.file?.pet?.namesByGeneration).toEqual({ "3": "モチモ" });
  });

  it("still reads a v1 file, and reports no pet rather than an empty one", () => {
    const v1 = {
      schemaVersion: 1,
      exportedAt: 1,
      appVersion: "old",
      courses: {},
      settings: {},
    };
    const res = validateBackupFile(v1);
    expect(res.ok).toBe(true);
    expect(res.file).toBeDefined();
    expect(res.file?.pet).toBeUndefined();
  });

  it("omits the pet block entirely when there is nothing to save", () => {
    const file = buildBackupFile({}, emptySettings, 1, "test");
    expect("pet" in file).toBe(false);
  });

  it("rejects a file from a newer schema than this build understands", () => {
    const res = validateBackupFile({ schemaVersion: 99, courses: {}, settings: {} });
    expect(res.ok).toBe(false);
  });
});

describe("chooseBackupPet", () => {
  it("prefers the later generation — generations only ever move forward", () => {
    expect(chooseBackupPet(petOf(1), petOf(2))).toMatchObject({ state: { generation: 2 } });
  });

  it("keeps the device's pet when the incoming one is from an earlier generation", () => {
    expect(chooseBackupPet(petOf(5), petOf(2))).toBeNull();
  });

  it("within one generation, the more recently cared-for pet wins", () => {
    const older = petOf(3, 1000);
    const newer = petOf(3, 9000);
    expect(chooseBackupPet(older, newer)).toBe(newer);
    expect(chooseBackupPet(newer, older)).toBeNull();
  });

  it("takes the incoming pet when the device has none", () => {
    expect(chooseBackupPet(undefined, petOf(1))).toMatchObject({ state: { generation: 1 } });
  });

  it("never wipes a pet just because the backup has none (a v1 restore)", () => {
    expect(chooseBackupPet(petOf(4), undefined)).toBeNull();
    expect(chooseBackupPet(petOf(4), { state: null, collection: [], namesByGeneration: {} })).toBeNull();
  });
});

describe("mergeBackups: pet", () => {
  const base = { courses: {}, settings: emptySettings };

  it("merge mode applies the chosen pet", () => {
    const incoming = buildBackupFile({}, emptySettings, 1, "t", petOf(7, 50));
    const res = mergeBackups({ ...base, pet: petOf(2, 10) }, incoming, false);
    expect(res.petToApply).toMatchObject({ state: { generation: 7 } });
  });

  it("merge mode leaves the device's pet alone when it is further along", () => {
    const incoming = buildBackupFile({}, emptySettings, 1, "t", petOf(2, 10));
    const res = mergeBackups({ ...base, pet: petOf(7, 50) }, incoming, false);
    expect(res.petToApply).toBeNull();
  });

  it("replace-all applies the backup's pet verbatim", () => {
    const incoming = buildBackupFile({}, emptySettings, 1, "t", petOf(2, 10));
    const res = mergeBackups({ ...base, pet: petOf(7, 50) }, incoming, true);
    expect(res.petToApply).toMatchObject({ state: { generation: 2 } });
  });

  it("replace-all from a v1 file reports no pet (not a deletion of one)", () => {
    const incoming = buildBackupFile({}, emptySettings, 1, "t");
    expect(mergeBackups({ ...base, pet: petOf(7) }, incoming, true).petToApply).toBeNull();
  });
});
