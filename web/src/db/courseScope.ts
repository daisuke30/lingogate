// Pure key-scoping for the LINGO-014 course dimension, split out of idb.ts so
// the separation invariants can be unit-tested without a browser IndexedDB.
//
// Design §2: the migration is *additive only*. The default RU course keeps
// using bare legacy keys (existing rows are byte-for-byte unchanged and read
// back as RU), while any other course namespaces its keys with "<courseId>::".
// Records are therefore separated purely by key shape — no DB version bump, no
// keyPath change, and a second course can never collide with RU's rows.

export const DEFAULT_COURSE = "ru";
export const SEP = "::";

/** Scope a store key (sentenceId / lemma) into a course. RU → unchanged. */
export function scopeKey(courseId: string, key: string): string {
  return courseId === DEFAULT_COURSE ? key : `${courseId}${SEP}${key}`;
}

/** Does a stored key belong to `courseId`? RU owns every un-prefixed (legacy)
 * key; another course owns exactly its own prefix. */
export function belongsToCourse(courseId: string, key: string): boolean {
  return courseId === DEFAULT_COURSE ? !key.includes(SEP) : key.startsWith(`${courseId}${SEP}`);
}

/** Strip the course prefix back off a stored key. */
export function unscopeKey(courseId: string, key: string): string {
  return courseId === DEFAULT_COURSE ? key : key.slice(courseId.length + SEP.length);
}
